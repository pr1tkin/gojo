import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildCodeGraphFromSymbolIndex } from '../graph/build-graph.js';
import { loadRepoResolutionConfigs } from '../graph/repo-config.js';
import type { CodeGraphSnapshot } from '../graph/types.js';
import { loadPatternIndexResult } from '../patterns/store.js';
import { runPatternExtractionStage } from '../patterns/stage.js';
import type { PatternIndex } from '../patterns/types.js';
import { listRepositories } from '../repositories.js';
import { buildIndexedSymbols, collectRepositorySourceFiles } from '../symbol-index/build-index.js';
import { createFileId } from '../symbol-index/ids.js';
import { loadSymbolIndex } from '../symbol-index/store.js';
import type { IndexedSymbol, SymbolFrequencyStats, SymbolIndex } from '../symbol-index/types.js';
import { buildUiCompositionIndex } from '../ui-composition/build-index.js';
import { loadUiCompositionIndex } from '../ui-composition/store.js';
import type { UiCompositionIndex } from '../ui-composition/types.js';
import { buildUiPropSurfaceIndex } from '../ui-props/build-index.js';
import { loadUiPropSurfaceIndex } from '../ui-props/store.js';
import type { UiPropSurfaceIndex } from '../ui-props/types.js';
import { classifyRepositoryChanges, createEmptyGenerationChangeSummary } from './change-detection.js';
import { findPriorTrustedGenerationBaseline } from './count-regressions.js';
import { runCurrentGenerationConsistencyMaintenance } from './consistency.js';
import { getCurrentIndexHealth } from './health.js';
import { evaluateHighRiskRefreshValidation } from './high-risk-validation.js';
import { evaluatePatternIntegrity } from './pattern-integrity.js';
import {
  buildUiSemanticsIndex,
  createEmptyUiSemanticsIndex,
  getUiSemanticsArtifactFileName,
  loadUiSemanticsIndexForGeneration,
} from './ui-semantics.js';
import {
  loadCurrentGenerationState,
  publishGeneration,
  saveGenerationArtifacts,
  saveSearchRefreshRequest,
} from './generation-store.js';
import {
  buildSearchRepoFingerprints,
  createSearchRefreshRequest,
  deriveSearchFreshness,
  getCurrentSearchFreshness,
} from './search-freshness.js';
import { runSingleFlightRefresh, type RefreshCoordinatorTestHooks } from './refresh-coordinator.js';
import type {
  FileFingerprintManifestEntry,
  IndexGenerationCleanupSummary,
  IndexGenerationCounts,
  IndexGenerationRebuildSummary,
  IndexGenerationState,
  IndexRefreshDelta,
  IndexRefreshDiagnostics,
  IndexedRepositoryDescriptor,
} from './types.js';

const INDEX_GENERATION_STATE_SCHEMA_VERSION = 2;

