import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getDefinedSymbolsMock,
  getFileNodeMock,
  getImportingFilesMock,
  getIncomingSemanticEdgesForSymbolMock,
  getReexportingFilesMock,
  getSemanticGraphMock,
  getFileRelationMock,
  getFileRelationByIdMock,
  loadRequiredSymbolIndexMock,
  loadConfigMock,
  getRepositoryByIdMock,
  readRepositoryFileMock,
  getObservedPropNamesForComponentMock,
  getUiParentsForComponentMock,
  collectApiPropagationForSymbolMock,
} = vi.hoisted(() => ({
  getDefinedSymbolsMock: vi.fn(),
  getFileNodeMock: vi.fn(),
  getImportingFilesMock: vi.fn(),
  getIncomingSemanticEdgesForSymbolMock: vi.fn(),
  getReexportingFilesMock: vi.fn(),
  getSemanticGraphMock: vi.fn(),
  getFileRelationMock: vi.fn(),
  getFileRelationByIdMock: vi.fn(),
  loadRequiredSymbolIndexMock: vi.fn(),
  loadConfigMock: vi.fn(),
  getRepositoryByIdMock: vi.fn(),
  readRepositoryFileMock: vi.fn(),
  getObservedPropNamesForComponentMock: vi.fn(),
  getUiParentsForComponentMock: vi.fn(),
  collectApiPropagationForSymbolMock: vi.fn(),
}));

