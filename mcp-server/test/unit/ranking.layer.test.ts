import { describe, expect, it } from 'vitest';

import { rankRelatedFileCandidates, rankSymbolCandidates } from '../../src/ranking/index.js';
import type { FileRelation, IndexedSymbol, SymbolFrequencyStats } from '../../src/symbol-index/types.js';

function createSymbol(overrides: Partial<IndexedSymbol> = {}): IndexedSymbol {
  return {
    symbolId: 'repo-a:src/a.ts:function:Widget:1',
    fileId: 'repo-a:src/a.ts',
    name: 'Widget',
    kind: 'function',
    repo: 'repo-a',
    filePath: 'src/a.ts',
    startLine: 1,
    endLine: 3,
    exported: false,
    declarationFingerprint: 'function:Widget:1',
    ...overrides,
  };
}

function createRelation(overrides: Partial<FileRelation> = {}): FileRelation {
  return {
    fileId: 'repo-a:src/a.ts',
    repo: 'repo-a',
    filePath: 'src/a.ts',
    classification: 'source',
    symbolIds: [],
    symbolNames: [],
    imports: [],
    exports: [],
    importTokens: [],
    ...overrides,
  };
}

function createStats(overrides: Partial<SymbolFrequencyStats> = {}): SymbolFrequencyStats {
  return {
    globalByName: {},
    globalByNameLower: {},
    byRepo: {},
    exportedByName: {},
    byKind: {},
    ...overrides,
  };
}

describe('ranking layer', () => {
  it('prefers exact and same-repo exported symbols with explainable reasons', () => {
    const candidates = [
      createSymbol({
        symbolId: 'repo-b:src/widget.ts:function:Widget:1',
        fileId: 'repo-b:src/widget.ts',
        repo: 'repo-b',
        filePath: 'src/widget.ts',
        exported: false,
      }),
      createSymbol({
        symbolId: 'repo-a:src/widget.ts:function:Widget:1',
        fileId: 'repo-a:src/widget.ts',
        filePath: 'src/widget.ts',
        exported: true,
      }),
    ];
    const ranked = rankSymbolCandidates(
      candidates,
      {
        queryName: 'Widget',
        kind: 'function',
        repo: 'repo-a',
      },
      {
        stats: createStats({
          globalByName: { Widget: 2 },
        }),
      },
    );

    expect(ranked[0].item.repo).toBe('repo-a');
    expect(ranked[0].reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: 'exact_name' }),
        expect.objectContaining({ signal: 'same_repo' }),
        expect.objectContaining({ signal: 'exported_symbol' }),
      ]),
    );
  });

  it('lets lower-frequency exact symbols beat very common loose candidates when other signals are similar', () => {
    const candidates = [
      createSymbol({
        name: 'Config',
        symbolId: 'repo-a:src/config.ts:function:Config:1',
        fileId: 'repo-a:src/config.ts',
        filePath: 'src/config.ts',
      }),
      createSymbol({
        name: 'config',
        symbolId: 'repo-a:src/config-lower.ts:function:config:1',
        fileId: 'repo-a:src/config-lower.ts',
        filePath: 'src/config-lower.ts',
      }),
    ];
    const ranked = rankSymbolCandidates(
      candidates,
      {
        queryName: 'config',
        kind: 'function',
      },
      {
        stats: createStats({
          globalByName: { Config: 8, config: 1 },
        }),
      },
    );

    expect(ranked[0].item.name).toBe('config');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('ranks directly graph-connected related files above weaker same-repo candidates', () => {
    const target = createRelation({
      fileId: 'repo-a:src/target.ts',
      filePath: 'src/target.ts',
      symbolNames: ['Target'],
      importTokens: ['./shared', 'Target'],
    });
    const ranked = rankRelatedFileCandidates(
      target,
      [
        {
          relation: createRelation({
            fileId: 'repo-a:src/direct.ts',
            filePath: 'src/direct.ts',
            symbolNames: ['Shared'],
            importTokens: ['./target'],
          }),
          graphSignals: {
            edgeTypes: ['file_imports_file'],
            connectionCount: 1,
          },
        },
        {
          relation: createRelation({
            fileId: 'repo-a:src/weak.ts',
            filePath: 'src/weak.ts',
            symbolNames: ['Target'],
            importTokens: [],
          }),
        },
      ],
      10,
    );

    expect(ranked[0]).toEqual(
      expect.objectContaining({
        filePath: 'src/direct.ts',
        reason: 'direct import',
      }),
    );
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});
