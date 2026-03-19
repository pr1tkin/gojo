import { collectRefactorContextInputSchema } from '../schemas.js';
import { getCollectRefactorContext } from '../orchestrator/index.js';
import type { CollectRefactorContextInput } from '../types.js';
import {
  buildIndexedSymbolExplainability,
  buildNearbyFileExplainability,
  buildRefactorSymbolCandidateExplainability,
  buildRelatedFileExplainability,
} from './explainability.js';

export const collectRefactorContextToolDefinition = {
  name: 'collect_refactor_context',
  title: 'Collect Refactor Context',
  description: 'Assemble refactor impact context for a file, component, or symbol using existing graph and symbol signals.',
  inputSchema: collectRefactorContextInputSchema,
};

export async function runCollectRefactorContextTool(
  input: CollectRefactorContextInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const detail = input.detail ?? 'agent';
  const result = await getCollectRefactorContext({
    name: input.name,
    repo: input.repo,
    mode: input.mode ?? 'component',
    limit: input.limit,
  });
  const relatedFiles = await Promise.all(
    result.relatedFiles.map(async (entry) => ({
      ...entry,
      explanation: await buildRelatedFileExplainability(entry, detail),
    })),
  );
  const nearbyFiles = await Promise.all(
    result.nearbyFiles.map(async (entry) => ({
      ...entry,
      explanation: await buildNearbyFileExplainability(entry, detail),
    })),
  );
  const symbolCandidates = await Promise.all(
    result.symbolCandidates.map(async (entry) => ({
      ...entry,
      explanation: await buildRefactorSymbolCandidateExplainability(entry, detail),
    })),
  );
  const targetSymbol = result.target.symbol
    ? {
        ...result.target.symbol,
        explanation: await buildIndexedSymbolExplainability(result.target.symbol, detail),
      }
    : null;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            ...result,
            explainabilityMode: detail,
            target: {
              ...result.target,
              symbol: targetSymbol,
            },
            relatedFiles,
            nearbyFiles,
            symbolCandidates,
          },
          null,
          2,
        ),
      },
    ],
  };
}
