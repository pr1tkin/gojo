import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { saveCodeGraph } from '../../src/graph/store.js';
import type { CodeGraphSnapshot, FileNode, GraphEdge } from '../../src/graph/types.js';
import {
  createEmptyPatternIndex,
  createPatternCandidate,
  registerPatternCandidateInIndex,
  savePatternIndex,
  type PatternCandidate,
  type PatternFingerprint,
} from '../../src/patterns/index.js';
import {
  createPrecedentDiscoveryService,
} from '../../src/orchestrator/index.js';
import { saveSymbolIndex } from '../../src/symbol-index/store.js';
import type { FileRelation, IndexedSymbol, SymbolIndex } from '../../src/symbol-index/types.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-precedent-discovery-test-'));
}

function makePattern(
  overrides: Partial<PatternCandidate> & {
    kind: PatternCandidate['kind'];
    repoId: string;
    fileId: string;
    name: string;
    language: PatternCandidate['language'];
    startLine: number;
    endLine: number;
    fingerprint: PatternFingerprint;
  },
): PatternCandidate {
  return createPatternCandidate({
    kind: overrides.kind,
    repoId: overrides.repoId,
    fileId: overrides.fileId,
    ...(overrides.symbolId ? { symbolId: overrides.symbolId } : {}),
    name: overrides.name,
    language: overrides.language,
    startLine: overrides.startLine,
    endLine: overrides.endLine,
    signals: overrides.signals ?? [],
    fingerprint: overrides.fingerprint,
    supportingImports: overrides.supportingImports ?? [],
    relatedSymbolIds: overrides.relatedSymbolIds ?? [],
    confidence: overrides.confidence ?? 'high',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
  });
}

function buildPatternIndex(patterns: PatternCandidate[]) {
  return patterns.reduce(
    (index, pattern) => registerPatternCandidateInIndex(index, pattern),
    createEmptyPatternIndex(4, '2026-01-01T00:00:00.000Z'),
  );
}

function buildSymbolIndex(symbols: IndexedSymbol[]): SymbolIndex {
  const byName = Object.create(null) as SymbolIndex['byName'];
  const byNameLower = Object.create(null) as SymbolIndex['byNameLower'];
  const byFile = Object.create(null) as SymbolIndex['byFile'];
  const globalByName = Object.create(null) as SymbolIndex['stats']['globalByName'];
  const globalByNameLower = Object.create(null) as SymbolIndex['stats']['globalByNameLower'];
  const exportedByName = Object.create(null) as SymbolIndex['stats']['exportedByName'];
  const byRepo = Object.create(null) as SymbolIndex['stats']['byRepo'];
  const byKind = Object.create(null) as SymbolIndex['stats']['byKind'];

  for (const symbol of symbols) {
    if (!byName[symbol.name]) {
      byName[symbol.name] = [];
    }

    if (!byNameLower[symbol.name.toLowerCase()]) {
      byNameLower[symbol.name.toLowerCase()] = [];
    }

    byName[symbol.name].push(symbol);
    byNameLower[symbol.name.toLowerCase()].push(symbol);
    globalByName[symbol.name] = (globalByName[symbol.name] ?? 0) + 1;
    globalByNameLower[symbol.name.toLowerCase()] = (globalByNameLower[symbol.name.toLowerCase()] ?? 0) + 1;

    if (!byRepo[symbol.repo]) {
      byRepo[symbol.repo] = Object.create(null) as Record<string, number>;
    }

    if (!byKind[symbol.kind]) {
      byKind[symbol.kind] = Object.create(null) as Record<string, number>;
    }

    byRepo[symbol.repo][symbol.name] = (byRepo[symbol.repo][symbol.name] ?? 0) + 1;
    byKind[symbol.kind][symbol.name] = (byKind[symbol.kind][symbol.name] ?? 0) + 1;

    if (symbol.exported) {
      exportedByName[symbol.name] = (exportedByName[symbol.name] ?? 0) + 1;
    }

    if (!byFile[symbol.fileId]) {
      byFile[symbol.fileId] = {
        fileId: symbol.fileId,
        repo: symbol.repo,
        filePath: symbol.filePath,
        classification: 'source',
        symbolIds: [],
        symbolNames: [],
        imports: [],
        exports: [],
        importTokens: [],
      } satisfies FileRelation;
    }

    byFile[symbol.fileId].symbolIds.push(symbol.symbolId);
    byFile[symbol.fileId].symbolNames.push(symbol.name);

    if (symbol.exported) {
      byFile[symbol.fileId].exports.push({
        fileId: symbol.fileId,
        kind: 'named',
        exportedName: symbol.name,
        localName: symbol.name,
        symbolId: symbol.symbolId,
      });
    }
  }

  return {
    schemaVersion: 4,
    symbols,
    byName,
    byNameLower,
    byFile,
    stats: {
      globalByName,
      globalByNameLower,
      byRepo,
      exportedByName,
      byKind,
    },
  };
}

