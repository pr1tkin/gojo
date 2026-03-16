import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getDefinedSymbolsMock,
  getFileNodeMock,
  getImportingFilesMock,
  getReexportingFilesMock,
  getFileRelationMock,
  getFileRelationByIdMock,
  loadRequiredSymbolIndexMock,
  loadConfigMock,
  getRepositoryByIdMock,
  readRepositoryFileMock,
} = vi.hoisted(() => ({
  getDefinedSymbolsMock: vi.fn(),
  getFileNodeMock: vi.fn(),
  getImportingFilesMock: vi.fn(),
  getReexportingFilesMock: vi.fn(),
  getFileRelationMock: vi.fn(),
  getFileRelationByIdMock: vi.fn(),
  loadRequiredSymbolIndexMock: vi.fn(),
  loadConfigMock: vi.fn(),
  getRepositoryByIdMock: vi.fn(),
  readRepositoryFileMock: vi.fn(),
}));

vi.mock('../../src/graph/query.js', () => ({
  getDefinedSymbols: getDefinedSymbolsMock,
  getFileNode: getFileNodeMock,
  getImportingFiles: getImportingFilesMock,
  getReexportingFiles: getReexportingFilesMock,
}));

vi.mock('../../src/symbol-index/query.js', () => ({
  getFileRelation: getFileRelationMock,
  getFileRelationById: getFileRelationByIdMock,
}));

vi.mock('../../src/symbol-index/store.js', () => ({
  loadRequiredSymbolIndex: loadRequiredSymbolIndexMock,
}));

vi.mock('../../src/config.js', () => ({
  loadConfig: loadConfigMock,
}));

vi.mock('../../src/repositories.js', () => ({
  getRepositoryById: getRepositoryByIdMock,
}));

vi.mock('../../src/files.js', () => ({
  readRepositoryFile: readRepositoryFileMock,
}));

import { analyzeSymbolImpact } from '../../src/orchestrator/impact-analysis-service.js';

function fileNode(fileId: string, repoId: string, filePath: string) {
  return { nodeType: 'file' as const, fileId, repoId, filePath, classification: 'source' as const };
}

function symbolNode(
  symbolId: string,
  fileId: string,
  repoId: string,
  filePath: string,
  name: string,
  startLine: number,
  endLine: number,
  kind: 'function' | 'interface' | 'variable' = 'function',
) {
  return {
    nodeType: 'symbol' as const,
    symbolId,
    fileId,
    repoId,
    filePath,
    name,
    kind,
    exported: true,
    startLine,
    endLine,
  };
}

