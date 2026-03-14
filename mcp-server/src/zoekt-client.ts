import type { ZoektSearchRequest, ZoektSearchResponse } from './types.js';

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildQuery(request: ZoektSearchRequest): string {
  const parts = [request.query.trim()];

  if (request.repoName) {
    parts.push(`repo:^${escapeRegexLiteral(request.repoName)}$`);
  }

  if (request.pathPrefix) {
    parts.push(`f:^${escapeRegexLiteral(request.pathPrefix)}`);
  }

  return parts.join(' ');
}

export async function searchZoekt(
  baseUrl: string,
  request: ZoektSearchRequest,
): Promise<{ appliedQuery: string; response: ZoektSearchResponse }> {
  const appliedQuery = buildQuery(request);
  const url = new URL('/search', baseUrl);

  url.searchParams.set('q', appliedQuery);
  url.searchParams.set('num', String(request.limit));
  url.searchParams.set('format', 'json');

  let response: Response;

  try {
    response = await fetch(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Zoekt request failed: ${message}`);
  }

  if (!response.ok) {
    throw new Error(`Zoekt request failed with status ${response.status}.`);
  }

  const body = await response.text();

  if (!body.trim()) {
    throw new Error('Zoekt returned an empty response.');
  }

  try {
    return {
      appliedQuery,
      response: JSON.parse(body) as ZoektSearchResponse,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Zoekt returned invalid JSON: ${message}`);
  }
}
