import { beforeEach, describe, expect, it, vi } from 'vitest';

const { assembleFileContextMock, assembleSymbolContextMock } = vi.hoisted(() => ({
  assembleFileContextMock: vi.fn(),
  assembleSymbolContextMock: vi.fn(),
}));

vi.mock('../../src/context/index.js', () => ({
  assembleFileContext: assembleFileContextMock,
  assembleSymbolContext: assembleSymbolContextMock,
}));

import { getFileExplorationContext, getSymbolExplorationContext } from '../../src/orchestrator/index.js';

describe('orchestrator services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds file exploration context from the assembled file context bundle', async () => {
    assembleFileContextMock.mockResolvedValue({
      fileId: 'repo-a:src/feature.ts',
      file: {
        nodeType: 'file',
        fileId: 'repo-a:src/feature.ts',
        repoId: 'repo-a',
        filePath: 'src/feature.ts',
        classification: 'source',
      },
      repo: 'repo-a',
      neighboringFiles: [
        {
          nodeType: 'file',
          fileId: 'repo-a:src/shared.ts',
          repoId: 'repo-a',
          filePath: 'src/shared.ts',
          classification: 'source',
        },
      ],
      relatedFiles: [
        {
          file: {
            nodeType: 'file',
            fileId: 'repo-a:src/shared.ts',
            repoId: 'repo-a',
            filePath: 'src/shared.ts',
            classification: 'source',
          },
          score: 12,
          reason: 'direct import',
          reasons: [{ signal: 'graph_connection', value: 9 }],
          via: ['file_imports_file'],
        },
      ],
      definedSymbols: [
        {
          nodeType: 'symbol',
          symbolId: 'repo-a:src/feature.ts:function:feature:1',
          fileId: 'repo-a:src/feature.ts',
          repoId: 'repo-a',
          filePath: 'src/feature.ts',
          name: 'feature',
          kind: 'function',
          exported: true,
          startLine: 1,
          endLine: 1,
        },
      ],
      exportedSymbols: [
        {
          nodeType: 'symbol',
          symbolId: 'repo-a:src/feature.ts:function:feature:1',
          fileId: 'repo-a:src/feature.ts',
          repoId: 'repo-a',
          filePath: 'src/feature.ts',
          name: 'feature',
          kind: 'function',
          exported: true,
          startLine: 1,
          endLine: 1,
        },
      ],
    });

    const result = await getFileExplorationContext('repo-a:src/feature.ts', { relatedLimit: 5 });

    expect(assembleFileContextMock).toHaveBeenCalledWith('repo-a:src/feature.ts', { relatedLimit: 5 });
    expect(result).toEqual(
      expect.objectContaining({
        fileId: 'repo-a:src/feature.ts',
        primaryFile: expect.objectContaining({ fileId: 'repo-a:src/feature.ts' }),
        repo: 'repo-a',
        relatedFiles: [
          expect.objectContaining({
            reason: 'direct import',
            file: expect.objectContaining({ fileId: 'repo-a:src/shared.ts' }),
          }),
        ],
        summary: {
          relatedFileCount: 1,
          neighboringFileCount: 1,
          definedSymbolCount: 1,
          exportedSymbolCount: 1,
        },
      }),
    );
  });

  it('builds symbol exploration context from the assembled symbol context bundle', async () => {
    assembleSymbolContextMock.mockResolvedValue({
      query: 'Widget',
      repo: 'repo-a',
      kind: 'function',
      rankedSymbols: [
        {
          item: {
            symbolId: 'repo-a:src/widget.ts:function:Widget:1',
            fileId: 'repo-a:src/widget.ts',
            name: 'Widget',
            kind: 'function',
            repo: 'repo-a',
            filePath: 'src/widget.ts',
            startLine: 1,
            endLine: 1,
            exported: true,
          },
          score: 20,
          reasons: [{ signal: 'exact_name', value: 10 }],
        },
      ],
      primarySymbol: {
        symbolId: 'repo-a:src/widget.ts:function:Widget:1',
        fileId: 'repo-a:src/widget.ts',
        name: 'Widget',
        kind: 'function',
        repo: 'repo-a',
        filePath: 'src/widget.ts',
        startLine: 1,
        endLine: 1,
        exported: true,
      },
      primaryFile: {
        nodeType: 'file',
        fileId: 'repo-a:src/widget.ts',
        repoId: 'repo-a',
        filePath: 'src/widget.ts',
        classification: 'source',
      },
      relatedFiles: [],
      exportedSymbols: [
        {
          nodeType: 'symbol',
          symbolId: 'repo-a:src/widget.ts:function:Widget:1',
          fileId: 'repo-a:src/widget.ts',
          repoId: 'repo-a',
          filePath: 'src/widget.ts',
          name: 'Widget',
          kind: 'function',
          exported: true,
          startLine: 1,
          endLine: 1,
        },
      ],
    });

    const result = await getSymbolExplorationContext('Widget', {
      repo: 'repo-a',
      kind: 'function',
      limit: 3,
      relatedLimit: 4,
    });

    expect(assembleSymbolContextMock).toHaveBeenCalledWith({
      name: 'Widget',
      repo: 'repo-a',
      kind: 'function',
      limit: 3,
      relatedLimit: 4,
    });
    expect(result).toEqual(
      expect.objectContaining({
        query: 'Widget',
        primarySymbol: expect.objectContaining({ name: 'Widget' }),
        primaryFile: expect.objectContaining({ fileId: 'repo-a:src/widget.ts' }),
        summary: {
          candidateCount: 1,
          relatedFileCount: 0,
          exportedSymbolCount: 1,
        },
      }),
    );
  });

  it('degrades safely for missing file exploration context', async () => {
    assembleFileContextMock.mockResolvedValue({
      fileId: 'missing-file',
      file: null,
      repo: null,
      neighboringFiles: [],
      relatedFiles: [],
      definedSymbols: [],
      exportedSymbols: [],
    });

    const result = await getFileExplorationContext('missing-file');

    expect(result).toEqual({
      fileId: 'missing-file',
      primaryFile: null,
      repo: null,
      relatedFiles: [],
      neighboringFiles: [],
      definedSymbols: [],
      exportedSymbols: [],
      summary: {
        relatedFileCount: 0,
        neighboringFileCount: 0,
        definedSymbolCount: 0,
        exportedSymbolCount: 0,
      },
      rawContext: {
        fileId: 'missing-file',
        file: null,
        repo: null,
        neighboringFiles: [],
        relatedFiles: [],
        definedSymbols: [],
        exportedSymbols: [],
      },
    });
  });

  it('degrades safely for unresolved symbol exploration context', async () => {
    assembleSymbolContextMock.mockResolvedValue({
      query: 'MissingSymbol',
      repo: undefined,
      kind: undefined,
      rankedSymbols: [],
      primarySymbol: null,
      primaryFile: null,
      relatedFiles: [],
      exportedSymbols: [],
    });

    const result = await getSymbolExplorationContext('MissingSymbol');

    expect(result).toEqual({
      query: 'MissingSymbol',
      repo: undefined,
      kind: undefined,
      primarySymbol: null,
      primaryFile: null,
      rankedSymbols: [],
      relatedFiles: [],
      exportedSymbols: [],
      summary: {
        candidateCount: 0,
        relatedFileCount: 0,
        exportedSymbolCount: 0,
      },
      rawContext: {
        query: 'MissingSymbol',
        repo: undefined,
        kind: undefined,
        rankedSymbols: [],
        primarySymbol: null,
        primaryFile: null,
        relatedFiles: [],
        exportedSymbols: [],
      },
    });
  });
});
