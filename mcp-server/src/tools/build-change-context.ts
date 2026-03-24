import { buildChangeContextInputSchema } from '../schemas.js';
import type { BuildChangeContextInput, BuildChangeContextIntent } from '../types.js';
import { buildNormalizedExplanation } from '../tool-response/explanation-builder.js';
import {
  buildNormalizedExpansion,
  buildExpansionRefId,
} from '../tool-response/expansion-builder.js';
import { createNormalizedResponse } from '../tool-response/normalized-response.js';
import { buildNormalizedResultTiers, buildNormalizedSummary } from '../tool-response/summary-builder.js';
import type {
  CollectRefactorContextNormalizedResponse,
  ExploreComponentNormalizedResponse,
  FindPrecedentsNormalizedResponse,
  CanonicalBucket,
  PlanChangeNormalizedResponse,
} from '../tool-response/index.js';
import type {
  ConfidenceLevel,
  NormalizedDiagnostics,
  NormalizedExpansion,
  NormalizedMode,
  NormalizedNextAction,
  NormalizedResultBase,
  NormalizedToolResponse,
} from '../tool-response/normalized-types.js';
import { mergeNormalizedDiagnostics } from '../tool-response/diagnostics-builder.js';
import { getExecutionBudgetProfile, type ExecutionBudgetProfile } from '../execution/budgets.js';
import { traceAsync, traceHotspot } from '../instrumentation/trace.js';
import { loadRequiredSymbolIndex } from '../symbol-index/store.js';
import type { IndexedSymbol } from '../symbol-index/types.js';
import { getFileNode, getImportingFiles, getRelatedFiles, getSemanticConsumersForSymbol } from '../graph/query.js';
import { runCollectRefactorContextTool } from './collect-refactor-context.js';
import { runExploreComponentTool } from './explore-component.js';
import { runFindPrecedentsTool } from './find-precedents.js';
import { runPlanChangeTool } from './plan-change.js';

const DEFAULT_EXPLORE_LIMIT = 3;
const DEFAULT_RELATED_LIMIT = 6;

type BuildChangeSectionKind =
  | 'component_summary'
  | 'precedent_cluster'
  | 'refactor_context'
  | 'change_plan';

interface NormalizedBuildChangeContextResult extends NormalizedResultBase {
  sourceTool: 'explore_component' | 'find_precedents' | 'collect_refactor_context' | 'plan_change';
  section: BuildChangeSectionKind;
  status: 'ready' | 'skipped';
  filePath?: string | null;
  symbolName?: string | null;
  role?: string;
  family?: string;
  itemCount?: number;
  relationshipKinds?: string[];
  planScope?: string;
  planRisk?: string;
}

interface BuildChangeContextTarget {
  requestedSymbolName?: string;
  requestedFilePath?: string;
  requestedRepo?: string;
  intent?: BuildChangeContextIntent;
  status: 'resolved' | 'missing';
  filePath?: string | null;
  symbolName?: string | null;
  role?: string;
  family?: string;
  confidence?: ConfidenceLevel;
  grounding?: string;
  resolution?: {
    candidateCount: number;
    ambiguityDetected: boolean;
  };
  planIncluded: boolean;
  expansionId?: string;
}

interface BuildChangeContextResponse
  extends NormalizedToolResponse<NormalizedBuildChangeContextResult> {
  target: BuildChangeContextTarget;
  direct_consumers?: CanonicalBucket<{ filePath?: string | null; symbolName?: string | null }>;
  indirect_consumers?: CanonicalBucket<{ filePath?: string | null; symbolName?: string | null }>;
  related_context?: CanonicalBucket<{ filePath?: string | null; symbolName?: string | null }>;
}

export const buildChangeContextToolDefinition = {
  name: 'build_change_context',
  title: 'Build Change Context',
  description: 'Default workflow entry point for building bundled change context from exploration, precedents, refactor impact, and optional planning.',
  visibility: 'public' as const,
  role: 'primary' as const,
  inputSchema: buildChangeContextInputSchema,
};

function parseToolResult<T>(result: { content: Array<{ type: 'text'; text: string }> }): T {
  return JSON.parse(result.content[0].text) as T;
}

function confidenceOrFallback(...values: Array<ConfidenceLevel | undefined>): ConfidenceLevel {
  return values.find(Boolean) ?? 'low';
}

function confidenceFromPlan(plan: PlanChangeNormalizedResponse | null): ConfidenceLevel {
  if (!plan) {
    return 'low';
  }

  if (plan.plan.risk === 'low') {
    return 'high';
  }

  if (plan.plan.risk === 'medium') {
    return 'medium';
  }

  return 'low';
}

function relationshipKindsFromArray(values: Array<string | undefined>): string[] | undefined {
  const deduped = Array.from(new Set(values.filter(Boolean))) as string[];
  return deduped.length > 0 ? deduped : undefined;
}

function compactStrings(values: Array<string | null | undefined>): string[] | undefined {
  const filtered = values.filter((value): value is string => Boolean(value));
  return filtered.length > 0 ? filtered : undefined;
}

function namespacedExpansionId(scope: string, id: string | undefined): string | undefined {
  if (!id) {
    return undefined;
  }

  return buildExpansionRefId('bundle', `${scope}:${id}`);
}

function namespaceExpansions(
  scope: string,
  expansions: Record<string, NormalizedExpansion> | undefined,
): NormalizedExpansion[] {
  return Object.values(expansions ?? {}).map((expansion) => ({
    ...expansion,
    id: namespacedExpansionId(scope, expansion.id) ?? expansion.id,
  }));
}

function buildSectionExpansion(
  section: BuildChangeSectionKind,
  title: string,
  summary: string | undefined,
): NormalizedExpansion | null {
  if (!summary) {
    return null;
  }

  return buildNormalizedExpansion({
    id: `bundle-section:${section}`,
    kind: 'bundle-section',
    title,
    summary,
    status: 'deferred',
  });
}