describe('impact analysis service', () => {
  const targetSymbol = {
    symbolId: 'widget-symbol',
    fileId: 'repo-a:src/components/Widget.tsx',
    name: 'Widget',
    kind: 'function' as const,
    repo: 'repo-a',
    filePath: 'src/components/Widget.tsx',
    startLine: 1,
    endLine: 6,
    exported: true,
  };
  const widgetPropsSymbol = symbolNode(
    'widget-props',
    targetSymbol.fileId,
    'repo-a',
    targetSymbol.filePath,
    'WidgetProps',
    8,
    11,
    'interface',
  );
  const helperSymbol = symbolNode(
    'widget-helper',
    targetSymbol.fileId,
    'repo-a',
    targetSymbol.filePath,
    'renderWidget',
    13,
    18,
  );
  const consumerFile = fileNode('repo-a:src/pages/dashboard.tsx', 'repo-a', 'src/pages/dashboard.tsx');
  const barrelFile = fileNode('repo-a:src/components/index.ts', 'repo-a', 'src/components/index.ts');

  beforeEach(() => {
    vi.clearAllMocks();

    loadRequiredSymbolIndexMock.mockResolvedValue({
      symbols: [targetSymbol],
      byName: { Widget: [targetSymbol] },
      byNameLower: { widget: [targetSymbol] },
      byFile: {},
      stats: {},
    });
    loadConfigMock.mockReturnValue({
      nodeEnv: 'test',
      port: 3000,
      reposRoot: '/repos',
      zoektBaseUrl: 'http://zoekt:6070',
    });
    getRepositoryByIdMock.mockResolvedValue({
      id: 'repo-a',
      name: 'repo-a',
      rootPath: '/repos/repo-a',
      isGitRepository: true,
    });
    getFileNodeMock.mockImplementation(async (fileId: string) => {
      if (fileId === targetSymbol.fileId) {
        return fileNode(targetSymbol.fileId, 'repo-a', targetSymbol.filePath);
      }

      if (fileId === consumerFile.fileId) {
        return consumerFile;
      }

      if (fileId === barrelFile.fileId) {
        return barrelFile;
      }

      return null;
    });
    getDefinedSymbolsMock.mockImplementation(async (fileId: string) => {
      if (fileId === targetSymbol.fileId) {
        return [
          symbolNode(
            targetSymbol.symbolId,
            targetSymbol.fileId,
            'repo-a',
            targetSymbol.filePath,
            targetSymbol.name,
            targetSymbol.startLine,
            targetSymbol.endLine,
          ),
          widgetPropsSymbol,
          helperSymbol,
        ];
      }

      if (fileId === consumerFile.fileId) {
        return [
          symbolNode('dashboard-page', consumerFile.fileId, 'repo-a', consumerFile.filePath, 'DashboardPage', 1, 6),
        ];
      }

      if (fileId === barrelFile.fileId) {
        return [
          symbolNode('widget-index-helper', barrelFile.fileId, 'repo-a', barrelFile.filePath, 'widgetIndexHelper', 1, 3),
        ];
      }

      return [];
    });
    getImportingFilesMock.mockResolvedValue([consumerFile]);
    getReexportingFilesMock.mockResolvedValue([barrelFile]);
    getFileRelationMock.mockResolvedValue({
      fileId: targetSymbol.fileId,
      repo: 'repo-a',
      filePath: targetSymbol.filePath,
      classification: 'source',
      symbolIds: [targetSymbol.symbolId],
      symbolNames: [targetSymbol.name],
      imports: [],
      exports: [
        {
          fileId: targetSymbol.fileId,
          kind: 'named',
          exportedName: 'Widget',
          localName: 'Widget',
          symbolId: targetSymbol.symbolId,
        },
      ],
      importTokens: [],
    });
    getFileRelationByIdMock.mockImplementation(async (fileId: string) => {
      if (fileId === targetSymbol.fileId) {
        return {
          fileId: targetSymbol.fileId,
          repo: 'repo-a',
          filePath: targetSymbol.filePath,
          classification: 'source',
          symbolIds: [targetSymbol.symbolId],
          symbolNames: [targetSymbol.name],
          imports: [],
          exports: [
            {
              fileId: targetSymbol.fileId,
              kind: 'named',
              exportedName: 'Widget',
              localName: 'Widget',
              symbolId: targetSymbol.symbolId,
            },
          ],
          importTokens: [],
        };
      }

      if (fileId === consumerFile.fileId) {
        return {
          fileId: consumerFile.fileId,
          repo: 'repo-a',
          filePath: consumerFile.filePath,
          classification: 'source',
          symbolIds: ['dashboard-page'],
          symbolNames: ['DashboardPage'],
          imports: [
            {
              fileId: consumerFile.fileId,
              source: '../components/Widget',
              bindings: [
                {
                  importedName: 'Widget',
                  localName: 'Widget',
                  kind: 'named',
                  isTypeOnly: false,
                },
              ],
              resolvedKind: 'local-file',
              resolvedTargetFileId: targetSymbol.fileId,
            },
          ],
          exports: [],
          importTokens: ['Widget'],
        };
      }

      if (fileId === barrelFile.fileId) {
        return {
          fileId: barrelFile.fileId,
          repo: 'repo-a',
          filePath: barrelFile.filePath,
          classification: 'source',
          symbolIds: ['widget-index-helper'],
          symbolNames: ['widgetIndexHelper'],
          imports: [],
          exports: [
            {
              fileId: barrelFile.fileId,
              kind: 'reexport-named',
              exportedName: 'Widget',
              localName: 'Widget',
              source: './Widget',
            },
            {
              fileId: barrelFile.fileId,
              kind: 'named',
              exportedName: 'widgetIndexHelper',
              localName: 'widgetIndexHelper',
              symbolId: 'widget-index-helper',
            },
          ],
          importTokens: [],
        };
      }

      return null;
    });
    readRepositoryFileMock.mockImplementation(async (repository: { id: string }, filePath: string) => {
      if (repository.id !== 'repo-a') {
        throw new Error('unexpected repo');
      }

      if (filePath === targetSymbol.filePath) {
        return {
          repositoryId: 'repo-a',
          filePath,
          absolutePath: `/repos/repo-a/${filePath}`,
          content: [
            'export function Widget() {',
            '  return null;',
            '}',
            '',
            '',
            '',
            '',
            'export interface WidgetProps {',
            '  widget: Widget;',
            '}',
            '',
            'export function renderWidget() {',
            '  return Widget();',
            '}',
          ].join('\n'),
          startLine: 1,
          endLine: 14,
          totalLines: 14,
        };
      }

      if (filePath === consumerFile.filePath) {
        return {
          repositoryId: 'repo-a',
          filePath,
          absolutePath: `/repos/repo-a/${filePath}`,
          content: [
            "import { Widget } from '../components/Widget';",
            'export function DashboardPage() {',
            '  return Widget();',
            '}',
          ].join('\n'),
          startLine: 1,
          endLine: 4,
          totalLines: 4,
        };
      }

      if (filePath === barrelFile.filePath) {
        return {
          repositoryId: 'repo-a',
          filePath,
          absolutePath: `/repos/repo-a/${filePath}`,
          content: [
            "export { Widget } from './Widget';",
            'export function widgetIndexHelper() {',
            '  return Widget;',
            '}',
          ].join('\n'),
          startLine: 1,
          endLine: 4,
          totalLines: 4,
        };
      }

      throw new Error(`unexpected file: ${filePath}`);
    });
  });

  it('resolves the target by symbolId and collects direct impacts', async () => {
    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    expect(result.target.symbolId).toBe(targetSymbol.symbolId);
    expect(result.directlyImpactedFiles).toEqual([
      expect.objectContaining({ filePath: consumerFile.filePath }),
      expect.objectContaining({ filePath: barrelFile.filePath }),
    ]);
    expect(result.directlyImpactedSymbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbolName: 'DashboardPage' }),
        expect.objectContaining({ symbolName: 'WidgetProps' }),
        expect.objectContaining({ symbolName: 'renderWidget' }),
      ]),
    );
    expect(result.summary).toEqual(expect.objectContaining({
      directFileCount: 2,
      directSymbolCount: 3,
      highConfidenceImpactCount: 3,
    }));
    expect(result.summary.notes).toEqual(expect.arrayContaining([
      'direct importer and re-export relationships are the strongest current impact signals',
      'same-file symbol impacts are based on exact symbol-name matches inside sibling symbol spans',
    ]));
  });

  it('resolves the target by filePath and symbolName', async () => {
    const result = await analyzeSymbolImpact({
      repoId: 'repo-a',
      filePath: 'src/components/Widget.tsx',
      symbolName: 'Widget',
      mode: 'safe',
    });

    expect(result.target.symbolName).toBe('Widget');
    expect(result.target.file?.fileId).toBe(targetSymbol.fileId);
  });

  it('includes same-file direct dependency evidence conservatively', async () => {
    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    const sameFileImpact = result.directlyImpactedSymbols.find((entry) => entry.symbolName === 'renderWidget');

    expect(sameFileImpact).toEqual(
      expect.objectContaining({
        filePath: targetSymbol.filePath,
        confidence: 'medium',
      }),
    );
    expect(sameFileImpact?.evidence[0]).toEqual(
      expect.objectContaining({
        reason: 'same-file-reference',
        confidence: 'medium',
      }),
    );
  });

  it('captures direct importer file and symbol evidence', async () => {
    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    const importerFile = result.directlyImpactedFiles.find((entry) => entry.filePath === consumerFile.filePath);
    const importerSymbol = result.directlyImpactedSymbols.find((entry) => entry.symbolName === 'DashboardPage');

    expect(importerFile?.evidence[0]).toEqual(expect.objectContaining({
      reason: 'imports-target',
      confidence: 'high',
    }));
    expect(importerSymbol?.evidence[0].notes[0]).toContain('references imported binding "Widget"');
  });

  it('captures barrel re-export file evidence', async () => {
    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    const barrelImpact = result.directlyImpactedFiles.find((entry) => entry.filePath === barrelFile.filePath);

    expect(barrelImpact).toEqual(expect.objectContaining({
      confidence: 'high',
    }));
    expect(barrelImpact?.evidence[0]).toEqual(expect.objectContaining({
      reason: 'reexports-target',
      confidence: 'high',
    }));
  });

  it('degrades safely for unresolved targets', async () => {
    loadRequiredSymbolIndexMock.mockResolvedValueOnce({
      symbols: [],
      byName: {},
      byNameLower: {},
      byFile: {},
      stats: {},
    });

    const result = await analyzeSymbolImpact({
      symbolId: 'missing-symbol',
      mode: 'safe',
    });

    expect(result.target.symbol).toBeNull();
    expect(result.directlyImpactedFiles).toEqual([]);
    expect(result.directlyImpactedSymbols).toEqual([]);
    expect(result.summary.notes).toContain('target symbol could not be resolved from the current symbol index and graph');
  });
});
