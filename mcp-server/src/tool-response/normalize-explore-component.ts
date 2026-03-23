import type { ResultExplainabilitySignals } from '../orchestrator/types.js';
import type { ToolTrustMetadata } from '../tools/trust-metadata.js';
import type { CanonicalBucket } from './bucket-schema.js';
import {
  buildNormalizedDiagnostics,
  buildNormalizedTruncation,
  mergeNormalizedDiagnostics,
} from './diagnostics-builder.js';
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

export type ExploreComponentMembership = 'core' | 'peripheral' | 'unknown';

export interface RawExploreComponentRelatedResult {
  rank: number;
  filePath: string;
  repoId?: string;
  via: string[];
  matchStrength: ConfidenceLevel;
  role?: string;
  confidence?: ConfidenceLevel;
  familyRef?: string;
  clusterRef?: string;
  membership?: ExploreComponentMembership;
  selectionReason?: string;
  explanationSignals?: ResultExplainabilitySignals;
  debug?: Record<string, unknown>;
}

export interface RawExploreComponentCandidate {
  symbolId: string;
  fileId: string;
  repoId: string;
  filePath: string;
  name: string;
  kind?: string;
  exported: boolean;
  matchStrength: ConfidenceLevel;
  role?: string;
  confidence?: ConfidenceLevel;
  familyRef?: string;
  clusterRef?: string;
  membership?: ExploreComponentMembership;
  selectionReason?: string;
  explanationSignals?: ResultExplainabilitySignals;
  debug?: Record<string, unknown>;
}

export interface RawExploreComponentUiTreeNode {
  name: string;
  resolution: string;
  filePath?: string;
  symbolId?: string;
  hint?: string;
  source?: string;
  children?: RawExploreComponentUiTreeNode[];
}

export interface RawExploreComponentUiSummary {
  renderTreeSummary: {
    totalNodes: number;
    resolvedNodes: number;
    unresolvedNodes: number;
    completeness: number;
  };
  renderedByTreeSummary: {
    totalNodes: number;
    resolvedNodes: number;
    unresolvedNodes: number;
    completeness: number;
  };
  observedProps: Array<{
    propName: string;
    count: number;
  }>;
}

export interface RawExploreComponentResponse {
  requestedName: string;
  requestedRepo?: string;
  explainabilityMode: NormalizedMode;
  metadata: ToolTrustMetadata;
  target: {
    status: 'resolved' | 'missing';
    requestedName: string;
    requestedRepo?: string;
    symbolId: string | null;
    symbolName: string;
    filePath: string | null;
    repoId: string | null;
    role?: string;
    confidence?: ConfidenceLevel;
    familyRef?: string;
    clusterRef?: string;
    membership?: ExploreComponentMembership;
    resolution: {
      candidateCount: number;
      ambiguityDetected: boolean;
    };
    symbolSurface: {
      defined: string[];
      exported: string[];
    };
    ui?: RawExploreComponentUiSummary;
  };
  results: {
    primary: RawExploreComponentRelatedResult[];
    secondary?: RawExploreComponentRelatedResult[];
    alternatives?: RawExploreComponentCandidate[];
    ui?: {
      renders: RawExploreComponentUiTreeNode[];
      renderedBy: RawExploreComponentUiTreeNode[];
    };
  };
  sharedContext?: {
    families?: Record<string, { role?: string; relatedFamilyRefs?: string[] }>;
    clusters?: Record<
      string,
      {
        role?: string;
        membership: ExploreComponentMembership;
        parentClusterRef?: string;
        relatedClusterRefs?: string[];
      }
    >;
  };
  navigationHints: Array<Record<string, string>>;
  direct_consumers?: {
    label: string;
    explanation: string;
    entries: RawExploreComponentRelatedResult[];
    total: number;
    shown: number;
    truncated: boolean;
    confidence: ConfidenceLevel;
    coverage: 'exact' | 'inferred' | 'exploratory';
  };
  indirect_consumers?: {
    label: string;
    explanation: string;
    entries: RawExploreComponentRelatedResult[];
    total: number;
    shown: number;
    truncated: boolean;
    confidence: ConfidenceLevel;
    coverage: 'exact' | 'inferred' | 'exploratory';
  };
  related_context?: {
    label: string;
    explanation: string;
    entries: RawExploreComponentRelatedResult[];
    total: number;
    shown: number;
    truncated: boolean;
    confidence: ConfidenceLevel;
    coverage: 'exact' | 'inferred' | 'exploratory';
  };
  summary: {
    resultCount?: number;
    strongMatches?: number;
    relatedFileCount?: number;
    alternativeCandidateCount?: number;
    uiCompleteness?: number | null;
    tokenEstimate?: number;
  };
  internal?: {
    totalRelatedCount?: number;
    returnedRelatedCount: number;
    appliedRelatedLimit?: number;
    totalCandidateCount?: number;
    returnedCandidateCount: number;
    appliedCandidateLimit?: number;
    navigationHintLimit?: number;
  };
}