function buildComponentSection(
  response: ExploreComponentNormalizedResponse,
  mode: NormalizedMode,
): {
  result: NormalizedBuildChangeContextResult;
  expansions: NormalizedExpansion[];
} {
  const uiCompleteness = response.target.ui?.renderTreeSummary?.completeness;
  const renderExpansionId = namespacedExpansionId('explore_component', response.target.ui?.rendersExpansionId);
  const targetExpansionId =
    namespacedExpansionId('explore_component', response.target.expansionId) ??
    renderExpansionId ??
    'bundle-section:component_summary';
  const sectionExpansion = buildSectionExpansion(
    'component_summary',
    'Component summary',
    [
      response.target.role ? `role ${response.target.role}` : undefined,
      response.target.family ? `family ${response.target.family}` : undefined,
      response.results.primary.length > 0 ? `${response.results.primary.length} primary related files` : undefined,
      uiCompleteness !== undefined ? `ui ${Math.round(uiCompleteness * 100)}% complete` : undefined,
    ]
      .filter(Boolean)
      .join(' | '),
  );

  return {
    result: {
      id: 'build-change-context:component-summary',
      kind: 'component_summary',
      title: response.target.symbolName ?? response.target.filePath ?? response.query.target ?? 'Component summary',
      confidence: confidenceOrFallback(response.target.confidence, response.summary.confidence),
      explanation: buildNormalizedExplanation({
        mode,
        short:
          response.target.status === 'resolved'
            ? 'resolved target with structural context and nearest related files'
            : 'target could not be resolved cleanly; component summary is partial',
        signals: {
          status: response.target.status,
          role: response.target.role ?? null,
          family: response.target.family ?? null,
          ambiguity: response.target.resolution.ambiguityDetected,
          uiCompleteness:
            uiCompleteness === undefined ? null : uiCompleteness >= 0.75 ? 'high' : uiCompleteness >= 0.5 ? 'medium' : 'low',
        },
      }),
      references: {
        ...(response.target.filePath ? { filePaths: [response.target.filePath] } : {}),
        ...(response.target.symbolName ? { symbolNames: [response.target.symbolName] } : {}),
      },
      expansionId: targetExpansionId,
      debug: mode === 'debug' ? { details: { sourceTool: 'explore_component' } } : null,
      sourceTool: 'explore_component',
      section: 'component_summary',
      status: response.target.status === 'resolved' ? 'ready' : 'skipped',
      filePath: response.target.filePath,
      symbolName: response.target.symbolName,
      role: response.target.role,
      family: response.target.family,
      itemCount: response.results.primary.length + (response.results.secondary?.length ?? 0),
      relationshipKinds: relationshipKindsFromArray(response.results.primary.flatMap((entry) => entry.relationshipKinds ?? [])),
    },
    expansions: [
      ...(sectionExpansion ? [sectionExpansion] : []),
      ...namespaceExpansions('explore_component', response.expansions),
    ],
  };
}

function buildPrecedentSection(
  response: FindPrecedentsNormalizedResponse,
  mode: NormalizedMode,
): {
  result: NormalizedBuildChangeContextResult;
  expansions: NormalizedExpansion[];
} {
  const topPrecedent = response.results.primary[0] ?? response.results.secondary?.[0];
  const sectionExpansion = buildSectionExpansion(
    'precedent_cluster',
    'Precedent cluster',
    [
      `${response.summary.resultCount} precedents`,
      response.target.family ? `family ${response.target.family}` : undefined,
      topPrecedent?.filePath ? `best ${topPrecedent.filePath}` : undefined,
    ]
      .filter(Boolean)
      .join(' | '),
  );

  return {
    result: {
      id: 'build-change-context:precedent-cluster',
      kind: 'precedent_cluster',
      title: topPrecedent?.symbolName ?? topPrecedent?.filePath ?? 'Precedent cluster',
      confidence: confidenceOrFallback(response.summary.confidence, response.target.confidence),
      explanation: buildNormalizedExplanation({
        mode,
        short:
          response.summary.resultCount > 0
            ? 'ranked precedents identify the closest reusable implementation family'
            : 'no strong precedents were found for the current target',
        signals: {
          grounding: response.target.grounding,
          family: response.target.family ?? null,
          ambiguity: response.target.resolution.ambiguityDetected,
          topMatch: topPrecedent?.matchStrength ?? null,
        },
      }),
      references: {
        filePaths: [
          ...(response.target.filePath ? [response.target.filePath] : []),
          ...(topPrecedent?.filePath ? [topPrecedent.filePath] : []),
        ],
        symbolNames: [
          ...(response.target.symbolName ? [response.target.symbolName] : []),
          ...(topPrecedent?.symbolName ? [topPrecedent.symbolName] : []),
        ],
      },
      expansionId:
        namespacedExpansionId('find_precedents', topPrecedent?.expansionId ?? response.target.expansionId) ??
        'bundle-section:precedent_cluster',
      debug: mode === 'debug' ? { details: { sourceTool: 'find_precedents' } } : null,
      sourceTool: 'find_precedents',
      section: 'precedent_cluster',
      status: response.summary.resultCount > 0 ? 'ready' : 'skipped',
      filePath: topPrecedent?.filePath ?? response.target.filePath,
      symbolName: topPrecedent?.symbolName ?? response.target.symbolName,
      role: topPrecedent?.role ?? response.target.role,
      family: topPrecedent?.family ?? response.target.family,
      itemCount: response.summary.resultCount,
      relationshipKinds: relationshipKindsFromArray(
        [topPrecedent?.relationship, ...response.results.primary.map((entry) => entry.relationship)],
      ),
    },
    expansions: [
      ...(sectionExpansion ? [sectionExpansion] : []),
      ...namespaceExpansions('find_precedents', response.expansions),
    ],
  };
}

