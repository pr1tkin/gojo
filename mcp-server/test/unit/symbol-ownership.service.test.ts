import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getFileNodeMock,
  getImportingFilesMock,
  getReexportingFilesMock,
  getFileRelationMock,
  getFileRelationByIdMock,
  loadRequiredSymbolIndexMock,
} = vi.hoisted(() => ({
  getFileNodeMock: vi.fn(),
  getImportingFilesMock: vi.fn(),
  getReexportingFilesMock: vi.fn(),
  getFileRelationMock: vi.fn(),
  getFileRelationByIdMock: vi.fn(),
  loadRequiredSymbolIndexMock: vi.fn(),
}));

vi.mock('../../src/graph/query.js', () => ({
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

import { analyzeSymbolOwnership } from '../../src/orchestrator/symbol-ownership-service.js';

function fileNode(fileId: string, repoId: string, filePath: string) {
  return { nodeType: 'file' as const, fileId, repoId, filePath, classification: 'source' as const };
}

function symbolNode(
  symbolId: string,
  fileId: string,
  repo: string,
  filePath: string,
  name: string,
  kind: 'function' | 'interface' | 'typeAlias' | 'variable' = 'function',
  exported = false,
) {
  return {
    symbolId,
    fileId,
    repo,
    filePath,
    name,
    kind,
    startLine: 1,
    endLine: 8,
    exported,
  };
}

function fileRelation(fileId: string, repo: string, filePath: string, symbolId: string, symbolName: string, exported: boolean, exportKind: 'named' | 'default' = 'named') {
  return {
    fileId,
    repo,
    filePath,
    classification: 'source' as const,
    symbolIds: [symbolId],
    symbolNames: [symbolName],
    imports: [],
    exports: exported
      ? [{
          fileId,
          kind: exportKind,
          exportedName: exportKind === 'default' ? 'default' : symbolName,
          localName: symbolName,
          symbolId,
        }]
      : [],
    importTokens: [],
  };
}

function seedTarget(symbol: ReturnType<typeof symbolNode>, relation: ReturnType<typeof fileRelation>) {
  loadRequiredSymbolIndexMock.mockResolvedValue({
    symbols: [symbol],
    byName: { [symbol.name]: [symbol] },
    byNameLower: { [symbol.name.toLowerCase()]: [symbol] },
    byFile: { [relation.fileId]: relation },
    stats: {},
  });
  getFileNodeMock.mockResolvedValue(fileNode(symbol.fileId, symbol.repo, symbol.filePath));
  getFileRelationByIdMock.mockImplementation(async (fileId: string) => (fileId === relation.fileId ? relation : null));
  getFileRelationMock.mockImplementation(async (filePath: string) => (filePath === relation.filePath ? relation : null));
}

function expectHeuristicSignals(result: Awaited<ReturnType<typeof analyzeSymbolOwnership>>) {
  expect(result.signals.map((entry) => entry.type)).toEqual(expect.arrayContaining([
    'export-surface',
    'path-boundary',
    'usage-fanout',
    'barrel-participation',
  ]));
}

describe('symbol ownership service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getImportingFilesMock.mockResolvedValue([]);
    getReexportingFilesMock.mockResolvedValue([]);
  });

  it('classifies a non-exported local helper as internal-local', async () => {
    const symbol = symbolNode(
      'local-helper',
      'repo-a:src/features/account/providers/internal/buildProviderState.ts',
      'repo-a',
      'src/features/account/providers/internal/buildProviderState.ts',
      'buildProviderState',
      'function',
      false,
    );
    const relation = fileRelation(symbol.fileId, symbol.repo, symbol.filePath, symbol.symbolId, symbol.name, false);
    seedTarget(symbol, relation);

    const result = await analyzeSymbolOwnership({ symbolId: symbol.symbolId });

    expect(result.ownership).toBe('internal-local');
    expect(result.apiBoundary).toBe('not-api-like');
    expect(result.confidence).toBe('high');
    expect(result.summary).toBe('provider helper with no shared surface signals');
    expectHeuristicSignals(result);
    expect(result.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'local-only-usage', strength: 'strong' }),
      expect.objectContaining({ type: 'path-boundary', strength: 'strong' }),
    ]));
  });

  it('classifies a feature-local component conservatively as feature-internal', async () => {
    const symbol = symbolNode(
      'billing-summary',
      'repo-a:src/features/billing/components/BillingSummary.tsx',
      'repo-a',
      'src/features/billing/components/BillingSummary.tsx',
      'BillingSummary',
      'function',
      true,
    );
    const relation = fileRelation(symbol.fileId, symbol.repo, symbol.filePath, symbol.symbolId, symbol.name, true);
    seedTarget(symbol, relation);
    getImportingFilesMock.mockResolvedValue([
      fileNode('repo-a:src/features/billing/page.tsx', 'repo-a', 'src/features/billing/page.tsx'),
      fileNode('repo-a:src/features/billing/hooks/useBilling.ts', 'repo-a', 'src/features/billing/hooks/useBilling.ts'),
    ]);

    const result = await analyzeSymbolOwnership({ symbolId: symbol.symbolId });

    expect(result.ownership).toBe('feature-internal');
    expect(result.apiBoundary).toBe('feature-boundary');
    expect(result.summary).toContain('used within one feature area');
    expectHeuristicSignals(result);
    expect(result.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'feature-local-usage', strength: 'strong' }),
    ]));
  });

  it('keeps a non-exported helper inside a widely imported file as internal-local', async () => {
    const symbol = symbolNode(
      'parse-date',
      'repo-a:src/app/_components/audioSimple/AudioSimple.tsx',
      'repo-a',
      'src/app/_components/audioSimple/AudioSimple.tsx',
      'parseDate',
      'function',
      false,
    );
    const relation = {
      fileId: symbol.fileId,
      repo: symbol.repo,
      filePath: symbol.filePath,
      classification: 'source' as const,
      symbolIds: [symbol.symbolId],
      symbolNames: [symbol.name],
      imports: [],
      exports: [{
        fileId: symbol.fileId,
        kind: 'default' as const,
        exportedName: 'default',
        localName: 'AudioSimple',
        symbolId: 'audio-simple',
      }],
      importTokens: [],
    };
    seedTarget(symbol, relation);
    getImportingFilesMock.mockResolvedValue([
      fileNode('repo-a:src/app/audio/page.tsx', 'repo-a', 'src/app/audio/page.tsx'),
      fileNode('repo-a:src/app/podcast/page.tsx', 'repo-a', 'src/app/podcast/page.tsx'),
      fileNode('repo-a:src/app/audio/AudioSimple.stories.tsx', 'repo-a', 'src/app/audio/AudioSimple.stories.tsx'),
    ]);

    const result = await analyzeSymbolOwnership({ symbolId: symbol.symbolId });

    expect(result.ownership).toBe('internal-local');
    expect(result.apiBoundary).toBe('not-api-like');
    expect(result.summary).toBe('function with no shared surface signals');
    expectHeuristicSignals(result);
    expect(result.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'local-only-usage', strength: 'strong' }),
      expect.objectContaining({
        type: 'usage-fanout',
        strength: 'weak',
        note: expect.stringContaining('only file-level importer fan-out was observed'),
      }),
    ]));
  });

  it('promotes a feature-local exported hook from unknown to feature-internal', async () => {
    const symbol = symbolNode(
      'admin-cleanup-store',
      'repo-a:components/admin/cleanup/store/admin-cleanup-context.ts',
      'repo-a',
      'components/admin/cleanup/store/admin-cleanup-context.ts',
      'useAdminCleanupStore',
      'variable',
      true,
    );
    const relation = fileRelation(symbol.fileId, symbol.repo, symbol.filePath, symbol.symbolId, symbol.name, true);
    seedTarget(symbol, relation);
    getImportingFilesMock.mockResolvedValue([
      fileNode('repo-a:components/admin/cleanup/table.tsx', 'repo-a', 'components/admin/cleanup/table.tsx'),
      fileNode('repo-a:components/admin/cleanup/table-row.tsx', 'repo-a', 'components/admin/cleanup/table-row.tsx'),
    ]);

    const result = await analyzeSymbolOwnership({ symbolId: symbol.symbolId });

    expect(result.ownership).toBe('feature-internal');
    expect(result.apiBoundary).toBe('feature-boundary');
    expect(result.confidence).toBe('medium');
    expect(result.summary).toContain('used within one feature area');
    expectHeuristicSignals(result);
    expect(result.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'path-boundary', strength: 'moderate' }),
      expect.objectContaining({ type: 'feature-local-usage', strength: 'strong' }),
    ]));
  });

  it('classifies a shared utility reused across features as shared-internal', async () => {
    const symbol = symbolNode(
      'format-date',
      'repo-a:src/shared/utils/date/formatDate.ts',
      'repo-a',
      'src/shared/utils/date/formatDate.ts',
      'formatDate',
      'function',
      true,
    );
    const relation = fileRelation(symbol.fileId, symbol.repo, symbol.filePath, symbol.symbolId, symbol.name, true);
    seedTarget(symbol, relation);
    getImportingFilesMock.mockResolvedValue([
      fileNode('repo-a:src/features/orders/table/OrderTable.tsx', 'repo-a', 'src/features/orders/table/OrderTable.tsx'),
      fileNode('repo-a:src/features/billing/summary/BillingSummary.tsx', 'repo-a', 'src/features/billing/summary/BillingSummary.tsx'),
      fileNode('repo-a:src/app/reports/page.tsx', 'repo-a', 'src/app/reports/page.tsx'),
    ]);

    const result = await analyzeSymbolOwnership({ symbolId: symbol.symbolId });

    expect(result.ownership).toBe('shared-internal');
    expect(result.apiBoundary).toBe('shared-boundary');
    expect(result.summary).toContain('without stable entry-surface exposure');
    expectHeuristicSignals(result);
    expect(result.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'cross-feature-usage', strength: 'moderate' }),
      expect.objectContaining({ type: 'barrel-participation', strength: 'weak' }),
    ]));
  });

  it('classifies a barrel-exported shared type as shared-surface', async () => {
    const symbol = symbolNode(
      'button-props',
      'repo-a:src/shared/components/Button.tsx',
      'repo-a',
      'src/shared/components/Button.tsx',
      'ButtonProps',
      'interface',
      true,
    );
    const relation = fileRelation(symbol.fileId, symbol.repo, symbol.filePath, symbol.symbolId, symbol.name, true);
    const barrelFile = fileNode('repo-a:src/shared/components/index.ts', 'repo-a', 'src/shared/components/index.ts');
    seedTarget(symbol, relation);
    getImportingFilesMock.mockResolvedValue([
      fileNode('repo-a:src/features/orders/OrderPage.tsx', 'repo-a', 'src/features/orders/OrderPage.tsx'),
      fileNode('repo-a:src/features/profile/ProfilePage.tsx', 'repo-a', 'src/features/profile/ProfilePage.tsx'),
    ]);
    getReexportingFilesMock.mockResolvedValue([barrelFile]);
    getFileRelationByIdMock.mockImplementation(async (fileId: string) => {
      if (fileId === relation.fileId) {
        return relation;
      }

      if (fileId === barrelFile.fileId) {
        return {
          fileId: barrelFile.fileId,
          repo: 'repo-a',
          filePath: barrelFile.filePath,
          classification: 'source' as const,
          symbolIds: [],
          symbolNames: [],
          imports: [],
          exports: [{
            fileId: barrelFile.fileId,
            kind: 'reexport-named' as const,
            exportedName: 'ButtonProps',
            localName: 'ButtonProps',
            source: './Button',
          }],
          importTokens: [],
        };
      }

      return null;
    });

    const result = await analyzeSymbolOwnership({ symbolId: symbol.symbolId });

    expect(result.ownership).toBe('shared-surface');
    expect(result.apiBoundary).toBe('shared-boundary');
    expect(result.confidence).toBe('high');
    expect(result.summary).toBe('type exposed through barrel export and used across multiple feature areas');
    expectHeuristicSignals(result);
    expect(result.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'barrel-participation', strength: 'strong' }),
    ]));
  });

  it('keeps broad infrastructure fan-out as shared-internal without overstating public surface', async () => {
    const symbol = symbolNode(
      'runtime-config',
      'repo-a:src/infrastructure/config/runtimeConfig.ts',
      'repo-a',
      'src/infrastructure/config/runtimeConfig.ts',
      'runtimeConfig',
      'variable',
      true,
    );
    const relation = fileRelation(symbol.fileId, symbol.repo, symbol.filePath, symbol.symbolId, symbol.name, true);
    seedTarget(symbol, relation);
    getImportingFilesMock.mockResolvedValue([
      fileNode('repo-a:src/app/page.tsx', 'repo-a', 'src/app/page.tsx'),
      fileNode('repo-a:src/features/orders/OrderPage.tsx', 'repo-a', 'src/features/orders/OrderPage.tsx'),
      fileNode('repo-a:src/features/billing/BillingPage.tsx', 'repo-a', 'src/features/billing/BillingPage.tsx'),
      fileNode('repo-a:src/features/profile/ProfilePage.tsx', 'repo-a', 'src/features/profile/ProfilePage.tsx'),
      fileNode('repo-a:src/features/admin/AdminPage.tsx', 'repo-a', 'src/features/admin/AdminPage.tsx'),
      fileNode('repo-a:src/lib/bootstrap/initRuntime.ts', 'repo-a', 'src/lib/bootstrap/initRuntime.ts'),
    ]);

    const result = await analyzeSymbolOwnership({ symbolId: symbol.symbolId });

    expect(result.ownership).toBe('shared-internal');
    expect(result.apiBoundary).toBe('shared-boundary');
    expect(result.summary).toBe('infrastructure utility with broad importer fan-out but no stable entry-surface signal');
    expectHeuristicSignals(result);
    expect(result.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'repo-wide-usage', strength: 'strong' }),
    ]));
  });

  it('recognizes a framework entrypoint as a shared boundary surface even without importer fan-out', async () => {
    const symbol = symbolNode(
      'root-layout',
      'repo-a:src/app/layout.tsx',
      'repo-a',
      'src/app/layout.tsx',
      'RootLayout',
      'function',
      true,
    );
    const relation = fileRelation(symbol.fileId, symbol.repo, symbol.filePath, symbol.symbolId, symbol.name, true, 'default');
    seedTarget(symbol, relation);
    getImportingFilesMock.mockResolvedValue([]);

    const result = await analyzeSymbolOwnership({ symbolId: symbol.symbolId });

    expect(result.ownership).toBe('shared-surface');
    expect(result.apiBoundary).toBe('shared-boundary');
    expect(result.confidence).toBe('medium');
    expect(result.summary).toBe('function exposed on a framework entry surface');
    expectHeuristicSignals(result);
    expect(result.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'path-boundary',
        strength: 'strong',
        note: expect.stringContaining('framework entry-surface convention'),
      }),
      expect.objectContaining({ type: 'barrel-participation', strength: 'moderate' }),
    ]));
  });

  it('returns unknown for mixed internal-path and broad surface signals', async () => {
    const symbol = symbolNode(
      'mixed-export',
      'repo-a:src/utils/private/mixed.ts',
      'repo-a',
      'src/utils/private/mixed.ts',
      'mixedExport',
      'function',
      true,
    );
    const relation = fileRelation(symbol.fileId, symbol.repo, symbol.filePath, symbol.symbolId, symbol.name, true);
    const barrelFile = fileNode('repo-a:src/index.ts', 'repo-a', 'src/index.ts');
    seedTarget(symbol, relation);
    getImportingFilesMock.mockResolvedValue([
      fileNode('repo-a:src/app/page.tsx', 'repo-a', 'src/app/page.tsx'),
      fileNode('repo-a:src/features/orders/OrderPage.tsx', 'repo-a', 'src/features/orders/OrderPage.tsx'),
      fileNode('repo-a:src/features/billing/BillingPage.tsx', 'repo-a', 'src/features/billing/BillingPage.tsx'),
      fileNode('repo-a:src/features/profile/ProfilePage.tsx', 'repo-a', 'src/features/profile/ProfilePage.tsx'),
      fileNode('repo-a:src/features/admin/AdminPage.tsx', 'repo-a', 'src/features/admin/AdminPage.tsx'),
      fileNode('repo-a:src/lib/bootstrap/initRuntime.ts', 'repo-a', 'src/lib/bootstrap/initRuntime.ts'),
    ]);
    getReexportingFilesMock.mockResolvedValue([barrelFile]);
    getFileRelationByIdMock.mockImplementation(async (fileId: string) => {
      if (fileId === relation.fileId) {
        return relation;
      }

      if (fileId === barrelFile.fileId) {
        return {
          fileId: barrelFile.fileId,
          repo: 'repo-a',
          filePath: barrelFile.filePath,
          classification: 'source' as const,
          symbolIds: [],
          symbolNames: [],
          imports: [],
          exports: [{
            fileId: barrelFile.fileId,
            kind: 'reexport-named' as const,
            exportedName: 'mixedExport',
            localName: 'mixedExport',
            source: './utils/private/mixed',
          }],
          importTokens: [],
        };
      }

      return null;
    });

    const result = await analyzeSymbolOwnership({ symbolId: symbol.symbolId });

    expect(result.ownership).toBe('unknown');
    expect(result.apiBoundary).toBe('unknown');
    expect(result.confidence).toBe('low');
    expect(result.summary).toContain('mixed ownership signals');
    expectHeuristicSignals(result);
    expect(result.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'path-boundary', strength: 'strong' }),
      expect.objectContaining({ type: 'barrel-participation', strength: 'strong' }),
      expect.objectContaining({ type: 'repo-wide-usage', strength: 'strong' }),
    ]));
  });
});
