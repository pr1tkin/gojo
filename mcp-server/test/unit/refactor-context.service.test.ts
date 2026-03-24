import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getDefinedSymbolsMock,
  getExportedSymbolsMock,
  getImportedFilesMock,
  getImportingFilesMock,
  getFileNodeMock,
  getNeighboringFilesMock,
  getReexportedFilesMock,
  getReexportingFilesMock,
  getFileRelationMock,
  getFileRelationByIdMock,
  getFileExplorationContextMock,
  getSymbolExplorationContextMock,
} = vi.hoisted(() => ({
  getDefinedSymbolsMock: vi.fn(),
  getExportedSymbolsMock: vi.fn(),
  getImportedFilesMock: vi.fn(),
  getImportingFilesMock: vi.fn(),
  getFileNodeMock: vi.fn(),
  getNeighboringFilesMock: vi.fn(),
  getReexportedFilesMock: vi.fn(),
  getReexportingFilesMock: vi.fn(),
  getFileRelationMock: vi.fn(),
  getFileRelationByIdMock: vi.fn(),
  getFileExplorationContextMock: vi.fn(),
  getSymbolExplorationContextMock: vi.fn(),
}));

vi.mock('../../src/graph/query.js', () => ({
  getDefinedSymbols: getDefinedSymbolsMock,
  getExportedSymbols: getExportedSymbolsMock,
  getImportedFiles: getImportedFilesMock,
  getImportingFiles: getImportingFilesMock,
  getFileNode: getFileNodeMock,
  getNeighboringFiles: getNeighboringFilesMock,
  getReexportedFiles: getReexportedFilesMock,
  getReexportingFiles: getReexportingFilesMock,
}));

vi.mock('../../src/symbol-index/query.js', () => ({
  getFileRelation: getFileRelationMock,
  getFileRelationById: getFileRelationByIdMock,
}));

vi.mock('../../src/orchestrator/file-service.js', () => ({
  getFileExplorationContext: getFileExplorationContextMock,
}));

vi.mock('../../src/orchestrator/symbol-service.js', () => ({
  getSymbolExplorationContext: getSymbolExplorationContextMock,
}));

import {
  getCollectRefactorContext,
  getRefactorContextForFile,
  getRefactorContextForSymbol,
} from '../../src/orchestrator/refactor-service.js';

function fileNode(fileId: string, repoId: string, filePath: string) {
  return { nodeType: 'file' as const, fileId, repoId, filePath, classification: 'source' as const };
}

function symbolNode(symbolId: string, fileId: string, repoId: string, filePath: string, name: string) {
  return {
    nodeType: 'symbol' as const,
    symbolId,
    fileId,
    repoId,
    filePath,
    name,
    kind: 'function' as const,
    exported: true,
    startLine: 1,
    endLine: 10,
  };
}

const primaryRelation = {
  fileId: 'repo-a:src/components/Widget.tsx',
  repo: 'repo-a',
  filePath: 'src/components/Widget.tsx',
  classification: 'source' as const,
  symbolIds: ['widget-symbol'],
  symbolNames: ['Widget', 'WidgetProps'],
  imports: [],
  exports: [],
  importTokens: ['react', 'clsx'],
};

const bundleTestRelation = {
  fileId: 'repo-a:src/components/Widget.test.tsx',
  repo: 'repo-a',
  filePath: 'src/components/Widget.test.tsx',
  classification: 'source' as const,
  symbolIds: [],
  symbolNames: ['Widget test'],
  imports: [],
  exports: [],
  importTokens: ['vitest'],
};

const sameDirRelation = {
  fileId: 'repo-a:src/components/WidgetCard.tsx',
  repo: 'repo-a',
  filePath: 'src/components/WidgetCard.tsx',
  classification: 'source' as const,
  symbolIds: [],
  symbolNames: ['WidgetCard'],
  imports: [],
  exports: [],
  importTokens: ['react'],
};