vi.mock('../../src/graph/query.js', () => ({
  getDefinedSymbols: getDefinedSymbolsMock,
  getFileNode: getFileNodeMock,
  getImportingFiles: getImportingFilesMock,
  getIncomingSemanticEdgesForSymbol: getIncomingSemanticEdgesForSymbolMock,
  getReexportingFiles: getReexportingFilesMock,
  getSemanticGraph: getSemanticGraphMock,
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

vi.mock('../../src/orchestrator/ui-hierarchy-service.js', () => ({
  getObservedPropNamesForComponent: getObservedPropNamesForComponentMock,
  getUiParentsForComponent: getUiParentsForComponentMock,
}));

vi.mock('../../src/typescript/api-propagation.js', () => ({
  collectApiPropagationForSymbol: collectApiPropagationForSymbolMock,
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
  const transitivePageFile = fileNode('repo-a:src/app/page.tsx', 'repo-a', 'src/app/page.tsx');

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

      if (fileId === transitivePageFile.fileId) {
        return transitivePageFile;
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

      if (fileId === transitivePageFile.fileId) {
        return [
          symbolNode('home-page', transitivePageFile.fileId, 'repo-a', transitivePageFile.filePath, 'HomePage', 1, 4),
        ];
      }

      return [];
    });
    getImportingFilesMock.mockImplementation(async (fileId: string) => {
      if (fileId === targetSymbol.fileId) {
        return [consumerFile];
      }

      if (fileId === consumerFile.fileId) {
        return [transitivePageFile];
      }

      return [];
    });
    getReexportingFilesMock.mockResolvedValue([barrelFile]);
    getSemanticGraphMock.mockResolvedValue({
      schemaVersion: 1,
      sourceSymbolIndexSchemaVersion: 0,
      generatedAt: '',
      edges: [],
    });
    getIncomingSemanticEdgesForSymbolMock.mockResolvedValue([]);
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

      if (fileId === transitivePageFile.fileId) {
        return {
          fileId: transitivePageFile.fileId,
          repo: 'repo-a',
          filePath: transitivePageFile.filePath,
          classification: 'source',
          symbolIds: ['home-page'],
          symbolNames: ['HomePage'],
          imports: [
            {
              fileId: transitivePageFile.fileId,
              source: '../pages/dashboard',
              bindings: [
                {
                  importedName: 'default',
                  localName: 'DashboardPage',
                  kind: 'default',
                  isTypeOnly: false,
                },
              ],
              resolvedKind: 'local-file',
              resolvedTargetFileId: consumerFile.fileId,
            },
          ],
          exports: [],
          importTokens: ['DashboardPage'],
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

      if (filePath === transitivePageFile.filePath) {
        return {
          repositoryId: 'repo-a',
          filePath,
          absolutePath: `/repos/repo-a/${filePath}`,
          content: [
            "import DashboardPage from '../pages/dashboard';",
            'export default function HomePage() {',
            '  return <DashboardPage />;',
            '}',
          ].join('\n'),
          startLine: 1,
          endLine: 4,
          totalLines: 4,
        };
      }

      throw new Error(`unexpected file: ${filePath}`);
    });
    getObservedPropNamesForComponentMock.mockResolvedValue([]);
    getUiParentsForComponentMock.mockResolvedValue([]);
    collectApiPropagationForSymbolMock.mockResolvedValue({
      routeHandlers: [],
      clientCalls: [],
      propagatedClients: [],
    });
  });

  it('resolves the target by symbolId and collects direct impacts', async () => {
    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    expect(result.target.symbolId).toBe(targetSymbol.symbolId);
    expect(result.directConsumers.files).toEqual([
      expect.objectContaining({ filePath: consumerFile.filePath, tier: 'direct' }),
    ]);
    expect(result.indirectConsumers.files).toEqual([
      expect.objectContaining({ filePath: barrelFile.filePath, tier: 'indirect' }),
    ]);
    expect(result.directConsumers.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbolName: 'DashboardPage' }),
      ]),
    );
    expect(result.relatedContext.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbolName: 'WidgetProps' }),
        expect.objectContaining({ symbolName: 'renderWidget' }),
      ]),
    );
    expect(result.summary).toEqual(expect.objectContaining({
      directFileCount: 1,
      directSymbolCount: 1,
      indirectFileCount: 1,
      indirectSymbolCount: 0,
      relatedContextSymbolCount: 2,
      highConfidenceImpactCount: 2,
      mediumConfidenceImpactCount: 1,
      lowConfidenceImpactCount: 2,
      symbolDirectImpactCount: 1,
      fileDirectImpactCount: 1,
      proxyImpactCount: 1,
      localSymbolImpactCount: 2,
    }));
    expect(result.summary.overview).toContain('exact direct consumers are separated');
    expect(result.summary.notes).toEqual(expect.arrayContaining([
      'direct consumers require proven import bindings, callsites, or graph-backed symbol references',
      're-exports, wrapper layers, and bounded transitive propagation are reported as inferred indirect consumers, not exact breakage',
      'same-file matches and unresolved importer edges are kept as related context only because exact symbol-level usage was not proven',
    ]));
    expect(result.impactSummary).toEqual({
      directFiles: 1,
      directSymbols: 1,
      indirectFiles: 1,
      indirectSymbols: 0,
      relatedContextFiles: 0,
      relatedContextSymbols: 2,
      transitiveFiles: 0,
      transitiveSymbols: 0,
      viaGroups: 0,
      highlightedSurfaces: [],
      featureClusters: [],
      transitiveGroups: [],
    });
  });

  it('prefers persisted semantic graph edges when available', async () => {
    const routeFile = fileNode('repo-a:app/api/widget/route.ts', 'repo-a', 'app/api/widget/route.ts');
    const hookFile = fileNode('repo-a:src/hooks/useWidget.ts', 'repo-a', 'src/hooks/useWidget.ts');
    const routeSymbol = symbolNode('route-get', routeFile.fileId, 'repo-a', routeFile.filePath, 'GET', 1, 3);
    const hookSymbol = symbolNode('use-widget', hookFile.fileId, 'repo-a', hookFile.filePath, 'useWidget', 1, 4);

    getFileNodeMock.mockImplementation(async (fileId: string) => {
      if (fileId === targetSymbol.fileId) {
        return fileNode(targetSymbol.fileId, 'repo-a', targetSymbol.filePath);
      }

      if (fileId === routeFile.fileId) {
        return routeFile;
      }

      if (fileId === hookFile.fileId) {
        return hookFile;
      }

      return null;
    });
    getSemanticGraphMock.mockResolvedValue({
      schemaVersion: 1,
      sourceSymbolIndexSchemaVersion: 4,
      generatedAt: '2026-03-23T00:00:00.000Z',
      edges: [{}],
    });
    getIncomingSemanticEdgesForSymbolMock.mockImplementation(async (_symbolId: string, options?: { exactness?: string }) => {
      if (options?.exactness === 'exact') {
        return [
          {
            edge: {
              edgeId: 'exact-route',
              kind: 'api_route_handler',
              strength: 'strong',
              confidence: 'high',
              exactness: 'exact',
              fromFileId: routeFile.fileId,
              fromSymbolId: routeSymbol.symbolId,
              toFileId: targetSymbol.fileId,
              toSymbolId: targetSymbol.symbolId,
              metadata: {
                routeId: '/api/widget',
                routeFileId: routeFile.fileId,
                routeFilePath: routeFile.filePath,
                httpMethod: 'GET',
                source: 'api_propagation',
              },
            },
            fromFile: routeFile,
            fromSymbol: routeSymbol,
            toFile: fileNode(targetSymbol.fileId, 'repo-a', targetSymbol.filePath),
            toSymbol: symbolNode(
              targetSymbol.symbolId,
              targetSymbol.fileId,
              'repo-a',
              targetSymbol.filePath,
              targetSymbol.name,
              targetSymbol.startLine,
              targetSymbol.endLine,
            ),
          },
        ];
      }

      if (options?.exactness === 'inferred') {
        return [
          {
            edge: {
              edgeId: 'inferred-hook',
              kind: 'api_propagation',
              strength: 'medium',
              confidence: 'medium',
              exactness: 'inferred',
              fromFileId: hookFile.fileId,
              fromSymbolId: hookSymbol.symbolId,
              toFileId: targetSymbol.fileId,
              toSymbolId: targetSymbol.symbolId,
              metadata: {
                routeId: '/api/widget',
                routeFileId: routeFile.fileId,
                routeFilePath: routeFile.filePath,
                httpMethod: 'GET',
                handlerName: 'GET',
                source: 'api_propagation',
              },
            },
            fromFile: hookFile,
            fromSymbol: hookSymbol,
            toFile: fileNode(targetSymbol.fileId, 'repo-a', targetSymbol.filePath),
            toSymbol: symbolNode(
              targetSymbol.symbolId,
              targetSymbol.fileId,
              'repo-a',
              targetSymbol.filePath,
              targetSymbol.name,
              targetSymbol.startLine,
              targetSymbol.endLine,
            ),
          },
        ];
      }

      return [];
    });

    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    expect(result.directConsumers.files).toEqual(
      expect.arrayContaining([expect.objectContaining({ filePath: routeFile.filePath })]),
    );
    expect(result.directConsumers.symbols).toEqual(
      expect.arrayContaining([expect.objectContaining({ symbolName: 'GET' })]),
    );
    expect(result.indirectConsumers.files).toEqual(
      expect.arrayContaining([expect.objectContaining({ filePath: hookFile.filePath })]),
    );
    expect(result.indirectConsumers.symbols).toEqual(
      expect.arrayContaining([expect.objectContaining({ symbolName: 'useWidget' })]),
    );
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

    const sameFileImpact = result.relatedContext.symbols.find((entry) => entry.symbolName === 'renderWidget');

    expect(sameFileImpact).toEqual(
      expect.objectContaining({
        filePath: targetSymbol.filePath,
        impactScope: 'local-symbol',
        confidence: 'low',
        tier: 'context',
      }),
    );
    expect(sameFileImpact?.evidence[0]).toEqual(
      expect.objectContaining({
        reason: 'same-file-reference',
        impactScope: 'local-symbol',
        confidence: 'low',
      }),
    );
  });

  it('captures direct importer file and symbol evidence without overstating file-level impact', async () => {
    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    const importerFile = result.directlyImpactedFiles.find((entry) => entry.filePath === consumerFile.filePath);
    const importerSymbol = result.directlyImpactedSymbols.find((entry) => entry.symbolName === 'DashboardPage');

    expect(importerFile?.evidence[0]).toEqual(expect.objectContaining({
      reason: 'imports-target',
      impactScope: 'file-direct',
      confidence: 'high',
      tier: 'direct',
    }));
    expect(importerFile?.evidence[0].notes[0]).toContain('declares import bindings tied to the target export surface');
    expect(importerSymbol?.impactScope).toBe('symbol-direct');
    expect(importerSymbol?.evidence[0].notes[0]).toContain('references imported binding "Widget"');
  });

  it('surfaces graph-known importer files even when symbol-level usage cannot be confirmed', async () => {
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
        ];
      }

      if (fileId === consumerFile.fileId) {
        return [
          symbolNode('dashboard-page', consumerFile.fileId, 'repo-a', consumerFile.filePath, 'DashboardPage', 2, 4),
        ];
      }

      if (fileId === barrelFile.fileId) {
        return [];
      }

      return [];
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
                  localName: 'AliasedWidget',
                  kind: 'named',
                  isTypeOnly: false,
                },
              ],
              resolvedKind: 'local-file',
            },
          ],
          exports: [],
          importTokens: ['AliasedWidget'],
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
          ].join('\n'),
          startLine: 1,
          endLine: 3,
          totalLines: 3,
        };
      }

      if (filePath === consumerFile.filePath) {
        return {
          repositoryId: 'repo-a',
          filePath,
          absolutePath: `/repos/repo-a/${filePath}`,
          content: [
            "import { Widget as AliasedWidget } from '../components/Widget';",
            'export function DashboardPage() {',
            '  return "dashboard";',
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
          content: "export { Widget } from './Widget';",
          startLine: 1,
          endLine: 1,
          totalLines: 1,
        };
      }

      throw new Error(`unexpected file: ${filePath}`);
    });

    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    const importerFile = result.directlyImpactedFiles.find((entry) => entry.filePath === consumerFile.filePath);
    const importerSymbol = result.directlyImpactedSymbols.find((entry) => entry.symbolName === 'DashboardPage');

    expect(importerFile).toEqual(expect.objectContaining({
      impactScope: 'file-direct',
      confidence: 'high',
    }));
    expect(importerSymbol).toBeUndefined();
  });

  it('classifies api-mediated hook consumers as indirect rather than exact', async () => {
    collectApiPropagationForSymbolMock.mockResolvedValue({
      routeHandlers: [
        {
          kind: 'api_route_handler',
          routeId: '/api/widgets',
          routeFileId: 'repo-a:src/app/api/widgets/route.ts',
          routeFilePath: 'src/app/api/widgets/route.ts',
          handlerName: 'GET',
          referenceCount: 1,
        },
      ],
      clientCalls: [
        {
          kind: 'api_client_to_route',
          routeId: '/api/widgets',
          clientFileId: 'repo-a:src/hooks/useWidgets.ts',
          clientFilePath: 'src/hooks/useWidgets.ts',
          method: 'GET',
          line: 3,
          snippet: "return fetch('/api/widgets');",
        },
      ],
      propagatedClients: [
        {
          kind: 'api_propagation',
          routeId: '/api/widgets',
          routeFileId: 'repo-a:src/app/api/widgets/route.ts',
          routeFilePath: 'src/app/api/widgets/route.ts',
          clientFileId: 'repo-a:src/hooks/useWidgets.ts',
          clientFilePath: 'src/hooks/useWidgets.ts',
          method: 'GET',
          line: 3,
          snippet: "return fetch('/api/widgets');",
          handlerName: 'GET',
        },
      ],
    });
    getFileNodeMock.mockImplementation(async (fileId: string) => {
      if (fileId === 'repo-a:src/hooks/useWidgets.ts') {
        return fileNode(fileId, 'repo-a', 'src/hooks/useWidgets.ts');
      }

      if (fileId === targetSymbol.fileId) {
        return fileNode(targetSymbol.fileId, 'repo-a', targetSymbol.filePath);
      }

      if (fileId === consumerFile.fileId) {
        return consumerFile;
      }

      if (fileId === barrelFile.fileId) {
        return barrelFile;
      }

      if (fileId === transitivePageFile.fileId) {
        return transitivePageFile;
      }

      return null;
    });
    getDefinedSymbolsMock.mockImplementation(async (fileId: string) => {
      if (fileId === 'repo-a:src/hooks/useWidgets.ts') {
        return [
          symbolNode('use-widgets', fileId, 'repo-a', 'src/hooks/useWidgets.ts', 'useWidgets', 1, 4),
        ];
      }

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

      if (fileId === transitivePageFile.fileId) {
        return [
          symbolNode('home-page', transitivePageFile.fileId, 'repo-a', transitivePageFile.filePath, 'HomePage', 1, 4),
        ];
      }

      return [];
    });

    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    expect(result.directConsumers.files).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ filePath: 'src/hooks/useWidgets.ts' })]),
    );
    expect(result.indirectConsumers.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'src/hooks/useWidgets.ts',
          tier: 'indirect',
          impactScope: 'proxy',
          confidence: 'medium',
        }),
      ]),
    );
    expect(result.indirectConsumers.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: 'useWidgets',
          filePath: 'src/hooks/useWidgets.ts',
          tier: 'indirect',
        }),
      ]),
    );
    expect(result.summary.notes).toEqual(
      expect.arrayContaining([
        'API-mediated consumers are inferred through client -> route -> service propagation and remain indirect because the client does not call the target symbol directly',
      ]),
    );
  });

  it('captures barrel re-export file evidence as proxy impact', async () => {
    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    const barrelImpact = result.indirectConsumers.files.find((entry) => entry.filePath === barrelFile.filePath);

    expect(barrelImpact).toEqual(expect.objectContaining({
      impactScope: 'proxy',
      confidence: 'medium',
      tier: 'indirect',
    }));
    expect(barrelImpact?.evidence[0]).toEqual(expect.objectContaining({
      reason: 'reexports-target',
      impactScope: 'proxy',
      confidence: 'medium',
      tier: 'indirect',
    }));
  });

  it('keeps safe mode bounded to direct impacts only', async () => {
    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    expect(result.transitiveImpacts).toEqual([]);
    expect(result.summary.transitiveFileCount).toBe(0);
  });

  it('surfaces package-style local importers as direct file impacts for shared exported symbols', async () => {
    const sharedSymbol = {
      symbolId: 'shared-context',
      fileId: 'repo-a:components/common/custom-modal-context.tsx',
      name: 'CustomModalContext',
      kind: 'variable' as const,
      repo: 'repo-a',
      filePath: 'components/common/custom-modal-context.tsx',
      startLine: 1,
      endLine: 6,
      exported: true,
    };
    const modalOne = fileNode('repo-a:components/modal-one.tsx', 'repo-a', 'components/modal-one.tsx');
    const modalTwo = fileNode('repo-a:components/modal-two.tsx', 'repo-a', 'components/modal-two.tsx');

    loadRequiredSymbolIndexMock.mockResolvedValueOnce({
      symbols: [sharedSymbol],
      byName: { CustomModalContext: [sharedSymbol] },
      byNameLower: { custommodalcontext: [sharedSymbol] },
      byFile: {},
      stats: {},
    });
    getFileNodeMock.mockImplementation(async (fileId: string) => {
      if (fileId === sharedSymbol.fileId) {
        return fileNode(sharedSymbol.fileId, 'repo-a', sharedSymbol.filePath);
      }

      if (fileId === modalOne.fileId) {
        return modalOne;
      }

      if (fileId === modalTwo.fileId) {
        return modalTwo;
      }

      return null;
    });
    getDefinedSymbolsMock.mockResolvedValue([]);
    getImportingFilesMock.mockResolvedValue([modalOne, modalTwo]);
    getReexportingFilesMock.mockResolvedValue([]);
    getFileRelationByIdMock.mockImplementation(async (fileId: string) => {
      if (fileId === sharedSymbol.fileId) {
        return {
          fileId: sharedSymbol.fileId,
          repo: 'repo-a',
          filePath: sharedSymbol.filePath,
          classification: 'source',
          symbolIds: [sharedSymbol.symbolId],
          symbolNames: [sharedSymbol.name],
          imports: [],
          exports: [
            {
              fileId: sharedSymbol.fileId,
              kind: 'named',
              exportedName: 'CustomModalContext',
              localName: 'CustomModalContext',
              symbolId: sharedSymbol.symbolId,
            },
          ],
          importTokens: [],
        };
      }

      if (fileId === modalOne.fileId || fileId === modalTwo.fileId) {
        return {
          fileId,
          repo: 'repo-a',
          filePath: fileId === modalOne.fileId ? modalOne.filePath : modalTwo.filePath,
          classification: 'source',
          symbolIds: [],
          symbolNames: [],
          imports: [
            {
              fileId,
              source: 'components/common/custom-modal-context',
              bindings: [
                {
                  importedName: 'CustomModalContext',
                  localName: 'CustomModalContext',
                  kind: 'named',
                  isTypeOnly: false,
                },
              ],
              resolvedKind: 'package',
            },
          ],
          exports: [],
          importTokens: ['CustomModalContext'],
        };
      }

      return null;
    });
    readRepositoryFileMock.mockResolvedValue({
      repositoryId: 'repo-a',
      filePath: sharedSymbol.filePath,
      absolutePath: `/repos/repo-a/${sharedSymbol.filePath}`,
      content: 'export const CustomModalContext = {};',
      startLine: 1,
      endLine: 1,
      totalLines: 1,
    });

    const result = await analyzeSymbolImpact({
      symbolId: sharedSymbol.symbolId,
      repoId: 'repo-a',
      mode: 'safe',
    });

    expect(result.directlyImpactedFiles).toEqual([
      expect.objectContaining({ filePath: modalOne.filePath, impactScope: 'file-direct', confidence: 'high' }),
      expect.objectContaining({ filePath: modalTwo.filePath, impactScope: 'file-direct', confidence: 'high' }),
    ]);
    expect(result.summary.fileDirectImpactCount).toBe(2);
  });

  it('orders graph-derived direct importer files ahead of proxy files', async () => {
    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    expect(result.directlyImpactedFiles[0]).toEqual(expect.objectContaining({
      filePath: consumerFile.filePath,
      impactScope: 'file-direct',
    }));
    expect(result.indirectConsumers.files[0]).toEqual(expect.objectContaining({
      filePath: barrelFile.filePath,
      impactScope: 'proxy',
    }));
  });

  it('adds one bounded transitive importer hop in exploratory mode', async () => {
    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'exploratory',
    });

    expect(result.transitiveImpacts).toEqual([
      expect.objectContaining({
        depth: 2,
        confidence: 'medium',
        tier: 'indirect',
        file: expect.objectContaining({
          filePath: transitivePageFile.filePath,
          impactScope: 'proxy',
          confidence: 'medium',
        }),
      }),
    ]);
    expect(result.summary.transitiveFileCount).toBe(1);
    expect(result.summary.overview).toContain('1 bounded transitive consumer');
    expect(result.summary.notes).toContain('exploratory mode adds one bounded inferred-consumer hop beyond the exact direct consumer surface');
    expect(result.impactSummary.directFiles).toBe(result.directlyImpactedFiles.length);
    expect(result.impactSummary.directSymbols).toBe(result.directlyImpactedSymbols.length);
    expect(result.impactSummary.transitiveFiles).toBe(result.transitiveImpacts.length);
    expect(result.impactSummary.transitiveGroups).toEqual([]);
  });

  it('records the transitive via chain from the direct importer file', async () => {
    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'exploratory',
    });

    const transitive = result.transitiveImpacts[0];

    expect(transitive.file?.filePath).toBe(transitivePageFile.filePath);
    expect(transitive.evidence[0]).toEqual(expect.objectContaining({
      depth: 2,
      confidence: 'medium',
      impactScope: 'proxy',
      tier: 'indirect',
    }));
    expect(transitive.evidence[0].via).toEqual([
      expect.objectContaining({
        fileId: consumerFile.fileId,
        filePath: consumerFile.filePath,
        reason: 'imports-target',
      }),
    ]);
  });

  it('groups exploratory transitive results by via chain and prefers architectural surfaces within a group', async () => {
    const layoutFile = fileNode('repo-a:src/app/layout.tsx', 'repo-a', 'src/app/layout.tsx');
    const appPageFile = fileNode('repo-a:src/app/page.tsx', 'repo-a', 'src/app/page.tsx');
    const helperModuleFile = fileNode('repo-a:src/lib/widget-helper.ts', 'repo-a', 'src/lib/widget-helper.ts');
    const barrelConsumerFile = fileNode(
      'repo-a:src/features/widget/WidgetPanel.tsx',
      'repo-a',
      'src/features/widget/WidgetPanel.tsx',
    );

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

      if (fileId === layoutFile.fileId) {
        return layoutFile;
      }

      if (fileId === appPageFile.fileId) {
        return appPageFile;
      }

      if (fileId === helperModuleFile.fileId) {
        return helperModuleFile;
      }

      if (fileId === barrelConsumerFile.fileId) {
        return barrelConsumerFile;
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

      if (fileId === layoutFile.fileId) {
        return [symbolNode('app-layout', layoutFile.fileId, 'repo-a', layoutFile.filePath, 'RootLayout', 1, 4)];
      }

      if (fileId === appPageFile.fileId) {
        return [symbolNode('app-page', appPageFile.fileId, 'repo-a', appPageFile.filePath, 'HomePage', 1, 4)];
      }

      if (fileId === helperModuleFile.fileId) {
        return [symbolNode('helper-module', helperModuleFile.fileId, 'repo-a', helperModuleFile.filePath, 'widgetHelper', 1, 3)];
      }

      if (fileId === barrelConsumerFile.fileId) {
        return [symbolNode('widget-panel', barrelConsumerFile.fileId, 'repo-a', barrelConsumerFile.filePath, 'WidgetPanel', 1, 4)];
      }

      return [];
    });
    getImportingFilesMock.mockImplementation(async (fileId: string) => {
      if (fileId === targetSymbol.fileId) {
        return [consumerFile];
      }

      if (fileId === consumerFile.fileId) {
        return [helperModuleFile, appPageFile, layoutFile];
      }

      if (fileId === barrelFile.fileId) {
        return [barrelConsumerFile];
      }

      return [];
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

      if (fileId === layoutFile.fileId) {
        return {
          fileId: layoutFile.fileId,
          repo: 'repo-a',
          filePath: layoutFile.filePath,
          classification: 'source',
          symbolIds: ['app-layout'],
          symbolNames: ['RootLayout'],
          imports: [
            {
              fileId: layoutFile.fileId,
              source: '../pages/dashboard',
              bindings: [
                {
                  importedName: 'default',
                  localName: 'DashboardPage',
                  kind: 'default',
                  isTypeOnly: false,
                },
              ],
              resolvedKind: 'local-file',
              resolvedTargetFileId: consumerFile.fileId,
            },
          ],
          exports: [],
          importTokens: ['DashboardPage'],
        };
      }

      if (fileId === appPageFile.fileId) {
        return {
          fileId: appPageFile.fileId,
          repo: 'repo-a',
          filePath: appPageFile.filePath,
          classification: 'source',
          symbolIds: ['app-page'],
          symbolNames: ['HomePage'],
          imports: [
            {
              fileId: appPageFile.fileId,
              source: '../pages/dashboard',
              bindings: [
                {
                  importedName: 'default',
                  localName: 'DashboardPage',
                  kind: 'default',
                  isTypeOnly: false,
                },
              ],
              resolvedKind: 'local-file',
              resolvedTargetFileId: consumerFile.fileId,
            },
          ],
          exports: [],
          importTokens: ['DashboardPage'],
        };
      }

      if (fileId === helperModuleFile.fileId) {
        return {
          fileId: helperModuleFile.fileId,
          repo: 'repo-a',
          filePath: helperModuleFile.filePath,
          classification: 'source',
          symbolIds: ['helper-module'],
          symbolNames: ['widgetHelper'],
          imports: [
            {
              fileId: helperModuleFile.fileId,
              source: '../pages/dashboard',
              bindings: [
                {
                  importedName: 'default',
                  localName: 'DashboardPage',
                  kind: 'default',
                  isTypeOnly: false,
                },
              ],
              resolvedKind: 'local-file',
              resolvedTargetFileId: consumerFile.fileId,
            },
          ],
          exports: [],
          importTokens: ['DashboardPage'],
        };
      }

      if (fileId === barrelConsumerFile.fileId) {
        return {
          fileId: barrelConsumerFile.fileId,
          repo: 'repo-a',
          filePath: barrelConsumerFile.filePath,
          classification: 'source',
          symbolIds: ['widget-panel'],
          symbolNames: ['WidgetPanel'],
          imports: [
            {
              fileId: barrelConsumerFile.fileId,
              source: '../../components',
              bindings: [
                {
                  importedName: 'Widget',
                  localName: 'Widget',
                  kind: 'named',
                  isTypeOnly: false,
                },
              ],
              resolvedKind: 'local-file',
              resolvedTargetFileId: barrelFile.fileId,
            },
          ],
          exports: [],
          importTokens: ['Widget'],
        };
      }

      return null;
    });
    readRepositoryFileMock.mockImplementation(async (repository: { id: string }, filePath: string) => {
      if (repository.id !== 'repo-a') {
        throw new Error('unexpected repo');
      }

      return {
        repositoryId: 'repo-a',
        filePath,
        absolutePath: `/repos/repo-a/${filePath}`,
        content: 'export {};',
        startLine: 1,
        endLine: 1,
        totalLines: 1,
      };
    });

    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'exploratory',
    });

    expect(result.directlyImpactedFiles.map((entry) => entry.filePath)).toEqual([consumerFile.filePath]);
    expect(result.indirectConsumers.files.map((entry) => entry.filePath)).toEqual([barrelFile.filePath]);
    expect(result.transitiveImpacts.map((entry) => entry.file?.filePath)).toEqual([
      appPageFile.filePath,
      layoutFile.filePath,
      helperModuleFile.filePath,
      barrelConsumerFile.filePath,
    ]);
    expect(result.transitiveImpacts.map((entry) => entry.evidence[0]?.via[0]?.filePath)).toEqual([
      consumerFile.filePath,
      consumerFile.filePath,
      consumerFile.filePath,
      barrelFile.filePath,
    ]);
    expect(result.impactSummary.transitiveGroups).toEqual([]);
  });

  it('summarizes large exploratory result sets by via chain and highlights architectural surfaces', async () => {
    const layoutFile = fileNode('repo-a:src/app/layout.tsx', 'repo-a', 'src/app/layout.tsx');
    const appPageFile = fileNode('repo-a:src/app/page.tsx', 'repo-a', 'src/app/page.tsx');
    const routeFile = fileNode('repo-a:src/app/api/widget/route.ts', 'repo-a', 'src/app/api/widget/route.ts');
    const adminPageFile = fileNode('repo-a:pages/admin/widget.tsx', 'repo-a', 'pages/admin/widget.tsx');
    const helperModuleFile = fileNode('repo-a:src/lib/widget-helper.ts', 'repo-a', 'src/lib/widget-helper.ts');
    const settingsPageFile = fileNode('repo-a:pages/project/[id]/settings.tsx', 'repo-a', 'pages/project/[id]/settings.tsx');
    const indexPageFile = fileNode('repo-a:pages/project/[id]/index.tsx', 'repo-a', 'pages/project/[id]/index.tsx');
    const barrelConsumerFile = fileNode('repo-a:src/features/widget/WidgetPanel.tsx', 'repo-a', 'src/features/widget/WidgetPanel.tsx');
    const barrelFeaturePageFile = fileNode('repo-a:pages/project/[id]/widget.tsx', 'repo-a', 'pages/project/[id]/widget.tsx');

    const extraFiles = new Map<string, ReturnType<typeof fileNode>>([
      [layoutFile.fileId, layoutFile],
      [appPageFile.fileId, appPageFile],
      [routeFile.fileId, routeFile],
      [adminPageFile.fileId, adminPageFile],
      [helperModuleFile.fileId, helperModuleFile],
      [settingsPageFile.fileId, settingsPageFile],
      [indexPageFile.fileId, indexPageFile],
      [barrelConsumerFile.fileId, barrelConsumerFile],
      [barrelFeaturePageFile.fileId, barrelFeaturePageFile],
    ]);

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

      return extraFiles.get(fileId) ?? null;
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
        return [symbolNode('dashboard-page', consumerFile.fileId, 'repo-a', consumerFile.filePath, 'DashboardPage', 1, 6)];
      }

      if (fileId === barrelFile.fileId) {
        return [symbolNode('widget-index-helper', barrelFile.fileId, 'repo-a', barrelFile.filePath, 'widgetIndexHelper', 1, 3)];
      }

      return [];
    });
    getImportingFilesMock.mockImplementation(async (fileId: string) => {
      if (fileId === targetSymbol.fileId) {
        return [consumerFile];
      }

      if (fileId === consumerFile.fileId) {
        return [helperModuleFile, appPageFile, layoutFile, routeFile, adminPageFile, settingsPageFile, indexPageFile];
      }

      if (fileId === barrelFile.fileId) {
        return [barrelConsumerFile, barrelFeaturePageFile];
      }

      return [];
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
          ],
          importTokens: [],
        };
      }

      return {
        fileId,
        repo: 'repo-a',
        filePath: extraFiles.get(fileId)?.filePath ?? '',
        classification: 'source',
        symbolIds: [],
        symbolNames: [],
        imports: [],
        exports: [],
        importTokens: [],
      };
    });
    readRepositoryFileMock.mockResolvedValue({
      repositoryId: 'repo-a',
      filePath: targetSymbol.filePath,
      absolutePath: `/repos/repo-a/${targetSymbol.filePath}`,
      content: 'export function Widget() { return null; }',
      startLine: 1,
      endLine: 1,
      totalLines: 1,
    });

    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'exploratory',
    });

    expect(result.impactSummary.directFiles).toBe(result.directlyImpactedFiles.length);
    expect(result.impactSummary.directSymbols).toBe(result.directlyImpactedSymbols.length);
    expect(result.impactSummary.transitiveFiles).toBe(result.transitiveImpacts.length);
    expect(result.impactSummary.viaGroups).toBe(2);
    expect(result.impactSummary.transitiveGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          viaFilePath: consumerFile.filePath,
          fileCount: 7,
          surfaces: expect.arrayContaining([
            expect.objectContaining({ filePath: appPageFile.filePath, category: 'page' }),
            expect.objectContaining({ filePath: adminPageFile.filePath, category: 'page' }),
          ]),
        }),
        expect.objectContaining({
          viaFilePath: barrelFile.filePath,
          fileCount: 2,
          surfaces: expect.arrayContaining([
            expect.objectContaining({ filePath: barrelFeaturePageFile.filePath, category: 'page' }),
          ]),
        }),
      ]),
    );
    expect(result.impactSummary.highlightedSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filePath: appPageFile.filePath, category: 'page' }),
        expect.objectContaining({ filePath: adminPageFile.filePath, category: 'page' }),
        expect.objectContaining({ filePath: settingsPageFile.filePath, category: 'page' }),
      ]),
    );
    expect(result.impactSummary.featureClusters).toEqual(
      expect.arrayContaining(['pages/project/*', 'pages/admin/*', 'src/app/*']),
    );
  });

  it('respects maxDepth in exploratory mode and stays direct-only when below 2', async () => {
    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'exploratory',
      maxDepth: 1,
    });

    expect(result.transitiveImpacts).toEqual([]);
    expect(result.summary.transitiveFileCount).toBe(0);
    expect(result.summary.notes).toContain(
      'exploratory mode is enabled, but bounded transitive expansion was not applied because maxDepth is below 2',
    );
  });

  it('ranks graph-derived importer evidence ahead of local same-file proxy matches', async () => {
    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    expect(result.directlyImpactedSymbols[0]).toEqual(expect.objectContaining({
      symbolName: 'DashboardPage',
      impactScope: 'symbol-direct',
      confidence: 'high',
    }));
  });

  it('adds supplementary UI impact signals for components with clear UI parents and observed props', async () => {
    getObservedPropNamesForComponentMock.mockResolvedValue([
      { propName: 'variant', count: 3 },
      { propName: 'disabled', count: 1 },
    ]);
    getUiParentsForComponentMock
      .mockResolvedValueOnce([
        {
          componentName: 'AudioHero',
          filePath: 'src/components/AudioHero.tsx',
          symbolId: 'repo-a:src/components/AudioHero.tsx:function:AudioHero:1',
          resolved: true,
        },
        {
          componentName: 'PodcastPage',
          filePath: 'src/app/podcast/page.tsx',
          symbolId: 'repo-a:src/app/podcast/page.tsx:function:PodcastPage:1',
          resolved: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          componentName: 'HomepageHeroSection',
          filePath: 'src/app/page.tsx',
          symbolId: 'repo-a:src/app/page.tsx:function:HomepageHeroSection:1',
          resolved: true,
        },
      ]);

    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    expect(result.uiImpact).toEqual({
      parentComponents: [
        {
          componentName: 'AudioHero',
          filePath: 'src/components/AudioHero.tsx',
          symbolId: 'repo-a:src/components/AudioHero.tsx:function:AudioHero:1',
          resolved: true,
        },
      ],
      parentPages: [
        {
          componentName: 'HomepageHeroSection',
          filePath: 'src/app/page.tsx',
          symbolId: 'repo-a:src/app/page.tsx:function:HomepageHeroSection:1',
          resolved: true,
        },
        {
          componentName: 'PodcastPage',
          filePath: 'src/app/podcast/page.tsx',
          symbolId: 'repo-a:src/app/podcast/page.tsx:function:PodcastPage:1',
          resolved: true,
        },
      ],
      observedPropUsage: [
        { propName: 'variant', count: 3 },
        { propName: 'disabled', count: 1 },
      ],
      confidence: 'medium',
    });
    expect(result.directlyImpactedFiles.map((entry) => entry.filePath)).toEqual([consumerFile.filePath]);
    expect(result.indirectConsumers.files.map((entry) => entry.filePath)).toEqual([barrelFile.filePath]);
    expect(result.summary.notes).toContain(
      'ui impact signals are supplementary JSX hierarchy hints derived from component composition and observed prop usage; they do not change graph-based impact ranking',
    );
  });

  it('adds low-confidence UI impact when only observed prop usage exists without UI parents', async () => {
    getObservedPropNamesForComponentMock.mockResolvedValue([
      { propName: 'title', count: 2 },
    ]);
    getUiParentsForComponentMock.mockResolvedValue([]);

    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    expect(result.uiImpact).toEqual({
      parentComponents: [],
      parentPages: [],
      observedPropUsage: [{ propName: 'title', count: 2 }],
      confidence: 'low',
    });
  });

  it('omits UI impact when no UI hierarchy signals are available', async () => {
    getObservedPropNamesForComponentMock.mockResolvedValue([]);
    getUiParentsForComponentMock.mockResolvedValue([]);

    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'safe',
    });

    expect(result).not.toHaveProperty('uiImpact');
  });

  it('marks exploratory mode as bounded transitive expansion with explicit limitations', async () => {
    const result = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'exploratory',
      includeTransitive: true,
      maxDepth: 2,
    });

    expect(result.mode).toBe('exploratory');
    expect(result.summary.notes).toEqual(expect.arrayContaining([
      'exploratory mode adds one bounded inferred-consumer hop beyond the exact direct consumer surface',
    ]));
    expect(result.summary.transitiveFileCount).toBeGreaterThan(0);
  });

  it('keeps exploratory transitive ordering deterministic across repeated runs', async () => {
    const first = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'exploratory',
    });
    const second = await analyzeSymbolImpact({
      symbolId: targetSymbol.symbolId,
      mode: 'exploratory',
    });

    expect(first.transitiveImpacts.map((entry) => entry.file?.filePath)).toEqual(
      second.transitiveImpacts.map((entry) => entry.file?.filePath),
    );
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