export interface NormalizedExploreComponentResult extends NormalizedResultBase {
  rank: number;
  repoId?: string;
  filePath: string;
  role?: string;
  family?: string;
  clusterRef?: string;
  membership?: ExploreComponentMembership;
  matchStrength: ConfidenceLevel;
  relationshipKinds: string[];
}

export interface NormalizedExploreComponentAlternative extends NormalizedResultBase {
  symbolId: string;
  fileId: string;
  repoId: string;
  filePath: string;
  symbolName: string;
  symbolKind?: string;
  exported: boolean;
  role?: string;
  family?: string;
  clusterRef?: string;
  membership?: ExploreComponentMembership;
  matchStrength: ConfidenceLevel;
}

export interface NormalizedExploreComponentTarget {
  status: 'resolved' | 'missing';
  requestedName: string;
  requestedRepo?: string;
  symbolId?: string | null;
  symbolName?: string | null;
  filePath?: string | null;
  repoId?: string | null;
  role?: string;
  family?: string;
  clusterRef?: string;
  membership?: ExploreComponentMembership;
  confidence?: ConfidenceLevel;
  resolution: {
    candidateCount: number;
    ambiguityDetected: boolean;
  };
  symbolSurface: {
    defined: string[];
    exported: string[];
  };
  ui?: {
    renderTreeSummary: RawExploreComponentUiSummary['renderTreeSummary'];
    renderedByTreeSummary: RawExploreComponentUiSummary['renderedByTreeSummary'];
    observedProps: RawExploreComponentUiSummary['observedProps'];
    rendersExpansionId?: string;
    renderedByExpansionId?: string;
  };
  expansionId?: string;
}

export interface ExploreComponentNormalizedResponse
  extends NormalizedToolResponse<NormalizedExploreComponentResult> {
  target: NormalizedExploreComponentTarget;
  alternatives?: NormalizedExploreComponentAlternative[];
  direct_consumers?: CanonicalBucket<NormalizedExploreComponentResult>;
  indirect_consumers?: CanonicalBucket<NormalizedExploreComponentResult>;
  related_context?: CanonicalBucket<NormalizedExploreComponentResult>;
}

export interface ExploreComponentNormalizationInput {
  rawResponse: RawExploreComponentResponse;
  mode: NormalizedMode;
}

function buildExpansionSummary(parts: Array<string | undefined>): string | undefined {
  const values = parts.map((part) => part?.trim()).filter(Boolean) as string[];
  return values.length > 0 ? values.join(' | ') : undefined;
}

function formatPercent(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return undefined;
  }

  return `${Math.round(value * 100)}%`;
}

function summarizeTree(nodes: RawExploreComponentUiTreeNode[] | undefined): string | undefined {
  if (!nodes?.length) {
    return undefined;
  }

  const names = nodes.slice(0, 3).map((node) => node.name);
  return names.join(', ');
}

