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
import { runCollectRefactorContextTool } from './collect-refactor-context.js';
import { runExploreComponentTool } from './explore-component.js';
import { runFindPrecedentsTool } from './find-precedents.js';
import { runPlanChangeTool } from './plan-change.js';

const DEFAULT_EXPLORE_LIMIT = 3;
const DEFAULT_RELATED_LIMIT = 6;
const DEFAULT_PRECEDENT_LIMIT = 3;
const DEFAULT_REFACTOR_LIMIT = 3;

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

export async function runBuildChangeContextTool(
  input: BuildChangeContextInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!input.symbolName && !input.filePath) {
    throw new Error('build_change_context requires either symbolName or filePath');
  }

  const detail: NormalizedMode = input.detail ?? 'agent';
  const targetName = input.symbolName ?? input.filePath!;
  const targetMode = input.filePath && !input.symbolName ? 'file' : 'component';

  const explore = parseToolResult<ExploreComponentNormalizedResponse>(
    await runExploreComponentTool({
      name: targetName,
      repo: input.repo,
      detail,
      limit: DEFAULT_EXPLORE_LIMIT,
      relatedLimit: DEFAULT_RELATED_LIMIT,
      ...(detail === 'debug' ? { expandDebug: true } : {}),
    }),
  );

  const precedentTargetName =
    targetMode === 'file'
      ? input.filePath!
      : explore.target.symbolName ?? input.symbolName ?? input.filePath ?? targetName;

  const precedents = parseToolResult<FindPrecedentsNormalizedResponse>(
    await runFindPrecedentsTool({
      name: precedentTargetName,
      repo: input.repo ?? explore.target.repoId ?? undefined,
      mode: targetMode === 'file' ? 'file' : 'component',
      detail,
      limit: DEFAULT_PRECEDENT_LIMIT,
      ...(detail === 'debug' ? { expandDebug: true } : {}),
    }),
  );

  const refactorContext = parseToolResult<CollectRefactorContextNormalizedResponse>(
    await runCollectRefactorContextTool({
      name: targetMode === 'file' ? input.filePath! : explore.target.symbolName ?? targetName,
      repo: input.repo ?? explore.target.repoId ?? undefined,
      mode: targetMode === 'file' ? 'file' : 'component',
      detail,
      limit: DEFAULT_REFACTOR_LIMIT,
      ...(detail === 'debug' ? { expandDebug: true } : {}),
    }),
  );

  const planDecision = shouldGeneratePlan({
    intent: input.intent,
    targetFilePath: explore.target.filePath ?? refactorContext.target.filePath,
    targetSymbolName: explore.target.symbolName ?? refactorContext.target.symbolName,
    targetConfidence: confidenceOrFallback(explore.target.confidence, refactorContext.target.confidence),
    ambiguityDetected:
      Boolean(explore.target.resolution?.ambiguityDetected) || Boolean(refactorContext.target.resolution?.ambiguityDetected),
  });

  const planChange = planDecision.shouldGenerate
    ? parseToolResult<PlanChangeNormalizedResponse>(
        await runPlanChangeTool({
          symbol: explore.target.symbolName ?? refactorContext.target.symbolName ?? input.symbolName!,
          filePath: explore.target.filePath ?? refactorContext.target.filePath ?? input.filePath,
          repo: input.repo ?? explore.target.repoId ?? refactorContext.target.repoId ?? undefined,
          mode: derivePlanMode(input.intent),
        }),
      )
    : null;

  const componentSection = buildComponentSection(explore, detail);
  const precedentSection = buildPrecedentSection(precedents, detail);
  const refactorSection = buildRefactorSection(refactorContext, detail);
  const planSection = buildPlanSection(planChange, detail, planDecision.skipReason);

  const items = [componentSection.result, precedentSection.result, refactorSection.result, ...(planSection.result ? [planSection.result] : [])];
  const results = buildNormalizedResultTiers({
    items,
    mode: detail,
    primaryCount: items.length,
    secondaryCount: 0,
  });

  const diagnostics = mergeNormalizedDiagnostics(
    explore.diagnostics as NormalizedDiagnostics,
    precedents.diagnostics as NormalizedDiagnostics,
    refactorContext.diagnostics as NormalizedDiagnostics,
    planChange?.diagnostics as NormalizedDiagnostics | undefined,
    {
      notes: [
        `orchestration intent: ${input.intent ?? 'unspecified'}`,
        planDecision.shouldGenerate ? 'change plan included' : planDecision.skipReason,
      ],
    },
  );

  const response = createNormalizedResponse<NormalizedBuildChangeContextResult>({
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
        precedents.summary.confidence,
        refactorContext.target.confidence,
        planChange ? confidenceFromPlan(planChange) : undefined,
      ),
      strongMatchCount: items.filter((item) => item.confidence === 'high').length,
    }),
    evidence: [
      { kind: 'intent', label: 'intent', value: input.intent ?? 'unspecified' },
      ...explore.evidence,
      ...precedents.evidence,
      ...refactorContext.evidence,
      ...(planChange?.evidence ?? []),
    ],
    nextActions: [
      ...explore.nextActions,
      ...precedents.nextActions,
      ...refactorContext.nextActions,
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
                repo: input.repo ?? explore.target.repoId ?? undefined,
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
              planTriggered: planDecision.shouldGenerate,
              requestedIntent: input.intent ?? null,
              subtools: {
                explore_component: {
                  resultCount: explore.summary.resultCount,
                },
                find_precedents: {
                  resultCount: precedents.summary.resultCount,
                },
                collect_refactor_context: {
                  resultCount: refactorContext.summary.resultCount,
                },
                plan_change: planChange
                  ? {
                      resultCount: planChange.summary.resultCount,
                      risk: planChange.plan.risk,
                    }
                  : {
                      skipped: true,
                      reason: planDecision.skipReason,
                    },
              },
            },
          }
        : null,
  });

  const target: BuildChangeContextTarget = {
    ...(input.symbolName ? { requestedSymbolName: input.symbolName } : {}),
    ...(input.filePath ? { requestedFilePath: input.filePath } : {}),
    ...(input.repo ? { requestedRepo: input.repo } : {}),
    ...(input.intent ? { intent: input.intent } : {}),
    status: explore.target.status,
    filePath: explore.target.filePath ?? refactorContext.target.filePath,
    symbolName: explore.target.symbolName ?? refactorContext.target.symbolName,
    role: explore.target.role ?? refactorContext.target.role,
    family: explore.target.family ?? refactorContext.target.family ?? precedents.target.family,
    confidence: confidenceOrFallback(explore.target.confidence, refactorContext.target.confidence),
    grounding: precedents.target.grounding,
    resolution: explore.target.resolution,
    planIncluded: planDecision.shouldGenerate,
    expansionId: namespacedExpansionId('explore_component', explore.target.expansionId),
  };

  const output: BuildChangeContextResponse = {
    ...response,
    target,
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
