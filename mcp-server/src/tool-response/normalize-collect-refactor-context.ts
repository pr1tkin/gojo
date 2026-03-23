import type { ResultExplainabilitySignals } from '../orchestrator/types.js';
import {
  buildNormalizedDiagnostics,
  buildNormalizedTruncation,
  mergeNormalizedDiagnostics,
} from './diagnostics-builder.js';
import type { CanonicalBucket } from './bucket-schema.js';
import { buildExpansionRefId, buildNormalizedExpansion } from './expansion-builder.js';
import { buildNormalizedExplanation, normalizeExplanationSignals } from './explanation-builder.js';
import { buildNormalizedDebugPayload } from './mode-shaping.js';
import { buildNormalizedNextAction } from './next-actions-builder.js';
import { createNormalizedResponse } from './normalized-response.js';
import { buildNormalizedResultTiers, buildNormalizedSummary } from './summary-builder.js';
import type {
  ConfidenceLevel,
  NormalizedEvidenceItem,
  NormalizedExpansion,
  NormalizedMode,
  NormalizedNextAction,
  NormalizedResultBase,
  NormalizedToolResponse,
} from './normalized-types.js';

export type RefactorContextMembership = 'core' | 'peripheral' | 'unknown';

export interface RawCollectRefactorRelatedResult {
  rank: number;
  filePath: string | null;
  repoId?: string | null;
  via: string[];
  matchStrength: ConfidenceLevel;
  role?: string;
  confidence?: ConfidenceLevel;
  familyRef?: string;
  clusterRef?: string;
  membership?: RefactorContextMembership;
  selectionReason?: string;
  explanationSignals?: ResultExplainabilitySignals;
  debug?: Record<string, unknown>;
}

export interface RawCollectRefactorNearbyResult {
  category: 'same_directory' | 'bundle_family';
  filePath: string | null;
  repoId?: string | null;
  role?: string;
  confidence?: ConfidenceLevel;
  familyRef?: string;
  clusterRef?: string;
  membership?: RefactorContextMembership;
  selectionReason?: string;
  explanationSignals?: ResultExplainabilitySignals;
  debug?: Record<string, unknown>;
}

export interface RawCollectRefactorCandidate {
  filePath: string;
  repoId: string;
  name: string;
  kind: string;
  exported: boolean;
  matchStrength: ConfidenceLevel;
  role?: string;
  confidence?: ConfidenceLevel;
  familyRef?: string;
  clusterRef?: string;
  membership?: RefactorContextMembership;
  selectionReason?: string;
  explanationSignals?: ResultExplainabilitySignals;
  debug?: Record<string, unknown>;
}

export interface RawCollectRefactorContextResponse {
  requestedName: string;
  requestedRepo?: string;
  requestedMode: 'file' | 'symbol' | 'component';
  explainabilityMode: NormalizedMode;
  target: {
    status: 'resolved' | 'missing';
    requestedName: string;
    requestedMode: 'file' | 'symbol' | 'component';
    requestedRepo?: string;
    filePath: string | null;
    repoId: string | null;
    symbolId: string | null;
    symbolName: string | null;
    role?: string;
    confidence?: ConfidenceLevel;
    familyRef?: string;
    clusterRef?: string;
    membership?: RefactorContextMembership;
    resolution: {
      candidateCount: number;
      ambiguityDetected: boolean;
    };
    symbolSurface: {
      defined: string[];
      exported: string[];
    };
  };
  results: {
    primary: RawCollectRefactorRelatedResult[];
    secondary?: RawCollectRefactorRelatedResult[];
    nearby?: RawCollectRefactorNearbyResult[];
    candidates?: RawCollectRefactorCandidate[];
  };
  sharedContext?: {
    families?: Record<string, { role?: string; relatedFamilyRefs?: string[] }>;
    clusters?: Record<
      string,
      {
        role?: string;
        membership: RefactorContextMembership;
        parentClusterRef?: string;
        relatedClusterRefs?: string[];
      }
    >;
  };
  navigationHints: Array<Record<string, string>>;
  summary: {
    resultCount?: number;
    strongMatches?: number;
    importingFileCount: number;
    importedFileCount: number;
    reexportingFileCount: number;
    reexportedFileCount: number;
    graphNeighborCount: number;
    nearbyFileCount: number;
    relatedFileCount: number;
    definedSymbolCount: number;
    exportedSymbolCount: number;
    notes: string[];
  };
  context: {
    importingFiles: string[];
    importedFiles: string[];
    reexportingFiles: string[];
    reexportedFiles: string[];
    graphNeighbors: string[];
    definedSymbols: string[];
    exportedSymbols: string[];
  };
  debug?: {
    rawSummary?: Record<string, unknown>;
  };
  internal?: {
    returnedRelatedCount: number;
    totalRelatedCount: number;
    appliedRelatedLimit?: number;
    returnedNearbyCount: number;
    totalNearbyCount: number;
    appliedNearbyLimit?: number;
    returnedCandidateCount: number;
    totalCandidateCount: number;
    appliedCandidateLimit?: number;
    navigationHintLimit?: number;
  };
  direct_consumers?: CanonicalBucket<RawCollectRefactorRelatedResult>;
  indirect_consumers?: CanonicalBucket<RawCollectRefactorRelatedResult>;
  related_context?: CanonicalBucket<RawCollectRefactorRelatedResult>;
}

