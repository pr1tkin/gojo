import {
  getDefinedSymbols,
  getFileNode,
  getImportingFiles,
  getReexportingFiles,
} from '../graph/query.js';
import { readRepositoryFile } from '../files.js';
import { getRepositoryById } from '../repositories.js';
import { getFileRelation, getFileRelationById } from '../symbol-index/query.js';
import { loadRequiredSymbolIndex } from '../symbol-index/store.js';
import type { ExportRecord, ImportBinding, IndexedSymbol } from '../symbol-index/types.js';
import { loadConfig } from '../config.js';
import { findTypeScriptReferencesForIndexedSymbol } from '../typescript/symbol-references.js';
import {
  getObservedPropNamesForComponent,
  getUiParentsForComponent,
} from './ui-hierarchy-service.js';
import type {
  AnalyzeSymbolImpactInput,
  ImpactAnalysisResult,
  ImpactAnalysisSummary,
  ImpactAnalysisTarget,
  ImpactConfidence,
  ImpactCoverageSignal,
  ImpactEvidence,
  ImpactIndirectConsumers,
  ImpactResultSummary,
  ImpactScope,
  ImpactReason,
  ImpactResultBucket,
  ImpactTier,
  ImpactedFile,
  ImpactedSymbol,
  ImpactSummarySurface,
  ImpactSummarySurfaceCategory,
  ImpactSummaryTransitiveGroup,
  TransitiveImpact,
  UiImpactComponentRef,
  UiImpactSummary,
} from './impact-analysis-types.js';

const DEFAULT_SAFE_MAX_DEPTH = 1;
const DEFAULT_EXPLORATORY_MAX_DEPTH = 2;
const MAX_EXPLORATORY_DEPTH = 2;
const MAX_TRANSITIVE_IMPACTS = 200;

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function stripKnownExtension(value: string): string {
  return value.replace(/\.(tsx?|jsx?)$/i, '');
}

function compareFiles(left: { repoId?: string; filePath: string }, right: { repoId?: string; filePath: string }): number {
  return (left.repoId ?? '').localeCompare(right.repoId ?? '') || left.filePath.localeCompare(right.filePath);
}

function compareSymbols(
  left: { repoId?: string; filePath: string; symbolName: string },
  right: { repoId?: string; filePath: string; symbolName: string },
): number {
  return (
    wrapperLayerPenalty(left.filePath, left.symbolName) - wrapperLayerPenalty(right.filePath, right.symbolName) ||
    compareFiles(left, right) ||
    left.symbolName.localeCompare(right.symbolName)
  );
}

function getEffectiveMaxDepth(input: AnalyzeSymbolImpactInput): number {
  if (typeof input.maxDepth === 'number' && Number.isInteger(input.maxDepth) && input.maxDepth >= 0) {
    return Math.min(input.maxDepth, MAX_EXPLORATORY_DEPTH);
  }

  return input.mode === 'exploratory' ? DEFAULT_EXPLORATORY_MAX_DEPTH : DEFAULT_SAFE_MAX_DEPTH;
}

function confidenceWeight(confidence: ImpactConfidence): number {
  switch (confidence) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
  }
}

function reasonWeight(reason: ImpactReason): number {
  switch (reason) {
    case 'imports-target':
      return 6;
    case 'reexports-target':
      return 5;
    case 'exports-target':
      return 4;
    case 'same-file-reference':
      return 3;
    case 'calls-target':
    case 'jsx-uses-target':
    case 'constructs-target':
    case 'extends-target':
    case 'implements-target':
    case 'type-propagation':
      return 2;
    case 'textual-match':
      return 1;
  }
}

function scopeWeight(scope: ImpactScope): number {
  switch (scope) {
    case 'symbol-direct':
      return 5;
    case 'file-direct':
      return 4;
    case 'proxy':
      return 3;
    case 'local-symbol':
      return 2;
    case 'fallback':
      return 1;
  }
}

function pickConfidence(evidence: ImpactEvidence[]): ImpactConfidence {
  let current: ImpactConfidence = 'low';

  for (const entry of evidence) {
    if (confidenceWeight(entry.confidence) > confidenceWeight(current)) {
      current = entry.confidence;
    }
  }

  return current;
}

function mergeCoverageSignals(evidence: ImpactEvidence[]): ImpactCoverageSignal[] {
  return [...new Set(evidence.flatMap((entry) => entry.coverageSignals))].sort((left, right) => left.localeCompare(right));
}

function wrapperLayerPenalty(filePath: string, symbolName: string): number {
  const normalizedFilePath = normalizePath(filePath);

  if (/(^|\/)(wrappers?|hooks?)\//i.test(normalizedFilePath) || /^use[A-Z]/.test(symbolName) || /wrapper/i.test(symbolName)) {
    return 2;
  }

  if (/(^|\/)index\.(tsx?|jsx?)$/i.test(normalizedFilePath)) {
    return 1;
  }

  return 0;
}

function compareEvidence(left: ImpactEvidence[], right: ImpactEvidence[]): number {
  const leftTop = [...left].sort((a, b) => {
    return (
      confidenceWeight(b.confidence) - confidenceWeight(a.confidence) ||
      scopeWeight(b.impactScope) - scopeWeight(a.impactScope) ||
      reasonWeight(b.reason) - reasonWeight(a.reason)
    );
  })[0];
  const rightTop = [...right].sort((a, b) => {
    return (
      confidenceWeight(b.confidence) - confidenceWeight(a.confidence) ||
      scopeWeight(b.impactScope) - scopeWeight(a.impactScope) ||
      reasonWeight(b.reason) - reasonWeight(a.reason)
    );
  })[0];

  if (!leftTop && !rightTop) {
    return 0;
  }

  if (!leftTop) {
    return 1;
  }

  if (!rightTop) {
    return -1;
  }

  return (
    confidenceWeight(rightTop.confidence) - confidenceWeight(leftTop.confidence) ||
    scopeWeight(rightTop.impactScope) - scopeWeight(leftTop.impactScope) ||
    reasonWeight(rightTop.reason) - reasonWeight(leftTop.reason)
  );
}

function pathSegmentCount(filePath: string): number {
  return normalizePath(filePath)
    .split('/')
    .filter((segment) => segment.length > 0).length;
}

