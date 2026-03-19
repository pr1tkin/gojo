import type { SymbolChangePlanResult } from '../orchestrator/index.js';
import { buildNormalizedDiagnostics } from './diagnostics-builder.js';
import { buildNormalizedExpansion } from './expansion-builder.js';
import { buildNormalizedExplanation } from './explanation-builder.js';
import { buildNormalizedDebugPayload } from './mode-shaping.js';
import { buildNormalizedNextAction } from './next-actions-builder.js';
import { createNormalizedResponse } from './normalized-response.js';
import { buildNormalizedResultTiers, buildNormalizedSummary } from './summary-builder.js';
import type {
  NormalizedEvidenceItem,
  NormalizedExpansion,
  NormalizedMode,
  NormalizedNextAction,
  NormalizedResultBase,
  NormalizedToolResponse,
} from './normalized-types.js';

export interface RawPlanChangeResponse extends SymbolChangePlanResult {
  requestedSymbol: string;
  requestedFilePath?: string;
  requestedRepo?: string;
  requestedMode?: string;
  explainabilityMode: NormalizedMode;
  agentSummary: string;
}

export interface NormalizedPlanChangeStep extends NormalizedResultBase {
  stepOrder: number;
  filePath: string;
  role: SymbolChangePlanResult['orderedPlan'][number]['role'];
  rationale: string;
}

export interface NormalizedPlanChangeTarget {
  filePath: string;
  symbolId?: string;
  symbolName?: string;
  kind?: string;
}

export interface NormalizedPlanFileGroups {
  primaryEditFiles: string[];
  secondaryEditFiles: string[];
  reviewFiles: string[];
  primaryEditExpansionId?: string;
  secondaryEditExpansionId?: string;
  reviewExpansionId?: string;
}

export interface NormalizedPlanOverview {
  scope: SymbolChangePlanResult['scope'];
  risk: SymbolChangePlanResult['risk'];
  summary: string;
  agentSummary: string;
  fileGroups: NormalizedPlanFileGroups;
  signalsExpansionId?: string;
  uiHintsExpansionId?: string;
}

export interface PlanChangeNormalizedResponse extends NormalizedToolResponse<NormalizedPlanChangeStep> {
  target: NormalizedPlanChangeTarget;
  plan: NormalizedPlanOverview;
}

