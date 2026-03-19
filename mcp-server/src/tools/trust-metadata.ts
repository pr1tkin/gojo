import { loadCurrentGenerationState } from '../indexing/generation-store.js';
import type { SearchRepoFingerprint } from '../indexing/types.js';
import type { PatternStructuralAlignment } from '../patterns/structural-alignment.js';
import { loadPatternIndexResult } from '../patterns/store.js';
import type { PatternMatchContext } from '../orchestrator/types.js';
import type { UiHierarchyTreeNode } from '../orchestrator/ui-hierarchy-types.js';

export interface ToolCoverageScopeSnapshot {
  filesAnalyzed: number;
  filesTotal: number;
  ratio: number;
}

export interface ToolCoverageMetadata extends ToolCoverageScopeSnapshot {
  scope: 'relevant_source' | 'raw_search_visible';
  raw: ToolCoverageScopeSnapshot;
  relevant?: ToolCoverageScopeSnapshot;
}

export interface ToolTrustMetadata {
  coverage: ToolCoverageMetadata;
  completeness?: number;
  confidence: 'high' | 'medium' | 'low';
  warnings?: string[];
  patternCoverage?: ToolCoverageScopeSnapshot;
  structuralAlignment?: {
    graphAnchored: boolean;
    structuralContextStrength: PatternStructuralAlignment['structuralContextStrength'];
  } | null;
}

interface StructuralCoverageSnapshot {
  coverage: ToolCoverageMetadata;
  searchReady: boolean;
  warnings: string[];
}

interface PatternCoverageSnapshot {
  coverage: ToolCoverageMetadata;
  patternCoverage: ToolCoverageScopeSnapshot;
  warnings: string[];
}

interface BuildTrustMetadataOptions {
  coverage: ToolCoverageMetadata;
  completeness?: number;
  warnings?: string[];
  criticalUnresolvedSignals?: boolean;
  patternCoverage?: ToolCoverageScopeSnapshot;
}

interface UiTreeResolutionSummary {
  totalNodes: number;
  resolutionCounts: Record<string, number>;
}

function roundRatio(value: number): number {
  return Number(value.toFixed(3));
}

function createCoverage(filesAnalyzed: number, filesTotal: number): ToolCoverageScopeSnapshot {
  const safeFilesAnalyzed = Math.max(0, filesAnalyzed);
  const safeFilesTotal = Math.max(safeFilesAnalyzed, filesTotal);

  return {
    filesAnalyzed: safeFilesAnalyzed,
    filesTotal: safeFilesTotal,
    ratio: safeFilesTotal === 0 ? 0 : roundRatio(safeFilesAnalyzed / safeFilesTotal),
  };
}

function createScopedCoverage(input: {
  raw: ToolCoverageScopeSnapshot;
  relevant?: ToolCoverageScopeSnapshot;
}): ToolCoverageMetadata {
  const preferred = input.relevant ?? input.raw;

  return {
    ...preferred,
    scope: input.relevant ? 'relevant_source' : 'raw_search_visible',
    raw: input.raw,
    ...(input.relevant ? { relevant: input.relevant } : {}),
  };
}

function getPrimaryCoverageScope(coverage: ToolCoverageMetadata): ToolCoverageScopeSnapshot {
  return coverage.relevant ?? coverage.raw;
}