export interface NormalizedCollectRefactorContextResult extends NormalizedResultBase {
  rank: number;
  repoId?: string | null;
  filePath?: string | null;
  role?: string;
  family?: string;
  clusterRef?: string;
  membership?: RefactorContextMembership;
  matchStrength: ConfidenceLevel;
  relationshipKinds: string[];
}

export interface NormalizedCollectRefactorNearbyResult extends NormalizedResultBase {
  category: RawCollectRefactorNearbyResult['category'];
  repoId?: string | null;
  filePath?: string | null;
  role?: string;
  family?: string;
  clusterRef?: string;
  membership?: RefactorContextMembership;
}

export interface NormalizedCollectRefactorCandidate extends NormalizedResultBase {
  repoId: string;
  filePath: string;
  symbolName: string;
  symbolKind: string;
  exported: boolean;
  role?: string;
  family?: string;
  clusterRef?: string;
  membership?: RefactorContextMembership;
  matchStrength: ConfidenceLevel;
}

export interface NormalizedCollectRefactorTarget {
  status: 'resolved' | 'missing';
  requestedName: string;
  requestedMode: 'file' | 'symbol' | 'component';
  requestedRepo?: string;
  filePath?: string | null;
  repoId?: string | null;
  symbolId?: string | null;
  symbolName?: string | null;
  role?: string;
  family?: string;
  clusterRef?: string;
  membership?: RefactorContextMembership;
  confidence?: ConfidenceLevel;
  resolution: {
    candidateCount: number;
    ambiguityDetected: boolean;
  };
  symbolSurface: {
    defined: string[];
    exported: string[];
  };
  expansionId?: string;
}

export interface NormalizedRefactorContextSummary {
  importingFileCount: number;
  importedFileCount: number;
  reexportingFileCount: number;
  reexportedFileCount: number;
  graphNeighborCount: number;
  nearbyFileCount: number;
  relatedFileCount: number;
  definedSymbolCount: number;
  exportedSymbolCount: number;
  ambiguityDetected: boolean;
  importingFilesExpansionId?: string;
  importedFilesExpansionId?: string;
  reexportingFilesExpansionId?: string;
  reexportedFilesExpansionId?: string;
  graphNeighborsExpansionId?: string;
  definedSymbolsExpansionId?: string;
  exportedSymbolsExpansionId?: string;
}

export interface CollectRefactorContextNormalizedResponse
  extends NormalizedToolResponse<NormalizedCollectRefactorContextResult> {
  target: NormalizedCollectRefactorTarget;
  contextSummary: NormalizedRefactorContextSummary;
  direct_consumers?: CanonicalBucket<NormalizedCollectRefactorContextResult>;
  indirect_consumers?: CanonicalBucket<NormalizedCollectRefactorContextResult>;
  related_context?: CanonicalBucket<NormalizedCollectRefactorContextResult>;
  nearbyFiles?: NormalizedCollectRefactorNearbyResult[];
  symbolCandidates?: NormalizedCollectRefactorCandidate[];
}