function buildRefactorSection(
  response: CollectRefactorContextNormalizedResponse,
  mode: NormalizedMode,
): {
  result: NormalizedBuildChangeContextResult;
  expansions: NormalizedExpansion[];
} {
  const sectionExpansion = buildSectionExpansion(
    'refactor_context',
    'Refactor context',
    [
      `${response.contextSummary.relatedFileCount} related files`,
      `${response.contextSummary.nearbyFileCount} nearby files`,
      response.contextSummary.ambiguityDetected ? 'ambiguity present' : undefined,
    ]
      .filter(Boolean)
      .join(' | '),
  );

  return {
    result: {
      id: 'build-change-context:refactor-context',
      kind: 'refactor_context',
      title: response.target.symbolName ?? response.target.filePath ?? 'Refactor context',
      confidence: confidenceOrFallback(response.target.confidence, response.summary.confidence),
      explanation: buildNormalizedExplanation({
        mode,
        short: 'impact context combines related files, nearby files, and symbol ambiguity signals',
        signals: {
          ambiguity: response.contextSummary.ambiguityDetected,
          relatedFiles:
            response.contextSummary.relatedFileCount > 8
              ? 'high'
              : response.contextSummary.relatedFileCount > 3
                ? 'medium'
                : 'low',
          nearbyFiles:
            response.contextSummary.nearbyFileCount > 3
              ? 'high'
              : response.contextSummary.nearbyFileCount > 1
                ? 'medium'
                : 'low',
        },
      }),
      references: {
        filePaths: compactStrings([
          ...(response.target.filePath ? [response.target.filePath] : []),
          ...response.results.primary.map((entry) => entry.filePath).filter(Boolean),
        ]),
        symbolNames: compactStrings([
          ...(response.target.symbolName ? [response.target.symbolName] : []),
          ...(response.symbolCandidates ?? []).slice(0, 2).map((entry) => entry.symbolName),
        ]),
      },
      expansionId:
        namespacedExpansionId('collect_refactor_context', response.target.expansionId) ??
        namespacedExpansionId('collect_refactor_context', response.contextSummary.graphNeighborsExpansionId) ??
        'bundle-section:refactor_context',
      debug: mode === 'debug' ? { details: { sourceTool: 'collect_refactor_context' } } : null,
      sourceTool: 'collect_refactor_context',
      section: 'refactor_context',
      status: response.target.status === 'resolved' ? 'ready' : 'skipped',
      filePath: response.target.filePath,
      symbolName: response.target.symbolName,
      role: response.target.role,
      family: response.target.family,
      itemCount: response.summary.resultCount,
      relationshipKinds: relationshipKindsFromArray(response.results.primary.flatMap((entry) => entry.relationshipKinds)),
    },
    expansions: [
      ...(sectionExpansion ? [sectionExpansion] : []),
      ...namespaceExpansions('collect_refactor_context', response.expansions),
    ],
  };
}

function buildPlanSection(
  response: PlanChangeNormalizedResponse | null,
  mode: NormalizedMode,
  reason: string,
): {
  result?: NormalizedBuildChangeContextResult;
  expansions: NormalizedExpansion[];
} {
  if (!response) {
    return {
      result: {
        id: 'build-change-context:change-plan',
        kind: 'change_plan',
        title: 'Change plan skipped',
        confidence: 'low',
        explanation: buildNormalizedExplanation({
          mode,
          short: reason,
          signals: {
            status: 'skipped',
          },
        }),
        references: {},
        expansionId: 'bundle-section:change_plan',
        debug: mode === 'debug' ? { details: { sourceTool: 'plan_change', skipped: true } } : null,
        sourceTool: 'plan_change',
        section: 'change_plan',
        status: 'skipped',
      },
      expansions: [
        buildNormalizedExpansion({
          id: 'bundle-section:change_plan',
          kind: 'bundle-section',
          title: 'Change plan',
          summary: reason,
          status: 'deferred',
        }),
      ],
    };
  }

  const sectionExpansion = buildSectionExpansion(
    'change_plan',
    'Change plan',
    [
      response.plan.scope,
      `risk ${response.plan.risk}`,
      `${response.summary.resultCount} ordered steps`,
    ].join(' | '),
  );

  return {
    result: {
      id: 'build-change-context:change-plan',
      kind: 'change_plan',
      title: response.target.symbolName ?? response.target.filePath ?? 'Change plan',
      confidence: confidenceFromPlan(response),
      explanation: buildNormalizedExplanation({
        mode,
        short: 'ordered plan turns the gathered context into edit and review steps',
        signals: {
          scope: response.plan.scope,
          risk: response.plan.risk,
          steps:
            response.summary.resultCount > 4
              ? 'high'
              : response.summary.resultCount > 1
                ? 'medium'
                : 'low',
        },
      }),
      references: {
        filePaths: [
          response.target.filePath,
          ...response.plan.fileGroups.primaryEditFiles,
          ...response.plan.fileGroups.secondaryEditFiles,
        ].filter(Boolean),
        symbolNames: response.target.symbolName ? [response.target.symbolName] : undefined,
      },
      expansionId:
        namespacedExpansionId('plan_change', response.plan.signalsExpansionId) ??
        namespacedExpansionId('plan_change', response.plan.fileGroups.primaryEditExpansionId) ??
        'bundle-section:change_plan',
      debug: mode === 'debug' ? { details: { sourceTool: 'plan_change' } } : null,
      sourceTool: 'plan_change',
      section: 'change_plan',
      status: 'ready',
      filePath: response.target.filePath,
      symbolName: response.target.symbolName,
      itemCount: response.summary.resultCount,
      planScope: response.plan.scope,
      planRisk: response.plan.risk,
    },
    expansions: [
      ...(sectionExpansion ? [sectionExpansion] : []),
      ...namespaceExpansions('plan_change', response.expansions),
    ],
  };
}

