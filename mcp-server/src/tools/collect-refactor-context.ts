import { collectRefactorContextInputSchema } from '../schemas.js';
import { getCollectRefactorContext } from '../orchestrator/index.js';
import type { CollectRefactorContextInput } from '../types.js';

export const collectRefactorContextToolDefinition = {
  name: 'collect_refactor_context',
  title: 'Collect Refactor Context',
  description: 'Assemble refactor impact context for a file, component, or symbol using existing graph and symbol signals.',
  inputSchema: collectRefactorContextInputSchema,
};

export async function runCollectRefactorContextTool(
  input: CollectRefactorContextInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const result = await getCollectRefactorContext({
    name: input.name,
    repo: input.repo,
    mode: input.mode ?? 'component',
    limit: input.limit,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
