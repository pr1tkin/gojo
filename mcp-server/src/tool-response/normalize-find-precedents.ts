import type { ToolTrustMetadata } from '../tools/trust-metadata.js';
import type { ResultExplainabilitySignals } from '../orchestrator/types.js';
import { buildNormalizedDiagnostics, buildNormalizedTruncation, mergeNormalizedDiagnostics } from './diagnostics-builder.js';
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

export type FindPrecedentsGrounding = 'strong' | 'partial' | 'weak' | 'unknown';
export type FindPrecedentsRelationship = 'peer_family' | 'structural_neighbor' | 'heuristic_neighbor';

export interface RawFindPrecedentResult {
  rank: number;
  repoId: string;
  filePath: string;
  symbolName?: string;
  role: string;
  confidence: ConfidenceLevel;
  matchStrength: ConfidenceLevel;
  grounding: FindPrecedentsGrounding;
  relationship: FindPrecedentsRelationship;
  selectionReason: string;
  familyRef?: string;
  clusterRef?: string;
  explanationSignals?: ResultExplainabilitySignals;
  debug?: {
    precedentScore?: number;
    similarityScore?: number;
    reasonSignals?: string[];
    explanation?: Record<string, unknown>;
  };
}

export interface RawFindPrecedentsResponse {
  requestedName: string;
  requestedRepo?: string;
  requestedMode: 'component' | 'symbol' | 'file';
  explainabilityMode: NormalizedMode;
  metadata: ToolTrustMetadata;
  target: {
    status: 'resolved' | 'missing';
    filePath: string | null;
    repoId: string | null;
    symbolName: string | null;
    confidence: ConfidenceLevel;
    grounding: FindPrecedentsGrounding;
    role?: string;
    familyRef?: string;
    clusterRef?: string;
    resolution: {
      candidateCount: number;
      ambiguityDetected: boolean;
    };
  };
  results: {
    primary: RawFindPrecedentResult[];
    secondary?: RawFindPrecedentResult[];
  };
  navigationHints: Array<Record<string, string>>;
  summary: Record<string, unknown>;
  familyContext?: {
    role?: string;
    confidence?: ConfidenceLevel;
    familyRef?: string;
    clusterRef?: string;
    membership?: string;
  } | null;
  sharedContext?: {
    families?: Record<string, { role?: string; relatedFamilyRefs?: string[] }>;
    clusters?: Record<
      string,
      {
        role?: string;
        membership: string;
        parentClusterRef?: string;
        relatedClusterRefs?: string[];
      }
    >;
  };
  debug?: {
    serviceSummary?: string;
    rawTarget?: unknown;
  };
  internal?: {
    scopedCandidateCount: number;
    totalCandidateCount: number;
    appliedLimit: number;
    navigationHintLimit: number;
  };
}

export interface NormalizedFindPrecedentResult extends NormalizedResultBase {
  rank: number;
  family?: string;
  role?: string;
  repoId: string;
  filePath: string;
  symbolName?: string;
  matchStrength: ConfidenceLevel;
  grounding: FindPrecedentsGrounding;
  relationship: FindPrecedentsRelationship;
}

export interface NormalizedFindPrecedentsTarget {
  status: 'resolved' | 'missing';
  repoId?: string | null;
  filePath?: string | null;
  symbolName?: string | null;
  role?: string;
  family?: string;
  clusterRef?: string;
  confidence: ConfidenceLevel;
  grounding: FindPrecedentsGrounding;
  resolution: {
    candidateCount: number;
    ambiguityDetected: boolean;
  };
  expansionId?: string;
}

export interface FindPrecedentsNormalizedResponse
  extends NormalizedToolResponse<NormalizedFindPrecedentResult> {
  target: NormalizedFindPrecedentsTarget;
}

export interface FindPrecedentsNormalizationInput {
  rawResponse: RawFindPrecedentsResponse;
  mode: NormalizedMode;
}

function buildExpansionSummary(parts: Array<string | undefined>): string | undefined {
  const values = parts.map((part) => part?.trim()).filter(Boolean) as string[];
  return values.length > 0 ? values.join(' | ') : undefined;
}

function buildSharedContextExpansions(raw: RawFindPrecedentsResponse): Record<string, NormalizedExpansion> {
  const expansions = new Map<string, NormalizedExpansion>();

  if (raw.familyContext?.familyRef) {
    const familyId = buildExpansionRefId('family', raw.familyContext.familyRef);
    expansions.set(
      familyId,
      buildNormalizedExpansion({
        id: familyId,
        kind: 'family-context',
        title: `Family ${raw.familyContext.familyRef}`,
        summary: buildExpansionSummary([
          raw.familyContext.role ? `role ${raw.familyContext.role}` : undefined,
          raw.familyContext.confidence ? `confidence ${raw.familyContext.confidence}` : undefined,
          raw.familyContext.membership ? `membership ${raw.familyContext.membership}` : undefined,
        ]),
        status: 'available',
      }),
    );
  }

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

  return Object.fromEntries(expansions);
}

function buildResultExpansionId(result: RawFindPrecedentResult): string | undefined {
  if (result.clusterRef) {
    return buildExpansionRefId('cluster', result.clusterRef);
  }

  if (result.familyRef) {
    return buildExpansionRefId('family', result.familyRef);
  }

  return undefined;
}

