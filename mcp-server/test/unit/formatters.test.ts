import { describe, expect, it } from 'vitest';

import { formatOpenFileResult, formatSearchResults } from '../../src/formatters.js';

describe('formatSearchResults', () => {
  it('normalizes successful Zoekt results into repository, file, line, and snippet fields', () => {
    const result = formatSearchResults(
      'hello',
      'hello repo:^test-repo$',
      {
        result: {
          FileMatches: [
            {
              Repo: 'test-repo',
              FileName: 'src/hello.ts',
              Matches: [
                {
                  LineNum: 3,
                  Fragments: [
                    { Pre: 'export function ', Match: 'greet', Post: '() {' },
                  ],
                },
              ],
            },
          ],
        },
      },
      10,
    );

    expect(result).toEqual({
      query: 'hello',
      appliedQuery: 'hello repo:^test-repo$',
      matchCount: 1,
      truncated: false,
      matches: [
        {
          repository: 'test-repo',
          filePath: 'src/hello.ts',
          lineNumber: 3,
          snippet: 'export function greet() {',
        },
      ],
    });
  });

  it('handles empty Zoekt responses with a stable empty result shape', () => {
    const result = formatSearchResults('missing', 'missing', {}, 20);

    expect(result).toEqual({
      query: 'missing',
      appliedQuery: 'missing',
      matchCount: 0,
      truncated: false,
      matches: [],
    });
  });

  it('behaves defensively with incomplete response fields', () => {
    const result = formatSearchResults(
      'hello',
      'hello',
      {
        result: {
          FileMatches: [
            {
              Matches: [
                {
                  LineNum: 7,
                },
              ],
            },
          ],
        },
      },
      20,
    );

    expect(result.matches).toEqual([
      {
        repository: 'unknown',
        filePath: 'unknown',
        lineNumber: 7,
        snippet: '',
      },
    ]);
  });

  it('ignores malformed line matches without a numeric line number', () => {
    const result = formatSearchResults(
      'hello',
      'hello',
      {
        result: {
          FileMatches: [
            {
              Repo: 'test-repo',
              FileName: 'src/hello.ts',
              Matches: [
                {
                  Fragments: [{ Match: 'greet' }],
                },
                {
                  LineNum: 8,
                  Fragments: [{ Match: 'hello' }],
                },
              ],
            },
          ],
        },
      },
      20,
    );

    expect(result.matchCount).toBe(1);
    expect(result.matches).toEqual([
      {
        repository: 'test-repo',
        filePath: 'src/hello.ts',
        lineNumber: 8,
        snippet: 'hello',
      },
    ]);
  });

  it('truncates normalized results to the requested limit', () => {
    const result = formatSearchResults(
      'hello',
      'hello',
      {
        result: {
          FileMatches: [
            {
              Repo: 'test-repo',
              FileName: 'src/hello.ts',
              Matches: [
                { LineNum: 1, Fragments: [{ Match: 'one' }] },
                { LineNum: 2, Fragments: [{ Match: 'two' }] },
                { LineNum: 3, Fragments: [{ Match: 'three' }] },
              ],
            },
          ],
        },
      },
      2,
    );

    expect(result.matchCount).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.matches).toEqual([
      {
        repository: 'test-repo',
        filePath: 'src/hello.ts',
        lineNumber: 1,
        snippet: 'one',
      },
      {
        repository: 'test-repo',
        filePath: 'src/hello.ts',
        lineNumber: 2,
        snippet: 'two',
      },
    ]);
  });
});

describe('formatOpenFileResult', () => {
  it('formats deterministic plain-text output with file metadata and numbered lines', () => {
    const result = formatOpenFileResult({
      filePath: 'test-repo/src/hello.ts',
      startLine: 10,
      endLine: 12,
      totalLines: 20,
      content: 'line a\nline b\nline c',
    });

    expect(result).toBe(
      [
        'File: test-repo/src/hello.ts',
        'Lines: 10-12 of 20',
        '',
        '10 | line a',
        '11 | line b',
        '12 | line c',
      ].join('\n'),
    );
  });

  it('handles empty file content predictably', () => {
    const result = formatOpenFileResult({
      filePath: 'test-repo/src/empty.ts',
      startLine: 1,
      endLine: 0,
      totalLines: 0,
      content: '',
    });

    expect(result).toBe(
      [
        'File: test-repo/src/empty.ts',
        'Lines: 1-0 of 0',
        '',
      ].join('\n'),
    );
  });
});