export interface CollectRefactorContextNormalizationInput {
  rawResponse: RawCollectRefactorContextResponse;
  mode: NormalizedMode;
}

function buildExpansionSummary(parts: Array<string | undefined>): string | undefined {
  const values = parts.map((part) => part?.trim()).filter(Boolean) as string[];
  return values.length > 0 ? values.join(' | ') : undefined;
}

function compactListSummary(values: string[] | undefined): string | undefined {
  if (!values?.length) {
    return undefined;
  }

  return values.slice(0, 3).join(', ');
}

function buildListExpansion(
  id: string,
  title: string,
  values: string[],
  kind: string,
): NormalizedExpansion | null {
  if (values.length === 0) {
    return null;
  }

  return buildNormalizedExpansion({
    id,
    kind,
    title,
    summary: buildExpansionSummary([
      `${values.length} items`,
      compactListSummary(values),
    ]),
    status: 'deferred',
  });
}

function buildSharedContextExpansions(raw: RawCollectRefactorContextResponse): Record<string, NormalizedExpansion> {
  const expansions = new Map<string, NormalizedExpansion>();

  for (const [familyRef, family] of Object.entries(raw.sharedContext?.families ?? {})) {
    const id = buildExpansionRefId('family', familyRef);
    expansions.set(
      id,
      buildNormalizedExpansion({
        id,
        kind: 'family-context',
        title: `Family ${familyRef}`,
        summary: buildExpansionSummary([
          family.role ? `role ${family.role}` : undefined,
          family.relatedFamilyRefs?.length ? `related ${family.relatedFamilyRefs.join(', ')}` : undefined,
        ]),
        status: 'available',
      }),
    );
  }

  for (const [clusterRef, cluster] of Object.entries(raw.sharedContext?.clusters ?? {})) {
    const id = buildExpansionRefId('cluster', clusterRef);
    expansions.set(
      id,
      buildNormalizedExpansion({
        id,
        kind: 'cluster-context',
        title: `Cluster ${clusterRef}`,
        summary: buildExpansionSummary([
          cluster.role ? `role ${cluster.role}` : undefined,
          cluster.membership ? `membership ${cluster.membership}` : undefined,
          cluster.parentClusterRef ? `parent ${cluster.parentClusterRef}` : undefined,
          cluster.relatedClusterRefs?.length ? `related ${cluster.relatedClusterRefs.join(', ')}` : undefined,
        ]),
        status: 'available',
      }),
    );
  }

  const contextExpansions = [
    buildListExpansion('refactor:importing-files', 'Importing files', raw.context.importingFiles, 'refactor-importing-files'),
    buildListExpansion('refactor:imported-files', 'Imported files', raw.context.importedFiles, 'refactor-imported-files'),
    buildListExpansion('refactor:reexporting-files', 'Re-exporting files', raw.context.reexportingFiles, 'refactor-reexporting-files'),
    buildListExpansion('refactor:reexported-files', 'Re-exported files', raw.context.reexportedFiles, 'refactor-reexported-files'),
    buildListExpansion('refactor:graph-neighbors', 'Graph neighbors', raw.context.graphNeighbors, 'refactor-graph-neighbors'),
    buildListExpansion('refactor:defined-symbols', 'Defined symbols', raw.context.definedSymbols, 'refactor-defined-symbols'),
    buildListExpansion('refactor:exported-symbols', 'Exported symbols', raw.context.exportedSymbols, 'refactor-exported-symbols'),
  ];

  for (const expansion of contextExpansions) {
    if (expansion) {
      expansions.set(expansion.id, expansion);
    }
  }

  if (raw.results.nearby?.length) {
    expansions.set(
      'refactor:nearby-files',
      buildNormalizedExpansion({
        id: 'refactor:nearby-files',
        kind: 'refactor-nearby-files',
        title: 'Nearby files',
        summary: buildExpansionSummary([
          `${raw.results.nearby.length} nearby files`,
          compactListSummary(raw.results.nearby.map((entry) => entry.filePath ?? '').filter(Boolean)),
        ]),
        status: 'deferred',
      }),
    );
  }

  if (raw.results.candidates?.length) {
    expansions.set(
      'refactor:symbol-candidates',
      buildNormalizedExpansion({
        id: 'refactor:symbol-candidates',
        kind: 'refactor-symbol-candidates',
        title: 'Symbol candidates',
        summary: buildExpansionSummary([
          `${raw.results.candidates.length} symbol candidates`,
          raw.results.candidates.slice(0, 3).map((entry) => entry.name).join(', '),
        ]),
        status: 'deferred',
      }),
    );
  }

  return Object.fromEntries(expansions);
}