function buildGraphSnapshot(fileNodes: FileNode[], edges: GraphEdge[]): CodeGraphSnapshot {
  return {
    schemaVersion: 1,
    sourceSymbolIndexSchemaVersion: 4,
    generatedAt: '2026-01-01T00:00:00.000Z',
    nodes: {
      repos: {
        'repo-a': {
          nodeType: 'repo',
          repoId: 'repo-a',
          name: 'repo-a',
        },
      },
      files: Object.fromEntries(fileNodes.map((fileNode) => [fileNode.fileId, fileNode])),
      symbols: {},
    },
    edges,
  };
}

function makeFileNode(fileId: string, filePath: string): FileNode {
  return {
    nodeType: 'file',
    fileId,
    repoId: 'repo-a',
    filePath,
    classification: 'source',
  };
}

const tempDirectories: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  process.chdir(originalCwd);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('precedent discovery service', () => {
  it('ranks cross-file exported precedents ahead of same-file helpers', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const buttonSymbol: IndexedSymbol = {
      symbolId: 'repo-a:src/components/Button.tsx:function:Button:1',
      fileId: 'repo-a:src/components/Button.tsx',
      name: 'Button',
      kind: 'function',
      repo: 'repo-a',
      filePath: 'src/components/Button.tsx',
      startLine: 1,
      endLine: 20,
      exported: true,
    };
    const buttonBaseSymbol: IndexedSymbol = {
      symbolId: 'repo-a:src/components/Button.tsx:function:ButtonBase:1',
      fileId: 'repo-a:src/components/Button.tsx',
      name: 'ButtonBase',
      kind: 'function',
      repo: 'repo-a',
      filePath: 'src/components/Button.tsx',
      startLine: 22,
      endLine: 34,
      exported: false,
    };
    const iconButtonSymbol: IndexedSymbol = {
      symbolId: 'repo-a:src/components/IconButton.tsx:function:IconButton:1',
      fileId: 'repo-a:src/components/IconButton.tsx',
      name: 'IconButton',
      kind: 'function',
      repo: 'repo-a',
      filePath: 'src/components/IconButton.tsx',
      startLine: 1,
      endLine: 20,
      exported: true,
    };
    const primaryButtonSymbol: IndexedSymbol = {
      symbolId: 'repo-a:src/components/PrimaryButton.tsx:function:PrimaryButton:1',
      fileId: 'repo-a:src/components/PrimaryButton.tsx',
      name: 'PrimaryButton',
      kind: 'function',
      repo: 'repo-a',
      filePath: 'src/components/PrimaryButton.tsx',
      startLine: 1,
      endLine: 20,
      exported: true,
    };

    await saveSymbolIndex(
      buildSymbolIndex([buttonSymbol, buttonBaseSymbol, iconButtonSymbol, primaryButtonSymbol]),
    );

    const buttonPattern = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: buttonSymbol.fileId,
      symbolId: buttonSymbol.symbolId,
      name: 'Button',
      language: 'tsx',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react', './button.css'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const buttonBasePattern = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: buttonBaseSymbol.fileId,
      symbolId: buttonBaseSymbol.symbolId,
      name: 'ButtonBase',
      language: 'tsx',
      startLine: 22,
      endLine: 34,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component'],
        importSet: ['react', './button.css'],
        exportShape: 'none',
        symbolRole: 'component',
        uiSignals: ['jsx-return'],
      },
    });
    const iconButtonPattern = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: iconButtonSymbol.fileId,
      symbolId: iconButtonSymbol.symbolId,
      name: 'IconButton',
      language: 'tsx',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react', './button.css'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const primaryButtonPattern = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: primaryButtonSymbol.fileId,
      symbolId: primaryButtonSymbol.symbolId,
      name: 'PrimaryButton',
      language: 'tsx',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react', './button.css'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });

    await savePatternIndex(
      buildPatternIndex([buttonPattern, buttonBasePattern, iconButtonPattern, primaryButtonPattern]),
    );

    await saveCodeGraph(
      buildGraphSnapshot(
        [
          makeFileNode(buttonSymbol.fileId, buttonSymbol.filePath),
          makeFileNode(iconButtonSymbol.fileId, iconButtonSymbol.filePath),
          makeFileNode(primaryButtonSymbol.fileId, primaryButtonSymbol.filePath),
          makeFileNode('repo-a:src/pages/HomePage.tsx', 'src/pages/HomePage.tsx'),
          makeFileNode('repo-a:src/pages/AdminPage.tsx', 'src/pages/AdminPage.tsx'),
        ],
        [
          {
            edgeId: 'edge-1',
            type: 'file_imports_file',
            fromId: 'repo-a:src/pages/HomePage.tsx',
            toId: iconButtonSymbol.fileId,
          },
          {
            edgeId: 'edge-2',
            type: 'file_imports_file',
            fromId: 'repo-a:src/pages/AdminPage.tsx',
            toId: iconButtonSymbol.fileId,
          },
        ],
      ),
    );

    const service = await createPrecedentDiscoveryService();
    const result = service.findPrecedentsForSymbol(buttonSymbol.symbolId, 3);

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        symbolId: iconButtonSymbol.symbolId,
        symbolName: 'IconButton',
      }),
    );
    expect(result.candidates[0].reasonSignals).toEqual(
      expect.arrayContaining(['cross-file', 'exported-symbol', 'graph-importers', 'name-family']),
    );
    expect(result.candidates[1]).toEqual(
      expect.objectContaining({
        symbolId: primaryButtonSymbol.symbolId,
        symbolName: 'PrimaryButton',
      }),
    );
    expect(result.candidates[2]).toEqual(
      expect.objectContaining({
        symbolId: buttonBaseSymbol.symbolId,
        symbolName: 'ButtonBase',
      }),
    );
    expect(result.summary).toContain('Button');
    expect(result.summary).toContain('IconButton');
  });

  it('deduplicates precedent candidates across multiple target patterns for one symbol', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const buttonSymbol: IndexedSymbol = {
      symbolId: 'repo-a:src/components/Button.tsx:function:Button:1',
      fileId: 'repo-a:src/components/Button.tsx',
      name: 'Button',
      kind: 'function',
      repo: 'repo-a',
      filePath: 'src/components/Button.tsx',
      startLine: 1,
      endLine: 20,
      exported: true,
    };
    const iconButtonSymbol: IndexedSymbol = {
      symbolId: 'repo-a:src/components/IconButton.tsx:function:IconButton:1',
      fileId: 'repo-a:src/components/IconButton.tsx',
      name: 'IconButton',
      kind: 'function',
      repo: 'repo-a',
      filePath: 'src/components/IconButton.tsx',
      startLine: 1,
      endLine: 20,
      exported: true,
    };

    await saveSymbolIndex(buildSymbolIndex([buttonSymbol, iconButtonSymbol]));

    const buttonComponent = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: buttonSymbol.fileId,
      symbolId: buttonSymbol.symbolId,
      name: 'Button',
      language: 'tsx',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const buttonConditional = makePattern({
      kind: 'conditional-rendering',
      repoId: 'repo-a',
      fileId: buttonSymbol.fileId,
      symbolId: buttonSymbol.symbolId,
      name: 'Button',
      language: 'tsx',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'conditional-rendering',
        structuralSignals: ['conditional-render'],
        importSet: ['react'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['conditional-render'],
      },
    });
    const iconButtonComponent = makePattern({
      kind: 'component',
      repoId: 'repo-a',
      fileId: iconButtonSymbol.fileId,
      symbolId: iconButtonSymbol.symbolId,
      name: 'IconButton',
      language: 'tsx',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'component',
        structuralSignals: ['jsx-return', 'react-function-component', 'uses-hooks'],
        importSet: ['react'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['jsx-return', 'uses-hooks'],
      },
    });
    const iconButtonConditional = makePattern({
      kind: 'conditional-rendering',
      repoId: 'repo-a',
      fileId: iconButtonSymbol.fileId,
      symbolId: iconButtonSymbol.symbolId,
      name: 'IconButton',
      language: 'tsx',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'conditional-rendering',
        structuralSignals: ['conditional-render'],
        importSet: ['react'],
        exportShape: 'default',
        symbolRole: 'component',
        uiSignals: ['conditional-render'],
      },
    });

    await savePatternIndex(
      buildPatternIndex([
        buttonComponent,
        buttonConditional,
        iconButtonComponent,
        iconButtonConditional,
      ]),
    );
    await saveCodeGraph(buildGraphSnapshot([makeFileNode(buttonSymbol.fileId, buttonSymbol.filePath)], []));

    const service = await createPrecedentDiscoveryService();
    const result = service.findPrecedentsForSymbol(buttonSymbol.symbolId, 5);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        symbolId: iconButtonSymbol.symbolId,
        symbolName: 'IconButton',
      }),
    );
  });

  it('supports pattern and file entrypoints with deterministic ordering', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const useGetJobs: IndexedSymbol = {
      symbolId: 'repo-a:src/hooks/useGetJobs.ts:function:useGetJobs:1',
      fileId: 'repo-a:src/hooks/useGetJobs.ts',
      name: 'useGetJobs',
      kind: 'function',
      repo: 'repo-a',
      filePath: 'src/hooks/useGetJobs.ts',
      startLine: 1,
      endLine: 20,
      exported: true,
    };
    const useGetNotifications: IndexedSymbol = {
      symbolId: 'repo-a:src/hooks/useGetNotifications.ts:function:useGetNotifications:1',
      fileId: 'repo-a:src/hooks/useGetNotifications.ts',
      name: 'useGetNotifications',
      kind: 'function',
      repo: 'repo-a',
      filePath: 'src/hooks/useGetNotifications.ts',
      startLine: 1,
      endLine: 20,
      exported: true,
    };
    const useScreenState: IndexedSymbol = {
      symbolId: 'repo-a:src/hooks/useScreenState.ts:function:useScreenState:1',
      fileId: 'repo-a:src/hooks/useScreenState.ts',
      name: 'useScreenState',
      kind: 'function',
      repo: 'repo-a',
      filePath: 'src/hooks/useScreenState.ts',
      startLine: 1,
      endLine: 20,
      exported: true,
    };

    await saveSymbolIndex(buildSymbolIndex([useGetJobs, useGetNotifications, useScreenState]));

    const jobsPattern = makePattern({
      kind: 'hook',
      repoId: 'repo-a',
      fileId: useGetJobs.fileId,
      symbolId: useGetJobs.symbolId,
      name: 'useGetJobs',
      language: 'ts',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'hook',
        structuralSignals: ['custom-hook', 'uses-hooks'],
        importSet: ['@tanstack/react-query', '@/lib/http'],
        exportShape: 'named',
        symbolRole: 'hook',
        uiSignals: ['uses-hooks'],
        responsibilitySignals: ['query-hook'],
      },
    });
    const notificationsPattern = makePattern({
      kind: 'hook',
      repoId: 'repo-a',
      fileId: useGetNotifications.fileId,
      symbolId: useGetNotifications.symbolId,
      name: 'useGetNotifications',
      language: 'ts',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'hook',
        structuralSignals: ['custom-hook', 'uses-hooks'],
        importSet: ['@tanstack/react-query', '@/lib/http'],
        exportShape: 'named',
        symbolRole: 'hook',
        uiSignals: ['uses-hooks'],
        responsibilitySignals: ['query-hook'],
      },
    });
    const screenStatePattern = makePattern({
      kind: 'hook',
      repoId: 'repo-a',
      fileId: useScreenState.fileId,
      symbolId: useScreenState.symbolId,
      name: 'useScreenState',
      language: 'ts',
      startLine: 1,
      endLine: 20,
      fingerprint: {
        patternKind: 'hook',
        structuralSignals: ['custom-hook', 'uses-hooks'],
        importSet: ['react'],
        exportShape: 'named',
        symbolRole: 'hook',
        uiSignals: ['uses-hooks'],
        responsibilitySignals: ['store-hook'],
      },
    });

    await savePatternIndex(buildPatternIndex([jobsPattern, notificationsPattern, screenStatePattern]));
    await saveCodeGraph(
      buildGraphSnapshot(
        [
          makeFileNode(useGetJobs.fileId, useGetJobs.filePath),
          makeFileNode(useGetNotifications.fileId, useGetNotifications.filePath),
          makeFileNode(useScreenState.fileId, useScreenState.filePath),
        ],
        [],
      ),
    );

    const service = await createPrecedentDiscoveryService();
    const byPattern = service.findPrecedentsForPattern(jobsPattern.patternId, 2);
    const byFile = service.findPrecedentsForFile(useGetJobs.fileId, 2);
    const debug = service.formatPrecedentDebug(byPattern);

    expect(byPattern.candidates[0]).toEqual(
      expect.objectContaining({
        symbolId: useGetNotifications.symbolId,
        symbolName: 'useGetNotifications',
      }),
    );
    expect(byPattern.candidates[0].reasonSignals).toContain('responsibility-match');
    expect(byFile.candidates.map((candidate) => candidate.symbolId)).toEqual(
      byPattern.candidates.map((candidate) => candidate.symbolId),
    );
    expect(debug).toContain('Precedent search for useGetJobs:');
    expect(debug).toContain('useGetNotifications');
  });
});