export interface RefreshIndexesOptions {
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  failBeforePublish?: boolean;
  runConsistencyChecks?: 'never' | 'risky-only' | 'always';
  testHooks?: RefreshCoordinatorTestHooks & {
    afterManifestScanned?: (context: {
      reposRoot: string;
      delta: IndexRefreshDelta;
      hasPreviousGeneration: boolean;
    }) => Promise<void> | void;
    mutatePatternIndex?: (context: {
      reposRoot: string;
      patternIndex: PatternIndex;
    }) => Promise<PatternIndex> | PatternIndex;
    mutateDerivedArtifacts?: (context: {
      reposRoot: string;
      symbolIndex: SymbolIndex;
      graph: CodeGraphSnapshot;
      uiComposition: UiCompositionIndex;
      uiProps: UiPropSurfaceIndex;
      patternIndex: PatternIndex;
    }) =>
      | Promise<{
          symbolIndex?: SymbolIndex;
          graph?: CodeGraphSnapshot;
          uiComposition?: UiCompositionIndex;
          uiProps?: UiPropSurfaceIndex;
          patternIndex?: PatternIndex;
        }>
      | {
          symbolIndex?: SymbolIndex;
          graph?: CodeGraphSnapshot;
          uiComposition?: UiCompositionIndex;
          uiProps?: UiPropSurfaceIndex;
          patternIndex?: PatternIndex;
        };
  };
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
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

function createManifestKey(repoId: string, filePath: string): string {
  return `${repoId}/${filePath}`;
}

function createEmptySymbolIndex(schemaVersion: number = 4): SymbolIndex {
  return {
    schemaVersion,
    symbols: [],
    byName: Object.create(null) as SymbolIndex['byName'],
    byNameLower: Object.create(null) as SymbolIndex['byNameLower'],
    byFile: Object.create(null) as SymbolIndex['byFile'],
    stats: createEmptySymbolFrequencyStats(),
  };
}

async function hashFileContent(absolutePath: string): Promise<string> {
  const buffer = await fs.readFile(absolutePath);
  return createHash('sha256').update(buffer).digest('hex');
}

async function scanRepositoryManifest(
  reposRoot: string,
): Promise<{ repositories: IndexedRepositoryDescriptor[]; manifest: FileFingerprintManifestEntry[] }> {
  const repositories = await listRepositories(reposRoot);
  const descriptors = repositories.map((repository) => ({
    repoId: repository.id,
    repoRoot: repository.rootPath,
  }));
  const manifest: FileFingerprintManifestEntry[] = [];

  for (const repository of repositories) {
    const files = await collectRepositorySourceFiles(repository.rootPath, repository.id);

    for (const filePath of files.sort((left, right) => left.localeCompare(right))) {
      const absolutePath = path.join(repository.rootPath, filePath);
      const stat = await fs.stat(absolutePath);
      const normalizedPath = normalizeRelativePath(filePath);
      manifest.push({
        key: createManifestKey(repository.id, normalizedPath),
        repoId: repository.id,
        repoRoot: repository.rootPath,
        filePath: normalizedPath,
        normalizedPath,
        fileSizeBytes: stat.size,
        modifiedTimeMs: Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : undefined,
        contentHash: await hashFileContent(absolutePath),
      });
    }
  }

  manifest.sort((left, right) => left.key.localeCompare(right.key));

  return {
    repositories: descriptors,
    manifest,
  };
}

function diffManifest(
  previousManifest: FileFingerprintManifestEntry[],
  currentManifest: FileFingerprintManifestEntry[],
): IndexRefreshDelta {
  const previousByKey = new Map(previousManifest.map((entry) => [entry.key, entry]));
  const currentByKey = new Map(currentManifest.map((entry) => [entry.key, entry]));
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [key, entry] of currentByKey) {
    const previousEntry = previousByKey.get(key);

    if (!previousEntry) {
      added.push(entry.key);
      continue;
    }

    if (
      previousEntry.contentHash !== entry.contentHash ||
      previousEntry.fileSizeBytes !== entry.fileSizeBytes ||
      previousEntry.modifiedTimeMs !== entry.modifiedTimeMs
    ) {
      modified.push(entry.key);
    }
  }

  for (const key of previousByKey.keys()) {
    if (!currentByKey.has(key)) {
      deleted.push(key);
    }
  }

  added.sort((left, right) => left.localeCompare(right));
  modified.sort((left, right) => left.localeCompare(right));
  deleted.sort((left, right) => left.localeCompare(right));

  return { added, modified, deleted };
}

