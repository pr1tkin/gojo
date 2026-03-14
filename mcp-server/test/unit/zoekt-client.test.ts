import { afterEach, describe, expect, it, vi } from 'vitest';

import { searchZoekt } from '../../src/zoekt-client.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('searchZoekt', () => {
  it('sends a request to the configured Zoekt base URL and returns parsed JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          result: {
            FileMatches: [],
          },
        }),
      ),
    });

    global.fetch = fetchMock as typeof fetch;

    const result = await searchZoekt('http://zoekt:6070', {
      query: 'hello world',
      repoName: 'test-repo',
      pathPrefix: 'src/components',
      limit: 5,
    });

    expect(result.appliedQuery).toBe(
      'hello world repo:^test-repo$ f:^src/components',
    );
    expect(result.response).toEqual({
      result: {
        FileMatches: [],
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = fetchMock.mock.calls[0][0];
    expect(requestedUrl).toBeInstanceOf(URL);
    expect((requestedUrl as URL).toString()).toBe(
      'http://zoekt:6070/search?q=hello+world+repo%3A%5Etest-repo%24+f%3A%5Esrc%2Fcomponents&num=5&format=json',
    );
  });

  it('escapes regex-sensitive characters in repoName and pathPrefix filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{}'),
    });

    global.fetch = fetchMock as typeof fetch;

    const result = await searchZoekt('http://zoekt:6070', {
      query: 'needle',
      repoName: 'repo.+(test)?',
      pathPrefix: 'src/[ui]',
      limit: 10,
    });

    expect(result.appliedQuery).toBe(
      'needle repo:^repo\\.\\+\\(test\\)\\?$ f:^src/\\[ui\\]',
    );
  });

  it('handles empty but valid result payloads cleanly', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{}'),
    });

    global.fetch = fetchMock as typeof fetch;

    await expect(
      searchZoekt('http://zoekt:6070', {
        query: 'missing',
        limit: 20,
      }),
    ).resolves.toEqual({
      appliedQuery: 'missing',
      response: {},
    });
  });

  it('fails clearly on non-OK HTTP responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn(),
    });

    global.fetch = fetchMock as typeof fetch;

    await expect(
      searchZoekt('http://zoekt:6070', {
        query: 'hello',
        limit: 20,
      }),
    ).rejects.toThrow(/status 503/i);
  });

  it('fails clearly when fetch rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

    global.fetch = fetchMock as typeof fetch;

    await expect(
      searchZoekt('http://zoekt:6070', {
        query: 'hello',
        limit: 20,
      }),
    ).rejects.toThrow(/zoekt request failed: connect econnrefused/i);
  });

  it('fails clearly on an empty response body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('   '),
    });

    global.fetch = fetchMock as typeof fetch;

    await expect(
      searchZoekt('http://zoekt:6070', {
        query: 'hello',
        limit: 20,
      }),
    ).rejects.toThrow(/empty response/i);
  });

  it('fails clearly on invalid JSON responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{not-valid-json'),
    });

    global.fetch = fetchMock as typeof fetch;

    await expect(
      searchZoekt('http://zoekt:6070', {
        query: 'hello',
        limit: 20,
      }),
    ).rejects.toThrow(/invalid json/i);
  });
});
