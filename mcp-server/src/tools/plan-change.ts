import { planChangeInputSchema } from '../schemas.js';
import { getSymbolExplorationContext, planSymbolChange } from '../orchestrator/index.js';
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
  description: 'Targeted planning tool for turning grounded context into an ordered edit and review sequence.',
  visibility: 'public' as const,
  role: 'specialist' as const,
  inputSchema: planChangeInputSchema,
};

async function resolvePlanTarget(input: PlanChangeInput): Promise<{
  repoId?: string;
  filePath?: string;
  symbolId?: string;
  symbolName: string;
}> {
  if (input.filePath) {
    return {
      repoId: input.repo,
      filePath: input.filePath,
      symbolName: input.symbol,
    };
  }

  const symbolContext = await getSymbolExplorationContext(input.symbol, {
    repo: input.repo,
    limit: 3,
    relatedLimit: 4,
  });

  return {
    repoId: symbolContext.primarySymbol?.repo ?? symbolContext.primaryFile?.repoId ?? input.repo,
    filePath: symbolContext.primarySymbol?.filePath ?? symbolContext.primaryFile?.filePath,
    symbolId: symbolContext.primarySymbol?.symbolId,
    symbolName: symbolContext.primarySymbol?.name ?? input.symbol,
  };
}

export async function runPlanChangeTool(
  input: PlanChangeInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const resolvedTarget = await resolvePlanTarget(input);
  const result = await planSymbolChange({
    symbolId: resolvedTarget.symbolId,
    symbolName: resolvedTarget.symbolName,
    filePath: resolvedTarget.filePath,
    repoId: resolvedTarget.repoId,
    impactMode: input.mode,
    maxDepth: 2,
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
