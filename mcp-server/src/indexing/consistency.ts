import fs from 'node:fs/promises';
import path from 'node:path';

import {
  evaluateCatastrophicCountRegressions,
  findPriorTrustedGenerationBaseline,
} from './count-regressions.js';
import { buildCodeGraphFromSymbolIndex } from '../graph/build-graph.js';
import { loadRepoResolutionConfigs } from '../graph/repo-config.js';
import type { CodeGraphSnapshot } from '../graph/types.js';
import { loadPatternIndexResult, savePatternIndex } from '../patterns/store.js';
import type { PatternIndex } from '../patterns/types.js';
import { loadSymbolIndex, saveSymbolIndex } from '../symbol-index/store.js';
import type { IndexedSymbol, SymbolFrequencyStats, SymbolIndex } from '../symbol-index/types.js';
import { loadUiCompositionIndex, saveUiCompositionIndex } from '../ui-composition/store.js';
import type { UiCompositionIndex } from '../ui-composition/types.js';
import { loadUiPropSurfaceIndex, saveUiPropSurfaceIndex } from '../ui-props/store.js';
import type { UiPropSurfaceIndex } from '../ui-props/types.js';
import {
  getCoordinationDirectory,
  getDataDirectory,
  getGenerationArtifactFilePath,
  getGenerationsDirectory,
  getGenerationStateFilePath,
  loadCurrentGenerationPointer,
  loadCurrentGenerationState,
  loadSearchRefreshRequestResult,
  loadSearchRefreshSnapshotResult,
  updateGenerationState,
} from './generation-store.js';
import { getCurrentIndexHealth } from './health.js';
import { deriveSearchFreshness } from './search-freshness.js';
import type {
  CoordinationMarkerParseResult,
  ConsistencyCheckResult,
  ConsistencyCheckSeverity,
  ConsistencyRepairRecord,
  ConsistencyRunOverview,
  ConsistencyRunReport,
  GenerationChangeSummary,
  IndexGenerationCounts,
  IndexGenerationState,
  SearchFreshnessState,
} from './types.js';

const CONSISTENCY_REPORT_SCHEMA_VERSION = 1;
const REQUIRED_GENERATION_ARTIFACTS = [
  'symbol-index.json',
  'code-graph.json',
  'ui-composition.json',
  'ui-props.json',
  'pattern-candidates.json',
  'change-summary.json',
] as const;
const ROOT_TEMP_FILES = [
  'current-generation.tmp.json',
  'symbol-index.tmp.json',
  'code-graph.tmp.json',
  'ui-composition.tmp.json',
  'ui-props.tmp.json',
  'pattern-candidates.tmp.json',
] as const;

interface RunConsistencyMaintenanceOptions {
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  applyRepairs?: boolean;
}

interface JsonFileStatus<T> {
  path: string;
  exists: boolean;
  malformed: boolean;
  value: T | null;
}

function createEmptySymbolFrequencyStats(): SymbolFrequencyStats {
  return {
    globalByName: Object.create(null) as SymbolFrequencyStats['globalByName'],
    globalByNameLower: Object.create(null) as SymbolFrequencyStats['globalByNameLower'],
    byRepo: Object.create(null) as SymbolFrequencyStats['byRepo'],
    exportedByName: Object.create(null) as SymbolFrequencyStats['exportedByName'],
    byKind: Object.create(null) as SymbolFrequencyStats['byKind'],
  };
}

function incrementCounter(table: Record<string, number>, key: string): void {
  table[key] = (table[key] ?? 0) + 1;
}

function incrementNestedCounter(
  table: Record<string, Record<string, number>>,
  outerKey: string,
  innerKey: string,
): void {
  if (!table[outerKey]) {
    table[outerKey] = Object.create(null) as Record<string, number>;
  }

  incrementCounter(table[outerKey], innerKey);
}

function rebuildLookups(symbols: IndexedSymbol[]): Pick<SymbolIndex, 'byName' | 'byNameLower' | 'stats'> {
  const byName = Object.create(null) as SymbolIndex['byName'];
  const byNameLower = Object.create(null) as SymbolIndex['byNameLower'];
  const stats = createEmptySymbolFrequencyStats();

  for (const symbol of symbols) {
    if (!Array.isArray(byName[symbol.name])) {
      byName[symbol.name] = [];
    }

    if (!Array.isArray(byNameLower[symbol.name.toLowerCase()])) {
      byNameLower[symbol.name.toLowerCase()] = [];
    }

    byName[symbol.name].push(symbol);
    byNameLower[symbol.name.toLowerCase()].push(symbol);
    incrementCounter(stats.globalByName, symbol.name);
    incrementCounter(stats.globalByNameLower, symbol.name.toLowerCase());
    incrementNestedCounter(stats.byRepo, symbol.repo, symbol.name);
    incrementNestedCounter(stats.byKind, symbol.kind, symbol.name);

    if (symbol.exported) {
      incrementCounter(stats.exportedByName, symbol.name);
    }
  }

  return { byName, byNameLower, stats };
}

