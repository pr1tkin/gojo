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

  it('ranks canonical service definitions above same-name hook wrappers', () => {
    const canonical = createSymbol({
      symbolId: 'repo-a:lib/services/automationService.ts:function:createAutomation:1',
      fileId: 'repo-a:lib/services/automationService.ts',
      filePath: 'lib/services/automationService.ts',
      name: 'createAutomation',
      startLine: 10,
      endLine: 28,
      exported: true,
    });
    const wrapper = createSymbol({
      symbolId: 'repo-a:lib/hooks/useAutomationsMutation.ts:function:createAutomation:1',
      fileId: 'repo-a:lib/hooks/useAutomationsMutation.ts',
      filePath: 'lib/hooks/useAutomationsMutation.ts',
      name: 'createAutomation',
      startLine: 4,
      endLine: 6,
      exported: true,
    });

    const ranked = rankSymbolCandidates(
      [wrapper, canonical],
      {
        queryName: 'createAutomation',
        kind: 'function',
        repo: 'repo-a',
      },
      {
        stats: createStats({
          globalByName: { createAutomation: 2 },
        }),
        relationsByFile: {
          [canonical.fileId]: createRelation({
            fileId: canonical.fileId,
            repo: canonical.repo,
            filePath: canonical.filePath,
            symbolIds: [canonical.symbolId],
            symbolNames: [canonical.name],
            exports: [{ fileId: canonical.fileId, kind: 'named', exportedName: canonical.name, localName: canonical.name, symbolId: canonical.symbolId }],
          }),
          [wrapper.fileId]: createRelation({
            fileId: wrapper.fileId,
            repo: wrapper.repo,
            filePath: wrapper.filePath,
            symbolIds: [wrapper.symbolId],
            symbolNames: [wrapper.name],
            imports: [{
              fileId: wrapper.fileId,
              source: '../services/automationService',
              bindings: [{ importedName: 'createAutomation', localName: 'createAutomation', kind: 'named', isTypeOnly: false }],
              resolvedKind: 'local-file',
              resolvedTargetFileId: canonical.fileId,
            }],
            exports: [{ fileId: wrapper.fileId, kind: 'named', exportedName: wrapper.name, localName: wrapper.name, symbolId: wrapper.symbolId }],
          }),
        },
        fileFanInById: {
          [canonical.fileId]: 3,
          [wrapper.fileId]: 0,
        },
      },
    );

    expect(ranked[0].item.filePath).toBe(canonical.filePath);
    expect(ranked[0].reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ signal: 'canonical_definition' }),
      expect.objectContaining({ signal: 'service_path' }),
      expect.objectContaining({ signal: 'fan_in_bonus' }),
    ]));
    expect(ranked[1].reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ signal: 'hook_detected' }),
    ]));
  });

  it('demotes re-export barrels below concrete definitions with the same name', () => {
    const definition = createSymbol({
      symbolId: 'repo-a:src/services/contracts.ts:function:getAutomations:1',
      fileId: 'repo-a:src/services/contracts.ts',
      filePath: 'src/services/contracts.ts',
      name: 'getAutomations',
      startLine: 5,
      endLine: 16,
      exported: true,
    });
    const barrel = createSymbol({
      symbolId: 'repo-a:src/index.ts:function:getAutomations:1',
      fileId: 'repo-a:src/index.ts',
      filePath: 'src/index.ts',
      name: 'getAutomations',
      startLine: 1,
      endLine: 1,
      exported: true,
    });

    const ranked = rankSymbolCandidates(
      [barrel, definition],
      {
        queryName: 'getAutomations',
        kind: 'function',
        repo: 'repo-a',
      },
      {
        stats: createStats({
          globalByName: { getAutomations: 2 },
        }),
        relationsByFile: {
          [definition.fileId]: createRelation({
            fileId: definition.fileId,
            repo: definition.repo,
            filePath: definition.filePath,
            symbolIds: [definition.symbolId],
            symbolNames: [definition.name],
            exports: [{ fileId: definition.fileId, kind: 'named', exportedName: definition.name, localName: definition.name, symbolId: definition.symbolId }],
          }),
          [barrel.fileId]: createRelation({
            fileId: barrel.fileId,
            repo: barrel.repo,
            filePath: barrel.filePath,
            symbolIds: [],
            symbolNames: [barrel.name],
            exports: [{ fileId: barrel.fileId, kind: 'reexport-named', exportedName: barrel.name, localName: barrel.name, source: './services/contracts' }],
          }),
        },
      },
    );

    expect(ranked[0].item.filePath).toBe(definition.filePath);
    expect(ranked[1].reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ signal: 'reexport_penalty' }),
    ]));
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

  it('ranks strong reference edges above medium and weak graph edges', () => {
    const target = createRelation({
      fileId: 'repo-a:lib/services/contract.ts',
      filePath: 'lib/services/contract.ts',
    });
    const ranked = rankRelatedFileCandidates(
      target,
      [
        {
          relation: createRelation({
            fileId: 'repo-a:app/api/contracts/[id]/route.ts',
            filePath: 'app/api/contracts/[id]/route.ts',
          }),
          graphSignals: {
            edgeTypes: ['incoming_file_imports_file', 'symbol_reference', 'call_reference'],
            connectionCount: 3,
          },
        },
        {
          relation: createRelation({
            fileId: 'repo-a:app/api/contracts/route.ts',
            filePath: 'app/api/contracts/route.ts',
          }),
          graphSignals: {
            edgeTypes: ['incoming_file_imports_file'],
            connectionCount: 1,
          },
        },
        {
          relation: createRelation({
            fileId: 'repo-a:lib/db/model/Contract.ts',
            filePath: 'lib/db/model/Contract.ts',
          }),
          graphSignals: {
            edgeTypes: ['outgoing_file_imports_file'],
            connectionCount: 1,
          },
        },
      ],
      10,
    );

    expect(ranked.map((entry) => entry.filePath)).toEqual([
      'app/api/contracts/[id]/route.ts',
      'app/api/contracts/route.ts',
      'lib/db/model/Contract.ts',
    ]);
  });

  it('down-ranks story and test files below non-noise files with similar graph evidence', () => {
    const target = createRelation({
      fileId: 'repo-a:src/components/Button.tsx',
      filePath: 'src/components/Button.tsx',
    });
    const ranked = rankRelatedFileCandidates(
      target,
      [
        {
          relation: createRelation({
            fileId: 'repo-a:src/components/ButtonConsumer.tsx',
            filePath: 'src/components/ButtonConsumer.tsx',
          }),
          graphSignals: {
            edgeTypes: ['outgoing_file_imports_file'],
            connectionCount: 1,
          },
        },
        {
          relation: createRelation({
            fileId: 'repo-a:src/components/Button.stories.tsx',
            filePath: 'src/components/Button.stories.tsx',
          }),
          graphSignals: {
            edgeTypes: ['outgoing_file_imports_file'],
            connectionCount: 1,
          },
        },
      ],
      10,
    );

    expect(ranked[0].filePath).toBe('src/components/ButtonConsumer.tsx');
    expect(ranked.find((entry) => entry.filePath === 'src/components/Button.stories.tsx')).toBeUndefined();
  });
});