function hasManifestChanges(delta: IndexRefreshDelta): boolean {
  return delta.added.length > 0 || delta.modified.length > 0 || delta.deleted.length > 0;
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

function mergeSymbolIndexes(
  previousIndex: SymbolIndex,
  freshIndex: SymbolIndex,
  changedOrAddedKeys: Set<string>,
  deletedKeys: Set<string>,
): { index: SymbolIndex; cleanup: IndexGenerationCleanupSummary } {
  const retainedByFile = Object.create(null) as SymbolIndex['byFile'];

  for (const relation of Object.values(previousIndex.byFile)) {
    const key = createManifestKey(relation.repo, relation.filePath);

    if (changedOrAddedKeys.has(key) || deletedKeys.has(key)) {
      continue;
    }

    retainedByFile[relation.fileId] = relation;
  }

  for (const relation of Object.values(freshIndex.byFile)) {
    const key = createManifestKey(relation.repo, relation.filePath);

    if (changedOrAddedKeys.has(key)) {
      retainedByFile[relation.fileId] = relation;
    }
  }

  const symbols = [
    ...previousIndex.symbols.filter((symbol) => {
      const key = createManifestKey(symbol.repo, symbol.filePath);
      return !changedOrAddedKeys.has(key) && !deletedKeys.has(key);
    }),
    ...freshIndex.symbols.filter((symbol) => changedOrAddedKeys.has(createManifestKey(symbol.repo, symbol.filePath))),
  ].sort((left, right) => left.symbolId.localeCompare(right.symbolId));

  const lookups = rebuildLookups(symbols);
  const deletedRelations = Object.values(previousIndex.byFile).filter((relation) =>
    deletedKeys.has(createManifestKey(relation.repo, relation.filePath)),
  );
  const deletedSymbols = previousIndex.symbols.filter((symbol) =>
    deletedKeys.has(createManifestKey(symbol.repo, symbol.filePath)),
  );

  return {
    index: {
      schemaVersion: freshIndex.schemaVersion,
      symbols,
      byName: lookups.byName,
      byNameLower: lookups.byNameLower,
      byFile: retainedByFile,
      stats: lookups.stats,
    },
    cleanup: {
      deletedFileRecordsRemoved: deletedRelations.length,
      deletedSymbolsRemoved: deletedSymbols.length,
      deletedPatternEntriesRemoved: 0,
    },
  };
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

function logDiagnostics(
  logger: Pick<Console, 'info' | 'warn' | 'error'>,
  diagnostics: IndexRefreshDiagnostics,
): void {
  logger.info(
    `[index-refresh] generation=${diagnostics.generationId} status=${diagnostics.status} added=${diagnostics.delta.added.length} modified=${diagnostics.delta.modified.length} deleted=${diagnostics.delta.deleted.length}`,
  );

  if (diagnostics.status === 'committed') {
    logger.info(
      `[index-refresh] change-summary files=${diagnostics.changeSummary.overview.filesChanged} high-risk=${diagnostics.changeSummary.overview.highRiskFiles}`,
    );
    logger.info(
      `[index-refresh] rebuild symbol-files=${diagnostics.rebuild.symbolFilesRebuilt} pattern-files=${diagnostics.rebuild.patternFilesRebuilt} graph=${diagnostics.rebuild.graphMode} ui-composition=${diagnostics.rebuild.uiCompositionMode} ui-props=${diagnostics.rebuild.uiPropsMode}`,
    );
    logger.info(
      `[index-refresh] cleanup file-records=${diagnostics.cleanup.deletedFileRecordsRemoved} symbols=${diagnostics.cleanup.deletedSymbolsRemoved} patterns=${diagnostics.cleanup.deletedPatternEntriesRemoved}`,
    );
    logger.info(
      `[index-refresh] commit generation=${diagnostics.generationId} files=${diagnostics.counts.files} symbols=${diagnostics.counts.symbols} graphEdges=${diagnostics.counts.graphEdges} uiEdges=${diagnostics.counts.uiCompositionEdges} uiProps=${diagnostics.counts.uiPropUsages} patterns=${diagnostics.counts.patterns}`,
    );
  }

  for (const warning of diagnostics.warnings) {
    logger.warn(`[index-refresh] warning: ${warning}`);
  }
}

async function refreshIndexesUnlocked(
  reposRoot: string,
  options: RefreshIndexesOptions = {},
): Promise<{ symbolIndex: SymbolIndex; diagnostics: IndexRefreshDiagnostics }> {
  const logger = options.logger ?? console;
  const previousGeneration = await loadCurrentGenerationState();
  const previousManifest = previousGeneration?.manifest ?? [];
  const { repositories, manifest } = await scanRepositoryManifest(reposRoot);
  const searchFingerprints = await buildSearchRepoFingerprints(reposRoot);
  const delta = diffManifest(previousManifest, manifest);
  await options.testHooks?.afterManifestScanned?.({
    reposRoot: path.resolve(reposRoot),
    delta,
    hasPreviousGeneration: previousGeneration !== null,
  });

  if (!hasManifestChanges(delta) && previousGeneration) {
    const currentSymbolIndex = await loadSymbolIndex();
    const search = (await getCurrentSearchFreshness(logger)) ?? previousGeneration.search;
    const changeSummary = createEmptyGenerationChangeSummary(previousGeneration.createdAt);
    const diagnostics: IndexRefreshDiagnostics = {
      generationId: previousGeneration.generationId,
      createdAt: previousGeneration.createdAt,
      delta,
      changeSummary,
      counts: previousGeneration.counts,
      rebuild: previousGeneration.rebuild,
      cleanup: previousGeneration.cleanup,
      search,
      warnings: previousGeneration.warnings,
      status: 'no-op',
    };
    logDiagnostics(logger, diagnostics);
    await getCurrentIndexHealth();
    return { symbolIndex: currentSymbolIndex, diagnostics };
  }

  const generationId = randomUUID();
  const createdAt = new Date().toISOString();
  const warnings: string[] = [];
  const changedOrAddedKeys = new Set([...delta.added, ...delta.modified]);
  const deletedKeys = new Set(delta.deleted);
  const freshSymbolIndex = await buildIndexedSymbols(reposRoot);
  const previousSymbolIndex = previousGeneration
    ? await loadSymbolIndex()
    : createEmptySymbolIndex(freshSymbolIndex.schemaVersion);
  const { index: mergedSymbolIndex, cleanup } = mergeSymbolIndexes(
    previousSymbolIndex,
    freshSymbolIndex,
    changedOrAddedKeys,
    deletedKeys,
  );
  const extractedPatternIndex = await runPatternExtractionStage(reposRoot, mergedSymbolIndex);
  const freshPatternIndex =
    (await options.testHooks?.mutatePatternIndex?.({
      reposRoot: path.resolve(reposRoot),
      patternIndex: extractedPatternIndex,
    })) ?? extractedPatternIndex;
  const previousPatternLoadResult = previousGeneration ? await loadPatternIndexResult() : null;
  const previousPatternIndex = previousGeneration
    ? previousPatternLoadResult?.value ?? {
        schemaVersion: freshPatternIndex.schemaVersion,
        sourceSymbolIndexSchemaVersion: 0,
        generatedAt: '',
        patterns: [],
      }
    : {
        schemaVersion: freshPatternIndex.schemaVersion,
        sourceSymbolIndexSchemaVersion: 0,
        generatedAt: '',
        patterns: [],
      };
  const previousUiComposition = previousGeneration
    ? await loadUiCompositionIndex()
    : {
        schemaVersion: 1,
        sourceSymbolIndexSchemaVersion: 0,
        generatedAt: '',
        edges: [],
      };
  const previousUiProps = previousGeneration
    ? await loadUiPropSurfaceIndex()
    : {
        schemaVersion: 1,
        sourceSymbolIndexSchemaVersion: 0,
        generatedAt: '',
        propUsages: [],
      };
  const previousUiSemantics = previousGeneration
    ? (await loadUiSemanticsIndexForGeneration(previousGeneration.generationId)) ?? createEmptyUiSemanticsIndex()
    : createEmptyUiSemanticsIndex();
  const deletedFileIds = new Set(
    previousManifest
      .filter((entry) => deletedKeys.has(entry.key))
      .map((entry) => createFileId(entry.repoId, entry.filePath)),
  );
  const mergedPatternResult = {
    index: freshPatternIndex,
    deletedPatternEntriesRemoved: previousPatternIndex.patterns.filter((pattern) =>
      deletedFileIds.has(pattern.fileId),
    ).length,
  };
  cleanup.deletedPatternEntriesRemoved = mergedPatternResult.deletedPatternEntriesRemoved;

  warnings.push(
    'code graph and UI artifacts rebuild globally on changed generations to keep cross-file resolution deterministic',
  );

  if (previousPatternLoadResult && previousPatternLoadResult.status !== 'ok') {
    warnings.push(
      `previous pattern artifact was ${previousPatternLoadResult.status}: ${previousPatternLoadResult.reason}; refresh rebuilt patterns from the current symbol index instead of trusting persisted pattern state`,
    );
  }

  const repoConfigById = await loadRepoResolutionConfigs(
    Object.fromEntries(repositories.map((repository) => [repository.repoId, repository.repoRoot])),
  );
  const graph = buildCodeGraphFromSymbolIndex(mergedSymbolIndex, {
    repoResolutionConfigsById: repoConfigById,
  });
  const uiComposition = await buildUiCompositionIndex(reposRoot, mergedSymbolIndex);
  const uiProps = await buildUiPropSurfaceIndex(reposRoot, mergedSymbolIndex);
  const uiSemantics = await buildUiSemanticsIndex(reposRoot);
  const mutatedArtifacts =
    (await options.testHooks?.mutateDerivedArtifacts?.({
      reposRoot: path.resolve(reposRoot),
      symbolIndex: mergedSymbolIndex,
      graph,
      uiComposition,
      uiProps,
      patternIndex: mergedPatternResult.index,
    })) ?? {};
  const finalSymbolIndex = mutatedArtifacts.symbolIndex ?? mergedSymbolIndex;
  const finalGraph = mutatedArtifacts.graph ?? graph;
  const finalUiComposition = mutatedArtifacts.uiComposition ?? uiComposition;
  const finalUiProps = mutatedArtifacts.uiProps ?? uiProps;
  const finalPatternIndex = mutatedArtifacts.patternIndex ?? mergedPatternResult.index;
  const changeSummary = classifyRepositoryChanges({
    delta,
    previousManifest,
    manifest,
    previousSymbolIndex,
    currentSymbolIndex: finalSymbolIndex,
    previousPatternIndex,
    currentPatternIndex: finalPatternIndex,
    previousUiComposition,
    currentUiComposition: finalUiComposition,
    previousUiProps,
    currentUiProps: finalUiProps,
    previousUiSemantics,
    currentUiSemantics: uiSemantics,
    generatedAt: createdAt,
  });
  const patternIntegrity = evaluatePatternIntegrity({
    checkedAt: createdAt,
    symbolIndex: finalSymbolIndex,
    patternIndex: finalPatternIndex,
    previousGeneration,
    previousPatternLoadResult,
    changeSummary,
  });

  for (const issue of patternIntegrity.issues) {
    warnings.push(`${issue.summary}: ${issue.details}`);
  }

  if (patternIntegrity.status === 'failed') {
    const failureSummary = patternIntegrity.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => `${issue.summary} (${issue.recommendedAction})`)
      .join('; ');
    logger.error(`[index-refresh] pattern-integrity failure: ${failureSummary}`);
    throw new Error(`Pattern integrity validation failed: ${failureSummary}`);
  }

  const counts = createCounts(
    finalSymbolIndex,
    finalGraph,
    finalUiComposition,
    finalUiProps,
    finalPatternIndex,
  );
  const rebuild: IndexGenerationRebuildSummary = {
    symbolFilesRebuilt: changedOrAddedKeys.size,
    patternFilesRebuilt: Object.keys(mergedSymbolIndex.byFile).length,
    graphMode: 'full',
    uiCompositionMode: 'full',
    uiPropsMode: 'full',
  };
  const searchRequest = createSearchRefreshRequest({
    generationId,
    createdAt,
    search: {
      status: 'pending',
      requestedAt: createdAt,
      aggregateFingerprint: searchFingerprints.aggregateFingerprint,
      repoFingerprints: searchFingerprints.repoFingerprints,
      coordinationMode: 'shared-marker',
    },
  });
  const search = deriveSearchFreshness(
    {
      generationId,
      createdAt,
      search: {
        status: 'pending',
        requestedAt: createdAt,
        aggregateFingerprint: searchFingerprints.aggregateFingerprint,
        repoFingerprints: searchFingerprints.repoFingerprints,
        coordinationMode: 'shared-marker',
      },
    },
    searchRequest,
    null,
  );
  const generationState: IndexGenerationState = {
    schemaVersion: INDEX_GENERATION_STATE_SCHEMA_VERSION,
    generationId,
    reposRoot,
    repositories,
    createdAt,
    status: 'ready',
    manifest,
    delta: {
      added: delta.added.length,
      modified: delta.modified.length,
      deleted: delta.deleted.length,
    },
    counts,
    rebuild,
    cleanup,
    changeSummary: changeSummary.overview,
    search,
    patternIntegrity,
    highRiskRefreshValidation: undefined,
    warnings,
    errors: [],
  };

  const priorTrustedBaseline = await findPriorTrustedGenerationBaseline(generationId);
  const highRiskRefreshValidation = evaluateHighRiskRefreshValidation({
    checkedAt: createdAt,
    current: generationState,
    changeSummary,
    baseline: priorTrustedBaseline,
    symbolIndex: finalSymbolIndex,
    graph: finalGraph,
    uiComposition: finalUiComposition,
    uiProps: finalUiProps,
    patternIndex: finalPatternIndex,
  });

  generationState.highRiskRefreshValidation = highRiskRefreshValidation;

  if (highRiskRefreshValidation.isHighRiskRefresh) {
    logger.info(
      `[index-refresh] high-risk validation generation=${generationId} status=${highRiskRefreshValidation.status} triggers=${highRiskRefreshValidation.triggers.join(' | ')}`,
    );
  }

  for (const issue of highRiskRefreshValidation.issues) {
    warnings.push(`${issue.summary}: ${issue.details}`);
  }

  if (highRiskRefreshValidation.status === 'failed') {
    const failureSummary = highRiskRefreshValidation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => `${issue.summary} (${issue.recommendedAction})`)
      .join('; ');
    logger.error(`[index-refresh] high-risk validation failure: ${failureSummary}`);
    throw new Error(`High-risk refresh validation failed: ${failureSummary}`);
  }

  await saveGenerationArtifacts(
    generationId,
    {
      'symbol-index.json': finalSymbolIndex,
      'code-graph.json': finalGraph,
      'ui-composition.json': finalUiComposition,
      'ui-props.json': finalUiProps,
      [getUiSemanticsArtifactFileName()]: uiSemantics,
      'pattern-candidates.json': finalPatternIndex,
      'change-summary.json': changeSummary,
    },
    generationState,
  );

  if (options.failBeforePublish) {
    throw new Error('Simulated refresh failure before publish.');
  }

  await saveSearchRefreshRequest(searchRequest);
  logger.info(
    `[search-freshness] request generation=${generationId} status=${generationState.search.status} fingerprint=${generationState.search.aggregateFingerprint}`,
  );
  await publishGeneration(generationId, createdAt);

  let consistency: IndexRefreshDiagnostics['consistency'];
  let finalCounts = counts;
  let finalSearch = generationState.search;

  if (
    options.runConsistencyChecks === 'always' ||
    ((options.runConsistencyChecks ?? 'risky-only') === 'risky-only' &&
      changeSummary.overview.highRiskFiles > 0)
  ) {
    consistency =
      (await runCurrentGenerationConsistencyMaintenance({ logger, applyRepairs: true })) ?? undefined;
    const refreshedState = await loadCurrentGenerationState();

    if (refreshedState) {
      finalCounts = refreshedState.counts;
      finalSearch = refreshedState.search;
    }
  }

  const diagnostics: IndexRefreshDiagnostics = {
    generationId,
    createdAt,
    delta,
    changeSummary,
    consistency,
    counts: finalCounts,
    rebuild,
    cleanup,
    search: finalSearch,
    warnings,
    status: 'committed',
  };
  logDiagnostics(logger, diagnostics);
  await getCurrentIndexHealth();

  return {
    symbolIndex: finalSymbolIndex,
    diagnostics,
  };
}

export async function refreshIndexes(
  reposRoot: string,
  options: RefreshIndexesOptions = {},
): Promise<{ symbolIndex: SymbolIndex; diagnostics: IndexRefreshDiagnostics }> {
  return runSingleFlightRefresh(
    reposRoot,
    () => refreshIndexesUnlocked(reposRoot, options),
    {
      logger: options.logger,
      testHooks: options.testHooks,
    },
  );
}