function classifyTrustConfidence(options: {
  coverage: ToolCoverageMetadata;
  completeness?: number;
  criticalUnresolvedSignals?: boolean;
}): ToolTrustMetadata['confidence'] {
  const { coverage, completeness, criticalUnresolvedSignals } = options;
  const primaryCoverage = getPrimaryCoverageScope(coverage);

  if (
    primaryCoverage.ratio < 0.6 ||
    (completeness !== undefined && completeness < 0.4) ||
    Boolean(criticalUnresolvedSignals)
  ) {
    return 'low';
  }

  if (
    primaryCoverage.ratio > 0.9 &&
    (completeness === undefined || completeness > 0.8)
  ) {
    return coverage.scope === 'relevant_source' ? 'high' : 'medium';
  }

  return 'medium';
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function dedupeWarnings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function summarizePatternStructuralAlignment(
  alignment: PatternStructuralAlignment | null,
): ToolTrustMetadata['structuralAlignment'] {
  if (!alignment) {
    return null;
  }

  return {
    graphAnchored: alignment.graphAnchored,
    structuralContextStrength: alignment.structuralContextStrength,
  };
}

function sumRawSearchVisibleFiles(repoFingerprints: SearchRepoFingerprint[]): number {
  return repoFingerprints.reduce((total, fingerprint) => total + fingerprint.fileCount, 0);
}

function getRelevantSourceFileTotal(
  repoFingerprints: SearchRepoFingerprint[],
): { total: number | null; reason?: string } {
  if (repoFingerprints.length === 0) {
    return { total: 0 };
  }

  let total = 0;

  for (const fingerprint of repoFingerprints) {
    const relevantSourceCount = fingerprint.scope?.relevantSourceCount;

    if (typeof relevantSourceCount !== 'number' || Number.isNaN(relevantSourceCount)) {
      return {
        total: null,
        reason: 'Relevant source coverage scope is unavailable; falling back to raw searchable coverage',
      };
    }

    total += relevantSourceCount;
  }

  return { total };
}

async function loadStructuralCoverageSnapshot(): Promise<StructuralCoverageSnapshot> {
  const state = await loadCurrentGenerationState();

  if (!state) {
    return {
      coverage: createScopedCoverage({
        raw: createCoverage(0, 0),
      }),
      searchReady: false,
      warnings: ['Published generation metadata is unavailable'],
    };
  }

  const filesAnalyzed = state.counts.files;
  const rawSearchVisibleFiles = sumRawSearchVisibleFiles(state.search.repoFingerprints);
  const rawCoverage = createCoverage(filesAnalyzed, rawSearchVisibleFiles || filesAnalyzed);
  const relevantScope = getRelevantSourceFileTotal(state.search.repoFingerprints);
  const warnings: string[] = state.search.status === 'ready'
    ? []
    : [`Search index freshness is ${state.search.status}`];
  let relevantCoverage: ToolCoverageScopeSnapshot | undefined;

  if (relevantScope.total === null) {
    if (relevantScope.reason) {
      warnings.push(relevantScope.reason);
    }
  } else if (relevantScope.total < filesAnalyzed) {
    warnings.push(
      'Relevant source coverage scope undercounts analyzed files; falling back to raw searchable coverage',
    );
  } else {
    relevantCoverage = createCoverage(filesAnalyzed, relevantScope.total || filesAnalyzed);
  }

  return {
    coverage: createScopedCoverage({
      raw: rawCoverage,
      relevant: relevantCoverage,
    }),
    searchReady: state.search.status === 'ready',
    warnings,
  };
}

async function loadPatternCoverageSnapshot(): Promise<PatternCoverageSnapshot> {
  const [state, patternIndexResult] = await Promise.all([
    loadCurrentGenerationState(),
    loadPatternIndexResult(),
  ]);
  const warnings: string[] = [];
  let structuralCoverage = createScopedCoverage({
    raw: createCoverage(0, 0),
  });

  if (state) {
    const filesAnalyzed = state.counts.files;
    const rawSearchVisibleFiles = sumRawSearchVisibleFiles(state.search.repoFingerprints);
    const rawCoverage = createCoverage(filesAnalyzed, rawSearchVisibleFiles || filesAnalyzed);
    const relevantScope = getRelevantSourceFileTotal(state.search.repoFingerprints);

    if (relevantScope.total === null) {
      if (relevantScope.reason) {
        warnings.push(relevantScope.reason);
      }
    } else if (relevantScope.total < filesAnalyzed) {
      warnings.push(
        'Relevant source coverage scope undercounts analyzed files; falling back to raw searchable coverage',
      );
    } else {
      structuralCoverage = createScopedCoverage({
        raw: rawCoverage,
        relevant: createCoverage(filesAnalyzed, relevantScope.total || filesAnalyzed),
      });
    }

    if (structuralCoverage.scope !== 'relevant_source') {
      structuralCoverage = createScopedCoverage({
        raw: rawCoverage,
      });
    }
  } else {
    warnings.push('Published generation metadata is unavailable');
  }

  const filesTotal = state?.counts.files ?? 0;
  const patternBearingFiles = new Set(
    patternIndexResult.value.patterns.map((pattern) => pattern.fileId),
  ).size;

  if (patternIndexResult.status !== 'ok') {
    warnings.push(`Pattern artifact is ${patternIndexResult.status}: ${patternIndexResult.reason}`);
  }

  return {
    coverage: structuralCoverage,
    patternCoverage: createCoverage(patternBearingFiles, filesTotal || patternBearingFiles),
    warnings,
  };
}

export function summarizeUiTreeResolution(nodes: UiHierarchyTreeNode[]): UiTreeResolutionSummary {
  const resolutionCounts = Object.create(null) as Record<string, number>;
  let totalNodes = 0;

  const visit = (items: UiHierarchyTreeNode[]) => {
    for (const item of items) {
      totalNodes += 1;
      resolutionCounts[item.resolution] = (resolutionCounts[item.resolution] ?? 0) + 1;
      visit(item.children);
    }
  };

  visit(nodes);

  return {
    totalNodes,
    resolutionCounts,
  };
}

export function buildTrustMetadata(options: BuildTrustMetadataOptions): ToolTrustMetadata {
  const warnings = dedupeWarnings(options.warnings ?? []);
  const confidence = classifyTrustConfidence({
    coverage: options.coverage,
    completeness: options.completeness,
    criticalUnresolvedSignals: options.criticalUnresolvedSignals,
  });

  return {
    coverage: options.coverage,
    ...(options.completeness !== undefined ? { completeness: roundRatio(options.completeness) } : {}),
    confidence,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(options.patternCoverage ? { patternCoverage: options.patternCoverage } : {}),
  };
}

export async function buildStructuralTrustMetadata(options: {
  completeness?: number;
  warnings?: string[];
  criticalUnresolvedSignals?: boolean;
} = {}): Promise<ToolTrustMetadata> {
  const snapshot = await loadStructuralCoverageSnapshot();
  const warnings = [...snapshot.warnings, ...(options.warnings ?? [])];
  const primaryCoverage = getPrimaryCoverageScope(snapshot.coverage);

  if (
    snapshot.coverage.relevant &&
    snapshot.coverage.raw.ratio + 0.15 < snapshot.coverage.relevant.ratio
  ) {
    warnings.push(
      `Raw searchable coverage is low (${formatPercent(snapshot.coverage.raw.ratio)}), but relevant source coverage is substantially higher (${formatPercent(snapshot.coverage.relevant.ratio)}) after excluding non-structural files.`,
    );
  }

  if (primaryCoverage.ratio < 0.9) {
    warnings.push(
      snapshot.coverage.scope === 'relevant_source'
        ? `Large portion of relevant source scope not structurally analyzed (${formatPercent(primaryCoverage.ratio)} coverage)`
        : `Large portion of searchable repository not structurally analyzed (${formatPercent(primaryCoverage.ratio)} coverage)`,
    );
  }

  return buildTrustMetadata({
    coverage: snapshot.coverage,
    completeness: options.completeness,
    warnings,
    criticalUnresolvedSignals: options.criticalUnresolvedSignals,
  });
}

export async function buildExploreComponentTrustMetadata(input: {
  renderTree?: UiHierarchyTreeNode[];
  completeness?: number;
}): Promise<ToolTrustMetadata> {
  const treeSummary = summarizeUiTreeResolution(input.renderTree ?? []);
  const warnings: string[] = [];
  const criticalUnresolvedSignals =
    (treeSummary.resolutionCounts.alias_not_resolved ?? 0) > 0 ||
    (treeSummary.resolutionCounts.missing_symbol ?? 0) > 0 ||
    (treeSummary.resolutionCounts.unresolved ?? 0) > 0;

  if (input.completeness !== undefined && input.completeness < 0.8) {
    warnings.push(`UI tree is only partially resolved (${formatPercent(input.completeness)} completeness)`);
  }

  if (
    treeSummary.totalNodes > 0 &&
    (treeSummary.resolutionCounts.external_dependency ?? 0) / treeSummary.totalNodes > 0.4
  ) {
    warnings.push('Many dependencies are external and not expanded');
  }

  return buildStructuralTrustMetadata({
    completeness: input.completeness,
    warnings,
    criticalUnresolvedSignals,
  });
}

export async function buildPatternTrustMetadata(result: PatternMatchContext): Promise<ToolTrustMetadata> {
  const snapshot = await loadPatternCoverageSnapshot();
  const warnings = [...snapshot.warnings];
  const strongMatchRatio =
    result.summary.matchCount === 0 ? 0 : result.summary.strongMatchCount / result.summary.matchCount;
  const targetStructuralAlignment = result.primaryTarget.structuralAlignment;
  const criticalUnresolvedSignals =
    result.resolution.status === 'missing' ||
    (result.summary.matchCount > 0 && strongMatchRatio < 0.4);

  if (snapshot.coverage.relevant && snapshot.coverage.raw.ratio + 0.15 < snapshot.coverage.relevant.ratio) {
    warnings.push(
      `Raw searchable coverage is low (${formatPercent(snapshot.coverage.raw.ratio)}), but relevant source coverage is substantially higher (${formatPercent(snapshot.coverage.relevant.ratio)}) after excluding non-structural files.`,
    );
  }

  if (snapshot.patternCoverage.ratio < 0.9) {
    warnings.push(
      `Pattern coverage is partial (${formatPercent(snapshot.patternCoverage.ratio)} of structurally analyzed files)`,
    );
  }

  if (result.resolution.status === 'missing') {
    warnings.push('No structurally matched pattern target was resolved');
  }

  if (result.summary.matchCount === 0) {
    warnings.push('No similar pattern matches were found');
  }

  const baseMetadata = buildTrustMetadata({
    coverage: snapshot.coverage,
    completeness: result.summary.matchCount === 0 ? 0 : strongMatchRatio,
    warnings,
    criticalUnresolvedSignals,
    patternCoverage: snapshot.patternCoverage,
  });

  if (!targetStructuralAlignment) {
    return {
      ...baseMetadata,
      structuralAlignment: null,
    };
  }

  const structuralWarnings = [...(baseMetadata.warnings ?? [])];
  let confidence = baseMetadata.confidence;
  const hasVeryStrongMatches = result.summary.matchCount > 0 && strongMatchRatio >= 0.8;

  if (!targetStructuralAlignment.graphAnchored || targetStructuralAlignment.structuralContextStrength === 'low') {
    if ((targetStructuralAlignment.resolvedLocalDependencies?.length ?? 0) === 0) {
      structuralWarnings.push('Target has weak structural grounding (no resolved local dependencies)');
    }
    structuralWarnings.push('Pattern matches are based on heuristic similarity, not graph-backed structure');
    confidence = hasVeryStrongMatches && baseMetadata.confidence !== 'low' ? 'medium' : 'low';
  } else if (
    targetStructuralAlignment.graphAnchored &&
    targetStructuralAlignment.structuralContextStrength === 'medium' &&
    baseMetadata.confidence === 'high'
  ) {
    structuralWarnings.push('Target has partial structural grounding (limited resolved local dependencies)');
    confidence = 'medium';
  }

  return {
    ...baseMetadata,
    confidence,
    ...(structuralWarnings.length > 0 ? { warnings: dedupeWarnings(structuralWarnings) } : {}),
    structuralAlignment: summarizePatternStructuralAlignment(targetStructuralAlignment),
  };
}
