import { planChangeInputSchema } from '../schemas.js';
import { planSymbolChange } from '../orchestrator/index.js';
import type { PlanChangeInput } from '../types.js';
import {
  normalizePlanChangeResponse,
  type RawPlanChangeResponse,
} from '../tool-response/normalize-plan-change.js';

function buildAgentSummary(result: {
  target: { symbolName?: string; filePath: string };
  scope: string;
  risk: string;
  orderedPlan: Array<{ filePath: string; role: string }>;
  summary: string;
}): string {
  const targetName = result.target.symbolName ?? 'target symbol';
  const nextSteps = result.orderedPlan
    .slice(0, 3)
    .map((entry) => `${entry.role}: ${entry.filePath}`)
    .join('; ');

  return `${targetName} is planned as ${result.scope} with ${result.risk} risk. ${result.summary}${nextSteps ? ` Start with ${nextSteps}.` : ''}`;
}

export const planChangeToolDefinition = {
  name: 'plan_change',
  title: 'Plan Change',
  description: 'Estimate safe change scope and produce an ordered edit/review plan using impact analysis and API-boundary signals.',
  visibility: 'public' as const,
  inputSchema: planChangeInputSchema,
};

export async function runPlanChangeTool(
  input: PlanChangeInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const result = await planSymbolChange({
    symbolName: input.symbol,
    filePath: input.filePath,
    repoId: input.repo,
    impactMode: input.mode,
  });
  const rawOutput: RawPlanChangeResponse = {
    ...result,
    requestedSymbol: input.symbol,
    ...(input.filePath ? { requestedFilePath: input.filePath } : {}),
    ...(input.repo ? { requestedRepo: input.repo } : {}),
    ...(input.mode ? { requestedMode: input.mode } : {}),
    explainabilityMode: 'agent',
    agentSummary: buildAgentSummary(result),
  };
  const normalizedOutput = normalizePlanChangeResponse({
    rawResponse: rawOutput,
    mode: 'agent',
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(normalizedOutput, null, 2),
      },
    ],
  };
}
