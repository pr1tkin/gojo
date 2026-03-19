import { findSymbolInputSchema } from '../schemas.js';
import { rankSymbolCandidates } from '../ranking/index.js';
import { loadSymbolIndex } from '../symbol-index/store.js';
import type { FindSymbolInput } from '../types.js';
import { findSymbolWithTypeScriptFallback } from '../typescript/fallback.js';
import { buildStructuralTrustMetadata } from './trust-metadata.js';

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
  const index = await loadSymbolIndex();
  const rankedMatches = rankSymbolCandidates(
    matches,
    {
      queryName: input.name,
      kind: input.kind,
      repo: input.repo,
    },
    {
      stats: index.stats,
    },
  ).map((entry) => entry.item);
  const metadata = await buildStructuralTrustMetadata();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            matches: rankedMatches,
            metadata,
          },
          null,
          2,
        ),
      },
    ],
  };
}