function buildResultExpansionId(input: { familyRef?: string; clusterRef?: string }): string | undefined {
  if (input.clusterRef) {
    return buildExpansionRefId('cluster', input.clusterRef);
  }

  if (input.familyRef) {
    return buildExpansionRefId('family', input.familyRef);
  }

  return undefined;
}

function normalizeRelatedResult(
  result: RawCollectRefactorRelatedResult,
  mode: NormalizedMode,
): NormalizedCollectRefactorContextResult {
  const expansionId = buildResultExpansionId(result);
  const title = result.filePath ?? 'related context file';

  return {
    id: `${result.repoId ?? 'unknown'}:${result.filePath ?? title}`,
    kind: 'refactor_related_file',
    title,
    confidence: result.confidence,
    explanation: buildNormalizedExplanation({
      mode,
      short: result.selectionReason ?? 'related file for refactor context',
      signals: normalizeExplanationSignals(result.explanationSignals),
    }),
    references: {
      ...(result.filePath ? { filePaths: [result.filePath] } : {}),
    },
    ...(expansionId ? { expansionId } : {}),
    rank: result.rank,
    ...(result.repoId ? { repoId: result.repoId } : {}),
    ...(result.filePath ? { filePath: result.filePath } : {}),
    ...(result.role ? { role: result.role } : {}),
    ...(result.familyRef ? { family: result.familyRef } : {}),
    ...(result.clusterRef ? { clusterRef: result.clusterRef } : {}),
    ...(result.membership ? { membership: result.membership } : {}),
    matchStrength: result.matchStrength,
    relationshipKinds: result.via,
    debug: buildNormalizedDebugPayload(mode, result.debug ?? null),
  };
}

function normalizeNearbyResult(
  result: RawCollectRefactorNearbyResult,
  mode: NormalizedMode,
): NormalizedCollectRefactorNearbyResult {
  const expansionId = buildResultExpansionId(result);
  const title = result.filePath ?? 'nearby file';

  return {
    id: `${result.repoId ?? 'unknown'}:${result.filePath ?? title}:${result.category}`,
    kind: 'refactor_nearby_file',
    title,
    confidence: result.confidence,
    explanation: buildNormalizedExplanation({
      mode,
      short: result.selectionReason ?? 'nearby file for coordinated review',
      signals: normalizeExplanationSignals(result.explanationSignals),
    }),
    references: {
      ...(result.filePath ? { filePaths: [result.filePath] } : {}),
    },
    ...(expansionId ? { expansionId } : {}),
    category: result.category,
    ...(result.repoId ? { repoId: result.repoId } : {}),
    ...(result.filePath ? { filePath: result.filePath } : {}),
    ...(result.role ? { role: result.role } : {}),
    ...(result.familyRef ? { family: result.familyRef } : {}),
    ...(result.clusterRef ? { clusterRef: result.clusterRef } : {}),
    ...(result.membership ? { membership: result.membership } : {}),
    debug: buildNormalizedDebugPayload(mode, result.debug ?? null),
  };
}