function createCounts(
  symbolIndex: SymbolIndex,
  graph: CodeGraphSnapshot,
  uiComposition: UiCompositionIndex,
  uiProps: UiPropSurfaceIndex,
  patternIndex: PatternIndex,
): IndexGenerationCounts {
  return {
    files: Object.keys(symbolIndex.byFile).length,
    symbols: symbolIndex.symbols.length,
    fileRecords: Object.keys(symbolIndex.byFile).length,
    graphFiles: Object.keys(graph.nodes.files).length,
    graphSymbols: Object.keys(graph.nodes.symbols).length,
    graphEdges: graph.edges.length,
    uiCompositionEdges: uiComposition.edges.length,
    uiPropUsages: uiProps.propUsages.length,
    patterns: patternIndex.patterns.length,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFileStatus<T>(filePath: string): Promise<JsonFileStatus<T>> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return {
      path: filePath,
      exists: true,
      malformed: false,
      value: JSON.parse(content) as T,
    };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return { path: filePath, exists: false, malformed: false, value: null };
    }

    return { path: filePath, exists: true, malformed: true, value: null };
  }
}

function describeCoordinationMarkerIssue(
  label: string,
  result: CoordinationMarkerParseResult<unknown>,
): string | null {
  if (result.status === 'ok') {
    return null;
  }

  return `${label} marker ${result.status} at ${result.path}: ${result.reason}`;
}

function createRepairRecord(
  actionId: string,
  description: string,
  disposition: ConsistencyRepairRecord['disposition'],
  targetArtifacts: string[],
  affectedFiles: string[],
  details?: string,
): ConsistencyRepairRecord {
  return {
    actionId,
    description,
    disposition,
    targetArtifacts,
    affectedFiles: Array.from(new Set(affectedFiles)).sort((left, right) => left.localeCompare(right)),
    details,
  };
}

function createCheckResult(
  checkId: string,
  name: string,
  severity: ConsistencyCheckSeverity,
  scope: ConsistencyCheckResult['scope'],
): ConsistencyCheckResult {
  return {
    checkId,
    name,
    severity,
    scope,
    status: 'passed',
    summary: 'check passed',
    details: [],
    targetArtifacts: [],
    affectedFiles: [],
    repairsApplied: [],
    repairsRecommended: [],
  };
}

function summarizeOverview(checks: ConsistencyCheckResult[]): ConsistencyRunOverview {
  return {
    checksExecuted: checks.length,
    passed: checks.filter((check) => check.status === 'passed').length,
    warnings: checks.filter((check) => check.status === 'warning').length,
    failed: checks.filter((check) => check.status === 'failed').length,
    repaired: checks.filter((check) => check.status === 'repaired').length,
    repairsApplied: checks.reduce((count, check) => count + check.repairsApplied.length, 0),
    repairsRecommended: checks.reduce((count, check) => count + check.repairsRecommended.length, 0),
  };
}

function isRiskyChangeSummary(changeSummary: GenerationChangeSummary | null): boolean {
  if (!changeSummary) {
    return false;
  }

  return (
    changeSummary.overview.highRiskFiles > 0 ||
    (changeSummary.overview.signalCounts.unknownStructuralChange ?? 0) > 0
  );
}

function collectKnownManifestMaps(state: IndexGenerationState): {
  manifestFileIds: Set<string>;
  manifestPaths: Set<string>;
  pathByFileId: Map<string, string>;
} {
  const manifestFileIds = new Set<string>();
  const manifestPaths = new Set<string>();
  const pathByFileId = new Map<string, string>();

  for (const relation of state.manifest) {
    const fileId = `${relation.repoId}:${relation.filePath}`;
    manifestFileIds.add(fileId);
    manifestPaths.add(relation.filePath);
    pathByFileId.set(fileId, relation.filePath);
  }

  return { manifestFileIds, manifestPaths, pathByFileId };
}

function normalizeFileId(repoId: string, filePath: string): string {
  return `${repoId}:${filePath}`;
}

function createManifestFileMapsFromRelations(symbolIndex: SymbolIndex): Map<string, string> {
  const paths = new Map<string, string>();

  for (const relation of Object.values(symbolIndex.byFile)) {
    paths.set(relation.fileId, relation.filePath);
  }

  return paths;
}

function sortStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

async function saveConsistencyReport(report: ConsistencyRunReport): Promise<void> {
  const filePath = getGenerationArtifactFilePath(report.generationId, 'consistency-report.json');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(report, null, 2), 'utf8');
}

