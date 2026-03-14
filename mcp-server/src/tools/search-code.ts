import { formatSearchResults } from '../formatters.js';
import { searchCodeInputSchema } from '../schemas.js';
import type { SearchCodeInput } from '../types.js';
import { searchZoekt } from '../zoekt-client.js';

const DEFAULT_SEARCH_LIMIT = 20;

export const searchCodeToolDefinition = {
  name: 'search_code',
  title: 'Search Code',
  description: 'Searches indexed code through the Zoekt HTTP service.',
  inputSchema: searchCodeInputSchema,
};

export async function runSearchCodeTool(
  zoektBaseUrl: string,
  input: SearchCodeInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const cappedLimit = input.limit ?? DEFAULT_SEARCH_LIMIT;
  const zoektResult = await searchZoekt(zoektBaseUrl, {
    query: input.query,
    repoName: input.repoName,
    pathPrefix: input.pathPrefix,
    limit: cappedLimit,
  });

  const formatted = formatSearchResults(
    input.query,
    zoektResult.appliedQuery,
    zoektResult.response,
    cappedLimit,
  );

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(formatted, null, 2),
      },
    ],
  };
}