function normalizeCandidate(
  result: RawCollectRefactorCandidate,
  mode: NormalizedMode,
): NormalizedCollectRefactorCandidate {
  const expansionId = buildResultExpansionId(result);

  return {
    id: `${result.repoId}:${result.filePath}:${result.name}`,
    kind: 'refactor_symbol_candidate',
    title: result.name,
    confidence: result.confidence,
    explanation: buildNormalizedExplanation({
      mode,
      short: result.selectionReason ?? 'alternate symbol candidate for refactor scope',
      signals: normalizeExplanationSignals(result.explanationSignals),
    }),
    references: {
      filePaths: [result.filePath],
      symbolNames: [result.name],
    },
    ...(expansionId ? { expansionId } : {}),
    repoId: result.repoId,
    filePath: result.filePath,
    symbolName: result.name,
    symbolKind: result.kind,
    exported: result.exported,
    ...(result.role ? { role: result.role } : {}),
    ...(result.familyRef ? { family: result.familyRef } : {}),
    ...(result.clusterRef ? { clusterRef: result.clusterRef } : {}),
    ...(result.membership ? { membership: result.membership } : {}),
    matchStrength: result.matchStrength,
    debug: buildNormalizedDebugPayload(mode, result.debug ?? null),
  };
}

function normalizeTarget(
  raw: RawCollectRefactorContextResponse,
  expansions: Record<string, NormalizedExpansion>,
): NormalizedCollectRefactorTarget {
  const clusterExpansionId = raw.target.clusterRef ? buildExpansionRefId('cluster', raw.target.clusterRef) : undefined;
  const familyExpansionId = raw.target.familyRef ? buildExpansionRefId('family', raw.target.familyRef) : undefined;
  const expansionId =
    (clusterExpansionId && expansions[clusterExpansionId] ? clusterExpansionId : undefined) ??
    (familyExpansionId && expansions[familyExpansionId] ? familyExpansionId : undefined);

  return {
    status: raw.target.status,
    requestedName: raw.target.requestedName,
    requestedMode: raw.target.requestedMode,
    ...(raw.target.requestedRepo ? { requestedRepo: raw.target.requestedRepo } : {}),
    filePath: raw.target.filePath,
    repoId: raw.target.repoId,
    symbolId: raw.target.symbolId,
    symbolName: raw.target.symbolName,
    ...(raw.target.role ? { role: raw.target.role } : {}),
    ...(raw.target.familyRef ? { family: raw.target.familyRef } : {}),
    ...(raw.target.clusterRef ? { clusterRef: raw.target.clusterRef } : {}),
    ...(raw.target.membership ? { membership: raw.target.membership } : {}),
    ...(raw.target.confidence ? { confidence: raw.target.confidence } : {}),
    resolution: raw.target.resolution,
    symbolSurface: raw.target.symbolSurface,
    ...(expansionId ? { expansionId } : {}),
  };
}

function buildEvidence(raw: RawCollectRefactorContextResponse): NormalizedEvidenceItem[] {
  const evidence: NormalizedEvidenceItem[] = [
    { kind: 'target_status', label: 'target status', value: raw.target.status },
  ];

  if (raw.target.role) {
    evidence.push({ kind: 'target_role', label: 'target role', value: raw.target.role });
  }

  if (raw.target.familyRef) {
    evidence.push({ kind: 'target_family', label: 'target family', value: raw.target.familyRef });
  }

  evidence.push(
    { kind: 'importing_files', label: 'importing files', value: String(raw.summary.importingFileCount) },
    { kind: 'imported_files', label: 'imported files', value: String(raw.summary.importedFileCount) },
  );

  if (raw.target.resolution.ambiguityDetected) {
    evidence.push({ kind: 'ambiguity', label: 'symbol ambiguity', value: 'multiple candidates remain' });
  }

  return evidence;
}