export interface PlanChangeNormalizationInput {
  rawResponse: RawPlanChangeResponse;
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

function buildListExpansion(id: string, kind: string, title: string, values: string[]): NormalizedExpansion | null {
  if (values.length === 0) {
    return null;
  }

  return buildNormalizedExpansion({
    id,
    kind,
    title,
    summary: buildExpansionSummary([`${values.length} files`, compactListSummary(values)]),
    status: 'deferred',
  });
}

function buildExpansions(raw: RawPlanChangeResponse): Record<string, NormalizedExpansion> {
  const expansions = new Map<string, NormalizedExpansion>();

  const fileGroupExpansions = [
    buildListExpansion('plan:primary-edit-files', 'plan-primary-edit-files', 'Primary edit files', raw.primaryEditFiles),
    buildListExpansion('plan:secondary-edit-files', 'plan-secondary-edit-files', 'Secondary edit files', raw.secondaryEditFiles),
    buildListExpansion('plan:review-files', 'plan-review-files', 'Review files', raw.reviewFiles),
  ];

  for (const expansion of fileGroupExpansions) {
    if (expansion) {
      expansions.set(expansion.id, expansion);
    }
  }

  if (raw.signals.length) {
    expansions.set(
      'plan:signals',
      buildNormalizedExpansion({
        id: 'plan:signals',
        kind: 'plan-signals',
        title: 'Planning signals',
        summary: buildExpansionSummary([
          `${raw.signals.length} signals`,
          raw.signals.slice(0, 3).map((entry) => entry.type).join(', '),
        ]),
        status: 'deferred',
      }),
    );
  }

  if (raw.uiPlanningHints) {
    expansions.set(
      'plan:ui-hints',
      buildNormalizedExpansion({
        id: 'plan:ui-hints',
        kind: 'plan-ui-hints',
        title: 'UI planning hints',
        summary: buildExpansionSummary([
          `confidence ${raw.uiPlanningHints.confidence}`,
          raw.uiPlanningHints.observedPropSurface.length
            ? `${raw.uiPlanningHints.observedPropSurface.length} observed props`
            : undefined,
          raw.uiPlanningHints.renderingComponents.length
            ? `${raw.uiPlanningHints.renderingComponents.length} rendering components`
            : undefined,
        ]),
        status: 'deferred',
      }),
    );
  }

  return Object.fromEntries(expansions);
}

function normalizeStep(step: RawPlanChangeResponse['orderedPlan'][number], mode: NormalizedMode): NormalizedPlanChangeStep {
  return {
    id: `plan-step:${step.order}:${step.filePath}`,
    kind: 'plan_step',
    title: step.filePath,
    confidence: step.confidence,
    explanation: buildNormalizedExplanation({
      mode,
      short: step.reason,
      signals: {
        role: step.role,
      },
    }),
    references: {
      filePaths: [step.filePath],
    },
    debug: buildNormalizedDebugPayload(mode, null),
    stepOrder: step.order,
    filePath: step.filePath,
    role: step.role,
    rationale: step.reason,
  };
}

function buildEvidence(raw: RawPlanChangeResponse): NormalizedEvidenceItem[] {
  const evidence: NormalizedEvidenceItem[] = [
    { kind: 'scope', label: 'change scope', value: raw.scope },
    { kind: 'risk', label: 'change risk', value: raw.risk },
  ];

  if (raw.target.kind) {
    evidence.push({ kind: 'target_kind', label: 'target kind', value: raw.target.kind });
  }

  for (const signal of raw.signals.slice(0, 2)) {
    evidence.push({
      kind: `signal_${signal.type}`,
      label: `signal ${signal.type}`,
      value: signal.strength,
    });
  }

  return evidence;
}

function buildNextActions(raw: RawPlanChangeResponse): NormalizedNextAction[] {
  const actions: NormalizedNextAction[] = [];
  const firstStep = raw.orderedPlan[0];

  if (raw.target.filePath) {
    actions.push(
      buildNormalizedNextAction({
        tool: 'collect_refactor_context',
        reason: 'inspect refactor impact around the planned target',
        query: {
          name: raw.target.filePath,
          repo: raw.requestedRepo,
          mode: 'file',
          detail: raw.explainabilityMode,
        },
      }),
    );
    actions.push(
      buildNormalizedNextAction({
        tool: 'find_precedents',
        reason: 'inspect implementation peers before editing',
        query: {
          name: raw.target.filePath,
          repo: raw.requestedRepo,
          mode: 'file',
          detail: raw.explainabilityMode,
        },
      }),
    );
  }

  if (firstStep?.filePath) {
    actions.push(
      buildNormalizedNextAction({
        tool: 'explore_component',
        reason: 'inspect the first planned edit target',
        query: {
          name: firstStep.filePath,
          repo: raw.requestedRepo,
          detail: raw.explainabilityMode,
        },
      }),
    );
  }

  return actions;
}

export function normalizePlanChangeResponse(
  input: PlanChangeNormalizationInput,
): PlanChangeNormalizedResponse {
  const raw = input.rawResponse;
  const normalizedSteps = raw.orderedPlan.map((step) => normalizeStep(step, input.mode));
  const results = buildNormalizedResultTiers({
    items: normalizedSteps,
    mode: input.mode,
    primaryCount: normalizedSteps.length,
    secondaryCount: 0,
  });
  const expansions = buildExpansions(raw);

  const response = createNormalizedResponse<NormalizedPlanChangeStep>({
    tool: 'plan_change',
    mode: input.mode,
    query: {
      target: raw.requestedSymbol,
      repo: raw.requestedRepo,
      mode: raw.requestedMode,
      filePath: raw.target.filePath,
      ...(raw.target.symbolName ? { symbolName: raw.target.symbolName } : {}),
    },
    results,
    summary: buildNormalizedSummary({
      results,
      strongMatchCount: normalizedSteps.filter((step) => step.confidence === 'high').length,
    }),
    evidence: buildEvidence(raw),
    nextActions: buildNextActions(raw),
    diagnostics: buildNormalizedDiagnostics({
      warnings: [],
      notes: raw.notes,
    }),
    expansions: Object.values(expansions),
    debug: null,
  });

  return {
    ...response,
    target: {
      filePath: raw.target.filePath,
      ...(raw.target.symbolId ? { symbolId: raw.target.symbolId } : {}),
      ...(raw.target.symbolName ? { symbolName: raw.target.symbolName } : {}),
      ...(raw.target.kind ? { kind: raw.target.kind } : {}),
    },
    plan: {
      scope: raw.scope,
      risk: raw.risk,
      summary: raw.summary,
      agentSummary: raw.agentSummary,
      fileGroups: {
        primaryEditFiles: raw.primaryEditFiles,
        secondaryEditFiles: raw.secondaryEditFiles,
        reviewFiles: raw.reviewFiles,
        ...(response.expansions['plan:primary-edit-files'] ? { primaryEditExpansionId: 'plan:primary-edit-files' } : {}),
        ...(response.expansions['plan:secondary-edit-files'] ? { secondaryEditExpansionId: 'plan:secondary-edit-files' } : {}),
        ...(response.expansions['plan:review-files'] ? { reviewExpansionId: 'plan:review-files' } : {}),
      },
      ...(response.expansions['plan:signals'] ? { signalsExpansionId: 'plan:signals' } : {}),
      ...(response.expansions['plan:ui-hints'] ? { uiHintsExpansionId: 'plan:ui-hints' } : {}),
    },
  };
}
