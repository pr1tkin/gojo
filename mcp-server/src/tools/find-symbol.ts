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
  visibility: 'internal' as const,
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
      relationsByFile: index.byFile,
      fileFanInById: Object.values(index.byFile).reduce<Record<string, number>>((acc, relation) => {
        for (const entry of relation.imports) {
          if (!entry.resolvedTargetFileId) {
            continue;
          }

          acc[entry.resolvedTargetFileId] = (acc[entry.resolvedTargetFileId] ?? 0) + 1;
        }

        return acc;
      }, Object.create(null) as Record<string, number>),
    },
  );
  const metadata = await buildStructuralTrustMetadata();
  const primary = rankedMatches[0]?.item ?? null;
  const alternatives = rankedMatches.slice(1).map((entry) => entry.item);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            primary,
            alternatives,
            matches: rankedMatches.map((entry) => entry.item),
            metadata,
          },
          null,
          2,
        ),
      },
    ],
  };
}