function buildNextActions(raw: RawCollectRefactorContextResponse): NormalizedNextAction[] {
  const actions: NormalizedNextAction[] = [];
  const firstPrimary = raw.results.primary[0];
  const firstCandidate = raw.results.candidates?.[0];

  if (firstPrimary?.filePath) {
    actions.push(
      buildNormalizedNextAction({
        tool: 'explore_component',
        reason: 'inspect the strongest neighboring file before refactor',
        query: {
          name: firstPrimary.filePath,
          repo: firstPrimary.repoId ?? raw.target.repoId ?? raw.requestedRepo,
          detail: raw.explainabilityMode,
        },
      }),
    );
  }

  if (raw.target.filePath && (raw.target.symbolName ?? raw.target.requestedName)) {
    actions.push(
      buildNormalizedNextAction({
        tool: 'plan_change',
        reason: 'turn collected context into an ordered change plan',
        query: {
          symbol: raw.target.symbolName ?? raw.target.requestedName,
          filePath: raw.target.filePath,
          repo: raw.target.repoId ?? raw.requestedRepo,
        },
      }),
    );
    actions.push(
      buildNormalizedNextAction({
        tool: 'find_precedents',
        reason: 'inspect reusable implementation peers before editing',
        query: {
          name: raw.target.filePath,
          repo: raw.target.repoId ?? raw.requestedRepo,
          mode: 'file',
          detail: raw.explainabilityMode,
        },
      }),
    );
  }

  if (firstCandidate) {
    actions.push(
      buildNormalizedNextAction({
        tool: 'explore_component',
        reason: 'compare an alternate symbol candidate',
        query: {
          name: firstCandidate.name,
          repo: firstCandidate.repoId,
          detail: raw.explainabilityMode,
        },
      }),
    );
  }

  return actions;
}

function normalizeBucket(
  bucket: CanonicalBucket<RawCollectRefactorRelatedResult> | undefined,
  mode: NormalizedMode,
): CanonicalBucket<NormalizedCollectRefactorContextResult> | undefined {
  if (!bucket) {
    return undefined;
  }

  return {
    label: bucket.label,
    explanation: bucket.explanation,
    entries: bucket.entries.map((entry) => normalizeRelatedResult(entry, mode)),
    total: bucket.total,
    shown: bucket.shown,
    truncated: bucket.truncated,
    confidence: bucket.confidence,
    coverage: bucket.coverage,
  };
}