function architectureSurfaceWeight(filePath: string): number {
  const normalized = normalizePath(filePath);

  if (/(^|\/)page\.(tsx?|jsx?)$/i.test(normalized) || /^pages\/.+\.(tsx?|jsx?)$/i.test(normalized)) {
    return 5;
  }

  if (/(^|\/)layout\.(tsx?|jsx?)$/i.test(normalized) || /(^|\/)route\.(tsx?|jsx?)$/i.test(normalized)) {
    return 4;
  }

  if (/^app\/[^/]+\.(tsx?|jsx?)$/i.test(normalized) || /^src\/app\/[^/]+\.(tsx?|jsx?)$/i.test(normalized)) {
    return 3;
  }

  if (/(^|\/)index\.(tsx?|jsx?)$/i.test(normalized)) {
    return 2;
  }

  return 1;
}

function getImpactSummarySurfaceCategory(filePath: string): ImpactSummarySurfaceCategory | null {
  const normalized = normalizePath(filePath);

  if (/(^|\/)page\.(tsx?|jsx?)$/i.test(normalized) || /^pages\/.+\.(tsx?|jsx?)$/i.test(normalized)) {
    return 'page';
  }

  if (/(^|\/)route\.(tsx?|jsx?)$/i.test(normalized)) {
    return 'route';
  }

  if (/(^|\/)layout\.(tsx?|jsx?)$/i.test(normalized)) {
    return 'layout';
  }

  if (
    /^app\/[^/]+\/[^/]+\.(tsx?|jsx?)$/i.test(normalized) ||
    /^src\/app\/[^/]+\/[^/]+\.(tsx?|jsx?)$/i.test(normalized) ||
    /^pages\/[^/]+\/[^/]+\.(tsx?|jsx?)$/i.test(normalized)
  ) {
    return 'feature-entry';
  }

  return null;
}

function toImpactSummarySurface(fileId: string | undefined, filePath: string): ImpactSummarySurface | null {
  const category = getImpactSummarySurfaceCategory(filePath);

  if (!category) {
    return null;
  }

  return {
    fileId,
    filePath,
    category,
  };
}

function compareImpactSummarySurfaces(left: ImpactSummarySurface, right: ImpactSummarySurface): number {
  return (
    architectureSurfaceWeight(right.filePath) - architectureSurfaceWeight(left.filePath) ||
    pathSegmentCount(left.filePath) - pathSegmentCount(right.filePath) ||
    left.filePath.localeCompare(right.filePath)
  );
}

function detectFeatureCluster(filePath: string): string | null {
  const normalized = normalizePath(filePath);

  const patterns = [
    /^pages\/admin\//i,
    /^pages\/project\//i,
    /^pages\/api\/[^/]+\//i,
    /^app\/settings\//i,
    /^components\/project\//i,
    /^components\/common\//i,
    /^components\/bucket\//i,
    /^components\/translation\//i,
    /^src\/app\/articles\//i,
    /^src\/app\/audio\//i,
    /^src\/app\/_components\/button\//i,
    /^src\/app\/_components\/metadata\//i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (match) {
      return match[0].replace(/\/$/, '/*');
    }
  }

  const segments = normalized.split('/').filter((segment) => segment.length > 0);

  if (segments.length >= 2) {
    return `${segments[0]}/${segments[1]}/*`;
  }

  if (segments.length === 1) {
    return `${segments[0]}/*`;
  }

  return null;
}

function compareDirectImpactFileSeeds(left: DirectImpactFileSeed, right: DirectImpactFileSeed): number {
  return (
    scopeWeight(right.impactScope) - scopeWeight(left.impactScope) ||
    reasonWeight(right.reason) - reasonWeight(left.reason) ||
    compareFiles(left, right)
  );
}

function getTopEvidence(entry: { evidence: ImpactEvidence[] }): ImpactEvidence | undefined {
  return [...entry.evidence].sort((left, right) => compareEvidence([left], [right]))[0];
}

function getViaGroupKey(entry: { evidence: ImpactEvidence[] }): string {
  const topEvidence = getTopEvidence(entry);
  const via = topEvidence?.via ?? [];

  if (via.length === 0) {
    return '';
  }

  return via.map((step) => step.fileId ?? step.filePath).join('>');
}

function compareTransitiveImpacts(
  left: TransitiveImpact,
  right: TransitiveImpact,
  groupOrder: Map<string, number>,
): number {
  const leftTopEvidence = getTopEvidence(left);
  const rightTopEvidence = getTopEvidence(right);
  const leftGroupKey = getViaGroupKey(left);
  const rightGroupKey = getViaGroupKey(right);
  const leftPrimaryStep = leftTopEvidence?.via?.[0];
  const rightPrimaryStep = rightTopEvidence?.via?.[0];
  const leftGroupOrder = groupOrder.get(leftPrimaryStep?.fileId ?? leftPrimaryStep?.filePath ?? '') ?? Number.MAX_SAFE_INTEGER;
  const rightGroupOrder =
    groupOrder.get(rightPrimaryStep?.fileId ?? rightPrimaryStep?.filePath ?? '') ?? Number.MAX_SAFE_INTEGER;
  const leftFilePath = left.file?.filePath ?? left.symbol?.filePath ?? '';
  const rightFilePath = right.file?.filePath ?? right.symbol?.filePath ?? '';

  return (
    left.depth - right.depth ||
    leftGroupOrder - rightGroupOrder ||
    leftGroupKey.localeCompare(rightGroupKey) ||
    architectureSurfaceWeight(rightFilePath) - architectureSurfaceWeight(leftFilePath) ||
    pathSegmentCount(leftFilePath) - pathSegmentCount(rightFilePath) ||
    leftFilePath.localeCompare(rightFilePath)
  );
}

function buildMissingResult(input: AnalyzeSymbolImpactInput, notes: string[]): ImpactAnalysisResult {
  return {
    mode: input.mode,
    target: {
      requestedRepoId: input.repoId,
      requestedSymbolId: input.symbolId,
      requestedFilePath: input.filePath,
      requestedSymbolName: input.symbolName,
      symbol: null,
      symbolId: null,
      symbolName: null,
      kind: null,
      repoId: input.repoId ?? null,
      file: null,
    },
    directConsumers: {
      files: [],
      symbols: [],
    },
    indirectConsumers: {
      files: [],
      symbols: [],
      transitive: [],
    },
    relatedContext: {
      files: [],
      symbols: [],
    },
    directlyImpactedSymbols: [],
    directlyImpactedFiles: [],
    transitiveImpacts: [],
    impactSummary: {
      directFiles: 0,
      directSymbols: 0,
      indirectFiles: 0,
      indirectSymbols: 0,
      relatedContextFiles: 0,
      relatedContextSymbols: 0,
      transitiveFiles: 0,
      transitiveSymbols: 0,
      viaGroups: 0,
      highlightedSurfaces: [],
      featureClusters: [],
      transitiveGroups: [],
    },
    publicSurfaceRisk: {
      level: 'unknown',
      notes: ['public surface risk is not derived in phase 5.1 step B'],
    },
    summary: {
      directFileCount: 0,
      directSymbolCount: 0,
      indirectFileCount: 0,
      indirectSymbolCount: 0,
      relatedContextFileCount: 0,
      relatedContextSymbolCount: 0,
      transitiveFileCount: 0,
      transitiveSymbolCount: 0,
      highConfidenceImpactCount: 0,
      mediumConfidenceImpactCount: 0,
      lowConfidenceImpactCount: 0,
      symbolDirectImpactCount: 0,
      fileDirectImpactCount: 0,
      proxyImpactCount: 0,
      localSymbolImpactCount: 0,
      overview: 'no likely impacts identified because the target could not be resolved',
      ambiguityDetected: false,
      notes,
    },
  };
}

