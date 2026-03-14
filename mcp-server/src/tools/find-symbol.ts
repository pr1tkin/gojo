import { findSymbolInputSchema } from '../schemas.js';
import { rankFindSymbolResults } from '../ranking.js';
import type { FindSymbolInput } from '../types.js';
import { findSymbolWithTypeScriptFallback } from '../typescript/fallback.js';

export const findSymbolToolDefinition = {
  name: 'find_symbol',
  title: 'Find Symbol',
  description: 'Find symbol definitions across indexed repositories.',
  inputSchema: findSymbolInputSchema,
};

export async function runFindSymbolTool(
  reposRoot: string,
  input: FindSymbolInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const matches = await findSymbolWithTypeScriptFallback(reposRoot, input);
  const rankedMatches = rankFindSymbolResults(matches, {
    kind: input.kind,
    repo: input.repo,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(rankedMatches, null, 2),
      },
    ],
  };
}
