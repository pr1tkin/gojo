import { formatSearchResults } from '../formatters.js';
import { getCurrentSearchFreshness } from '../indexing/search-freshness.js';
import { stderrLogger } from '../logging.js';
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
  const searchFreshness = await getCurrentSearchFreshness(stderrLogger);
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
  const warnings =
    searchFreshness && searchFreshness.status !== 'ready'
      ? [
          `Zoekt search freshness is ${searchFreshness.status}; search results may not match the current MCP generation.`,
        ]
      : [];
  formatted.searchFreshness = searchFreshness
    ? {
        status: searchFreshness.status,
        requestedAt: searchFreshness.requestedAt,
        refreshedAt: searchFreshness.refreshedAt,
        details: searchFreshness.details,
        error: searchFreshness.error,
      }
    : undefined;
  formatted.warnings = warnings;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(formatted, null, 2),
      },
    ],
  };
}