export async function loadCurrentConsistencyReport(): Promise<ConsistencyRunReport | null> {
  const pointer = await loadCurrentGenerationPointer();

  if (!pointer) {
    return null;
  }

  const status = await readJsonFileStatus<ConsistencyRunReport>(
    getGenerationArtifactFilePath(pointer.generationId, 'consistency-report.json'),
  );
  return status.exists && !status.malformed ? status.value : null;
}

export async function runCurrentGenerationConsistencyMaintenance(
  options: RunConsistencyMaintenanceOptions = {},
): Promise<ConsistencyRunReport | null> {
  const logger = options.logger ?? console;
  const applyRepairs = options.applyRepairs ?? true;
  const state = await loadCurrentGenerationState();

  if (!state) {
    return null;
  }

  const generationId = state.generationId;
  const artifactStatuses = await Promise.all(
    REQUIRED_GENERATION_ARTIFACTS.map(async (fileName) => ({
      fileName,
      exists: await fileExists(getGenerationArtifactFilePath(generationId, fileName)),
    })),
  );
  const changeSummaryStatus = await readJsonFileStatus<GenerationChangeSummary>(
    getGenerationArtifactFilePath(generationId, 'change-summary.json'),
  );
  const currentSymbolIndex = await loadSymbolIndex();
  const currentGraph = await (await import('../graph/store.js')).loadCodeGraph();
  let symbolIndex = currentSymbolIndex;
  let graph = currentGraph;
  let uiComposition = await loadUiCompositionIndex();
  let uiProps = await loadUiPropSurfaceIndex();
  const patternIndexLoadResult = await loadPatternIndexResult();
  let patternIndex = patternIndexLoadResult.value;
  let generationState = state;
  let symbolIndexChanged = false;
  let graphChanged = false;
  let uiCompositionChanged = false;
  let uiPropsChanged = false;
  let patternIndexChanged = false;
  let stateChanged = false;
  const checks: ConsistencyCheckResult[] = [];

  const missingArtifacts = createCheckResult(
    'generation-required-artifacts',
    'Required generation artifacts',
    'error',
    'generation',
  );
  const missingArtifactNames = artifactStatuses.filter((entry) => !entry.exists).map((entry) => entry.fileName);

  if (missingArtifactNames.length > 0) {
    missingArtifacts.status = 'failed';
    missingArtifacts.summary = `missing ${missingArtifactNames.length} required published artifacts`;
    missingArtifacts.details = missingArtifactNames.map((fileName) => `${fileName} is missing from the published generation directory`);
    missingArtifacts.targetArtifacts = missingArtifactNames;
    missingArtifacts.repairsRecommended.push(
      createRepairRecord(
        'rebuild-published-generation',
        'rebuild the published generation to restore missing required artifacts',
        'recommended',
        missingArtifactNames,
        [],
      ),
    );
  }

  checks.push(missingArtifacts);

  const structuralCheck = createCheckResult(
    'structure-missing-records',
    'Missing structure records',
    'error',
    'artifact',
  );
  const manifestFileIds = new Set(generationState.manifest.map((entry) => normalizeFileId(entry.repoId, entry.filePath)));
  const byFileIds = new Set(Object.keys(symbolIndex.byFile));
  const missingRelations = generationState.manifest
    .filter((entry) => !byFileIds.has(normalizeFileId(entry.repoId, entry.filePath)))
    .map((entry) => `${entry.repoId}/${entry.filePath}`);
  const relationSymbolGaps = Object.values(symbolIndex.byFile)
    .filter((relation) => relation.symbolIds.length > 0)
    .filter((relation) => symbolIndex.symbols.filter((symbol) => symbol.fileId === relation.fileId).length === 0)
    .map((relation) => `${relation.repo}/${relation.filePath}`);
  const riskyMissingUiOrPattern = (changeSummaryStatus.value?.files ?? [])
    .filter((file) => file.changeKind !== 'deleted')
    .filter((file) => file.signals.includes('unknownStructuralChange') || file.impactHints.includes('highRiskStructuralChange'))
    .filter((file) => {
      const hasPattern = patternIndex.patterns.some(
        (pattern) => pattern.repoId === file.repoId && pattern.fileId === normalizeFileId(file.repoId, file.filePath),
      );
      return file.impactHints.includes('requiresPatternRefresh') && !hasPattern;
    })
    .map((file) => file.key);

  if (missingRelations.length > 0 || relationSymbolGaps.length > 0 || riskyMissingUiOrPattern.length > 0) {
    structuralCheck.status = 'failed';
    structuralCheck.summary = 'published structure artifacts are missing expected file-level records';
    structuralCheck.affectedFiles = sortStrings([
      ...missingRelations,
      ...relationSymbolGaps,
      ...riskyMissingUiOrPattern,
    ]);
    structuralCheck.details = [
      ...missingRelations.map((file) => `${file} is present in the manifest but missing a file relation in symbol-index.json`),
      ...relationSymbolGaps.map((file) => `${file} declares symbol ids but no symbols exist for that file`),
      ...riskyMissingUiOrPattern.map((file) => `${file} was marked high-risk during refresh but no pattern artifacts were published for the file`),
    ];
    structuralCheck.targetArtifacts = ['symbol-index.json', 'pattern-candidates.json', 'change-summary.json'];
    structuralCheck.repairsRecommended.push(
      createRepairRecord(
        'reindex-missing-structure',
        're-run refresh to rebuild missing per-file structure artifacts conservatively',
        'recommended',
        structuralCheck.targetArtifacts,
        structuralCheck.affectedFiles,
      ),
    );
  }

  checks.push(structuralCheck);

  const orphanCheck = createCheckResult(
    'orphaned-artifact-entries',
    'Orphaned artifact entries',
    'warning',
    'artifact',
  );
  const orphanRelationIds = Object.keys(symbolIndex.byFile).filter((fileId) => !manifestFileIds.has(fileId));
  const relationIdsAfterRelationCleanup = new Set(
    Object.keys(symbolIndex.byFile).filter((fileId) => !orphanRelationIds.includes(fileId)),
  );
  const orphanSymbols = symbolIndex.symbols.filter(
    (symbol) => !manifestFileIds.has(symbol.fileId) || !relationIdsAfterRelationCleanup.has(symbol.fileId),
  );
  const knownSymbolIds = new Set(
    symbolIndex.symbols
      .filter((symbol) => !orphanSymbols.some((orphan) => orphan.symbolId === symbol.symbolId))
      .map((symbol) => symbol.symbolId),
  );
  const orphanGraphFileIds = Object.keys(graph.nodes.files).filter((fileId) => !manifestFileIds.has(fileId));
  const orphanGraphSymbolIds = Object.keys(graph.nodes.symbols).filter((symbolId) => !knownSymbolIds.has(symbolId));
  const validGraphNodeIds = new Set<string>([
    ...Object.keys(graph.nodes.repos),
    ...Object.keys(graph.nodes.files).filter((fileId) => !orphanGraphFileIds.includes(fileId)),
    ...Object.keys(graph.nodes.symbols).filter((symbolId) => !orphanGraphSymbolIds.includes(symbolId)),
  ]);
  const orphanGraphEdges = graph.edges.filter(
    (edge) => !validGraphNodeIds.has(edge.fromId) || !validGraphNodeIds.has(edge.toId),
  );
  const manifestPaths = new Set(generationState.manifest.map((entry) => entry.filePath));
  const orphanUiCompositionEdges = uiComposition.edges.filter(
    (edge) => !manifestPaths.has(edge.parentFilePath) || (edge.childFilePath !== undefined && !manifestPaths.has(edge.childFilePath)),
  );
  const orphanUiPropUsages = uiProps.propUsages.filter(
    (usage) => !manifestPaths.has(usage.parentFilePath) || (usage.childFilePath !== undefined && !manifestPaths.has(usage.childFilePath)),
  );
  const orphanPatterns = patternIndex.patterns.filter((pattern) => !manifestFileIds.has(pattern.fileId));

  const orphanFiles = sortStrings([
    ...orphanRelationIds.map((fileId) => symbolIndex.byFile[fileId]?.filePath ?? fileId),
    ...orphanSymbols.map((symbol) => symbol.filePath),
    ...orphanUiCompositionEdges.flatMap((edge) => [edge.parentFilePath, edge.childFilePath ?? '']),
    ...orphanUiPropUsages.flatMap((usage) => [usage.parentFilePath, usage.childFilePath ?? '']),
    ...orphanPatterns.map((pattern) => pattern.fileId),
  ].filter(Boolean));

  if (
    orphanRelationIds.length > 0 ||
    orphanSymbols.length > 0 ||
    orphanGraphFileIds.length > 0 ||
    orphanGraphSymbolIds.length > 0 ||
    orphanGraphEdges.length > 0 ||
    orphanUiCompositionEdges.length > 0 ||
    orphanUiPropUsages.length > 0 ||
    orphanPatterns.length > 0
  ) {
    orphanCheck.status = applyRepairs ? 'repaired' : 'warning';
    orphanCheck.summary = 'orphaned entries were found in published artifacts';
    orphanCheck.affectedFiles = orphanFiles;
    orphanCheck.targetArtifacts = [
      'symbol-index.json',
      'code-graph.json',
      'ui-composition.json',
      'ui-props.json',
      'pattern-candidates.json',
    ];
    orphanCheck.details = [
      ...(orphanRelationIds.length > 0 ? [`${orphanRelationIds.length} file relations refer to manifest-missing files`] : []),
      ...(orphanSymbols.length > 0 ? [`${orphanSymbols.length} symbols refer to missing file relations or manifest files`] : []),
      ...(orphanGraphEdges.length > 0 ? [`${orphanGraphEdges.length} graph edges point to unknown nodes`] : []),
      ...(orphanUiCompositionEdges.length > 0 ? [`${orphanUiCompositionEdges.length} UI composition edges refer to unknown files`] : []),
      ...(orphanUiPropUsages.length > 0 ? [`${orphanUiPropUsages.length} UI prop usages refer to unknown files`] : []),
      ...(orphanPatterns.length > 0 ? [`${orphanPatterns.length} pattern candidates refer to unknown files`] : []),
    ];

    if (applyRepairs) {
      const retainedByFile = Object.fromEntries(
        Object.entries(symbolIndex.byFile).filter(([fileId]) => manifestFileIds.has(fileId)),
      );
      const retainedSymbols = symbolIndex.symbols.filter(
        (symbol) => manifestFileIds.has(symbol.fileId) && retainedByFile[symbol.fileId],
      );
      const lookups = rebuildLookups(retainedSymbols);
      symbolIndex = {
        ...symbolIndex,
        symbols: retainedSymbols,
        byFile: retainedByFile,
        byName: lookups.byName,
        byNameLower: lookups.byNameLower,
        stats: lookups.stats,
      };
      symbolIndexChanged = true;

      const retainedSymbolIds = new Set(symbolIndex.symbols.map((symbol) => symbol.symbolId));
      const retainedGraphFiles = Object.fromEntries(
        Object.entries(graph.nodes.files).filter(([fileId]) => manifestFileIds.has(fileId)),
      );
      const retainedGraphSymbols = Object.fromEntries(
        Object.entries(graph.nodes.symbols).filter(([symbolId]) => retainedSymbolIds.has(symbolId)),
      );
      const retainedGraphNodeIds = new Set([
        ...Object.keys(graph.nodes.repos),
        ...Object.keys(retainedGraphFiles),
        ...Object.keys(retainedGraphSymbols),
      ]);
      graph = {
        ...graph,
        nodes: {
          repos: graph.nodes.repos,
          files: retainedGraphFiles,
          symbols: retainedGraphSymbols,
        },
        edges: graph.edges.filter(
          (edge) => retainedGraphNodeIds.has(edge.fromId) && retainedGraphNodeIds.has(edge.toId),
        ),
      };
      graphChanged = true;

      uiComposition = {
        ...uiComposition,
        edges: uiComposition.edges.filter(
          (edge) => manifestPaths.has(edge.parentFilePath) && (edge.childFilePath === undefined || manifestPaths.has(edge.childFilePath)),
        ),
      };
      uiCompositionChanged = true;
      uiProps = {
        ...uiProps,
        propUsages: uiProps.propUsages.filter(
          (usage) => manifestPaths.has(usage.parentFilePath) && (usage.childFilePath === undefined || manifestPaths.has(usage.childFilePath)),
        ),
      };
      uiPropsChanged = true;
      patternIndex = {
        ...patternIndex,
        patterns: patternIndex.patterns.filter((pattern) => manifestFileIds.has(pattern.fileId)),
      };
      patternIndexChanged = true;

      orphanCheck.repairsApplied.push(
        createRepairRecord(
          'cleanup-orphaned-artifact-entries',
          'removed orphaned published entries from symbol, graph, UI, and pattern artifacts',
          'applied',
          orphanCheck.targetArtifacts,
          orphanFiles,
        ),
      );
    } else {
      orphanCheck.repairsRecommended.push(
        createRepairRecord(
          'cleanup-orphaned-artifact-entries',
          'remove orphaned published entries from symbol, graph, UI, and pattern artifacts',
          'recommended',
          orphanCheck.targetArtifacts,
          orphanFiles,
        ),
      );
    }
  }

  checks.push(orphanCheck);

  const mismatchCheck = createCheckResult(
    'cross-artifact-mismatches',
    'Cross-artifact mismatches',
    'error',
    'artifact',
  );
  const relationMismatchFiles = Object.values(symbolIndex.byFile)
    .filter((relation) => {
      const fileSymbols = symbolIndex.symbols.filter((symbol) => symbol.fileId === relation.fileId);
      const expectedIds = sortStrings(fileSymbols.map((symbol) => symbol.symbolId));
      const expectedNames = sortStrings(fileSymbols.map((symbol) => symbol.name));
      return (
        JSON.stringify(sortStrings(relation.symbolIds)) !== JSON.stringify(expectedIds) ||
        JSON.stringify(sortStrings(relation.symbolNames)) !== JSON.stringify(expectedNames)
      );
    })
    .map((relation) => `${relation.repo}/${relation.filePath}`);
  const repoConfigById = await loadRepoResolutionConfigs(
    Object.fromEntries(generationState.repositories.map((repository) => [repository.repoId, repository.repoRoot])),
  );
  const expectedGraph = buildCodeGraphFromSymbolIndex(symbolIndex, { repoResolutionConfigsById: repoConfigById });
  const graphNodeMismatch =
    JSON.stringify(sortStrings(Object.keys(graph.nodes.files))) !== JSON.stringify(sortStrings(Object.keys(expectedGraph.nodes.files))) ||
    JSON.stringify(sortStrings(Object.keys(graph.nodes.symbols))) !== JSON.stringify(sortStrings(Object.keys(expectedGraph.nodes.symbols))) ||
    JSON.stringify(sortStrings(graph.edges.map((edge) => edge.edgeId))) !== JSON.stringify(sortStrings(expectedGraph.edges.map((edge) => edge.edgeId)));

  if (relationMismatchFiles.length > 0 || graphNodeMismatch) {
    mismatchCheck.status = 'failed';
    mismatchCheck.summary = 'published layers disagree about file, symbol, or graph structure';
    mismatchCheck.affectedFiles = relationMismatchFiles;
    mismatchCheck.targetArtifacts = ['symbol-index.json', 'code-graph.json'];
    mismatchCheck.details = [
      ...relationMismatchFiles.map((file) => `${file} has file-relation symbol metadata that does not match the symbol table`),
      ...(graphNodeMismatch ? ['code-graph.json does not match the graph deterministically rebuilt from the current symbol index'] : []),
    ];
    mismatchCheck.repairsRecommended.push(
      createRepairRecord(
        'rebuild-mismatched-artifacts',
        're-run refresh to rebuild mismatched structure and graph artifacts',
        'recommended',
        mismatchCheck.targetArtifacts,
        mismatchCheck.affectedFiles,
      ),
    );
  }

  checks.push(mismatchCheck);

  const patternIntegrityCheck = createCheckResult(
    'pattern-state-integrity',
    'Pattern state integrity',
    'error',
    'artifact',
  );
  const patternIssues = [
    ...(patternIndexLoadResult.status !== 'ok'
      ? [
          `pattern artifact ${patternIndexLoadResult.status} at ${patternIndexLoadResult.path}: ${patternIndexLoadResult.reason}`,
        ]
      : []),
    ...((generationState.patternIntegrity?.issues ?? []).map(
      (issue) => `${issue.summary}: ${issue.details}`,
    )),
  ];

  if (patternIssues.length > 0) {
    patternIntegrityCheck.status =
      patternIndexLoadResult.status !== 'ok' ||
      generationState.patternIntegrity?.status === 'failed'
        ? 'failed'
        : 'warning';
    patternIntegrityCheck.summary = 'pattern artifact state is suspicious or untrustworthy';
    patternIntegrityCheck.details = patternIssues;
    patternIntegrityCheck.targetArtifacts = ['pattern-candidates.json', 'index-generation.json'];
    patternIntegrityCheck.repairsRecommended.push(
      createRepairRecord(
        'rebuild-pattern-state',
        'rebuild the published generation or pattern artifacts because the pattern substrate is untrustworthy',
        'recommended',
        patternIntegrityCheck.targetArtifacts,
        [],
        generationState.patternIntegrity?.issues.map((issue) => issue.recommendedAction).join('; ') ||
          'recommended action: run a full generation rebuild',
      ),
    );
  }

  checks.push(patternIntegrityCheck);

  const highRiskValidationCheck = createCheckResult(
    'high-risk-post-refresh-validation',
    'High-risk post-refresh validation',
    'error',
    'generation',
  );

  if (generationState.highRiskRefreshValidation?.isHighRiskRefresh) {
    highRiskValidationCheck.summary =
      generationState.highRiskRefreshValidation.status === 'passed'
        ? 'high-risk refresh passed enhanced post-refresh validation'
        : 'high-risk refresh did not validate cleanly after enhanced post-refresh validation';
    highRiskValidationCheck.details = [
      `validation triggers: ${generationState.highRiskRefreshValidation.triggers.join('; ')}`,
      ...generationState.highRiskRefreshValidation.issues.map(
        (issue) => `${issue.summary}: ${issue.details}`,
      ),
    ];
    highRiskValidationCheck.targetArtifacts = [
      'index-generation.json',
      'symbol-index.json',
      'code-graph.json',
      'ui-composition.json',
      'ui-props.json',
      'pattern-candidates.json',
      'change-summary.json',
    ];

    if (generationState.highRiskRefreshValidation.status === 'failed') {
      highRiskValidationCheck.status = 'failed';
      highRiskValidationCheck.repairsRecommended.push(
        createRepairRecord(
          'rebuild-high-risk-refresh-generation',
          'rebuild the generation because a high-risk refresh did not validate cleanly',
          'recommended',
          highRiskValidationCheck.targetArtifacts,
          [],
          generationState.highRiskRefreshValidation.issues
            .map((issue) => issue.recommendedAction)
            .join('; '),
        ),
      );
    } else if (generationState.highRiskRefreshValidation.status === 'degraded') {
      highRiskValidationCheck.status = 'warning';
      highRiskValidationCheck.repairsRecommended.push(
        createRepairRecord(
          'review-high-risk-refresh-generation',
          'review or rebuild the generation because high-risk refresh validation surfaced suspicious signals',
          'recommended',
          highRiskValidationCheck.targetArtifacts,
          [],
          generationState.highRiskRefreshValidation.issues
            .map((issue) => issue.recommendedAction)
            .join('; '),
        ),
      );
    }
  } else {
    highRiskValidationCheck.summary = 'no high-risk refresh context required enhanced validation';
  }

  checks.push(highRiskValidationCheck);

  const countRegressionCheck = createCheckResult(
    'catastrophic-count-regressions',
    'Catastrophic count regressions',
    'error',
    'generation',
  );
  const priorTrustedBaseline = await findPriorTrustedGenerationBaseline(generationId);
  const countRegressionIssues = evaluateCatastrophicCountRegressions({
    current: generationState,
    baseline: priorTrustedBaseline,
    changeSummary: changeSummaryStatus.value,
  });

  if (countRegressionIssues.length > 0) {
    countRegressionCheck.status = 'failed';
    countRegressionCheck.summary = 'critical artifact counts regressed catastrophically relative to a prior trusted generation';
    countRegressionCheck.details = countRegressionIssues.map(
      (issue) => `${issue.summary}: ${issue.details}`,
    );
    countRegressionCheck.targetArtifacts = [
      'index-generation.json',
      'symbol-index.json',
      'code-graph.json',
      'pattern-candidates.json',
      'ui-composition.json',
      'ui-props.json',
    ];
    countRegressionCheck.repairsRecommended.push(
      createRepairRecord(
        'rebuild-catastrophic-count-regressions',
        'rebuild the published generation because critical artifact counts collapsed relative to a prior trusted baseline',
        'recommended',
        countRegressionCheck.targetArtifacts,
        [],
        countRegressionIssues.map((issue) => issue.recommendedAction).join('; '),
      ),
    );
  }

  checks.push(countRegressionCheck);

  const coordinationCheck = createCheckResult(
    'coordination-state-sanity',
    'Coordination state sanity',
    'warning',
    'coordination',
  );
  const requestStatus = await readJsonFileStatus<Record<string, unknown>>(
    path.join(getCoordinationDirectory(), 'search-refresh-request.json'),
  );
  const snapshotStatus = await readJsonFileStatus<Record<string, unknown>>(
    path.join(getCoordinationDirectory(), 'zoekt-refresh-state.json'),
  );
  const requestResult = await loadSearchRefreshRequestResult();
  const snapshotResult = await loadSearchRefreshSnapshotResult();
  let nextSearch = deriveSearchFreshness(generationState, requestResult.value, snapshotResult.value, {
    requestResult,
    snapshotResult,
  });
  const requestIssue = describeCoordinationMarkerIssue('search refresh request', requestResult);
  const snapshotIssue = describeCoordinationMarkerIssue('Zoekt refresh snapshot', snapshotResult);

  const coordinationIssues = [
    ...(requestIssue ? [requestIssue] : []),
    ...(snapshotIssue ? [snapshotIssue] : []),
    ...(requestStatus.malformed && !requestIssue ? ['search refresh request marker is malformed'] : []),
    ...(snapshotStatus.malformed && !snapshotIssue ? ['Zoekt refresh snapshot marker is malformed'] : []),
    ...(requestIssue || snapshotIssue
      ? [`search freshness consequence: downgraded to ${nextSearch.status}`]
      : []),
    ...(generationState.search.status === 'ready' && nextSearch.status !== 'ready'
      ? [`published search freshness was downgraded from ready to ${nextSearch.status}`]
      : []),
  ];

  if (coordinationIssues.length > 0) {
    coordinationCheck.status = applyRepairs ? 'repaired' : 'warning';
    coordinationCheck.summary = 'coordination state is suspicious or incompatible with the published generation';
    coordinationCheck.details = coordinationIssues;
    coordinationCheck.targetArtifacts = ['index-generation.json', 'coordination/search-refresh-request.json', 'coordination/zoekt-refresh-state.json'];

    if (applyRepairs) {
      generationState = {
        ...generationState,
        search: nextSearch,
      };
      stateChanged = true;
      coordinationCheck.repairsApplied.push(
        createRepairRecord(
          'downgrade-search-freshness',
          'downgraded published search freshness to a conservative state based on current coordination evidence',
          'applied',
          ['index-generation.json'],
          [],
          `new search status: ${nextSearch.status}`,
        ),
      );
    } else {
      coordinationCheck.repairsRecommended.push(
        createRepairRecord(
          'downgrade-search-freshness',
          'downgrade published search freshness to a conservative state based on current coordination evidence',
          'recommended',
          ['index-generation.json'],
          [],
          `recommended search status: ${nextSearch.status}`,
        ),
      );
    }
  }

  checks.push(coordinationCheck);

  const debrisCheck = createCheckResult(
    'maintenance-debris',
    'Maintenance debris and incomplete generations',
    'warning',
    'maintenance',
  );
  const rootTempFilePaths = await Promise.all(
    ROOT_TEMP_FILES.map(async (fileName) => ({
      fileName,
      filePath: path.join(getDataDirectory(), fileName),
      exists: await fileExists(path.join(getDataDirectory(), fileName)),
    })),
  );
  const generationDirEntries = await fs.readdir(getGenerationsDirectory(), { withFileTypes: true }).catch(() => []);
  const incompleteGenerationDirectories: string[] = [];

  for (const entry of generationDirEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name === generationId) {
      continue;
    }

    const stateFilePath = getGenerationStateFilePath(entry.name);
    const stateFileExists = await fileExists(stateFilePath);

    if (!stateFileExists) {
      incompleteGenerationDirectories.push(path.join(getGenerationsDirectory(), entry.name));
      continue;
    }

    const missingRequiredArtifact = await Promise.all(
      REQUIRED_GENERATION_ARTIFACTS.map((fileName) => fileExists(getGenerationArtifactFilePath(entry.name, fileName))),
    );

    if (missingRequiredArtifact.some((exists) => !exists)) {
      incompleteGenerationDirectories.push(path.join(getGenerationsDirectory(), entry.name));
    }
  }

  const debrisArtifacts = [
    ...rootTempFilePaths.filter((entry) => entry.exists).map((entry) => entry.filePath),
    ...incompleteGenerationDirectories,
  ];

  if (debrisArtifacts.length > 0) {
    debrisCheck.status = applyRepairs ? 'repaired' : 'warning';
    debrisCheck.summary = 'temporary files or incomplete generation directories were found';
    debrisCheck.details = debrisArtifacts.map((artifact) => `${artifact} appears to be leftover maintenance or failed-refresh debris`);
    debrisCheck.targetArtifacts = debrisArtifacts;

    if (applyRepairs) {
      for (const artifactPath of debrisArtifacts) {
        await fs.rm(artifactPath, { recursive: true, force: true });
      }

      debrisCheck.repairsApplied.push(
        createRepairRecord(
          'cleanup-maintenance-debris',
          'removed temporary files and incomplete unpublished generation directories',
          'applied',
          debrisArtifacts,
          [],
        ),
      );
    } else {
      debrisCheck.repairsRecommended.push(
        createRepairRecord(
          'cleanup-maintenance-debris',
          'remove temporary files and incomplete unpublished generation directories',
          'recommended',
          debrisArtifacts,
          [],
        ),
      );
    }
  }

  checks.push(debrisCheck);

  if (symbolIndexChanged) {
    await saveSymbolIndex(symbolIndex, { generationId });
  }

  if (graphChanged) {
    await (await import('../graph/store.js')).saveCodeGraph(graph, { generationId });
  }

  if (uiCompositionChanged) {
    await saveUiCompositionIndex(uiComposition, { generationId });
  }

  if (uiPropsChanged) {
    await saveUiPropSurfaceIndex(uiProps, { generationId });
  }

  if (patternIndexChanged) {
    await savePatternIndex(patternIndex, { generationId });
  }

  if (symbolIndexChanged || graphChanged || uiCompositionChanged || uiPropsChanged || patternIndexChanged) {
    generationState = {
      ...generationState,
      counts: createCounts(symbolIndex, graph, uiComposition, uiProps, patternIndex),
    };
    stateChanged = true;
  }

  const report: ConsistencyRunReport = {
    schemaVersion: CONSISTENCY_REPORT_SCHEMA_VERSION,
    generationId,
    generatedAt: new Date().toISOString(),
    overview: summarizeOverview(checks),
    checks,
  };

  generationState = {
    ...generationState,
    consistency: report.overview,
  };
  stateChanged = true;

  if (stateChanged) {
    await updateGenerationState(generationId, generationState);
  }

  await saveConsistencyReport(report);
  logger.info(
    `[consistency] generation=${generationId} checks=${report.overview.checksExecuted} failed=${report.overview.failed} repaired=${report.overview.repaired}`,
  );

  if (isRiskyChangeSummary(changeSummaryStatus.value)) {
    logger.info(`[consistency] generation=${generationId} post-refresh validation ran because the change summary was high risk`);
  }

  await getCurrentIndexHealth();

  return report;
}
