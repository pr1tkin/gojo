import type {
  SearchCodeResult,
  SearchMatch,
  ZoektFileMatch,
  ZoektLineMatch,
  ZoektMatchFragment,
  ZoektSearchResponse,
} from './types.js';

function formatFragments(fragments: ZoektMatchFragment[] | undefined): string {
  if (!fragments || fragments.length === 0) {
    return '';
  }

  return fragments
    .map((fragment) => `${fragment.Pre ?? ''}${fragment.Match ?? ''}${fragment.Post ?? ''}`)
    .join('')
    .trim();
}

function normalizeLineMatches(fileMatch: ZoektFileMatch): SearchMatch[] {
  const repository = fileMatch.Repo ?? 'unknown';
  const filePath = fileMatch.FileName ?? 'unknown';
  const lineMatches: ZoektLineMatch[] = fileMatch.Matches ?? [];

  return lineMatches
    .filter((lineMatch) => typeof lineMatch.LineNum === 'number')
    .map((lineMatch) => ({
      repository,
      filePath,
      lineNumber: lineMatch.LineNum as number,
      snippet: formatFragments(lineMatch.Fragments),
    }));
}

export function formatSearchResults(
  query: string,
  appliedQuery: string,
  response: ZoektSearchResponse,
  limit: number,
): SearchCodeResult {
  const fileMatches = response.result?.FileMatches ?? [];
  const normalizedMatches = fileMatches.flatMap(normalizeLineMatches);
  const matches = normalizedMatches.slice(0, limit);

  return {
    query,
    appliedQuery,
    matchCount: normalizedMatches.length,
    truncated: normalizedMatches.length > limit,
    matches,
  };
}

export function formatOpenFileResult(input: {
  filePath: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
}): string {
  const lines = input.content === '' ? [] : input.content.split('\n');
  const width = String(Math.max(input.endLine, 1)).length;
  const formattedLines = lines.map((line, index) => {
    const lineNumber = String(input.startLine + index).padStart(width, ' ');
    return `${lineNumber} | ${line}`;
  });

  return [
    `File: ${input.filePath}`,
    `Lines: ${input.startLine}-${input.endLine} of ${input.totalLines}`,
    '',
    ...formattedLines,
  ].join('\n');
}