function buildSharedContextExpansions(raw: RawExploreComponentResponse): Record<string, NormalizedExpansion> {
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

  const uiKey = raw.target.symbolId ?? raw.target.filePath ?? raw.requestedName;

  if (raw.results.ui?.renders?.length) {
    const id = `ui-renders:${uiKey}`;
    expansions.set(
      id,
      buildNormalizedExpansion({
        id,
        kind: 'ui-renders',
        title: 'Rendered child structure',
        summary: buildExpansionSummary([
          raw.target.ui?.renderTreeSummary
            ? `${raw.target.ui.renderTreeSummary.totalNodes} nodes`
            : undefined,
          raw.target.ui?.renderTreeSummary
            ? `completeness ${formatPercent(raw.target.ui.renderTreeSummary.completeness)}`
            : undefined,
          summarizeTree(raw.results.ui.renders),
        ]),
        status: 'deferred',
      }),
    );
  }

  if (raw.results.ui?.renderedBy?.length) {
    const id = `ui-rendered-by:${uiKey}`;
    expansions.set(
      id,
      buildNormalizedExpansion({
        id,
        kind: 'ui-rendered-by',
        title: 'Parent render structure',
        summary: buildExpansionSummary([
          raw.target.ui?.renderedByTreeSummary
            ? `${raw.target.ui.renderedByTreeSummary.totalNodes} nodes`
            : undefined,
          raw.target.ui?.renderedByTreeSummary
            ? `completeness ${formatPercent(raw.target.ui.renderedByTreeSummary.completeness)}`
            : undefined,
          summarizeTree(raw.results.ui.renderedBy),
        ]),
        status: 'deferred',
      }),
    );
  }

  if (raw.results.alternatives?.length) {
    const id = `symbol-candidates:${raw.requestedName}`;
    expansions.set(
      id,
      buildNormalizedExpansion({
        id,
        kind: 'symbol-candidates',
        title: 'Alternative symbol candidates',
        summary: buildExpansionSummary([
          `${raw.results.alternatives.length} alternate candidates`,
          raw.results.alternatives.slice(0, 2).map((entry) => entry.name).join(', '),
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

function normalizeResult(
  result: RawExploreComponentRelatedResult,
  mode: NormalizedMode,
): NormalizedExploreComponentResult {
  const expansionId = buildResultExpansionId(result);

  return {
    id: `${result.repoId ?? 'unknown'}:${result.filePath}`,
    kind: 'related_file',
    title: result.filePath,
    confidence: result.confidence,
    explanation: buildNormalizedExplanation({
      mode,
      short: result.selectionReason ?? 'related implementation context',
      signals: normalizeExplanationSignals(result.explanationSignals),
    }),
    references: {
      filePaths: [result.filePath],
    },
    ...(expansionId ? { expansionId } : {}),
    rank: result.rank,
    ...(result.repoId ? { repoId: result.repoId } : {}),
    filePath: result.filePath,
    ...(result.role ? { role: result.role } : {}),
    ...(result.familyRef ? { family: result.familyRef } : {}),
    ...(result.clusterRef ? { clusterRef: result.clusterRef } : {}),
    ...(result.membership ? { membership: result.membership } : {}),
    matchStrength: result.matchStrength,
    relationshipKinds: result.via,
    debug: buildNormalizedDebugPayload(mode, result.debug ?? null),
  };
}

function normalizeAlternative(
  candidate: RawExploreComponentCandidate,
  mode: NormalizedMode,
): NormalizedExploreComponentAlternative {
  const expansionId = buildResultExpansionId(candidate);

  return {
    id: `${candidate.repoId}:${candidate.filePath}:${candidate.name}`,
    kind: 'symbol_candidate',
    title: candidate.name,
    confidence: candidate.confidence,
    explanation: buildNormalizedExplanation({
      mode,
      short: candidate.selectionReason ?? 'alternative symbol candidate',
      signals: normalizeExplanationSignals(candidate.explanationSignals),
    }),
    references: {
      filePaths: [candidate.filePath],
      symbolNames: [candidate.name],
    },
    ...(expansionId ? { expansionId } : {}),
    symbolId: candidate.symbolId,
    fileId: candidate.fileId,
    repoId: candidate.repoId,
    filePath: candidate.filePath,
    symbolName: candidate.name,
    ...(candidate.kind ? { symbolKind: candidate.kind } : {}),
    exported: candidate.exported,
    ...(candidate.role ? { role: candidate.role } : {}),
    ...(candidate.familyRef ? { family: candidate.familyRef } : {}),
    ...(candidate.clusterRef ? { clusterRef: candidate.clusterRef } : {}),
    ...(candidate.membership ? { membership: candidate.membership } : {}),
    matchStrength: candidate.matchStrength,
    debug: buildNormalizedDebugPayload(mode, candidate.debug ?? null),
  };
}

function normalizeTarget(
  raw: RawExploreComponentResponse,
  expansions: Record<string, NormalizedExpansion>,
): NormalizedExploreComponentTarget {
  const rendersExpansionId = raw.results.ui?.renders?.length ? `ui-renders:${raw.target.symbolId ?? raw.target.filePath ?? raw.requestedName}` : undefined;
  const renderedByExpansionId = raw.results.ui?.renderedBy?.length
    ? `ui-rendered-by:${raw.target.symbolId ?? raw.target.filePath ?? raw.requestedName}`
    : undefined;
  const clusterExpansionId = raw.target.clusterRef ? buildExpansionRefId('cluster', raw.target.clusterRef) : undefined;
  const familyExpansionId = raw.target.familyRef ? buildExpansionRefId('family', raw.target.familyRef) : undefined;
  const expansionId =
    (rendersExpansionId && expansions[rendersExpansionId] ? rendersExpansionId : undefined) ??
    (clusterExpansionId && expansions[clusterExpansionId] ? clusterExpansionId : undefined) ??
    (familyExpansionId && expansions[familyExpansionId] ? familyExpansionId : undefined) ??
    (renderedByExpansionId && expansions[renderedByExpansionId] ? renderedByExpansionId : undefined);

  return {
    status: raw.target.status,
    requestedName: raw.target.requestedName,
    ...(raw.target.requestedRepo ? { requestedRepo: raw.target.requestedRepo } : {}),
    symbolId: raw.target.symbolId,
    symbolName: raw.target.symbolName,
    filePath: raw.target.filePath,
    repoId: raw.target.repoId,
    ...(raw.target.role ? { role: raw.target.role } : {}),
    ...(raw.target.familyRef ? { family: raw.target.familyRef } : {}),
    ...(raw.target.clusterRef ? { clusterRef: raw.target.clusterRef } : {}),
    ...(raw.target.membership ? { membership: raw.target.membership } : {}),
    ...(raw.target.confidence ? { confidence: raw.target.confidence } : {}),
    resolution: raw.target.resolution,
    symbolSurface: raw.target.symbolSurface,
    ...(raw.target.ui
      ? {
          ui: {
            renderTreeSummary: raw.target.ui.renderTreeSummary,
            renderedByTreeSummary: raw.target.ui.renderedByTreeSummary,
            observedProps: raw.target.ui.observedProps,
            ...(rendersExpansionId && expansions[rendersExpansionId] ? { rendersExpansionId } : {}),
            ...(renderedByExpansionId && expansions[renderedByExpansionId] ? { renderedByExpansionId } : {}),
          },
        }
      : {}),
    ...(expansionId ? { expansionId } : {}),
  };
}

function buildEvidence(raw: RawExploreComponentResponse): NormalizedEvidenceItem[] {
  const firstPrimary = raw.results.primary[0];
  const evidence: NormalizedEvidenceItem[] = [
    { kind: 'target_status', label: 'target status', value: raw.target.status },
  ];

  if (raw.target.role) {
    evidence.push({ kind: 'target_role', label: 'target role', value: raw.target.role });
  }

  if (raw.target.familyRef) {
    evidence.push({ kind: 'target_family', label: 'target family', value: raw.target.familyRef });
  }

  if (raw.target.ui?.renderTreeSummary) {
    evidence.push({
      kind: 'ui_completeness',
      label: 'ui completeness',
      value: formatPercent(raw.target.ui.renderTreeSummary.completeness) ?? 'unknown',
    });
  }

  if (raw.target.confidence) {
    evidence.push({ kind: 'target_confidence', label: 'target confidence', value: raw.target.confidence });
  }

  if (firstPrimary) {
    evidence.push({
      kind: 'top_relationship',
      label: 'top relationship',
      value: firstPrimary.via.join(', '),
    });
    evidence.push({
      kind: 'top_strength',
      label: 'top strength',
      value: firstPrimary.matchStrength,
    });
  }

  return evidence;
}

function buildNextActions(raw: RawExploreComponentResponse): NormalizedNextAction[] {
  const actions: NormalizedNextAction[] = [];
  const firstPrimary = raw.results.primary[0];
  const secondPrimary = raw.results.secondary?.[0];
  const firstAlternative = raw.results.alternatives?.[0];

  if (firstPrimary) {
    actions.push(
      buildNormalizedNextAction({
        tool: 'explore_component',
        reason: 'inspect the strongest related component',
        query: {
          name: firstPrimary.filePath,
          repo: firstPrimary.repoId ?? raw.target.repoId ?? raw.requestedRepo,
          detail: raw.explainabilityMode,
        },
      }),
    );
  }

  if (raw.target.filePath) {
    actions.push(
      buildNormalizedNextAction({
        tool: 'find_precedents',
        reason: 'find implementation peers for the focal component',
        query: {
          name: raw.target.filePath,
          repo: raw.target.repoId ?? raw.requestedRepo,
          mode: 'file',
          detail: raw.explainabilityMode,
        },
      }),
    );
    actions.push(
      buildNormalizedNextAction({
        tool: 'collect_refactor_context',
        reason: 'inspect change impact around the focal component',
        query: {
          name: raw.target.filePath,
          repo: raw.target.repoId ?? raw.requestedRepo,
          mode: 'file',
          detail: raw.explainabilityMode,
        },
      }),
    );
  }

  if (secondPrimary) {
    actions.push(
      buildNormalizedNextAction({
        tool: 'explore_component',
        reason: 'compare the next related component',
        query: {
          name: secondPrimary.filePath,
          repo: secondPrimary.repoId ?? raw.target.repoId ?? raw.requestedRepo,
          detail: raw.explainabilityMode,
        },
      }),
    );
  }

  if (raw.target.resolution.ambiguityDetected && firstAlternative) {
    actions.push(
      buildNormalizedNextAction({
        tool: 'explore_component',
        reason: 'inspect an alternate symbol candidate',
        query: {
          name: firstAlternative.name,
          repo: firstAlternative.repoId,
          detail: raw.explainabilityMode,
        },
      }),
    );
  }

  return actions;
}

function normalizeBucket(
  bucket:
    | RawExploreComponentResponse['direct_consumers']
    | RawExploreComponentResponse['indirect_consumers']
    | RawExploreComponentResponse['related_context']
    | undefined,
  mode: NormalizedMode,
) {
  if (!bucket) {
    return undefined;
  }

  return {
    label: bucket.label,
    explanation: bucket.explanation,
    entries: bucket.entries.map((entry) => normalizeResult(entry, mode)),
    total: bucket.total,
    shown: bucket.shown,
    truncated: bucket.truncated,
    confidence: bucket.confidence,
    coverage: bucket.coverage,
  };
}

export function normalizeExploreComponentResponse(
  input: ExploreComponentNormalizationInput,
): ExploreComponentNormalizedResponse {
  const raw = input.rawResponse;
  const expansions = buildSharedContextExpansions(raw);
  const normalizedItems = [...raw.results.primary, ...(raw.results.secondary ?? [])].map((result) =>
    normalizeResult(result, input.mode),
  );
  const results = buildNormalizedResultTiers({
    items: normalizedItems,
    mode: input.mode,
    primaryCount: raw.results.primary.length,
    secondaryCount: raw.results.secondary?.length ?? 0,
  });

  const relatedTruncation =
    raw.internal?.totalRelatedCount !== undefined && raw.internal.totalRelatedCount > raw.internal.returnedRelatedCount
      ? buildNormalizedTruncation({
          type: 'related_files',
          returnedCount: raw.internal.returnedRelatedCount,
          totalCount: raw.internal.totalRelatedCount,
          limitApplied: raw.internal.appliedRelatedLimit,
          reason: 'related file limit applied',
        })
      : undefined;
  const candidateTruncation =
    raw.internal?.totalCandidateCount !== undefined && raw.internal.totalCandidateCount > raw.internal.returnedCandidateCount
      ? buildNormalizedTruncation({
          type: 'symbol_candidates',
          returnedCount: raw.internal.returnedCandidateCount,
          totalCount: raw.internal.totalCandidateCount,
          limitApplied: raw.internal.appliedCandidateLimit,
          reason: 'symbol candidate limit applied',
        })
      : undefined;

  const diagnostics = mergeNormalizedDiagnostics(
    buildNormalizedDiagnostics({
      warnings: raw.metadata.warnings,
      limits: {
        ...(raw.internal?.appliedRelatedLimit !== undefined ? { resultLimit: raw.internal.appliedRelatedLimit } : {}),
        ...(raw.internal?.navigationHintLimit !== undefined
          ? { navigationHintLimit: raw.internal.navigationHintLimit }
          : {}),
        ...(raw.internal?.appliedCandidateLimit !== undefined ? { candidateLimit: raw.internal.appliedCandidateLimit } : {}),
      },
      notes: [
        ...(raw.target.status === 'missing' ? ['No primary symbol resolved for the requested component'] : []),
        ...(raw.target.resolution.ambiguityDetected
          ? ['Multiple symbol candidates remain for the requested component']
          : []),
        ...(candidateTruncation && candidateTruncation !== relatedTruncation
          ? ['Additional symbol candidates were omitted from the normalized response']
          : []),
      ],
    }),
    buildNormalizedDiagnostics({
      truncations: [relatedTruncation, candidateTruncation].filter(
        (value): value is NonNullable<typeof value> => Boolean(value),
      ),
    }),
  );

  const response = createNormalizedResponse<NormalizedExploreComponentResult>({
    tool: 'explore_component',
    mode: input.mode,
    query: {
      target: raw.requestedName,
      repo: raw.requestedRepo,
      ...(raw.target.filePath ? { filePath: raw.target.filePath } : {}),
      ...(raw.target.symbolName ? { symbolName: raw.target.symbolName } : {}),
    },
    results,
    summary: buildNormalizedSummary({
      results,
      confidence: raw.metadata.confidence,
      strongMatchCount: normalizedItems.filter((item) => item.confidence === 'high').length,
    }),
    evidence: buildEvidence(raw),
    nextActions: buildNextActions(raw),
    diagnostics,
    expansions: Object.values(expansions),
    debug: null,
  });

  const normalizedAlternatives = raw.results.alternatives?.map((candidate) =>
    normalizeAlternative(candidate, input.mode),
  );

  return {
    ...response,
    target: normalizeTarget(raw, response.expansions),
    ...(normalizedAlternatives?.length ? { alternatives: normalizedAlternatives } : {}),
    ...(raw.direct_consumers ? { direct_consumers: normalizeBucket(raw.direct_consumers, input.mode) } : {}),
    ...(raw.indirect_consumers ? { indirect_consumers: normalizeBucket(raw.indirect_consumers, input.mode) } : {}),
    ...(raw.related_context ? { related_context: normalizeBucket(raw.related_context, input.mode) } : {}),
  };
}