describe('refactor context service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getFileRelationMock.mockImplementation(async (filePath: string) => {
      return [primaryRelation, bundleTestRelation, sameDirRelation].find((entry) => entry.filePath === filePath) ?? primaryRelation;
    });
    getFileRelationByIdMock.mockImplementation(async (fileId: string) => {
      return [primaryRelation, bundleTestRelation, sameDirRelation].find((entry) => entry.fileId === fileId) ?? null;
    });
    getFileNodeMock.mockImplementation(async (fileId: string) => {
      const relation = [primaryRelation, bundleTestRelation, sameDirRelation].find((entry) => entry.fileId === fileId);
      return relation ? fileNode(relation.fileId, relation.repo, relation.filePath) : null;
    });
    getExportedSymbolsMock.mockResolvedValue([
      symbolNode('widget-symbol', primaryRelation.fileId, 'repo-a', primaryRelation.filePath, 'Widget'),
    ]);
    getDefinedSymbolsMock.mockResolvedValue([
      symbolNode('widget-symbol', primaryRelation.fileId, 'repo-a', primaryRelation.filePath, 'Widget'),
      { ...symbolNode('widget-props', primaryRelation.fileId, 'repo-a', primaryRelation.filePath, 'WidgetProps'), kind: 'interface' as const },
    ]);
    getImportingFilesMock.mockResolvedValue([
      fileNode('repo-a:src/pages/dashboard.tsx', 'repo-a', 'src/pages/dashboard.tsx'),
      fileNode('repo-a:src/pages/home.tsx', 'repo-a', 'src/pages/home.tsx'),
    ]);
    getImportedFilesMock.mockResolvedValue([
      fileNode('repo-a:src/lib/api.ts', 'repo-a', 'src/lib/api.ts'),
    ]);
    getReexportingFilesMock.mockResolvedValue([
      fileNode('repo-a:src/components/index.ts', 'repo-a', 'src/components/index.ts'),
    ]);
    getReexportedFilesMock.mockResolvedValue([]);
    getNeighboringFilesMock.mockResolvedValue([
      fileNode('repo-a:src/components/index.ts', 'repo-a', 'src/components/index.ts'),
      fileNode('repo-a:src/lib/api.ts', 'repo-a', 'src/lib/api.ts'),
    ]);
    getFileExplorationContextMock.mockResolvedValue({
      fileId: primaryRelation.fileId,
      primaryFile: fileNode(primaryRelation.fileId, 'repo-a', primaryRelation.filePath),
      repo: 'repo-a',
      relatedFiles: [
        {
          file: fileNode('repo-a:src/components/WidgetCard.tsx', 'repo-a', 'src/components/WidgetCard.tsx'),
          score: 18,
          reason: 'direct import',
          reasons: [{ signal: 'graph_connection', value: 9 }],
          via: ['file_imports_file'],
        },
        {
          file: fileNode('repo-a:src/components/WidgetList.tsx', 'repo-a', 'src/components/WidgetList.tsx'),
          score: 12,
          reason: 'shared imports',
          reasons: [{ signal: 'shared_import_tokens', value: 4 }],
          via: ['file_imports_file'],
        },
      ],
      neighboringFiles: [],
      definedSymbols: [],
      exportedSymbols: [],
      summary: {
        relatedFileCount: 2,
        totalRelatedFileCount: 2,
        neighboringFileCount: 0,
        definedSymbolCount: 0,
        exportedSymbolCount: 0,
      },
      rawContext: {},
    });
    getSymbolExplorationContextMock.mockResolvedValue({
      query: 'Widget',
      repo: 'repo-a',
      kind: undefined,
      primarySymbol: {
        symbolId: 'widget-symbol',
        fileId: primaryRelation.fileId,
        name: 'Widget',
        kind: 'function',
        repo: 'repo-a',
        filePath: primaryRelation.filePath,
        startLine: 1,
        endLine: 10,
        exported: true,
      },
      primaryFile: fileNode(primaryRelation.fileId, 'repo-a', primaryRelation.filePath),
      rankedSymbols: [
        {
          item: {
            symbolId: 'widget-symbol',
            fileId: primaryRelation.fileId,
            name: 'Widget',
            kind: 'function',
            repo: 'repo-a',
            filePath: primaryRelation.filePath,
            startLine: 1,
            endLine: 10,
            exported: true,
          },
          score: 16,
          reasons: [{ signal: 'exact_name', value: 10 }],
        },
        {
          item: {
            symbolId: 'widget-2',
            fileId: 'repo-a:src/legacy/Widget.tsx',
            name: 'Widget',
            kind: 'function',
            repo: 'repo-a',
            filePath: 'src/legacy/Widget.tsx',
            startLine: 1,
            endLine: 10,
            exported: true,
          },
          score: 9,
          reasons: [{ signal: 'exact_name', value: 10 }],
        },
      ],
      relatedFiles: [],
      exportedSymbols: [],
      summary: {
        candidateCount: 2,
        totalCandidateCount: 2,
        relatedFileCount: 0,
        totalRelatedFileCount: 0,
        exportedSymbolCount: 0,
      },
      rawContext: {},
    });
  });

  it('builds component refactor context with direct impact files and nearby bundle files', async () => {
    const result = await getCollectRefactorContext({
      name: 'Widget',
      repo: 'repo-a',
      mode: 'component',
      limit: 5,
    });

    expect(getSymbolExplorationContextMock).toHaveBeenCalledWith('Widget', {
      repo: 'repo-a',
      limit: 5,
      relatedLimit: 5,
    });
    expect(result.primaryFile).toEqual(expect.objectContaining({ fileId: primaryRelation.fileId }));
    expect(result.importingFiles).toEqual([
      expect.objectContaining({ fileId: 'repo-a:src/pages/dashboard.tsx' }),
      expect.objectContaining({ fileId: 'repo-a:src/pages/home.tsx' }),
    ]);
    expect(result.relatedFiles[0]).toEqual(expect.objectContaining({ score: 18 }));
    expect(result.nearbyFiles).toEqual([
      expect.objectContaining({ category: 'bundle_family', file: expect.objectContaining({ fileId: bundleTestRelation.fileId }) }),
      expect.objectContaining({ category: 'same_directory', file: expect.objectContaining({ fileId: sameDirRelation.fileId }) }),
    ]);
    expect(result.summary).toEqual(expect.objectContaining({
      importingFileCount: 2,
      importedFileCount: 1,
      reexportingFileCount: 1,
      relatedFileCount: 2,
      nearbyFileCount: 2,
      symbolCandidateCount: 2,
      ambiguityDetected: true,
    }));
    expect(result.summary.notes).toEqual(expect.arrayContaining([
      'multiple symbol candidates matched; the strongest ranked candidate was selected',
      'direct importers are likely to be the highest-impact change surface',
      'bundle-family files were included to capture tests, stories, or style companions',
    ]));
  });

  it('builds file-based refactor context without symbol candidates', async () => {
    const result = await getRefactorContextForFile('src/components/Widget.tsx', {
      repo: 'repo-a',
      limit: 3,
    });

    expect(getFileRelationMock).toHaveBeenCalledWith('src/components/Widget.tsx', 'repo-a');
    expect(result.target).toEqual(expect.objectContaining({
      requestedMode: 'file',
      symbol: null,
      file: expect.objectContaining({ fileId: primaryRelation.fileId }),
    }));
    expect(result.symbolCandidates).toEqual([]);
  });

  it('degrades safely for unresolved symbol targets and preserves candidates', async () => {
    getSymbolExplorationContextMock.mockResolvedValueOnce({
      query: 'MissingWidget',
      repo: 'repo-a',
      kind: undefined,
      primarySymbol: null,
      primaryFile: null,
      rankedSymbols: [
        {
          item: {
            symbolId: 'candidate-only',
            fileId: 'repo-a:src/legacy/MissingWidget.tsx',
            name: 'MissingWidget',
            kind: 'function',
            repo: 'repo-a',
            filePath: 'src/legacy/MissingWidget.tsx',
            startLine: 1,
            endLine: 2,
            exported: false,
          },
          score: 4,
          reasons: [{ signal: 'case_insensitive_name', value: 6 }],
        },
      ],
      relatedFiles: [],
      exportedSymbols: [],
      summary: {
        candidateCount: 1,
        totalCandidateCount: 1,
        relatedFileCount: 0,
        totalRelatedFileCount: 0,
        exportedSymbolCount: 0,
      },
      rawContext: {},
    });

    const result = await getRefactorContextForSymbol('MissingWidget', { repo: 'repo-a' });

    expect(result.primaryFile).toBeNull();
    expect(result.symbolCandidates).toEqual([
      expect.objectContaining({ symbolId: 'candidate-only', score: 4 }),
    ]);
    expect(result.summary.notes).toContain('target could not be resolved from the current symbol index and graph');
  });
});
