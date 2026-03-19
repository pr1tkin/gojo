import { searchPatternsInputSchema } from '../schemas.js';
import {
  getPatternMatchesForComponent,
  getPatternMatchesForFile,
  getPatternMatchesForSymbol,
} from '../orchestrator/index.js';
import type { SearchPatternsInput } from '../types.js';
import { buildPatternTrustMetadata } from './trust-metadata.js';

const DEFAULT_MATCH_LIMIT = 6;

export const searchPatternsToolDefinition = {
  name: 'search_patterns',
  title: 'Search Patterns',
  description: 'Find similar implementations and repository precedents using heuristic pattern discovery.',
  inputSchema: searchPatternsInputSchema,
};

export async function runSearchPatternsTool(
  input: SearchPatternsInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const mode = input.mode ?? 'component';
  const options = {
    repo: input.repo,
    limit: input.limit ?? DEFAULT_MATCH_LIMIT,
  };

  const result =
    mode === 'file'
      ? await getPatternMatchesForFile(input.name, options)
      : mode === 'symbol'
        ? await getPatternMatchesForSymbol(input.name, options)
        : await getPatternMatchesForComponent(input.name, options);
  const metadata = await buildPatternTrustMetadata(result);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            requestedName: input.name,
            requestedRepo: input.repo,
            requestedMode: mode,
            metadata,
            ...result,
          },
          null,
          2,
        ),
      },
    ],
  };
}
