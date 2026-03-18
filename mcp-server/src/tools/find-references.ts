import { formatSearchResults } from '../formatters.js';
import { getCurrentSearchFreshness } from '../indexing/search-freshness.js';
import { stderrLogger } from '../logging.js';
import { listFileRelations } from '../symbol-index/query.js';
import { rankFindReferenceResults } from '../ranking.js';
import { findReferencesInputSchema } from '../schemas.js';
import { findSymbol } from '../symbol-index/query.js';
import type {
  FindReferenceMatch,
  FindReferencesInput,
  SearchMatch,
} from '../types.js';
import { findReferencesWithTypeScriptFallback } from '../typescript/fallback.js';
import { searchZoekt } from '../zoekt-client.js';

const DEFAULT_REFERENCE_LIMIT = 20;
const REFERENCE_SEARCH_OVERSCAN_FACTOR = 5;
const MAX_REFERENCE_SEARCH_RESULTS = 100;

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWholeWord(snippet: string, symbol: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegexLiteral(symbol)}\\b`);
  return pattern.test(snippet);
}

function isLikelyReferenceSnippet(snippet: string, symbol: string): boolean {
  const trimmed = snippet.trim();

  if (!trimmed) {
    return false;
  }

  if (/^(\/\/|\/\*|\*|#)/.test(trimmed)) {
    return false;
  }

  if (!hasWholeWord(trimmed, symbol)) {
    return false;
  }

  return true;
}

function isDefinitionMatch(
  match: SearchMatch,
  definitions: Array<{ repo: string; filePath: string; startLine: number }>,
): boolean {
  return definitions.some(
    (definition) =>
      definition.repo === match.repository &&
      definition.filePath === match.filePath &&
      definition.startLine === match.lineNumber,
  );
}

function normalizeReferenceMatch(symbol: string, match: SearchMatch): FindReferenceMatch {
  return {
    symbol,
    repo: match.repository,
    filePath: match.filePath,
    line: match.lineNumber,
    snippet: match.snippet,
  };
}

export const findReferencesToolDefinition = {
  name: 'find_references',
  title: 'Find References',
  description: 'Find likely usages of a symbol across repositories.',
  inputSchema: findReferencesInputSchema,
};

async function findHeuristicReferences(
  zoektBaseUrl: string,
  input: FindReferencesInput,
): Promise<FindReferenceMatch[]> {
  const searchFreshness = await getCurrentSearchFreshness(stderrLogger);

  if (searchFreshness && searchFreshness.status !== 'ready') {
    stderrLogger.warn(
      `[search-freshness] heuristic references using Zoekt while status=${searchFreshness.status}`,
    );
  }

  const requestedLimit = input.limit ?? DEFAULT_REFERENCE_LIMIT;
  const definitions = await findSymbol(input.symbol, undefined, input.repo);

  if (definitions.length === 0) {
    return [];
  }

  const searchLimit = Math.min(
    requestedLimit * REFERENCE_SEARCH_OVERSCAN_FACTOR,
    MAX_REFERENCE_SEARCH_RESULTS,
  );

  const zoektResult = await searchZoekt(zoektBaseUrl, {
    query: input.symbol,
    repoName: input.repo,
    limit: searchLimit,
  });

  const formatted = formatSearchResults(
    input.symbol,
    zoektResult.appliedQuery,
    zoektResult.response,
    searchLimit,
  );
  const relations = await listFileRelations();
  const relationsByKey = Object.fromEntries(
    relations.map((relation) => [`${relation.repo}/${relation.filePath}`, relation]),
  );

  const references = formatted.matches
    .filter((match) => !isDefinitionMatch(match, definitions))
    .filter((match) => isLikelyReferenceSnippet(match.snippet, input.symbol))
    .map((match) => normalizeReferenceMatch(input.symbol, match));
  return rankFindReferenceResults(references, input.symbol, relationsByKey).slice(0, requestedLimit);
}

export async function runFindReferencesTool(
  reposRoot: string,
  zoektBaseUrl: string,
  input: FindReferencesInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const references = await findReferencesWithTypeScriptFallback(reposRoot, input, () =>
    findHeuristicReferences(zoektBaseUrl, input),
  );

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(references, null, 2),
      },
    ],
  };
}
