import { loadCurrentGenerationState } from '../indexing/generation-store.js';
import { loadPatternIndexResult } from '../patterns/store.js';
import type { PatternMatchContext } from '../orchestrator/types.js';
import type { UiHierarchyTreeNode } from '../orchestrator/ui-hierarchy-types.js';

export interface ToolCoverageMetadata {
  filesAnalyzed: number;
  filesTotal: number;
  ratio: number;
}

export interface ToolTrustMetadata {
  coverage: ToolCoverageMetadata;
  completeness?: number;
  confidence: 'high' | 'medium' | 'low';
  warnings?: string[];
}

interface StructuralCoverageSnapshot {
  coverage: ToolCoverageMetadata;
  searchReady: boolean;
  warnings: string[];
}

interface PatternCoverageSnapshot {
  coverage: ToolCoverageMetadata;
  warnings: string[];
}

interface BuildTrustMetadataOptions {
  coverage: ToolCoverageMetadata;
  completeness?: number;
  warnings?: string[];
  criticalUnresolvedSignals?: boolean;
}

interface UiTreeResolutionSummary {
  totalNodes: number;
  resolutionCounts: Record<string, number>;
}

function roundRatio(value: number): number {
  return Number(value.toFixed(3));
}

function createCoverage(filesAnalyzed: number, filesTotal: number): ToolCoverageMetadata {
  const safeFilesAnalyzed = Math.max(0, filesAnalyzed);
  const safeFilesTotal = Math.max(safeFilesAnalyzed, filesTotal);

  return {
    filesAnalyzed: safeFilesAnalyzed,
    filesTotal: safeFilesTotal,
    ratio: safeFilesTotal === 0 ? 0 : roundRatio(safeFilesAnalyzed / safeFilesTotal),
  };
}

function classifyTrustConfidence(options: {
  coverageRatio: number;
  completeness?: number;
  criticalUnresolvedSignals?: boolean;
}): ToolTrustMetadata['confidence'] {
  const { coverageRatio, completeness, criticalUnresolvedSignals } = options;

  if (
    coverageRatio < 0.6 ||
    (completeness !== undefined && completeness < 0.4) ||
    Boolean(criticalUnresolvedSignals)
  ) {
    return 'low';
  }

  if (coverageRatio > 0.9 && (completeness === undefined || completeness > 0.8)) {
    return 'high';
  }

  return 'medium';
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function dedupeWarnings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

async function loadStructuralCoverageSnapshot(): Promise<StructuralCoverageSnapshot> {
  const state = await loadCurrentGenerationState();

  if (!state) {
    return {
      coverage: createCoverage(0, 0),
      searchReady: false,
      warnings: ['Published generation metadata is unavailable'],
    };
  }

  const filesAnalyzed = state.counts.files;
  const searchIndexedFiles = state.search.repoFingerprints.reduce(
    (total, fingerprint) => total + fingerprint.fileCount,
    0,
  );

  return {
    coverage: createCoverage(filesAnalyzed, searchIndexedFiles || filesAnalyzed),
    searchReady: state.search.status === 'ready',
    warnings: state.search.status === 'ready'
      ? []
      : [`Search index freshness is ${state.search.status}`],
  };
}

async function loadPatternCoverageSnapshot(): Promise<PatternCoverageSnapshot> {
  const [state, patternIndexResult] = await Promise.all([
    loadCurrentGenerationState(),
    loadPatternIndexResult(),
  ]);

  const filesTotal = state?.counts.files ?? 0;
  const patternBearingFiles = new Set(
    patternIndexResult.value.patterns.map((pattern) => pattern.fileId),
  ).size;
  const warnings: string[] = [];

  if (patternIndexResult.status !== 'ok') {
    warnings.push(`Pattern artifact is ${patternIndexResult.status}: ${patternIndexResult.reason}`);
  }

  return {
    coverage: createCoverage(patternBearingFiles, filesTotal || patternBearingFiles),
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
    coverageRatio: options.coverage.ratio,
    completeness: options.completeness,
    criticalUnresolvedSignals: options.criticalUnresolvedSignals,
  });

  return {
    coverage: options.coverage,
    ...(options.completeness !== undefined ? { completeness: roundRatio(options.completeness) } : {}),
    confidence,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function buildStructuralTrustMetadata(options: {
  completeness?: number;
  warnings?: string[];
  criticalUnresolvedSignals?: boolean;
} = {}): Promise<ToolTrustMetadata> {
  const snapshot = await loadStructuralCoverageSnapshot();
  const warnings = [...snapshot.warnings, ...(options.warnings ?? [])];

  if (snapshot.coverage.ratio < 0.9) {
    warnings.push(
      `Large portion of repository not structurally analyzed (${formatPercent(snapshot.coverage.ratio)} coverage)`,
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
  const criticalUnresolvedSignals =
    result.resolution.status === 'missing' ||
    (result.summary.matchCount > 0 && strongMatchRatio < 0.4);

  if (snapshot.coverage.ratio < 0.9) {
    warnings.push(
      `Pattern coverage is partial (${formatPercent(snapshot.coverage.ratio)} of structurally analyzed files)`,
    );
  }

  if (result.resolution.status === 'missing') {
    warnings.push('No structurally matched pattern target was resolved');
  }

  if (result.summary.matchCount === 0) {
    warnings.push('No similar pattern matches were found');
  }

  return buildTrustMetadata({
    coverage: snapshot.coverage,
    completeness: result.summary.matchCount === 0 ? 0 : strongMatchRatio,
    warnings,
    criticalUnresolvedSignals,
  });
}
