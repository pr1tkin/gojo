import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { searchZoektMock, formatSearchResultsMock, getCurrentSearchFreshnessMock } = vi.hoisted(() => ({
  searchZoektMock: vi.fn(),
  formatSearchResultsMock: vi.fn(),
  getCurrentSearchFreshnessMock: vi.fn(),
}));

vi.mock('../../src/zoekt-client.js', () => ({
  searchZoekt: searchZoektMock,
}));

vi.mock('../../src/formatters.js', () => ({
  formatSearchResults: formatSearchResultsMock,
}));

vi.mock('../../src/indexing/search-freshness.js', () => ({
  getCurrentSearchFreshness: getCurrentSearchFreshnessMock,
}));

import { runSearchCodeTool, searchCodeToolDefinition } from '../../src/tools/search-code.js';

describe('search_code tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSearchFreshnessMock.mockResolvedValue({
      status: 'ready',
      requestedAt: '2026-03-17T00:00:00.000Z',
      refreshedAt: '2026-03-17T00:01:00.000Z',
      aggregateFingerprint: 'fingerprint',
      repoFingerprints: [],
      coordinationMode: 'shared-marker',
      details: 'up to date',
    });
  });

  it('requires a non-empty query through the public schema', () => {
    expect(() => z.object(searchCodeToolDefinition.inputSchema).parse({ query: '' })).toThrow();

    const parsed = z.object(searchCodeToolDefinition.inputSchema).parse({
      query: 'hello',
      repoName: 'test-repo',
      pathPrefix: 'src/',
      limit: 5,
    });

    expect(parsed).toEqual({
      query: 'hello',
      repoName: 'test-repo',
      pathPrefix: 'src/',
      limit: 5,
    });
  });

  it('returns normalized search results from the mocked Zoekt and formatter layers', async () => {
    searchZoektMock.mockResolvedValue({
      appliedQuery: 'hello repo:^test-repo$',
      response: { result: { FileMatches: [] } },
    });
    formatSearchResultsMock.mockReturnValue({
      query: 'hello',
      appliedQuery: 'hello repo:^test-repo$',
      matchCount: 1,
      truncated: false,
      matches: [
        {
          repository: 'test-repo',
          filePath: 'src/hello.ts',
          lineNumber: 3,
          snippet: 'hello',
        },
      ],
    });

    const result = await runSearchCodeTool('http://zoekt:6070', {
      query: 'hello',
      repoName: 'test-repo',
      limit: 5,
    });

    expect(searchZoektMock).toHaveBeenCalledWith('http://zoekt:6070', {
      query: 'hello',
      repoName: 'test-repo',
      pathPrefix: undefined,
      limit: 5,
    });
    expect(formatSearchResultsMock).toHaveBeenCalledWith(
      'hello',
      'hello repo:^test-repo$',
      { result: { FileMatches: [] } },
      5,
    );
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              query: 'hello',
              appliedQuery: 'hello repo:^test-repo$',
              matchCount: 1,
              truncated: false,
              matches: [
                {
                  repository: 'test-repo',
                  filePath: 'src/hello.ts',
                  lineNumber: 3,
                  snippet: 'hello',
                },
              ],
              searchFreshness: {
                status: 'ready',
                requestedAt: '2026-03-17T00:00:00.000Z',
                refreshedAt: '2026-03-17T00:01:00.000Z',
                details: 'up to date',
                error: undefined,
              },
              warnings: [],
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it('uses the default search limit when no limit is provided', async () => {
    searchZoektMock.mockResolvedValue({
      appliedQuery: 'hello',
      response: {},
    });
    formatSearchResultsMock.mockReturnValue({
      query: 'hello',
      appliedQuery: 'hello',
      matchCount: 0,
      truncated: false,
      matches: [],
    });

    await runSearchCodeTool('http://zoekt:6070', {
      query: 'hello',
    });

    expect(searchZoektMock).toHaveBeenCalledWith('http://zoekt:6070', {
      query: 'hello',
      repoName: undefined,
      pathPrefix: undefined,
      limit: 20,
    });
  });

  it('returns predictable empty results when the formatter returns no matches', async () => {
    searchZoektMock.mockResolvedValue({
      appliedQuery: 'missing',
      response: {},
    });
    formatSearchResultsMock.mockReturnValue({
      query: 'missing',
      appliedQuery: 'missing',
      matchCount: 0,
      truncated: false,
      matches: [],
    });

    const result = await runSearchCodeTool('http://zoekt:6070', {
      query: 'missing',
    });

    expect(result.content[0].text).toContain('"matchCount": 0');
    expect(result.content[0].text).toContain('"matches": []');
  });

  it('adds a freshness warning when Zoekt is not known to be current', async () => {
    getCurrentSearchFreshnessMock.mockResolvedValue({
      status: 'stale',
      requestedAt: '2026-03-17T00:00:00.000Z',
      refreshedAt: '2026-03-17T00:01:00.000Z',
      aggregateFingerprint: 'fingerprint',
      repoFingerprints: [],
      coordinationMode: 'shared-marker',
      details: 'snapshot does not match current generation',
    });
    searchZoektMock.mockResolvedValue({
      appliedQuery: 'missing',
      response: {},
    });
    formatSearchResultsMock.mockReturnValue({
      query: 'missing',
      appliedQuery: 'missing',
      matchCount: 0,
      truncated: false,
      matches: [],
    });

    const result = await runSearchCodeTool('http://zoekt:6070', {
      query: 'missing',
    });

    expect(result.content[0].text).toContain('"status": "stale"');
    expect(result.content[0].text).toContain('may not match the current MCP generation');
  });

  it('propagates lower-level Zoekt failures predictably', async () => {
    searchZoektMock.mockRejectedValue(new Error('Zoekt request failed with status 503.'));

    await expect(
      runSearchCodeTool('http://zoekt:6070', { query: 'hello' }),
    ).rejects.toThrow(/status 503/i);
  });
});