export function normalizeCollectRefactorContextResponse(
  input: CollectRefactorContextNormalizationInput,
): CollectRefactorContextNormalizedResponse {
  const raw = input.rawResponse;
  const internal = raw.internal;
  const expansions = buildSharedContextExpansions(raw);
  const normalizedItems = [...raw.results.primary, ...(raw.results.secondary ?? [])].map((entry) =>
    normalizeRelatedResult(entry, input.mode),
  );
  const results = buildNormalizedResultTiers({
    items: normalizedItems,
    mode: input.mode,
    primaryCount: raw.results.primary.length,
    secondaryCount: raw.results.secondary?.length ?? 0,
  });

  const nearbyTruncation =
    internal?.totalNearbyCount !== undefined && internal.totalNearbyCount > internal.returnedNearbyCount
      ? buildNormalizedTruncation({
          type: 'nearby_files',
          returnedCount: internal.returnedNearbyCount,
          totalCount: internal.totalNearbyCount,
          limitApplied: internal.appliedNearbyLimit,
          reason: 'nearby file limit applied',
        })
      : undefined;
  const candidateTruncation =
    internal?.totalCandidateCount !== undefined && internal.totalCandidateCount > internal.returnedCandidateCount
      ? buildNormalizedTruncation({
          type: 'symbol_candidates',
          returnedCount: internal.returnedCandidateCount,
          totalCount: internal.totalCandidateCount,
          limitApplied: internal.appliedCandidateLimit,
          reason: 'symbol candidate limit applied',
        })
      : undefined;
  const relatedTruncation =
    internal?.totalRelatedCount !== undefined && internal.totalRelatedCount > internal.returnedRelatedCount
      ? buildNormalizedTruncation({
          type: 'related_files',
          returnedCount: internal.returnedRelatedCount,
          totalCount: internal.totalRelatedCount,
          limitApplied: internal.appliedRelatedLimit,
          reason: 'related file limit applied',
        })
      : undefined;

  const diagnostics = mergeNormalizedDiagnostics(
    buildNormalizedDiagnostics({
      warnings: [],
      notes: [
        ...raw.summary.notes,
        ...(raw.target.status === 'missing' ? ['Target could not be resolved from the current symbol index and graph'] : []),
        ...(raw.target.resolution.ambiguityDetected ? ['Multiple symbol candidates remain for the requested target'] : []),
      ],
      limits: {
        ...(raw.internal?.appliedRelatedLimit !== undefined ? { resultLimit: raw.internal.appliedRelatedLimit } : {}),
        ...(raw.internal?.navigationHintLimit !== undefined
          ? { navigationHintLimit: raw.internal.navigationHintLimit }
          : {}),
        ...(raw.internal?.appliedNearbyLimit !== undefined ? { relatedItemLimit: raw.internal.appliedNearbyLimit } : {}),
        ...(raw.internal?.appliedCandidateLimit !== undefined ? { candidateLimit: raw.internal.appliedCandidateLimit } : {}),
      },
    }),
    buildNormalizedDiagnostics({
      truncations: [relatedTruncation, nearbyTruncation, candidateTruncation].filter(
        (value): value is NonNullable<typeof value> => Boolean(value),
      ),
    }),
  );

  const response = createNormalizedResponse<NormalizedCollectRefactorContextResult>({
    tool: 'collect_refactor_context',
    mode: input.mode,
    query: {
      target: raw.requestedName,
      repo: raw.requestedRepo,
      mode: raw.requestedMode,
      ...(raw.target.filePath ? { filePath: raw.target.filePath } : {}),
      ...(raw.target.symbolName ? { symbolName: raw.target.symbolName } : {}),
    },
    results,
    summary: buildNormalizedSummary({
      results,
      confidence: raw.target.confidence,
      strongMatchCount: normalizedItems.filter((item) => item.confidence === 'high').length,
    }),
    evidence: buildEvidence(raw),
    nextActions: buildNextActions(raw),
    diagnostics,
    expansions: Object.values(expansions),
    debug: raw.debug ?? null,
  });

  return {
    ...response,
    target: normalizeTarget(raw, response.expansions),
    contextSummary: {
      importingFileCount: raw.summary.importingFileCount,
      importedFileCount: raw.summary.importedFileCount,
      reexportingFileCount: raw.summary.reexportingFileCount,
      reexportedFileCount: raw.summary.reexportedFileCount,
      graphNeighborCount: raw.summary.graphNeighborCount,
      nearbyFileCount: raw.summary.nearbyFileCount,
      relatedFileCount: raw.summary.relatedFileCount,
      definedSymbolCount: raw.summary.definedSymbolCount,
      exportedSymbolCount: raw.summary.exportedSymbolCount,
      ambiguityDetected: raw.target.resolution.ambiguityDetected,
      ...(response.expansions['refactor:importing-files'] ? { importingFilesExpansionId: 'refactor:importing-files' } : {}),
      ...(response.expansions['refactor:imported-files'] ? { importedFilesExpansionId: 'refactor:imported-files' } : {}),
      ...(response.expansions['refactor:reexporting-files']
        ? { reexportingFilesExpansionId: 'refactor:reexporting-files' }
        : {}),
      ...(response.expansions['refactor:reexported-files']
        ? { reexportedFilesExpansionId: 'refactor:reexported-files' }
        : {}),
      ...(response.expansions['refactor:graph-neighbors'] ? { graphNeighborsExpansionId: 'refactor:graph-neighbors' } : {}),
      ...(response.expansions['refactor:defined-symbols'] ? { definedSymbolsExpansionId: 'refactor:defined-symbols' } : {}),
      ...(response.expansions['refactor:exported-symbols'] ? { exportedSymbolsExpansionId: 'refactor:exported-symbols' } : {}),
    },
    ...(raw.direct_consumers ? { direct_consumers: normalizeBucket(raw.direct_consumers, input.mode) } : {}),
    ...(raw.indirect_consumers ? { indirect_consumers: normalizeBucket(raw.indirect_consumers, input.mode) } : {}),
    ...(raw.related_context ? { related_context: normalizeBucket(raw.related_context, input.mode) } : {}),
    ...(raw.results.nearby?.length
      ? {
          nearbyFiles: raw.results.nearby.map((entry) => normalizeNearbyResult(entry, input.mode)),
        }
      : {}),
    ...(raw.results.candidates?.length
      ? {
          symbolCandidates: raw.results.candidates.map((entry) => normalizeCandidate(entry, input.mode)),
        }
      : {}),
  };
}