function derivePlanMode(intent: BuildChangeContextIntent | undefined): 'safe' | 'exploratory' {
  if (intent === 'feature') {
    return 'exploratory';
  }

  return 'safe';
}

function simplifyBucketEntries(
  bucket:
    | CanonicalBucket<{ filePath?: string | null; symbolName?: string | null }>
    | CanonicalBucket<{ filePath: string; symbolName?: string }>
    | undefined,
): CanonicalBucket<{ filePath?: string | null; symbolName?: string | null }> | undefined {
  if (!bucket) {
    return undefined;
  }

  return {
    ...bucket,
    entries: bucket.entries.map((entry) => ({
      ...(entry.filePath ? { filePath: entry.filePath } : {}),
      ...(entry.symbolName ? { symbolName: entry.symbolName } : {}),
    })),
  };
}

function dedupeCanonicalBucket(
  bucket: CanonicalBucket<{ filePath?: string | null; symbolName?: string | null }> | undefined,
): CanonicalBucket<{ filePath?: string | null; symbolName?: string | null }> | undefined {
  if (!bucket) {
    return undefined;
  }

  const seen = new Set<string>();
  const entries = bucket.entries.filter((entry) => {
    const key = `${entry.filePath ?? ''}::${entry.symbolName ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return {
    ...bucket,
    entries,
    shown: entries.length,
    total: Math.min(bucket.total ?? entries.length, entries.length),
  };
}

function selectCanonicalBuckets(input: {
  planChange: PlanChangeNormalizedResponse | null;
  refactorContext: CollectRefactorContextNormalizedResponse;
}): Pick<BuildChangeContextResponse, 'direct_consumers' | 'indirect_consumers' | 'related_context'> {
  if (input.planChange?.direct_consumers && input.planChange.indirect_consumers && input.planChange.related_context) {
    return {
      direct_consumers: dedupeCanonicalBucket(simplifyBucketEntries(input.planChange.direct_consumers)),
      indirect_consumers: dedupeCanonicalBucket(simplifyBucketEntries(input.planChange.indirect_consumers)),
      related_context: dedupeCanonicalBucket(simplifyBucketEntries(input.planChange.related_context)),
    };
  }

  return {
    ...(input.refactorContext.direct_consumers
      ? { direct_consumers: dedupeCanonicalBucket(simplifyBucketEntries(input.refactorContext.direct_consumers)) }
      : {}),
    ...(input.refactorContext.indirect_consumers
      ? { indirect_consumers: dedupeCanonicalBucket(simplifyBucketEntries(input.refactorContext.indirect_consumers)) }
      : {}),
    ...(input.refactorContext.related_context
      ? { related_context: dedupeCanonicalBucket(simplifyBucketEntries(input.refactorContext.related_context)) }
      : {}),
  };
}

function shouldGeneratePlan(input: {
  intent?: BuildChangeContextIntent;
  targetFilePath?: string | null;
  targetSymbolName?: string | null;
  targetConfidence?: ConfidenceLevel;
  ambiguityDetected?: boolean;
}): { shouldGenerate: boolean; skipReason: string } {
  if (!input.targetFilePath || !input.targetSymbolName) {
    return {
      shouldGenerate: false,
      skipReason: 'change plan skipped because the target did not resolve to a symbol and file pair',
    };
  }

  if (input.intent === 'refactor') {
    return {
      shouldGenerate: true,
      skipReason: '',
    };
  }

  if (!input.ambiguityDetected && input.targetConfidence && input.targetConfidence !== 'low') {
    return {
      shouldGenerate: true,
      skipReason: '',
    };
  }

  return {
    shouldGenerate: false,
    skipReason: 'change plan skipped because the target remains ambiguous or weakly grounded',
  };
}

function buildSkippedSection(
  section: BuildChangeSectionKind,
  sourceTool: NormalizedBuildChangeContextResult['sourceTool'],
  title: string,
  mode: NormalizedMode,
  reason: string,
): {
  result: NormalizedBuildChangeContextResult;
  expansions: NormalizedExpansion[];
} {
  return {
    result: {
      id: `build-change-context:${section.replace(/_/g, '-')}`,
      kind: section,
      title,
      confidence: 'low',
      explanation: buildNormalizedExplanation({
        mode,
        short: reason,
        signals: {
          status: 'skipped',
        },
      }),
      references: {},
      expansionId: `bundle-section:${section}`,
      debug: mode === 'debug' ? { details: { sourceTool, skipped: true } } : null,
      sourceTool,
      section,
      status: 'skipped',
    },
    expansions: [
      buildNormalizedExpansion({
        id: `bundle-section:${section}`,
        kind: 'bundle-section',
        title,
        summary: reason,
        status: 'deferred',
      }),
    ],
  };
}

function buildRepoCandidates(values: Array<string | null | undefined>): string[] {
  const candidates = new Set<string>();

  for (const value of values) {
    if (!value) {
      continue;
    }

    const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
    candidates.add(normalized);
    const basename = normalized.split('/').filter(Boolean).at(-1);
    if (basename) {
      candidates.add(basename);
    }
  }

  return Array.from(candidates);
}

async function getRepoFileCount(repoCandidates: string[]): Promise<number> {
  if (repoCandidates.length === 0) {
    return 0;
  }

  const index = await loadRequiredSymbolIndex();
  let count = 0;

  for (const relation of Object.values(index.byFile)) {
    if (repoCandidates.includes(relation.repo)) {
      count += 1;
    }
  }

  return count;
}

function countBucketEntries(
  bucket: CanonicalBucket<{ filePath?: string | null; symbolName?: string | null }> | undefined,
): number {
  if (!bucket) {
    return 0;
  }

  return bucket.shown ?? bucket.total ?? bucket.entries.length;
}

function shouldUseFocusedBundleMode(input: {
  budget: ExecutionBudgetProfile;
  explore: ExploreComponentNormalizedResponse;
}): boolean {
  if (!input.budget.bundle.focusedMode) {
    return false;
  }

  if (input.explore.target.status !== 'resolved' || input.explore.target.resolution?.ambiguityDetected) {
    return false;
  }

  const directCount = countBucketEntries(input.explore.direct_consumers);
  const indirectCount = countBucketEntries(input.explore.indirect_consumers);
  const relatedCount = countBucketEntries(input.explore.related_context);

  return (
    directCount >= 1 ||
    directCount + indirectCount >= 2 ||
    directCount + indirectCount + relatedCount >= input.budget.bundle.maxStrongResults
  );
}

function mapGroundingEntry(input: {
  fileId: string;
  filePath: string;
  reason: string;
  via: string[];
  score?: number;
}): {
  id: string;
  kind: 'related_file';
  title: string;
  confidence: 'high' | 'medium' | 'low';
  explanation: { short: string };
  references: { filePaths: string[] };
  filePath: string;
  relationshipKinds: string[];
} {
  return {
    id: `grounding:${input.fileId}`,
    kind: 'related_file',
    title: input.filePath,
    confidence: (input.score ?? 0) >= 12 ? 'high' : (input.score ?? 0) >= 6 ? 'medium' : 'low',
    explanation: {
      short: input.reason,
    },
    references: {
      filePaths: [input.filePath],
    },
    filePath: input.filePath,
    relationshipKinds: input.via,
  };
}

async function resolveGroundingSymbol(query: string, repoCandidates: string[]): Promise<IndexedSymbol | null> {
  const index = await traceAsync('build_change_context', 'grounding.load_symbol_index', () => loadRequiredSymbolIndex(), {
    query,
    repoCandidates: repoCandidates.length,
  });
  const exactMatches = index.byName[query] ?? [];
  const lowerMatches = exactMatches.length > 0 ? [] : index.byNameLower[query.toLowerCase()] ?? [];
  const candidates = [...exactMatches, ...lowerMatches];
  traceHotspot('build_change_context', 'grounding.resolve_symbol', {
    query,
    exactMatches: exactMatches.length,
    lowerMatches: lowerMatches.length,
    repoScopedMatches: candidates.filter((entry) => repoCandidates.includes(entry.repo)).length,
  });

  const repoScoped = candidates.filter((entry) => repoCandidates.includes(entry.repo));
  const preferred = repoScoped.length > 0 ? repoScoped : candidates;

  if (preferred.length === 0) {
    return null;
  }

  return preferred.find((entry) => entry.exported) ?? preferred[0] ?? null;
}

async function loadExploreStage(input: {
  detail: NormalizedMode;
  targetName: string;
  repo: string | undefined;
  useGroundingOnly: boolean;
}): Promise<ExploreComponentNormalizedResponse> {
  if (!input.useGroundingOnly) {
    return parseToolResult<ExploreComponentNormalizedResponse>(
      await runExploreComponentTool({
        name: input.targetName,
        repo: input.repo,
        detail: input.detail,
        limit: DEFAULT_EXPLORE_LIMIT,
        relatedLimit: DEFAULT_RELATED_LIMIT,
        ...(input.detail === 'debug' ? { expandDebug: true } : {}),
      }),
    );
  }

  const repoCandidates = buildRepoCandidates([input.repo]);
  const primarySymbol = await traceAsync('build_change_context', 'grounding.resolve_primary_symbol', () =>
    resolveGroundingSymbol(input.targetName, repoCandidates), {
      target: input.targetName,
    });
  const primaryFile = primarySymbol
    ? await traceAsync('build_change_context', 'grounding.get_primary_file', () => getFileNode(primarySymbol.fileId), {
        symbolId: primarySymbol.symbolId,
      })
    : null;
  const semanticConsumers = primarySymbol
    ? await traceAsync('build_change_context', 'grounding.semantic_consumers', () => getSemanticConsumersForSymbol(primarySymbol.symbolId), {
        symbolId: primarySymbol.symbolId,
      })
    : [];
  const importingFiles = primarySymbol
    ? await traceAsync('build_change_context', 'grounding.importing_files', () => getImportingFiles(primarySymbol.fileId), {
        fileId: primarySymbol.fileId,
      })
    : [];
  const neighboringFiles = primarySymbol
    ? await traceAsync('build_change_context', 'grounding.related_files', () => getRelatedFiles(primarySymbol.fileId), {
        fileId: primarySymbol.fileId,
      })
    : [];

  const directEntries = [
    ...semanticConsumers
      .filter((entry) => entry.fromFile && ['symbol_call', 'symbol_reference', 'jsx_reference', 'type_reference'].includes(entry.edge.kind))
      .map((entry) =>
        mapGroundingEntry({
          fileId: entry.fromFile!.fileId,
          filePath: entry.fromFile!.filePath,
          reason: `semantic ${entry.edge.kind}`,
          via: [entry.edge.kind],
          score: entry.edge.strength === 'strong' ? 12 : entry.edge.strength === 'medium' ? 8 : 4,
        })),
    ...importingFiles.map((entry) =>
      mapGroundingEntry({
        fileId: entry.fileId,
        filePath: entry.filePath,
        reason: 'imports target file directly',
        via: ['file_imports_file'],
        score: 8,
      })),
  ];
  const indirectEntries = semanticConsumers
    .filter((entry) => entry.fromFile && ['api_route_handler', 'api_client_to_route', 'api_propagation'].includes(entry.edge.kind))
    .map((entry) =>
      mapGroundingEntry({
        fileId: entry.fromFile!.fileId,
        filePath: entry.fromFile!.filePath,
        reason: `semantic ${entry.edge.kind}`,
        via: [entry.edge.kind],
        score: entry.edge.strength === 'strong' ? 10 : 6,
      }));
  const relatedEntries = neighboringFiles.map((entry) =>
    mapGroundingEntry({
      fileId: entry.file.fileId,
      filePath: entry.file.filePath,
      reason: `graph ${entry.via}`,
      via: [entry.via],
      score: 4,
    }));

  const directConsumers = dedupeCanonicalBucket({
    label: 'Direct consumers (exact)',
    explanation: 'confirmed symbol-level usage',
    entries: directEntries,
    total: directEntries.length,
    shown: directEntries.length,
    truncated: false,
    confidence: 'high',
    coverage: 'exact',
  })!;
  const indirectConsumers = dedupeCanonicalBucket({
    label: 'Indirect consumers (inferred)',
    explanation: 'likely usage via wrappers or propagation',
    entries: indirectEntries,
    total: indirectEntries.length,
    shown: indirectEntries.length,
    truncated: false,
    confidence: 'medium',
    coverage: 'inferred',
  })!;
  const relatedContext = dedupeCanonicalBucket({
    label: 'Related context (exploratory)',
    explanation: 'nearby or dependent files, not guaranteed direct usage',
    entries: relatedEntries,
    total: relatedEntries.length,
    shown: relatedEntries.length,
    truncated: false,
    confidence: 'low',
    coverage: 'exploratory',
  })!;
  const primaryEntries = [
    ...directConsumers.entries,
    ...indirectConsumers.entries,
    ...relatedContext.entries,
  ].slice(0, DEFAULT_RELATED_LIMIT);
  traceHotspot('build_change_context', 'grounding.bucket_counts', {
    direct: directConsumers.shown,
    indirect: indirectConsumers.shown,
    related: relatedContext.shown,
    primaryEntries: primaryEntries.length,
  });

  return {
    tool: 'explore_component',
    version: '1',
    mode: input.detail,
    query: {
      target: input.targetName,
      ...(input.repo ? { repo: input.repo } : {}),
    },
    summary: {
      resultCount: primaryEntries.length,
      primaryCount: primaryEntries.length,
      confidence:
        directConsumers.shown > 0 ? 'high' : indirectConsumers.shown > 0 ? 'medium' : 'low',
    },
    results: {
      primary: primaryEntries,
    },
    evidence: [],
    nextActions: [],
    diagnostics: {
      warnings: [],
    },
    expansions: {},
    debug: null,
    target: {
      status: primarySymbol || primaryFile ? 'resolved' : 'missing',
      requestedName: input.targetName,
      ...(input.repo ? { requestedRepo: input.repo } : {}),
      ...(primarySymbol?.name ? { symbolName: primarySymbol.name } : {}),
      ...(primarySymbol?.filePath || primaryFile?.filePath
        ? { filePath: primarySymbol?.filePath ?? primaryFile?.filePath }
        : {}),
      ...(primarySymbol?.repo || primaryFile?.repoId
        ? { repoId: primarySymbol?.repo ?? primaryFile?.repoId }
        : {}),
      ...(primarySymbol?.kind ? { role: primarySymbol.kind } : {}),
      confidence:
        primarySymbol || primaryFile
          ? 'high'
          : 'low',
      resolution: {
        candidateCount: primarySymbol ? 1 : 0,
        ambiguityDetected: false,
      },
      symbolSurface: {
        defined: primarySymbol?.name ? [primarySymbol.name] : [],
        exported: primarySymbol?.exported ? [primarySymbol.name] : [],
      },
    },
    direct_consumers: directConsumers,
    indirect_consumers: indirectConsumers,
    related_context: relatedContext,
  } as unknown as ExploreComponentNormalizedResponse;
}

export async function runBuildChangeContextTool(
  input: BuildChangeContextInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!input.symbolName && !input.filePath) {
    throw new Error('build_change_context requires either symbolName or filePath');
  }

  const detail: NormalizedMode = input.detail ?? 'agent';
  const targetName = input.symbolName ?? input.filePath!;
  const targetMode = input.filePath && !input.symbolName ? 'file' : 'component';
  const initialBudget = getExecutionBudgetProfile(
    await traceAsync('build_change_context', 'setup.initial_repo_file_count', () =>
      getRepoFileCount(buildRepoCandidates([input.repo])), {
        repo: input.repo ?? null,
      }),
  );
  traceHotspot('build_change_context', 'setup.initial_budget', {
    scale: initialBudget.scale,
    repo: input.repo ?? null,
  });
  const explore = await traceAsync('build_change_context', 'stage.explore', () => loadExploreStage({
    detail,
    targetName,
    repo: input.repo,
    useGroundingOnly: initialBudget.bundle.focusedMode,
  }), {
    useGroundingOnly: initialBudget.bundle.focusedMode,
    target: targetName,
  });

  const precedentTargetName =
    targetMode === 'file'
      ? input.filePath!
      : explore.target.symbolName ?? input.symbolName ?? input.filePath ?? targetName;

  const resolvedRepo = explore.target.repoId ?? input.repo ?? undefined;
  const executionBudget = getExecutionBudgetProfile(
    await traceAsync('build_change_context', 'setup.resolved_repo_file_count', () =>
      getRepoFileCount(buildRepoCandidates([input.repo, explore.target.repoId, resolvedRepo])), {
        requestedRepo: input.repo ?? null,
        resolvedRepo: resolvedRepo ?? null,
      }),
  );
  const focusedBundleMode = shouldUseFocusedBundleMode({
    budget: executionBudget,
    explore,
  });
  traceHotspot('build_change_context', 'setup.focused_mode', {
    scale: executionBudget.scale,
    focusedBundleMode,
    direct: countBucketEntries(explore.direct_consumers),
    indirect: countBucketEntries(explore.indirect_consumers),
    related: countBucketEntries(explore.related_context),
  });
  const enoughContextReached =
    focusedBundleMode &&
    (countBucketEntries(explore.direct_consumers) > 0 || countBucketEntries(explore.indirect_consumers) > 0);
  const preliminaryPlanDecision = shouldGeneratePlan({
    intent: input.intent,
    targetFilePath: explore.target.filePath,
    targetSymbolName: explore.target.symbolName,
    targetConfidence: explore.target.confidence,
    ambiguityDetected: Boolean(explore.target.resolution?.ambiguityDetected),
  });
  const shouldRunPlan =
    executionBudget.planning.enabled && (!focusedBundleMode || input.intent === 'refactor') && preliminaryPlanDecision.shouldGenerate;
  const precedentsPromise = !focusedBundleMode && executionBudget.precedents.enabled
    ? traceAsync('build_change_context', 'stage.precedents', () => runFindPrecedentsTool({
        name: precedentTargetName,
        repo: resolvedRepo,
        mode: targetMode === 'file' ? 'file' : 'component',
        detail,
        limit: executionBudget.precedents.limit,
        ...(detail === 'debug' ? { expandDebug: true } : {}),
      }), {
        target: precedentTargetName,
        repo: resolvedRepo ?? null,
      })
    : null;
  const refactorContextPromise = !focusedBundleMode
    ? traceAsync('build_change_context', 'stage.refactor_context', () => runCollectRefactorContextTool({
        name: targetMode === 'file' ? input.filePath! : explore.target.symbolName ?? targetName,
        repo: resolvedRepo,
        mode: targetMode === 'file' ? 'file' : 'component',
        detail,
        limit: executionBudget.refactor.relatedLimit,
        ...(detail === 'debug' ? { expandDebug: true } : {}),
      }), {
        target: targetMode === 'file' ? input.filePath! : explore.target.symbolName ?? targetName,
        repo: resolvedRepo ?? null,
      })
    : null;
  const planChangePromise = shouldRunPlan
    ? traceAsync('build_change_context', 'stage.plan_change', () => runPlanChangeTool({
        symbol: explore.target.symbolName ?? input.symbolName ?? targetName,
        filePath: explore.target.filePath ?? input.filePath,
        repo: resolvedRepo,
        mode: derivePlanMode(input.intent),
      }, {
        maxDepth: executionBudget.planning.maxDepth,
      }), {
        symbol: explore.target.symbolName ?? input.symbolName ?? targetName,
        repo: resolvedRepo ?? null,
      })
    : null;

  const [precedentsResult, refactorContextResult] = await Promise.all([
    precedentsPromise,
    refactorContextPromise,
  ]);
  const precedents = precedentsResult
    ? parseToolResult<FindPrecedentsNormalizedResponse>(precedentsResult)
    : null;
  const refactorContext = refactorContextResult
    ? parseToolResult<CollectRefactorContextNormalizedResponse>(refactorContextResult)
    : null;
  const planDecision = shouldGeneratePlan({
    intent: input.intent,
    targetFilePath: explore.target.filePath ?? refactorContext?.target.filePath,
    targetSymbolName: explore.target.symbolName ?? refactorContext?.target.symbolName,
    targetConfidence: confidenceOrFallback(explore.target.confidence, refactorContext?.target.confidence),
    ambiguityDetected:
      Boolean(explore.target.resolution?.ambiguityDetected) || Boolean(refactorContext?.target.resolution?.ambiguityDetected),
  });
  const effectivePlanDecision = shouldRunPlan
    ? planDecision
    : {
        shouldGenerate: false,
        skipReason: focusedBundleMode
          ? 'change plan skipped in large-repo focused mode after strong evidence was collected'
          : executionBudget.planning.enabled
            ? planDecision.skipReason
            : 'change plan skipped by execution budget',
      };

  const planChange = effectivePlanDecision.shouldGenerate
    ? parseToolResult<PlanChangeNormalizedResponse>(
        await (planChangePromise ??
          runPlanChangeTool({
            symbol: explore.target.symbolName ?? refactorContext?.target.symbolName ?? input.symbolName!,
            filePath: explore.target.filePath ?? refactorContext?.target.filePath ?? input.filePath,
            repo: resolvedRepo ?? refactorContext?.target.repoId ?? undefined,
            mode: derivePlanMode(input.intent),
          }, {
            maxDepth: executionBudget.planning.maxDepth,
          })),
      )
    : null;

  const componentSection = buildComponentSection(explore, detail);
  const precedentSection = precedents
    ? buildPrecedentSection(precedents, detail)
    : buildSkippedSection(
        'precedent_cluster',
        'find_precedents',
        'Precedent cluster',
        detail,
        focusedBundleMode
          ? 'precedent search skipped in large-repo focused mode after strong direct evidence was collected'
          : 'precedent search skipped',
      );
  const refactorSection = refactorContext
    ? buildRefactorSection(refactorContext, detail)
    : buildSkippedSection(
        'refactor_context',
        'collect_refactor_context',
        'Refactor context',
        detail,
        focusedBundleMode
          ? 'refactor context skipped in large-repo focused mode to preserve a bounded, high-value bundle'
          : 'refactor context skipped',
      );
  const planSection = buildPlanSection(planChange, detail, effectivePlanDecision.skipReason);

  const items = [componentSection.result, precedentSection.result, refactorSection.result, ...(planSection.result ? [planSection.result] : [])];
  const results = buildNormalizedResultTiers({
    items,
    mode: detail,
    primaryCount: items.length,
    secondaryCount: 0,
  });

  const diagnostics = mergeNormalizedDiagnostics(
    explore.diagnostics as NormalizedDiagnostics,
    precedents?.diagnostics as NormalizedDiagnostics | undefined,
    refactorContext?.diagnostics as NormalizedDiagnostics | undefined,
    planChange?.diagnostics as NormalizedDiagnostics | undefined,
    {
      notes: [
        `orchestration intent: ${input.intent ?? 'unspecified'}`,
        effectivePlanDecision.shouldGenerate ? 'change plan included' : effectivePlanDecision.skipReason,
        ...(focusedBundleMode
          ? [
              'large-repo focused mode activated',
              ...(enoughContextReached ? ['enough-context stop condition hit after strong consumer recovery'] : []),
              'precedent breadth capped in large-repo focused mode',
              'related-context expansion capped in large-repo focused mode',
              'weak exploratory bundle expansion skipped after strong evidence was collected',
              'change planning skipped to keep the bundled workflow within large-repo execution budget',
            ]
          : []),
      ],
    },
  );

  const response = await traceAsync('build_change_context', 'stage.normalize_output', async () =>
    createNormalizedResponse<NormalizedBuildChangeContextResult>({
    tool: 'build_change_context',
    mode: detail,
    query: {
      target: targetName,
      ...(input.symbolName ? { symbolName: input.symbolName } : {}),
      ...(input.filePath ? { filePath: input.filePath } : {}),
      ...(input.repo ? { repo: input.repo } : {}),
      ...(input.intent ? { intent: input.intent } : {}),
    },
    results,
    summary: buildNormalizedSummary({
      results,
      confidence: confidenceOrFallback(
        explore.target.confidence,
        precedents?.summary.confidence,
        refactorContext?.target.confidence,
        planChange ? confidenceFromPlan(planChange) : undefined,
      ),
      strongMatchCount: items.filter((item) => item.confidence === 'high').length,
    }),
    evidence: [
      { kind: 'intent', label: 'intent', value: input.intent ?? 'unspecified' },
      ...explore.evidence,
      ...(precedents?.evidence ?? []),
      ...(refactorContext?.evidence ?? []),
      ...(planChange?.evidence ?? []),
    ],
    nextActions: [
      ...explore.nextActions,
      ...(precedents?.nextActions ?? []),
      ...(refactorContext?.nextActions ?? []),
      ...(planChange?.nextActions ?? []),
      ...(planDecision.shouldGenerate
        ? []
        : [
            {
              tool: 'plan_change',
              reason: 'generate a concrete change plan once the target is narrowed further',
              query: {
                ...(explore.target.symbolName ? { symbol: explore.target.symbolName } : {}),
                ...(explore.target.filePath ? { filePath: explore.target.filePath } : {}),
                repo: resolvedRepo,
                mode: derivePlanMode(input.intent),
              },
            } satisfies NormalizedNextAction,
          ]),
    ],
    diagnostics,
    expansions: [
      ...componentSection.expansions,
      ...precedentSection.expansions,
      ...refactorSection.expansions,
      ...planSection.expansions,
    ],
    debug:
      detail === 'debug'
        ? {
            orchestration: {
              targetMode,
              planTriggered: effectivePlanDecision.shouldGenerate,
              requestedIntent: input.intent ?? null,
              subtools: {
                explore_component: {
                  resultCount: explore.summary.resultCount,
                },
                find_precedents: {
                  ...(precedents
                    ? { resultCount: precedents.summary.resultCount }
                    : { skipped: true, reason: focusedBundleMode ? 'large-repo focused mode' : 'disabled' }),
                },
                collect_refactor_context: {
                  ...(refactorContext
                    ? { resultCount: refactorContext.summary.resultCount }
                    : { skipped: true, reason: focusedBundleMode ? 'large-repo focused mode' : 'disabled' }),
                },
                plan_change: planChange
                  ? {
                      resultCount: planChange.summary.resultCount,
                      risk: planChange.plan.risk,
                    }
                  : {
                      skipped: true,
                      reason: effectivePlanDecision.skipReason,
                    },
              },
            },
          }
        : null,
    }), {
      resultCount: items.length,
      focusedBundleMode,
    });

  const target: BuildChangeContextTarget = {
    ...(input.symbolName ? { requestedSymbolName: input.symbolName } : {}),
    ...(input.filePath ? { requestedFilePath: input.filePath } : {}),
    ...(input.repo ? { requestedRepo: input.repo } : {}),
    ...(input.intent ? { intent: input.intent } : {}),
    status: explore.target.status,
    filePath: explore.target.filePath ?? refactorContext?.target.filePath,
    symbolName: explore.target.symbolName ?? refactorContext?.target.symbolName,
    role: explore.target.role ?? refactorContext?.target.role,
    family: explore.target.family ?? refactorContext?.target.family ?? precedents?.target.family,
    confidence: confidenceOrFallback(explore.target.confidence, refactorContext?.target.confidence),
    grounding: precedents?.target.grounding,
    resolution: explore.target.resolution,
    planIncluded: effectivePlanDecision.shouldGenerate,
    expansionId: namespacedExpansionId('explore_component', explore.target.expansionId),
  };

  const output: BuildChangeContextResponse = {
    ...response,
    target,
    ...selectCanonicalBuckets({
      planChange,
      refactorContext: refactorContext ?? ({
        direct_consumers: explore.direct_consumers,
        indirect_consumers: explore.indirect_consumers,
        related_context: explore.related_context,
      } as CollectRefactorContextNormalizedResponse),
    }),
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(output, null, 2),
      },
    ],
  };
}