function normalizeResult(
  result: RawFindPrecedentResult,
  mode: NormalizedMode,
): NormalizedFindPrecedentResult {
  return {
    id: result.symbolName
      ? `${result.repoId}:${result.filePath}:${result.symbolName}`
      : `${result.repoId}:${result.filePath}`,
    kind: 'precedent',
    title: result.symbolName ?? result.filePath,
    score: null,
    confidence: result.confidence,
    explanation: buildNormalizedExplanation({
      mode,
      short: result.selectionReason,
      signals: normalizeExplanationSignals(result.explanationSignals),
    }),
    references: {
      filePaths: [result.filePath],
      ...(result.symbolName ? { symbolNames: [result.symbolName] } : {}),
    },
    ...(buildResultExpansionId(result) ? { expansionId: buildResultExpansionId(result) } : {}),
    rank: result.rank,
    ...(result.familyRef ? { family: result.familyRef } : {}),
    role: result.role,
    repoId: result.repoId,
    filePath: result.filePath,
    ...(result.symbolName ? { symbolName: result.symbolName } : {}),
    matchStrength: result.matchStrength,
    grounding: result.grounding,
    relationship: result.relationship,
    debug: buildNormalizedDebugPayload(mode, result.debug ?? null),
  };
}

function normalizeTarget(
  raw: RawFindPrecedentsResponse,
  expansions: Record<string, NormalizedExpansion>,
): NormalizedFindPrecedentsTarget {
  const familyExpansionId = raw.target.familyRef ? buildExpansionRefId('family', raw.target.familyRef) : undefined;
  const clusterExpansionId = raw.target.clusterRef ? buildExpansionRefId('cluster', raw.target.clusterRef) : undefined;
  const expansionId =
    (clusterExpansionId && expansions[clusterExpansionId] ? clusterExpansionId : undefined) ??
    (familyExpansionId && expansions[familyExpansionId] ? familyExpansionId : undefined);

  return {
    status: raw.target.status,
    repoId: raw.target.repoId,
    filePath: raw.target.filePath,
    symbolName: raw.target.symbolName,
    ...(raw.target.role ? { role: raw.target.role } : {}),
    ...(raw.target.familyRef ? { family: raw.target.familyRef } : {}),
    ...(raw.target.clusterRef ? { clusterRef: raw.target.clusterRef } : {}),
    confidence: raw.target.confidence,
    grounding: raw.target.grounding,
    resolution: raw.target.resolution,
    ...(expansionId ? { expansionId } : {}),
  };
}

function buildEvidence(raw: RawFindPrecedentsResponse): NormalizedEvidenceItem[] {
  const firstPrimary = raw.results.primary[0];

  return [
    ...(raw.target.familyRef ? [{ kind: 'target_family', label: 'target family', value: raw.target.familyRef }] : []),
    { kind: 'target_grounding', label: 'target grounding', value: raw.target.grounding },
    ...(raw.target.role ? [{ kind: 'target_role', label: 'target role', value: raw.target.role }] : []),
    ...(raw.target.repoId ? [{ kind: 'target_repo', label: 'target repo', value: raw.target.repoId }] : []),
    ...(firstPrimary
      ? [
          { kind: 'top_relationship', label: 'top relationship', value: firstPrimary.relationship },
          { kind: 'top_strength', label: 'top strength', value: firstPrimary.matchStrength },
        ]
      : []),
  ];
}

function buildNextActions(raw: RawFindPrecedentsResponse): NormalizedNextAction[] {
  const actions: NormalizedNextAction[] = [];
  const firstPrimary = raw.results.primary[0];
  const secondPrimary = raw.results.secondary?.[0];

  if (firstPrimary) {
    actions.push(
      buildNormalizedNextAction({
        tool: 'explore_component',
        reason: 'inspect the strongest precedent',
        query: {
          name: firstPrimary.filePath,
          repo: firstPrimary.repoId,
          detail: raw.explainabilityMode,
        },
      }),
    );
  }

  if (secondPrimary) {
    actions.push(
      buildNormalizedNextAction({
        tool: 'explore_component',
        reason: 'compare the next precedent',
        query: {
          name: secondPrimary.filePath,
          repo: secondPrimary.repoId,
          detail: raw.explainabilityMode,
        },
      }),
    );
  }

  if (raw.target.filePath) {
    actions.push(
      buildNormalizedNextAction({
        tool: 'collect_refactor_context',
        reason: 'collect change context around the current target',
        query: {
          name: raw.target.filePath,
          repo: raw.target.repoId ?? raw.requestedRepo,
          mode: 'file',
          detail: raw.explainabilityMode,
        },
      }),
    );
  }

  return actions;
}

export function normalizeFindPrecedentsResponse(
  input: FindPrecedentsNormalizationInput,
): FindPrecedentsNormalizedResponse {
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
  const diagnostics = mergeNormalizedDiagnostics(
    buildNormalizedDiagnostics({
      warnings: raw.metadata.warnings,
      limits: {
        resultLimit: raw.internal?.appliedLimit,
        navigationHintLimit: raw.internal?.navigationHintLimit,
      },
    }),
    buildNormalizedDiagnostics({
      truncation: buildNormalizedTruncation({
        type: 'results',
        returnedCount: raw.internal?.scopedCandidateCount ?? normalizedItems.length,
        totalCount: raw.internal?.totalCandidateCount,
        limitApplied: raw.internal?.appliedLimit,
        reason: 'precedent result limit applied',
      }),
    }),
  );

  const response = createNormalizedResponse<NormalizedFindPrecedentResult>({
    tool: 'find_precedents',
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
      confidence: raw.metadata.confidence,
      strongMatchCount: normalizedItems.filter((item) => item.matchStrength === 'high').length,
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
  };
}