function isUiPageLikeFile(filePath: string | undefined): boolean {
  if (!filePath) {
    return false;
  }

  const normalized = normalizePath(filePath);

  return (
    /(^|\/)page\.(tsx?|jsx?)$/i.test(normalized) ||
    /(^|\/)layout\.(tsx?|jsx?)$/i.test(normalized) ||
    /(^|\/)route\.(tsx?|jsx?)$/i.test(normalized) ||
    /^pages\/.+\.(tsx?|jsx?)$/i.test(normalized)
  );
}

function dedupeUiImpactRefs(entries: UiImpactComponentRef[]): UiImpactComponentRef[] {
  const seen = new Set<string>();
  const deduped: UiImpactComponentRef[] = [];

  for (const entry of entries) {
    const key = `${entry.componentName}|${entry.filePath ?? ''}|${entry.symbolId ?? ''}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped.sort((left, right) => compareFiles(
    { repoId: undefined, filePath: left.filePath ?? left.componentName },
    { repoId: undefined, filePath: right.filePath ?? right.componentName },
  ) || left.componentName.localeCompare(right.componentName));
}

async function buildUiImpactSummary(target: ImpactAnalysisTarget): Promise<UiImpactSummary | undefined> {
  if (!target.symbol || !target.file || !target.symbolName) {
    return undefined;
  }

  const targetInput = {
    filePath: target.symbol.filePath,
    symbolId: target.symbol.symbolId,
    symbolName: target.symbol.name,
  };
  const directParents = await getUiParentsForComponent(targetInput);

  if (directParents.length === 0) {
    const observedPropUsage = await getObservedPropNamesForComponent(targetInput);

    if (observedPropUsage.length === 0) {
      return undefined;
    }

    return {
      parentComponents: [],
      parentPages: [],
      observedPropUsage,
      confidence: 'low',
    };
  }

  const parentPages: UiImpactComponentRef[] = [];
  const parentComponents: UiImpactComponentRef[] = [];

  for (const parent of directParents) {
    if (isUiPageLikeFile(parent.filePath)) {
      parentPages.push(parent);
      continue;
    }

    parentComponents.push(parent);
  }

  for (const parent of parentComponents) {
    if (!parent.filePath) {
      continue;
    }

    const upstreamParents = await getUiParentsForComponent({
      filePath: parent.filePath,
      symbolId: parent.symbolId,
      symbolName: parent.componentName,
    });

    for (const upstreamParent of upstreamParents) {
      if (isUiPageLikeFile(upstreamParent.filePath)) {
        parentPages.push(upstreamParent);
      }
    }
  }

  const observedPropUsage = await getObservedPropNamesForComponent(targetInput);
  const dedupedParentComponents = dedupeUiImpactRefs(parentComponents);
  const dedupedParentPages = dedupeUiImpactRefs(parentPages);

  if (
    dedupedParentComponents.length === 0 &&
    dedupedParentPages.length === 0 &&
    observedPropUsage.length === 0
  ) {
    return undefined;
  }

  return {
    parentComponents: dedupedParentComponents,
    parentPages: dedupedParentPages,
    observedPropUsage,
    confidence:
      dedupedParentComponents.length > 0 || dedupedParentPages.length > 0 ? 'medium' : 'low',
  };
}

function buildImpactResultSummary(
  directFiles: ImpactedFile[],
  directSymbols: ImpactedSymbol[],
  indirectFiles: ImpactedFile[],
  indirectSymbols: ImpactedSymbol[],
  relatedFiles: ImpactedFile[],
  relatedSymbols: ImpactedSymbol[],
  transitiveImpacts: TransitiveImpact[],
): ImpactResultSummary {
  const allFiles = [
    ...directFiles.map((entry) => ({ fileId: entry.fileId, filePath: entry.filePath })),
    ...indirectFiles.map((entry) => ({ fileId: entry.fileId, filePath: entry.filePath })),
    ...relatedFiles.map((entry) => ({ fileId: entry.fileId, filePath: entry.filePath })),
    ...transitiveImpacts
      .map((entry) => entry.file)
      .filter((entry): entry is ImpactedFile => Boolean(entry))
      .map((entry) => ({ fileId: entry.fileId, filePath: entry.filePath })),
  ];
  const highlightedSurfaces = new Map<string, ImpactSummarySurface>();
  const featureClusters = new Map<string, number>();
  const transitiveGroups = new Map<string, ImpactSummaryTransitiveGroup>();

  for (const entry of allFiles) {
    const surface = toImpactSummarySurface(entry.fileId, entry.filePath);

    if (surface && !highlightedSurfaces.has(surface.filePath)) {
      highlightedSurfaces.set(surface.filePath, surface);
    }

    const cluster = detectFeatureCluster(entry.filePath);

    if (cluster) {
      featureClusters.set(cluster, (featureClusters.get(cluster) ?? 0) + 1);
    }
  }

  for (const impact of transitiveImpacts) {
    const file = impact.file;
    const topEvidence = getTopEvidence(impact);
    const viaStep = topEvidence?.via?.[0];

    if (!file || !viaStep) {
      continue;
    }

    const key = viaStep.fileId ?? viaStep.filePath;
    const existing = transitiveGroups.get(key);
    const surface = toImpactSummarySurface(file.fileId, file.filePath);
    const cluster = detectFeatureCluster(file.filePath);

    if (!existing) {
      transitiveGroups.set(key, {
        viaFileId: viaStep.fileId,
        viaFilePath: viaStep.filePath,
        depth: impact.depth,
        fileCount: 1,
        surfaces: surface ? [surface] : [],
        featureClusters: cluster ? [cluster] : [],
      });
      continue;
    }

    existing.fileCount += 1;

    if (surface && !existing.surfaces.some((entry) => entry.filePath === surface.filePath)) {
      existing.surfaces.push(surface);
    }

    if (cluster && !existing.featureClusters.includes(cluster)) {
      existing.featureClusters.push(cluster);
    }
  }

  const totalFiles =
    directFiles.length +
    indirectFiles.length +
    relatedFiles.length +
    transitiveImpacts.filter((entry) => entry.file).length;
  const minimalSummary = totalFiles < 10;

  return {
    directFiles: directFiles.length,
    directSymbols: directSymbols.length,
    indirectFiles: indirectFiles.length,
    indirectSymbols: indirectSymbols.length,
    relatedContextFiles: relatedFiles.length,
    relatedContextSymbols: relatedSymbols.length,
    transitiveFiles: transitiveImpacts.filter((entry) => entry.file).length,
    transitiveSymbols: transitiveImpacts.filter((entry) => entry.symbol).length,
    viaGroups: transitiveGroups.size,
    highlightedSurfaces: Array.from(highlightedSurfaces.values())
      .sort(compareImpactSummarySurfaces)
      .slice(0, minimalSummary ? 3 : 8),
    featureClusters: minimalSummary
      ? []
      : Array.from(featureClusters.entries())
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .map(([cluster]) => cluster)
          .slice(0, 6),
    transitiveGroups: minimalSummary
      ? []
      : Array.from(transitiveGroups.values())
          .map((group) => ({
            ...group,
            surfaces: [...group.surfaces].sort(compareImpactSummarySurfaces).slice(0, 4),
            featureClusters: [...group.featureClusters].sort((left, right) => left.localeCompare(right)).slice(0, 4),
          }))
          .sort((left, right) => {
            return (
              right.fileCount - left.fileCount ||
              architectureSurfaceWeight((right.surfaces[0]?.filePath ?? '')) -
                architectureSurfaceWeight((left.surfaces[0]?.filePath ?? '')) ||
              left.viaFilePath.localeCompare(right.viaFilePath)
            );
          }),
  };
}

async function resolveTarget(input: AnalyzeSymbolImpactInput): Promise<ImpactAnalysisTarget> {
  const index = await loadRequiredSymbolIndex();
  let symbol: IndexedSymbol | null = null;

  if (input.symbolId) {
    symbol = index.symbols.find((entry) => entry.symbolId === input.symbolId) ?? null;
  } else if (input.filePath && input.symbolName) {
    const normalizedPath = normalizePath(input.filePath);
    symbol =
      index.symbols.find((entry) => {
        if (input.repoId && entry.repo !== input.repoId) {
          return false;
        }

        return normalizePath(entry.filePath) === normalizedPath && entry.name === input.symbolName;
      }) ?? null;
  } else if (input.filePath) {
    try {
      const relation = await getFileRelation(input.filePath, input.repoId);
      const fileSymbols = index.symbols.filter((entry) => entry.fileId === relation.fileId);

      if (fileSymbols.length === 1) {
        symbol = fileSymbols[0];
      }
    } catch {
      symbol = null;
    }
  }

  if (!symbol) {
    return {
      requestedRepoId: input.repoId,
      requestedSymbolId: input.symbolId,
      requestedFilePath: input.filePath,
      requestedSymbolName: input.symbolName,
      symbol: null,
      symbolId: null,
      symbolName: input.symbolName ?? null,
      kind: null,
      repoId: input.repoId ?? null,
      file: null,
    };
  }

  const file = await getFileNode(symbol.fileId);

  return {
    requestedRepoId: input.repoId,
    requestedSymbolId: input.symbolId,
    requestedFilePath: input.filePath,
    requestedSymbolName: input.symbolName,
    symbol,
    symbolId: symbol.symbolId,
    symbolName: symbol.name,
    kind: symbol.kind,
    repoId: symbol.repo,
    file,
  };
}

async function getFileContent(repoId: string, filePath: string): Promise<string | null> {
  const config = loadConfig();
  const repository = await getRepositoryById(config.reposRoot, repoId);

  if (!repository) {
    return null;
  }

  try {
    const file = await readRepositoryFile(repository, filePath);
    return file.content;
  } catch {
    return null;
  }
}

function lineSlice(content: string, startLine: number, endLine: number): string {
  const lines = content.split(/\r?\n/);
  return lines.slice(startLine - 1, endLine).join('\n');
}

function containsIdentifier(source: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(source);
}

function importSourceLikelyTargetsFile(source: string, targetFilePath: string): boolean {
  const normalizedSource = stripKnownExtension(normalizePath(source)).replace(/\/index$/i, '');
  const normalizedTarget = stripKnownExtension(normalizePath(targetFilePath)).replace(/\/index$/i, '');

  if (!normalizedSource || !normalizedTarget) {
    return false;
  }

  const sourceBase = normalizedSource.split('/').pop() ?? normalizedSource;
  const targetBase = normalizedTarget.split('/').pop() ?? normalizedTarget;

  return (
    normalizedSource === normalizedTarget ||
    normalizedTarget.endsWith(`/${normalizedSource}`) ||
    normalizedSource.endsWith(`/${targetBase}`) ||
    sourceBase === targetBase
  );
}

function buildEvidence(
  reason: ImpactReason,
  confidence: ImpactConfidence,
  filePath: string,
  notes: string[],
  impactScope: ImpactScope,
  tier: ImpactTier,
  source: ImpactEvidence['source'] = 'graph',
  symbolId?: string,
  symbolName?: string,
  depth = 1,
  via?: ImpactEvidence['via'],
  coverageSignals: ImpactCoverageSignal[] = [],
): ImpactEvidence {
  return {
    reason,
    confidence,
    source,
    impactScope,
    tier,
    depth,
    via:
      via ??
      [
        {
          filePath,
          symbolId,
          symbolName,
          reason,
        },
      ],
    coverageSignals,
    notes,
  };
}

function buildImpactedSymbol(
  entry: Omit<ImpactedSymbol, 'confidence' | 'coverageSignals'> & { evidence: ImpactEvidence[] },
): ImpactedSymbol {
  return {
    ...entry,
    confidence: pickConfidence(entry.evidence),
    coverageSignals: mergeCoverageSignals(entry.evidence),
  };
}

function buildImpactedFile(
  entry: Omit<ImpactedFile, 'confidence' | 'coverageSignals'> & { evidence: ImpactEvidence[] },
): ImpactedFile {
  return {
    ...entry,
    confidence: pickConfidence(entry.evidence),
    coverageSignals: mergeCoverageSignals(entry.evidence),
  };
}

function getTargetExportNames(target: IndexedSymbol, exports: ExportRecord[]): { names: Set<string>; hasDefault: boolean } {
  const names = new Set<string>();
  let hasDefault = false;

  for (const entry of exports) {
    if (entry.symbolId && entry.symbolId !== target.symbolId) {
      continue;
    }

    if (entry.kind === 'default') {
      hasDefault = true;
      if (entry.exportedName) {
        names.add(entry.exportedName);
      }
      continue;
    }

    if (entry.exportedName) {
      names.add(entry.exportedName);
    }

    if (entry.localName === target.name) {
      names.add(entry.exportedName ?? target.name);
    }
  }

  if (target.exported) {
    names.add(target.name);
  }

  return { names, hasDefault };
}

function bindingTargetsSymbol(
  binding: ImportBinding,
  exportedNames: Set<string>,
  hasDefault: boolean,
): boolean {
  if (binding.kind === 'default') {
    return hasDefault;
  }

  if (binding.importedName === null) {
    return false;
  }

  return exportedNames.has(binding.importedName);
}

async function collectSameFileImpacts(target: IndexedSymbol): Promise<ImpactedSymbol[]> {
  const [definedSymbols, content, file] = await Promise.all([
    getDefinedSymbols(target.fileId),
    getFileContent(target.repo, target.filePath),
    getFileNode(target.fileId),
  ]);

  if (!content || !file) {
    return [];
  }

  const impacts: ImpactedSymbol[] = [];

  for (const candidate of definedSymbols) {
    if (candidate.symbolId === target.symbolId) {
      continue;
    }

    const slice = lineSlice(content, candidate.startLine, candidate.endLine);

    if (!containsIdentifier(slice, target.name)) {
      continue;
    }

    const evidence = buildEvidence(
      'same-file-reference',
      'low',
      candidate.filePath,
      ['exact symbol-name occurrence found inside a sibling symbol span in the same file; this is local same-file evidence, not a confirmed symbol reference edge'],
      'local-symbol',
      'context',
      'symbol-index',
      candidate.symbolId,
      candidate.name,
      1,
      undefined,
      ['approximate_scope'],
    );

    impacts.push(buildImpactedSymbol({
      symbol: candidate,
      file,
      symbolId: candidate.symbolId,
      symbolName: candidate.name,
      kind: candidate.kind,
      exported: candidate.exported,
      filePath: candidate.filePath,
      repoId: candidate.repoId,
      impactScope: 'local-symbol',
      tier: 'context',
      evidence: [evidence],
    }));
  }

  return impacts.sort((left, right) => compareSymbols(left, right));
}

async function collectImporterImpacts(target: IndexedSymbol): Promise<{
  directFiles: ImpactedFile[];
  directSymbols: ImpactedSymbol[];
  relatedFiles: ImpactedFile[];
}> {
  const [importingFiles, targetRelation] = await Promise.all([
    getImportingFiles(target.fileId),
    getFileRelationById(target.fileId),
  ]);

  if (!targetRelation) {
    return { directFiles: [], directSymbols: [], relatedFiles: [] };
  }

  const { names: exportedNames, hasDefault } = getTargetExportNames(target, targetRelation.exports);
  const directFiles: ImpactedFile[] = [];
  const directSymbols: ImpactedSymbol[] = [];
  const relatedFiles: ImpactedFile[] = [];

  for (const importingFile of importingFiles) {
    const [relation, definedSymbols, content] = await Promise.all([
      getFileRelationById(importingFile.fileId),
      getDefinedSymbols(importingFile.fileId),
      getFileContent(importingFile.repoId, importingFile.filePath),
    ]);

    const matchingBindings = (relation?.imports ?? []).flatMap((entry) => {
      const targetsFile =
        entry.resolvedTargetFileId === target.fileId || importSourceLikelyTargetsFile(entry.source, target.filePath);

      if (!targetsFile) {
        return [];
      }

      return entry.bindings
        .filter((binding) => bindingTargetsSymbol(binding, exportedNames, hasDefault))
        .map((binding) => ({
          ...binding,
          source: entry.source,
        }));
    });

    if (matchingBindings.length > 0) {
      const importerFileEvidence = buildEvidence(
        'imports-target',
        'high',
        importingFile.filePath,
        [`file declares import bindings tied to the target export surface (${matchingBindings.map((binding) => binding.localName).join(', ')})`],
        'file-direct',
        'direct',
        'graph',
      );

      directFiles.push(buildImpactedFile({
        file: importingFile,
        fileId: importingFile.fileId,
        filePath: importingFile.filePath,
        repoId: importingFile.repoId,
        impactScope: 'file-direct',
        tier: 'direct',
        evidence: [importerFileEvidence],
      }));
    } else {
      const relatedImporterEvidence = buildEvidence(
        'imports-target',
        'low',
        importingFile.filePath,
        ['file imports the target file through a graph-known edge, but no target binding could be proven from the local import relation'],
        'fallback',
        'context',
        'graph',
        undefined,
        undefined,
        1,
        undefined,
        ['missing_graph_evidence', 'approximate_scope'],
      );

      relatedFiles.push(buildImpactedFile({
        file: importingFile,
        fileId: importingFile.fileId,
        filePath: importingFile.filePath,
        repoId: importingFile.repoId,
        impactScope: 'fallback',
        tier: 'context',
        evidence: [relatedImporterEvidence],
      }));
    }

    if (!content || matchingBindings.length === 0) {
      continue;
    }

    for (const definedSymbol of definedSymbols) {
      const slice = lineSlice(content, definedSymbol.startLine, definedSymbol.endLine);
      const referencedBinding = matchingBindings.find((binding) => containsIdentifier(slice, binding.localName));

      if (!referencedBinding) {
        continue;
      }

      const symbolFile = await getFileNode(definedSymbol.fileId);
      const symbolEvidence = buildEvidence(
        'imports-target',
        'high',
        definedSymbol.filePath,
        [`symbol span references imported binding "${referencedBinding.localName}" from "${referencedBinding.source}", tied to the target export surface`],
        'symbol-direct',
        'direct',
        'symbol-index',
        definedSymbol.symbolId,
        definedSymbol.name,
      );

      directSymbols.push(buildImpactedSymbol({
        symbol: definedSymbol,
        file: symbolFile,
        symbolId: definedSymbol.symbolId,
        symbolName: definedSymbol.name,
        kind: definedSymbol.kind,
        exported: definedSymbol.exported,
        filePath: definedSymbol.filePath,
        repoId: definedSymbol.repoId,
        impactScope: 'symbol-direct',
        tier: 'direct',
        evidence: [symbolEvidence],
      }));
    }
  }

  return { directFiles, directSymbols, relatedFiles };
}

function inferReferenceReason(match: {
  isCallReference: boolean;
  isJsxReference: boolean;
  isTypeReference: boolean;
  isImportBinding: boolean;
}): ImpactReason {
  if (match.isCallReference) {
    return 'calls-target';
  }

  if (match.isJsxReference) {
    return 'jsx-uses-target';
  }

  if (match.isTypeReference) {
    return 'type-propagation';
  }

  if (match.isImportBinding) {
    return 'imports-target';
  }

  return 'calls-target';
}

async function collectCompilerReferenceImpacts(target: IndexedSymbol): Promise<{
  directFiles: ImpactedFile[];
  directSymbols: ImpactedSymbol[];
}> {
  let repository: Awaited<ReturnType<typeof getRepositoryById>> | null = null;

  try {
    repository = await getRepositoryById(loadConfig().reposRoot, target.repo);
  } catch {
    repository = null;
  }

  if (!repository) {
    return {
      directFiles: [],
      directSymbols: [],
    };
  }

  let matches;

  try {
    matches = await findTypeScriptReferencesForIndexedSymbol(repository, target);
  } catch {
    return {
      directFiles: [],
      directSymbols: [],
    };
  }
  const matchesByFile = new Map<string, typeof matches>();

  for (const match of matches) {
    if (match.filePath === target.filePath) {
      continue;
    }

    const existing = matchesByFile.get(match.filePath) ?? [];
    existing.push(match);
    matchesByFile.set(match.filePath, existing);
  }

  const directFiles: ImpactedFile[] = [];
  const directSymbols: ImpactedSymbol[] = [];

  for (const [filePath, fileMatches] of matchesByFile.entries()) {
    const [file, relation, definedSymbols] = await Promise.all([
      getFileNode(`${target.repo}:${filePath}`),
      getFileRelation(filePath, target.repo).catch(() => null),
      getDefinedSymbols(`${target.repo}:${filePath}`).catch(() => []),
    ]);
    const topMatch = fileMatches.find((entry) => !entry.isImportBinding) ?? fileMatches[0];
    const reason = inferReferenceReason(topMatch);
    const fileEvidence = buildEvidence(
      reason,
      'high',
      filePath,
      ['TypeScript resolved an exact cross-file symbol reference to the target declaration'],
      'file-direct',
      'direct',
      'graph',
    );

    directFiles.push(buildImpactedFile({
      file,
      fileId: relation?.fileId ?? file?.fileId ?? `${target.repo}:${filePath}`,
      filePath,
      repoId: target.repo,
      impactScope: 'file-direct',
      tier: 'direct',
      evidence: [fileEvidence],
    }));

    for (const definedSymbol of definedSymbols) {
      const symbolMatches = fileMatches.filter((match) => match.line >= definedSymbol.startLine && match.line <= definedSymbol.endLine);

      if (symbolMatches.length === 0) {
        continue;
      }

      const topSymbolMatch = symbolMatches.find((entry) => !entry.isImportBinding) ?? symbolMatches[0];
      const symbolReason = inferReferenceReason(topSymbolMatch);
      const symbolFile = file ?? (await getFileNode(definedSymbol.fileId));
      const symbolEvidence = buildEvidence(
        symbolReason,
        'high',
        filePath,
        [`TypeScript resolved exact symbol references inside "${definedSymbol.name}"`],
        'symbol-direct',
        'direct',
        'graph',
        definedSymbol.symbolId,
        definedSymbol.name,
      );

      directSymbols.push(buildImpactedSymbol({
        symbol: definedSymbol,
        file: symbolFile,
        symbolId: definedSymbol.symbolId,
        symbolName: definedSymbol.name,
        kind: definedSymbol.kind,
        exported: definedSymbol.exported,
        filePath: definedSymbol.filePath,
        repoId: definedSymbol.repoId,
        impactScope: 'symbol-direct',
        tier: 'direct',
        evidence: [symbolEvidence],
      }));
    }
  }

  return {
    directFiles,
    directSymbols,
  };
}

async function collectReexportImpacts(target: IndexedSymbol): Promise<{
  indirectFiles: ImpactedFile[];
  indirectSymbols: ImpactedSymbol[];
}> {
  const reexportingFiles = await getReexportingFiles(target.fileId);
  const indirectFiles: ImpactedFile[] = [];
  const indirectSymbols: ImpactedSymbol[] = [];

  for (const reexportingFile of reexportingFiles) {
    const [relation, definedSymbols, content] = await Promise.all([
      getFileRelationById(reexportingFile.fileId),
      getDefinedSymbols(reexportingFile.fileId),
      getFileContent(reexportingFile.repoId, reexportingFile.filePath),
    ]);

    const evidence = buildEvidence(
      'reexports-target',
      'medium',
      reexportingFile.filePath,
      ['file re-exports the target file through a resolved local re-export edge; downstream consumer usage is not confirmed by this evidence alone'],
      'proxy',
      'indirect',
      'graph',
      undefined,
      undefined,
      1,
      undefined,
      ['proxy_only'],
    );

    indirectFiles.push(buildImpactedFile({
      file: reexportingFile,
      fileId: reexportingFile.fileId,
      filePath: reexportingFile.filePath,
      repoId: reexportingFile.repoId,
      impactScope: 'proxy',
      tier: 'indirect',
      evidence: [evidence],
    }));

    if (!relation || !content) {
      continue;
    }

    const hasNamedLocalReference = relation.exports.some(
      (entry) =>
        entry.kind === 'named' &&
        (entry.symbolId === target.symbolId || entry.localName === target.name),
    );

    if (!hasNamedLocalReference) {
      continue;
    }

    for (const definedSymbol of definedSymbols) {
      const slice = lineSlice(content, definedSymbol.startLine, definedSymbol.endLine);

      if (!containsIdentifier(slice, target.name)) {
        continue;
      }

      const symbolFile = await getFileNode(definedSymbol.fileId);
      const symbolEvidence = buildEvidence(
        'reexports-target',
        'medium',
        definedSymbol.filePath,
        ['same-file symbol span references a local symbol that is re-exported from this file; this is a barrel-proxy signal, not a confirmed downstream consumer reference'],
        'proxy',
        'indirect',
        'symbol-index',
        definedSymbol.symbolId,
        definedSymbol.name,
        1,
        undefined,
        ['proxy_only', 'approximate_scope'],
      );

      indirectSymbols.push(buildImpactedSymbol({
        symbol: definedSymbol,
        file: symbolFile,
        symbolId: definedSymbol.symbolId,
        symbolName: definedSymbol.name,
        kind: definedSymbol.kind,
        exported: definedSymbol.exported,
        filePath: definedSymbol.filePath,
        repoId: definedSymbol.repoId,
        impactScope: 'proxy',
        tier: 'indirect',
        evidence: [symbolEvidence],
      }));
    }
  }

  return { indirectFiles, indirectSymbols };
}

function mergeImpactedFiles(entries: ImpactedFile[]): ImpactedFile[] {
  const byFile = new Map<string, ImpactedFile>();

  for (const entry of entries) {
    const key = entry.fileId ?? entry.filePath;
    const existing = byFile.get(key);

    if (!existing) {
      byFile.set(key, entry);
      continue;
    }

    existing.evidence.push(...entry.evidence);
    existing.confidence = pickConfidence(existing.evidence);
    existing.coverageSignals = mergeCoverageSignals(existing.evidence);
  }

  return Array.from(byFile.values())
    .sort((left, right) => compareEvidence(left.evidence, right.evidence) || compareFiles(left, right));
}

function mergeImpactedSymbols(entries: ImpactedSymbol[]): ImpactedSymbol[] {
  const bySymbol = new Map<string, ImpactedSymbol>();

  for (const entry of entries) {
    const key = entry.symbolId ?? `${entry.filePath}:${entry.symbolName}`;
    const existing = bySymbol.get(key);

    if (!existing) {
      bySymbol.set(key, entry);
      continue;
    }

    existing.evidence.push(...entry.evidence);
    existing.confidence = pickConfidence(existing.evidence);
    existing.coverageSignals = mergeCoverageSignals(existing.evidence);
  }

  return Array.from(bySymbol.values())
    .sort((left, right) => compareEvidence(left.evidence, right.evidence) || compareSymbols(left, right));
}

interface DirectImpactFileSeed {
  fileId: string;
  filePath: string;
  repoId: string;
  impactScope: ImpactScope;
  reason: ImpactReason;
}

function collectDirectImpactFileSeeds(
  directFiles: ImpactedFile[],
  directSymbols: ImpactedSymbol[],
  targetFileId: string,
): DirectImpactFileSeed[] {
  const seeds = new Map<string, DirectImpactFileSeed>();

  for (const entry of directFiles) {
    if (!entry.fileId || !entry.repoId || entry.fileId === targetFileId) {
      continue;
    }

    const topReason = entry.evidence[0]?.reason ?? 'imports-target';
    seeds.set(entry.fileId, {
      fileId: entry.fileId,
      filePath: entry.filePath,
      repoId: entry.repoId,
      impactScope: entry.impactScope,
      reason: topReason,
    });
  }

  for (const entry of directSymbols) {
    const fileId = entry.file?.fileId;
    const repoId = entry.repoId ?? entry.file?.repoId;

    if (!fileId || !repoId || fileId === targetFileId || seeds.has(fileId)) {
      continue;
    }

    const topReason = entry.evidence[0]?.reason ?? 'imports-target';
    seeds.set(fileId, {
      fileId,
      filePath: entry.filePath,
      repoId,
      impactScope: entry.impactScope,
      reason: topReason,
    });
  }

  return Array.from(seeds.values()).sort(compareDirectImpactFileSeeds);
}

async function collectTransitiveImpacts(
  target: ImpactAnalysisTarget,
  seedFiles: ImpactedFile[],
  seedSymbols: ImpactedSymbol[],
): Promise<{ impacts: TransitiveImpact[]; truncated: boolean }> {
  if (!target.file?.fileId) {
    return { impacts: [], truncated: false };
  }

  const seeds = collectDirectImpactFileSeeds(seedFiles, seedSymbols, target.file.fileId);
  const directFileIds = new Set<string>([
    target.file.fileId,
    ...seedFiles.map((entry) => entry.fileId).filter((entry): entry is string => typeof entry === 'string'),
  ]);
  const impacts = new Map<string, TransitiveImpact>();
  const visited = new Set<string>([target.file.fileId]);
  const groupOrder = new Map<string, number>();
  let truncated = false;

  for (const seed of seeds) {
    visited.add(seed.fileId);
  }

  seeds.forEach((seed, index) => {
    groupOrder.set(seed.fileId, index);
  });

  for (const seed of seeds) {
    const importers = await getImportingFiles(seed.fileId);

    for (const importer of importers) {
      if (visited.has(importer.fileId) || directFileIds.has(importer.fileId)) {
        continue;
      }

      const evidence = buildEvidence(
        'imports-target',
        'medium',
        importer.filePath,
        [`file imports direct impact file "${seed.filePath}" and is included as a bounded exploratory second-hop candidate`],
        'proxy',
        'indirect',
        'graph',
        undefined,
        undefined,
        2,
        [
          {
            fileId: seed.fileId,
            filePath: seed.filePath,
            reason: seed.reason,
          },
        ],
        ['proxy_only'],
      );
      const fileImpact = buildImpactedFile({
        file: importer,
        fileId: importer.fileId,
        filePath: importer.filePath,
        repoId: importer.repoId,
        impactScope: 'proxy',
        tier: 'indirect',
        evidence: [evidence],
      });

      impacts.set(importer.fileId, {
        depth: 2,
        file: fileImpact,
        tier: 'indirect',
        confidence: 'medium',
        coverageSignals: mergeCoverageSignals([evidence]),
        evidence: [evidence],
      });
      visited.add(importer.fileId);

      if (impacts.size >= MAX_TRANSITIVE_IMPACTS) {
        truncated = true;
        break;
      }
    }

    if (truncated) {
      break;
    }
  }

  return {
    impacts: Array.from(impacts.values()).sort((left, right) => compareTransitiveImpacts(left, right, groupOrder)),
    truncated,
  };
}

function buildSummary(
  directFiles: ImpactedFile[],
  directSymbols: ImpactedSymbol[],
  indirectFiles: ImpactedFile[],
  indirectSymbols: ImpactedSymbol[],
  relatedFiles: ImpactedFile[],
  relatedSymbols: ImpactedSymbol[],
  transitiveImpacts: TransitiveImpact[],
  notes: string[],
): ImpactAnalysisSummary {
  const impacts = [
    ...directFiles.map((entry) => entry.confidence),
    ...directSymbols.map((entry) => entry.confidence),
    ...indirectFiles.map((entry) => entry.confidence),
    ...indirectSymbols.map((entry) => entry.confidence),
    ...relatedFiles.map((entry) => entry.confidence),
    ...relatedSymbols.map((entry) => entry.confidence),
    ...transitiveImpacts.map((entry) => entry.confidence),
  ];
  const symbolDirectImpactCount = directSymbols.filter((entry) => entry.impactScope === 'symbol-direct').length;
  const fileDirectImpactCount = directFiles.filter((entry) => entry.impactScope === 'file-direct').length;
  const proxyImpactCount =
    indirectFiles.filter((entry) => entry.impactScope === 'proxy').length +
    indirectSymbols.filter((entry) => entry.impactScope === 'proxy').length +
    transitiveImpacts.filter((entry) => entry.file?.impactScope === 'proxy' || entry.symbol?.impactScope === 'proxy').length;
  const localSymbolImpactCount = relatedSymbols.filter((entry) => entry.impactScope === 'local-symbol').length;
  const overviewParts: string[] = [];

  if (symbolDirectImpactCount > 0) {
    overviewParts.push(`${symbolDirectImpactCount} exact symbol consumer`);
  }

  if (fileDirectImpactCount > 0) {
    overviewParts.push(`${fileDirectImpactCount} exact file consumer`);
  }

  if (indirectFiles.length + indirectSymbols.length > 0) {
    overviewParts.push(`${indirectFiles.length + indirectSymbols.length} inferred indirect consumer`);
  }

  if (relatedFiles.length + localSymbolImpactCount > 0) {
    overviewParts.push(`${relatedFiles.length + localSymbolImpactCount} related context`);
  }

  if (transitiveImpacts.length > 0) {
    overviewParts.push(`${transitiveImpacts.length} bounded transitive consumer`);
  }

  const overview =
    overviewParts.length > 0
      ? `exact direct consumers are separated from inferred and contextual results: ${overviewParts.join(', ')}`
      : 'no exact direct consumers identified from the current symbol and graph evidence';

  return {
    directFileCount: directFiles.length,
    directSymbolCount: directSymbols.length,
    indirectFileCount: indirectFiles.length,
    indirectSymbolCount: indirectSymbols.length,
    relatedContextFileCount: relatedFiles.length,
    relatedContextSymbolCount: relatedSymbols.length,
    transitiveFileCount: transitiveImpacts.filter((entry) => entry.file).length,
    transitiveSymbolCount: transitiveImpacts.filter((entry) => entry.symbol).length,
    highConfidenceImpactCount: impacts.filter((entry) => entry === 'high').length,
    mediumConfidenceImpactCount: impacts.filter((entry) => entry === 'medium').length,
    lowConfidenceImpactCount: impacts.filter((entry) => entry === 'low').length,
    symbolDirectImpactCount,
    fileDirectImpactCount,
    proxyImpactCount,
    localSymbolImpactCount,
    overview,
    ambiguityDetected: false,
    notes,
  };
}

export async function analyzeSymbolImpact(input: AnalyzeSymbolImpactInput): Promise<ImpactAnalysisResult> {
  const target = await resolveTarget(input);

  if (!target.symbol || !target.file || !target.repoId) {
    return buildMissingResult(input, ['target symbol could not be resolved from the current symbol index and graph']);
  }

  const effectiveMaxDepth = getEffectiveMaxDepth(input);
  const notes: string[] = [];

  const [sameFileSymbols, importerImpacts, reexportImpacts, compilerReferenceImpacts] = await Promise.all([
    collectSameFileImpacts(target.symbol),
    collectImporterImpacts(target.symbol),
    collectReexportImpacts(target.symbol),
    collectCompilerReferenceImpacts(target.symbol),
  ]);

  const directConsumers: ImpactResultBucket = {
    files: mergeImpactedFiles([...importerImpacts.directFiles, ...compilerReferenceImpacts.directFiles]),
    symbols: mergeImpactedSymbols([...importerImpacts.directSymbols, ...compilerReferenceImpacts.directSymbols]),
  };
  const indirectConsumers: ImpactIndirectConsumers = {
    files: mergeImpactedFiles(reexportImpacts.indirectFiles),
    symbols: mergeImpactedSymbols(reexportImpacts.indirectSymbols),
    transitive: [],
  };
  const relatedContext: ImpactResultBucket = {
    files: mergeImpactedFiles(importerImpacts.relatedFiles),
    symbols: mergeImpactedSymbols(sameFileSymbols),
  };
  const directlyImpactedSymbols = directConsumers.symbols;
  const directlyImpactedFiles = directConsumers.files;
  let transitiveImpacts: TransitiveImpact[] = [];

  if (input.mode === 'exploratory' && effectiveMaxDepth >= 2) {
    const transitive = await collectTransitiveImpacts(
      target,
      [...directConsumers.files, ...indirectConsumers.files],
      [...directConsumers.symbols, ...indirectConsumers.symbols],
    );
    transitiveImpacts = transitive.impacts;
    indirectConsumers.transitive = transitiveImpacts;

    if (transitiveImpacts.length > 0) {
      notes.push('exploratory mode adds one bounded inferred-consumer hop beyond the exact direct consumer surface');
    }

    if (transitive.truncated) {
      notes.push(`exploratory transitive results were capped at ${MAX_TRANSITIVE_IMPACTS} files to keep traversal bounded`);
    }
  } else if (input.mode === 'exploratory') {
    notes.push('exploratory mode is enabled, but bounded transitive expansion was not applied because maxDepth is below 2');
  }

  if (directConsumers.files.length > 0) {
    notes.push('direct consumers require proven import bindings, callsites, or graph-backed symbol references');
  }

  if (indirectConsumers.files.length > 0 || indirectConsumers.symbols.length > 0 || transitiveImpacts.length > 0) {
    notes.push('re-exports, wrapper layers, and bounded transitive propagation are reported as inferred indirect consumers, not exact breakage');
  }

  if (relatedContext.files.length > 0 || relatedContext.symbols.length > 0) {
    notes.push('same-file matches and unresolved importer edges are kept as related context only because exact symbol-level usage was not proven');
  }

  const uiImpact = await buildUiImpactSummary(target);

  if (uiImpact) {
    notes.push('ui impact signals are supplementary JSX hierarchy hints derived from component composition and observed prop usage; they do not change graph-based impact ranking');
  }

  return {
    mode: input.mode,
    target,
    directConsumers,
    indirectConsumers,
    relatedContext,
    directlyImpactedSymbols,
    directlyImpactedFiles,
    transitiveImpacts,
    impactSummary: buildImpactResultSummary(
      directConsumers.files,
      directConsumers.symbols,
      indirectConsumers.files,
      indirectConsumers.symbols,
      relatedContext.files,
      relatedContext.symbols,
      transitiveImpacts,
    ),
    ...(uiImpact ? { uiImpact } : {}),
    publicSurfaceRisk: {
      level: 'unknown',
      notes: ['public surface risk is not derived in phase 5.1 step B'],
    },
    summary: buildSummary(
      directConsumers.files,
      directConsumers.symbols,
      indirectConsumers.files,
      indirectConsumers.symbols,
      relatedContext.files,
      relatedContext.symbols,
      transitiveImpacts,
      notes,
    ),
  };
}
