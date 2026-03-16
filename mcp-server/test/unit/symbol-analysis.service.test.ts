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
  getFileExplorationContextMock,
  getRefactorContextForFileMock,
  loadRequiredSymbolIndexMock,
  rankSymbolCandidatesMock,
} = vi.hoisted(() => ({
  getDefinedSymbolsMock: vi.fn(),
  getExportedSymbolsMock: vi.fn(),
  getImportedFilesMock: vi.fn(),
  getImportingFilesMock: vi.fn(),
  getFileNodeMock: vi.fn(),
  getNeighboringFilesMock: vi.fn(),
  getReexportedFilesMock: vi.fn(),
  getReexportingFilesMock: vi.fn(),
  getFileExplorationContextMock: vi.fn(),
  getRefactorContextForFileMock: vi.fn(),
  loadRequiredSymbolIndexMock: vi.fn(),
  rankSymbolCandidatesMock: vi.fn(),
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

vi.mock('../../src/orchestrator/file-service.js', () => ({
  getFileExplorationContext: getFileExplorationContextMock,
}));

vi.mock('../../src/orchestrator/refactor-service.js', () => ({
  getRefactorContextForFile: getRefactorContextForFileMock,
}));

vi.mock('../../src/symbol-index/store.js', () => ({
  loadRequiredSymbolIndex: loadRequiredSymbolIndexMock,
}));

vi.mock('../../src/ranking/index.js', () => ({
  rankSymbolCandidates: rankSymbolCandidatesMock,
}));

import { getAnalyzeSymbolContext } from '../../src/orchestrator/symbol-analysis-service.js';

function fileNode(fileId: string, repoId: string, filePath: string) {
  return { nodeType: 'file' as const, fileId, repoId, filePath, classification: 'source' as const };
}

function symbolNode(symbolId: string, fileId: string, repoId: string, filePath: string, name: string, kind: any, exported = true, startLine = 1, endLine = 10) {
  return { nodeType: 'symbol' as const, symbolId, fileId, repoId, filePath, name, kind, exported, startLine, endLine };
}

describe('symbol analysis service', () => {
  const primarySymbol = {
    symbolId: 'repo-a:components/ui/Button.tsx:function:Button:1',
    fileId: 'repo-a:components/ui/Button.tsx',
    name: 'Button',
    kind: 'function' as const,
    repo: 'repo-a',
    filePath: 'components/ui/Button.tsx',
    startLine: 40,
    endLine: 64,
    exported: true,
  };
  const secondaryCandidate = {
    symbolId: 'repo-a:components/forms/Button.tsx:function:Button:1',
    fileId: 'repo-a:components/forms/Button.tsx',
    name: 'Button',
    kind: 'function' as const,
    repo: 'repo-a',
    filePath: 'components/forms/Button.tsx',
    startLine: 12,
    endLine: 20,
    exported: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    loadRequiredSymbolIndexMock.mockResolvedValue({
      symbols: [primarySymbol, secondaryCandidate],
      stats: { globalByName: { Button: 2 } },
    });
    rankSymbolCandidatesMock.mockImplementation((candidates: any[]) =>
      candidates.map((candidate, index) => ({
        item: candidate,
        score: index === 0 ? 16 : 9,
        reasons: [{ signal: 'exact_name', value: 10 }],
      })),
    );
    getFileNodeMock.mockImplementation(async (fileId: string) => {
      if (fileId === primarySymbol.fileId) {
        return fileNode(primarySymbol.fileId, 'repo-a', primarySymbol.filePath);
      }

      if (fileId === secondaryCandidate.fileId) {
        return fileNode(secondaryCandidate.fileId, 'repo-a', secondaryCandidate.filePath);
      }

      return null;
    });
    getDefinedSymbolsMock.mockResolvedValue([
      symbolNode(primarySymbol.symbolId, primarySymbol.fileId, 'repo-a', primarySymbol.filePath, 'Button', 'function', true, 40, 64),
      symbolNode('button-props', primarySymbol.fileId, 'repo-a', primarySymbol.filePath, 'ButtonProps', 'interface', false, 28, 38),
      symbolNode('link-button', primarySymbol.fileId, 'repo-a', primarySymbol.filePath, 'LinkButton', 'function', true, 70, 90),
    ]);
    getExportedSymbolsMock.mockResolvedValue([
      symbolNode(primarySymbol.symbolId, primarySymbol.fileId, 'repo-a', primarySymbol.filePath, 'Button', 'function', true, 40, 64),
      symbolNode('link-button', primarySymbol.fileId, 'repo-a', primarySymbol.filePath, 'LinkButton', 'function', true, 70, 90),
    ]);
    getImportingFilesMock.mockResolvedValue([
      fileNode('repo-a:app/page.tsx', 'repo-a', 'app/page.tsx'),
      fileNode('repo-a:app/forms/page.tsx', 'repo-a', 'app/forms/page.tsx'),
    ]);
    getImportedFilesMock.mockResolvedValue([
      fileNode('repo-a:lib/utils.ts', 'repo-a', 'lib/utils.ts'),
    ]);
    getReexportingFilesMock.mockResolvedValue([
      fileNode('repo-a:components/ui/index.ts', 'repo-a', 'components/ui/index.ts'),
    ]);
    getReexportedFilesMock.mockResolvedValue([]);
    getNeighboringFilesMock.mockResolvedValue([
      fileNode('repo-a:components/ui/index.ts', 'repo-a', 'components/ui/index.ts'),
      fileNode('repo-a:lib/utils.ts', 'repo-a', 'lib/utils.ts'),
    ]);
    getFileExplorationContextMock.mockResolvedValue({
      fileId: primarySymbol.fileId,
      primaryFile: fileNode(primarySymbol.fileId, 'repo-a', primarySymbol.filePath),
      repo: 'repo-a',
      relatedFiles: [
        {
          file: fileNode('repo-a:components/ui/DownloadButton.tsx', 'repo-a', 'components/ui/DownloadButton.tsx'),
          score: 25,
          reason: 'direct import',
          reasons: [{ signal: 'graph_connection', value: 9 }],
          via: ['file_imports_file'],
        },
      ],
      neighboringFiles: [],
      definedSymbols: [],
      exportedSymbols: [],
      summary: {
        relatedFileCount: 1,
        neighboringFileCount: 0,
        definedSymbolCount: 0,
        exportedSymbolCount: 0,
      },
      rawContext: {},
    });
    getRefactorContextForFileMock.mockResolvedValue({
      nearbyFiles: [
        {
          file: fileNode('repo-a:components/ui/Badge.tsx', 'repo-a', 'components/ui/Badge.tsx'),
          category: 'same_directory',
        },
      ],
    });
  });

  it('analyzes an exported shared symbol with grounded role summary and nearby symbols', async () => {
    const result = await getAnalyzeSymbolContext({
      name: 'Button',
      repo: 'repo-a',
      limit: 5,
    });

    expect(result.primarySymbol).toEqual(expect.objectContaining({ symbolId: primarySymbol.symbolId }));
    expect(result.roleSummary).toBe('exported shared UI function in Button with 2 direct importers');
    expect(result.importingFiles).toEqual([
      expect.objectContaining({ filePath: 'app/forms/page.tsx' }),
      expect.objectContaining({ filePath: 'app/page.tsx' }),
    ]);
    expect(result.siblingSymbols).toEqual([
      expect.objectContaining({ name: 'ButtonProps' }),
      expect.objectContaining({ name: 'LinkButton' }),
    ]);
    expect(result.nearbySymbols[0]).toEqual(expect.objectContaining({ name: 'ButtonProps' }));
    expect(result.usageSummary).toEqual(expect.objectContaining({
      importerCount: 2,
      importCount: 1,
      relatedFileCount: 1,
      exportedStatus: 'exported',
      ambiguityDetected: true,
    }));
    expect(result.usageSummary.notes).toEqual(expect.arrayContaining([
      'multiple symbol candidates matched; the strongest ranked candidate was selected',
      'symbol is exported from its defining file',
      'direct file importers indicate the strongest observed repository usage',
    ]));
  });

  it('respects the file filter when selecting among ambiguous candidates', async () => {
    const result = await getAnalyzeSymbolContext({
      name: 'Button',
      repo: 'repo-a',
      file: 'components/forms/Button.tsx',
      limit: 5,
    });

    expect(rankSymbolCandidatesMock).toHaveBeenCalledWith(
      [secondaryCandidate],
      expect.objectContaining({ queryName: 'Button', repo: 'repo-a' }),
      expect.anything(),
    );
    expect(result.primarySymbol).toEqual(expect.objectContaining({ symbolId: secondaryCandidate.symbolId }));
  });

  it('degrades safely for missing symbols', async () => {
    loadRequiredSymbolIndexMock.mockResolvedValueOnce({ symbols: [], stats: { globalByName: {} } });
    rankSymbolCandidatesMock.mockReturnValueOnce([]);

    const result = await getAnalyzeSymbolContext({ name: 'MissingSymbol' });

    expect(result).toEqual(expect.objectContaining({
      primarySymbol: null,
      primaryFile: null,
      roleSummary: 'symbol could not be resolved from the current symbol index',
      symbolCandidates: [],
      usageSummary: expect.objectContaining({
        importerCount: 0,
        ambiguityDetected: false,
      }),
    }));
  });

  it('keeps local helper summaries grounded in available signals', async () => {
    const localHelper = {
      symbolId: 'repo-a:src/features/cleanup/helpers.ts:function:buildCleanupPayload:1',
      fileId: 'repo-a:src/features/cleanup/helpers.ts',
      name: 'buildCleanupPayload',
      kind: 'function' as const,
      repo: 'repo-a',
      filePath: 'src/features/cleanup/helpers.ts',
      startLine: 3,
      endLine: 14,
      exported: false,
    };
    loadRequiredSymbolIndexMock.mockResolvedValueOnce({ symbols: [localHelper], stats: { globalByName: {} } });
    rankSymbolCandidatesMock.mockReturnValueOnce([
      {
        item: localHelper,
        score: 14,
        reasons: [{ signal: 'exact_name', value: 10 }],
      },
    ]);
    getFileNodeMock.mockResolvedValueOnce(fileNode(localHelper.fileId, 'repo-a', localHelper.filePath));
    getDefinedSymbolsMock.mockResolvedValueOnce([
      symbolNode(localHelper.symbolId, localHelper.fileId, 'repo-a', localHelper.filePath, 'buildCleanupPayload', 'function', false, 3, 14),
    ]);
    getExportedSymbolsMock.mockResolvedValueOnce([]);
    getImportingFilesMock.mockResolvedValueOnce([]);
    getImportedFilesMock.mockResolvedValueOnce([fileNode('repo-a:src/lib/date.ts', 'repo-a', 'src/lib/date.ts')]);
    getReexportingFilesMock.mockResolvedValueOnce([]);
    getReexportedFilesMock.mockResolvedValueOnce([]);
    getNeighboringFilesMock.mockResolvedValueOnce([fileNode('repo-a:src/lib/date.ts', 'repo-a', 'src/lib/date.ts')]);
    getFileExplorationContextMock.mockResolvedValueOnce({
      fileId: localHelper.fileId,
      primaryFile: fileNode(localHelper.fileId, 'repo-a', localHelper.filePath),
      repo: 'repo-a',
      relatedFiles: [],
      neighboringFiles: [],
      definedSymbols: [],
      exportedSymbols: [],
      summary: { relatedFileCount: 0, neighboringFileCount: 0, definedSymbolCount: 0, exportedSymbolCount: 0 },
      rawContext: {},
    });
    getRefactorContextForFileMock.mockResolvedValueOnce({ nearbyFiles: [] });

    const result = await getAnalyzeSymbolContext({ name: 'buildCleanupPayload', repo: 'repo-a' });

    expect(result.exported).toBe(false);
    expect(result.roleSummary).toBe('local function defined in helpers with 0 nearby file signals');
    expect(result.usageSummary.notes).toContain('symbol is not exported from its defining file');
  });
});
