import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  analyzeSymbolImpactMock,
  analyzeSymbolOwnershipMock,
  getImportedFilesMock,
  getRepoFilesMock,
} = vi.hoisted(() => ({
  analyzeSymbolImpactMock: vi.fn(),
  analyzeSymbolOwnershipMock: vi.fn(),
  getImportedFilesMock: vi.fn(),
  getRepoFilesMock: vi.fn(),
}));

vi.mock('../../src/orchestrator/impact-analysis-service.js', () => ({
  analyzeSymbolImpact: analyzeSymbolImpactMock,
}));

vi.mock('../../src/orchestrator/symbol-ownership-service.js', () => ({
  analyzeSymbolOwnership: analyzeSymbolOwnershipMock,
}));

vi.mock('../../src/graph/query.js', () => ({
  getImportedFiles: getImportedFilesMock,
  getRepoFiles: getRepoFilesMock,
}));

import { planSymbolChange } from '../../src/orchestrator/change-planning-service.js';

function ownershipResult(
  filePath: string,
  symbolName: string,
  kind: 'function' | 'variable' | 'interface' = 'function',
  overrides: Partial<Awaited<ReturnType<typeof analyzeSymbolOwnershipMock>>> = {},
) {
  return {
    target: {
      filePath,
      symbolId: `${filePath}:${symbolName}`,
      symbolName,
      kind,
    },
    ownership: 'internal-local' as const,
    apiBoundary: 'not-api-like' as const,
    confidence: 'high' as const,
    signals: [],
    summary: '',
    ...overrides,
  };
}

function impactResult(
  filePath: string,
  symbolName: string,
  kind: 'function' | 'variable' | 'interface' = 'function',
  overrides: Partial<Awaited<ReturnType<typeof analyzeSymbolImpactMock>>> = {},
) {
  return {
    mode: 'exploratory' as const,
    target: {
      requestedRepoId: 'repo-a',
      requestedSymbolId: `${filePath}:${symbolName}`,
      requestedFilePath: filePath,
      requestedSymbolName: symbolName,
      symbol: null,
      symbolId: `${filePath}:${symbolName}`,
      symbolName,
      kind,
      repoId: 'repo-a',
      file: {
        nodeType: 'file' as const,
        fileId: `repo-a:${filePath}`,
        repoId: 'repo-a',
        filePath,
        classification: 'source' as const,
      },
    },
    directlyImpactedSymbols: [],
    directlyImpactedFiles: [],
    transitiveImpacts: [],
    impactSummary: {
      directFiles: 0,
      directSymbols: 0,
      transitiveFiles: 0,
      transitiveSymbols: 0,
      viaGroups: 0,
      highlightedSurfaces: [],
      featureClusters: [],
      transitiveGroups: [],
    },
    summary: {
      directFileCount: 0,
      directSymbolCount: 0,
      transitiveFileCount: 0,
      transitiveSymbolCount: 0,
      highConfidenceImpactCount: 0,
      mediumConfidenceImpactCount: 0,
      lowConfidenceImpactCount: 0,
      symbolDirectImpactCount: 0,
      fileDirectImpactCount: 0,
      proxyImpactCount: 0,
      localSymbolImpactCount: 0,
      overview: '',
      ambiguityDetected: false,
      notes: [],
    },
    publicSurfaceRisk: {
      level: 'unknown' as const,
      notes: [],
    },
    uiImpact: undefined,
    ...overrides,
  };
}

function directFile(filePath: string, reason: 'imports-target' | 'reexports-target' = 'imports-target', confidence: 'high' | 'medium' | 'low' = 'high') {
  return {
    file: null,
    fileId: `repo-a:${filePath}`,
    filePath,
    repoId: 'repo-a',
    impactScope: 'file-direct' as const,
    confidence,
    evidence: [{
      reason,
      confidence,
      source: 'graph' as const,
      impactScope: 'file-direct' as const,
      depth: 0,
      via: [],
      notes: [],
    }],
  };
}

function directSymbol(filePath: string, symbolName: string, confidence: 'high' | 'medium' | 'low' = 'high') {
  return {
    symbol: null,
    file: null,
    symbolId: `repo-a:${filePath}:${symbolName}`,
    symbolName,
    kind: 'function' as const,
    exported: true,
    filePath,
    repoId: 'repo-a',
    impactScope: 'symbol-direct' as const,
    confidence,
    evidence: [{
      reason: 'calls-target' as const,
      confidence,
      source: 'graph' as const,
      impactScope: 'symbol-direct' as const,
      depth: 0,
      via: [],
      notes: [],
    }],
  };
}

function transitiveFile(filePath: string, confidence: 'medium' | 'low' = 'medium') {
  return {
    depth: 1,
    file: {
      file: null,
      fileId: `repo-a:${filePath}`,
      filePath,
      repoId: 'repo-a',
      impactScope: 'proxy' as const,
      confidence,
      evidence: [{
        reason: 'imports-target' as const,
        confidence,
        source: 'graph' as const,
        impactScope: 'proxy' as const,
        depth: 1,
        via: [{
          fileId: 'repo-a:via',
          filePath: 'src/via.ts',
          reason: 'imports-target' as const,
        }],
        notes: [],
      }],
    },
    confidence,
    evidence: [{
      reason: 'imports-target' as const,
      confidence,
      source: 'graph' as const,
      impactScope: 'proxy' as const,
      depth: 1,
      via: [{
        fileId: 'repo-a:via',
        filePath: 'src/via.ts',
        reason: 'imports-target' as const,
      }],
      notes: [],
    }],
  };
}

describe('change planning service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getImportedFilesMock.mockResolvedValue([]);
    getRepoFilesMock.mockResolvedValue([]);
  });

  it('classifies a local helper as local-file with a defining-file-first plan', async () => {
    analyzeSymbolOwnershipMock.mockResolvedValue(ownershipResult(
      'src/app/_components/audioSimple/AudioSimple.tsx',
      'parseDate',
      'function',
      {
        ownership: 'internal-local',
        apiBoundary: 'not-api-like',
        confidence: 'medium',
        signals: [
          { type: 'export-surface', strength: 'weak', note: 'not exported' },
          { type: 'local-only-usage', strength: 'strong', note: 'local only' },
        ],
        summary: 'function with no shared surface signals',
      },
    ));
    analyzeSymbolImpactMock.mockResolvedValue(impactResult(
      'src/app/_components/audioSimple/AudioSimple.tsx',
      'parseDate',
    ));

    const result = await planSymbolChange({ symbolId: 'parse-date' });

    expect(result.scope).toBe('local-file');
    expect(result.risk).toBe('low');
    expect(result.primaryEditFiles).toEqual(['src/app/_components/audioSimple/AudioSimple.tsx']);
    expect(result.secondaryEditFiles).toEqual([]);
    expect(result.uiPlanningHints).toBeUndefined();
    expect(result.summary).toContain('defining file');
    expect(result.orderedPlan).toEqual([
      expect.objectContaining({
        order: 1,
        filePath: 'src/app/_components/audioSimple/AudioSimple.tsx',
        role: 'edit-primary',
      }),
    ]);
  });

  it('suppresses non-test downstream files for local-file plans', async () => {
    analyzeSymbolOwnershipMock.mockResolvedValue(ownershipResult(
      'src/app/_components/audioSimple/AudioSimple.tsx',
      'parseDate',
      'function',
      {
        ownership: 'internal-local',
        apiBoundary: 'not-api-like',
        confidence: 'medium',
        signals: [
          { type: 'export-surface', strength: 'weak', note: 'not exported' },
          { type: 'local-only-usage', strength: 'strong', note: 'local only' },
        ],
        summary: 'function with no shared surface signals',
      },
    ));
    analyzeSymbolImpactMock.mockResolvedValue(impactResult(
      'src/app/_components/audioSimple/AudioSimple.tsx',
      'parseDate',
      'function',
      {
        directlyImpactedFiles: [
          directFile('src/app/audio/[sophoraId]/page.tsx'),
          directFile('src/app/_components/audioSimple/AudioSimple.stories.tsx'),
        ],
        transitiveImpacts: [transitiveFile('src/app/audio/[sophoraId]/AudioContent.tsx')],
        summary: {
          directFileCount: 2,
          directSymbolCount: 0,
          transitiveFileCount: 1,
          transitiveSymbolCount: 0,
          highConfidenceImpactCount: 1,
          mediumConfidenceImpactCount: 2,
          lowConfidenceImpactCount: 0,
          symbolDirectImpactCount: 0,
          fileDirectImpactCount: 2,
          proxyImpactCount: 1,
          localSymbolImpactCount: 0,
          overview: '',
          ambiguityDetected: false,
          notes: [],
        },
      },
    ));

    const result = await planSymbolChange({ symbolId: 'parse-date-leak' });

    expect(result.scope).toBe('local-file');
    expect(result.secondaryEditFiles).toEqual([]);
    expect(result.reviewFiles).toEqual(['src/app/_components/audioSimple/AudioSimple.stories.tsx']);
    expect(result.orderedPlan).toEqual([
      expect.objectContaining({
        order: 1,
        filePath: 'src/app/_components/audioSimple/AudioSimple.tsx',
        role: 'edit-primary',
      }),
      expect.objectContaining({
        order: 2,
        filePath: 'src/app/_components/audioSimple/AudioSimple.stories.tsx',
        role: 'test-or-story',
      }),
    ]);
  });

  it('classifies a feature-local exported hook as feature-bounded', async () => {
    analyzeSymbolOwnershipMock.mockResolvedValue(ownershipResult(
      'components/admin/cleanup/store/admin-cleanup-context.ts',
      'useAdminCleanupStore',
      'variable',
      {
        ownership: 'feature-internal',
        apiBoundary: 'feature-boundary',
        confidence: 'medium',
        signals: [
          { type: 'export-surface', strength: 'moderate', note: 'exported from defining file' },
          { type: 'path-boundary', strength: 'moderate', note: 'feature area' },
          { type: 'feature-local-usage', strength: 'strong', note: 'bounded to one feature' },
        ],
        summary: 'variable used within one feature area',
      },
    ));
    analyzeSymbolImpactMock.mockResolvedValue(impactResult(
      'components/admin/cleanup/store/admin-cleanup-context.ts',
      'useAdminCleanupStore',
      'variable',
      {
        directlyImpactedFiles: [
          directFile('components/admin/cleanup/table.tsx'),
          directFile('components/admin/cleanup/table-row.tsx'),
        ],
        summary: {
          directFileCount: 2,
          directSymbolCount: 0,
          transitiveFileCount: 0,
          transitiveSymbolCount: 0,
          highConfidenceImpactCount: 2,
          mediumConfidenceImpactCount: 0,
          lowConfidenceImpactCount: 0,
          symbolDirectImpactCount: 0,
          fileDirectImpactCount: 2,
          proxyImpactCount: 0,
          localSymbolImpactCount: 0,
          overview: '',
          ambiguityDetected: false,
          notes: [],
        },
      },
    ));

    const result = await planSymbolChange({ symbolId: 'admin-cleanup-store' });

    expect(result.scope).toBe('feature-bounded');
    expect(result.risk).toBe('low');
    expect(result.secondaryEditFiles).toEqual([
      'components/admin/cleanup/table-row.tsx',
      'components/admin/cleanup/table.tsx',
    ]);
    expect(result.summary).toContain('feature-bounded');
    expect(result.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'feature-bounded', strength: 'strong' }),
      expect.objectContaining({ type: 'direct-impact' }),
    ]));
  });

  it('adds UI planning hints for a shared UI primitive without changing edit targets', async () => {
    analyzeSymbolOwnershipMock.mockResolvedValue(ownershipResult(
      'components/common/react-select.tsx',
      'ReactSelectSingle',
      'variable',
      {
        ownership: 'shared-internal',
        apiBoundary: 'shared-boundary',
        confidence: 'high',
        signals: [
          { type: 'export-surface', strength: 'moderate', note: 'exported from defining file' },
          { type: 'repo-wide-usage', strength: 'strong', note: 'broad repository usage' },
          { type: 'ui-parent-reuse', strength: 'strong', note: 'rendered by many parent components' },
          { type: 'ui-page-presence', strength: 'strong', note: 'rendered in two page surfaces' },
        ],
        summary: 'component reused across 19 parent components and 2 page surfaces without stable entry-surface exposure',
      },
    ));
    analyzeSymbolImpactMock.mockResolvedValue(impactResult(
      'components/common/react-select.tsx',
      'ReactSelectSingle',
      'variable',
      {
        directlyImpactedFiles: [
          directFile('components/profile/form.tsx'),
          directFile('components/project/settings/form.tsx'),
        ],
        transitiveImpacts: [transitiveFile('pages/project/[id]/index.tsx')],
        uiImpact: {
          parentComponents: [
            {
              componentName: 'ProfileForm',
              filePath: 'components/profile/form.tsx',
              symbolId: 'profile-form',
              resolved: true,
            },
            {
              componentName: 'SettingsForm',
              filePath: 'components/project/settings/form.tsx',
              symbolId: 'settings-form',
              resolved: true,
            },
          ],
          parentPages: [
            {
              componentName: 'TranslationPage',
              filePath: 'pages/project/[id]/index.tsx',
              symbolId: 'translation-page',
              resolved: true,
            },
          ],
          observedPropUsage: [
            { propName: 'options', count: 10 },
            { propName: 'defaultValue', count: 9 },
            { propName: 'onChange', count: 9 },
          ],
          confidence: 'medium',
        },
        summary: {
          directFileCount: 2,
          directSymbolCount: 0,
          transitiveFileCount: 1,
          transitiveSymbolCount: 0,
          highConfidenceImpactCount: 2,
          mediumConfidenceImpactCount: 1,
          lowConfidenceImpactCount: 0,
          symbolDirectImpactCount: 0,
          fileDirectImpactCount: 2,
          proxyImpactCount: 1,
          localSymbolImpactCount: 0,
          overview: '',
          ambiguityDetected: false,
          notes: [],
        },
      },
    ));

    const result = await planSymbolChange({ symbolId: 'react-select-single' });

    expect(result.scope).toBe('broad-shared');
    expect(result.risk).toBe('high');
    expect(result.primaryEditFiles).toEqual(['components/common/react-select.tsx']);
    expect(result.secondaryEditFiles).toEqual([]);
    expect(result.reviewFiles).toEqual([
      'pages/project/[id]/index.tsx',
      'components/profile/form.tsx',
      'components/project/settings/form.tsx',
    ]);
    expect(result.uiPlanningHints).toEqual({
      renderingComponents: [
        {
          componentName: 'ProfileForm',
          filePath: 'components/profile/form.tsx',
          symbolId: 'profile-form',
          resolved: true,
        },
        {
          componentName: 'SettingsForm',
          filePath: 'components/project/settings/form.tsx',
          symbolId: 'settings-form',
          resolved: true,
        },
      ],
      renderingPages: [
        {
          componentName: 'TranslationPage',
          filePath: 'pages/project/[id]/index.tsx',
          symbolId: 'translation-page',
          resolved: true,
        },
      ],
      observedPropSurface: [
        { propName: 'options', count: 10 },
        { propName: 'defaultValue', count: 9 },
        { propName: 'onChange', count: 9 },
      ],
      confidence: 'medium',
    });
  });

  it('adds UI planning hints for a feature-local UI component while keeping the plan bounded', async () => {
    analyzeSymbolOwnershipMock.mockResolvedValue(ownershipResult(
      'app/contracts/components/ContractStatsScoreDistributionChart.tsx',
      'ContractStatsScoreDistributionChart',
      'function',
      {
        ownership: 'feature-internal',
        apiBoundary: 'feature-boundary',
        confidence: 'medium',
        signals: [
          { type: 'export-surface', strength: 'moderate', note: 'exported from defining file' },
          { type: 'feature-local-usage', strength: 'strong', note: 'bounded to one feature' },
          { type: 'ui-page-presence', strength: 'moderate', note: 'rendered in a single page surface' },
        ],
        summary: 'component used within one feature area',
      },
    ));
    analyzeSymbolImpactMock.mockResolvedValue(impactResult(
      'app/contracts/components/ContractStatsScoreDistributionChart.tsx',
      'ContractStatsScoreDistributionChart',
      'function',
      {
        directlyImpactedFiles: [
          directFile('app/contracts/[contractId]/ContractDetailPage.tsx'),
        ],
        uiImpact: {
          parentComponents: [
            {
              componentName: 'ContractDetailPage',
              filePath: 'app/contracts/[contractId]/ContractDetailPage.tsx',
              symbolId: 'contract-detail-page',
              resolved: true,
            },
          ],
          parentPages: [
            {
              componentName: 'Page',
              filePath: 'app/contracts/[contractId]/page.tsx',
              symbolId: 'contracts-page',
              resolved: true,
            },
          ],
          observedPropUsage: [
            { propName: 'contractId', count: 1 },
          ],
          confidence: 'medium',
        },
        summary: {
          directFileCount: 1,
          directSymbolCount: 0,
          transitiveFileCount: 0,
          transitiveSymbolCount: 0,
          highConfidenceImpactCount: 1,
          mediumConfidenceImpactCount: 0,
          lowConfidenceImpactCount: 0,
          symbolDirectImpactCount: 0,
          fileDirectImpactCount: 1,
          proxyImpactCount: 0,
          localSymbolImpactCount: 0,
          overview: '',
          ambiguityDetected: false,
          notes: [],
        },
      },
    ));

    const result = await planSymbolChange({ symbolId: 'contract-chart' });

    expect(result.scope).toBe('feature-bounded');
    expect(result.risk).toBe('low');
    expect(result.primaryEditFiles).toEqual(['app/contracts/components/ContractStatsScoreDistributionChart.tsx']);
    expect(result.secondaryEditFiles).toEqual(['app/contracts/[contractId]/ContractDetailPage.tsx']);
    expect(result.uiPlanningHints).toEqual({
      renderingComponents: [
        {
          componentName: 'ContractDetailPage',
          filePath: 'app/contracts/[contractId]/ContractDetailPage.tsx',
          symbolId: 'contract-detail-page',
          resolved: true,
        },
      ],
      renderingPages: [
        {
          componentName: 'Page',
          filePath: 'app/contracts/[contractId]/page.tsx',
          symbolId: 'contracts-page',
          resolved: true,
        },
      ],
      observedPropSurface: [
        { propName: 'contractId', count: 1 },
      ],
      confidence: 'medium',
    });
  });

  it('classifies a barrel-exported shared component as shared-surface and prioritizes the barrel file', async () => {
    analyzeSymbolOwnershipMock.mockResolvedValue(ownershipResult(
      'src/app/_components/button/Button.tsx',
      'Button',
      'variable',
      {
        ownership: 'shared-surface',
        apiBoundary: 'shared-boundary',
        confidence: 'high',
        signals: [
          { type: 'export-surface', strength: 'moderate', note: 'exported from defining file' },
          { type: 'feature-local-usage', strength: 'strong', note: 'bounded feature usage' },
          { type: 'barrel-participation', strength: 'strong', note: 'barrel export' },
        ],
        summary: 'component exposed through barrel export and consumed across multiple downstream files',
      },
    ));
    analyzeSymbolImpactMock.mockResolvedValue(impactResult(
      'src/app/_components/button/Button.tsx',
      'Button',
      'variable',
      {
        directlyImpactedFiles: [
          directFile('src/app/_components/metadata/podcast/Podcast.tsx'),
          directFile('src/app/_components/button/index.ts', 'reexports-target'),
        ],
        transitiveImpacts: [transitiveFile('src/app/podcast/page.tsx')],
        summary: {
          directFileCount: 2,
          directSymbolCount: 0,
          transitiveFileCount: 1,
          transitiveSymbolCount: 0,
          highConfidenceImpactCount: 2,
          mediumConfidenceImpactCount: 1,
          lowConfidenceImpactCount: 0,
          symbolDirectImpactCount: 0,
          fileDirectImpactCount: 2,
          proxyImpactCount: 1,
          localSymbolImpactCount: 0,
          overview: '',
          ambiguityDetected: false,
          notes: [],
        },
      },
    ));

    const result = await planSymbolChange({ symbolId: 'button' });

    expect(result.scope).toBe('shared-surface');
    expect(result.risk).toBe('medium');
    expect(result.summary).toContain('barrel export');
    expect(result.orderedPlan[0]).toEqual(expect.objectContaining({
      filePath: 'src/app/_components/button/Button.tsx',
      role: 'edit-primary',
    }));
    expect(result.orderedPlan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        filePath: 'src/app/_components/button/index.ts',
        role: 'entry-surface',
      }),
      expect.objectContaining({
        filePath: 'src/app/_components/metadata/podcast/Podcast.tsx',
        role: 'review-only',
      }),
    ]));
    expect(result.secondaryEditFiles).toEqual(['src/app/_components/button/index.ts']);
  });

  it('classifies a broadly reused utility as broad-shared and high-risk', async () => {
    analyzeSymbolOwnershipMock.mockResolvedValue(ownershipResult(
      'lib/utils.ts',
      'classNames',
      'function',
      {
        ownership: 'shared-internal',
        apiBoundary: 'shared-boundary',
        confidence: 'medium',
        signals: [
          { type: 'export-surface', strength: 'moderate', note: 'exported' },
          { type: 'repo-wide-usage', strength: 'strong', note: 'broad fan-out' },
        ],
        summary: 'utility with broad importer fan-out but no stable entry-surface signal',
      },
    ));
    analyzeSymbolImpactMock.mockResolvedValue(impactResult(
      'lib/utils.ts',
      'classNames',
      'function',
      {
        directlyImpactedFiles: [
          directFile('components/ui/Button.tsx'),
          directFile('components/ui/TagCloud.tsx'),
          directFile('components/ui/Badge.tsx'),
          directFile('components/ui/Modal.jsx'),
          directFile('app/settings/components/SecondaryNavigation.tsx'),
          directFile('components/HeaderNav.jsx'),
        ],
        transitiveImpacts: [
          transitiveFile('app/contracts/page.tsx'),
          transitiveFile('app/settings/page.tsx'),
          transitiveFile('app/layout.tsx'),
        ],
        summary: {
          directFileCount: 6,
          directSymbolCount: 0,
          transitiveFileCount: 3,
          transitiveSymbolCount: 0,
          highConfidenceImpactCount: 6,
          mediumConfidenceImpactCount: 3,
          lowConfidenceImpactCount: 0,
          symbolDirectImpactCount: 0,
          fileDirectImpactCount: 6,
          proxyImpactCount: 3,
          localSymbolImpactCount: 0,
          overview: '',
          ambiguityDetected: false,
          notes: [],
        },
      },
    ));

    const result = await planSymbolChange({ symbolId: 'classNames' });

    expect(result.scope).toBe('broad-shared');
    expect(result.risk).toBe('high');
    expect(result.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'repo-wide', strength: 'strong' }),
      expect.objectContaining({ type: 'high-fanout', strength: 'strong' }),
    ]));
    expect(result.secondaryEditFiles).toEqual([]);
    expect(result.reviewFiles).toEqual(expect.arrayContaining([
      'components/ui/Button.tsx',
      'app/layout.tsx',
    ]));
    expect(result.reviewFiles).toContain('app/layout.tsx');
  });

  it('keeps framework entry surfaces conservative while highlighting the entry file first', async () => {
    getImportedFilesMock.mockResolvedValue([
      {
        nodeType: 'file',
        fileId: 'repo-a:src/app/providers/AppProviders.tsx',
        repoId: 'repo-a',
        filePath: 'src/app/providers/AppProviders.tsx',
        classification: 'source',
      },
      {
        nodeType: 'file',
        fileId: 'repo-a:src/app/_components/navbar/Navbar.tsx',
        repoId: 'repo-a',
        filePath: 'src/app/_components/navbar/Navbar.tsx',
        classification: 'source',
      },
    ]);
    getRepoFilesMock.mockResolvedValue([
      {
        nodeType: 'file',
        fileId: 'repo-a:src/app/page.tsx',
        repoId: 'repo-a',
        filePath: 'src/app/page.tsx',
        classification: 'source',
      },
      {
        nodeType: 'file',
        fileId: 'repo-a:src/app/providers/AppProviders.tsx',
        repoId: 'repo-a',
        filePath: 'src/app/providers/AppProviders.tsx',
        classification: 'source',
      },
    ]);
    analyzeSymbolOwnershipMock.mockResolvedValue(ownershipResult(
      'src/app/layout.tsx',
      'RootLayout',
      'function',
      {
        ownership: 'shared-surface',
        apiBoundary: 'shared-boundary',
        confidence: 'medium',
        signals: [
          { type: 'export-surface', strength: 'strong', note: 'entry-like export' },
          { type: 'path-boundary', strength: 'strong', note: 'framework entry-surface convention' },
          { type: 'barrel-participation', strength: 'moderate', note: 'entry-like file surface' },
        ],
        summary: 'function exposed on a framework entry surface',
      },
    ));
    analyzeSymbolImpactMock.mockResolvedValue(impactResult(
      'src/app/layout.tsx',
      'RootLayout',
    ));

    const result = await planSymbolChange({ symbolId: 'root-layout' });

    expect(result.scope).toBe('shared-surface');
    expect(result.risk).toBe('medium');
    expect(result.summary).toContain('framework entry surface');
    expect(result.primaryEditFiles).toEqual(['src/app/layout.tsx']);
    expect(result.reviewFiles).toEqual(expect.arrayContaining([
      'src/app/page.tsx',
      'src/app/providers/AppProviders.tsx',
      'src/app/_components/navbar/Navbar.tsx',
    ]));
    expect(result.orderedPlan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        filePath: 'src/app/page.tsx',
        role: 'entry-surface',
      }),
      expect.objectContaining({
        filePath: 'src/app/providers/AppProviders.tsx',
        role: 'review-only',
      }),
    ]));
  });

  it('treats repo-wide infrastructure utilities as broad-shared high-risk changes', async () => {
    analyzeSymbolOwnershipMock.mockResolvedValue(ownershipResult(
      'src/infrastructure/config/runtimeConfig.ts',
      'runtimeConfig',
      'variable',
      {
        ownership: 'shared-internal',
        apiBoundary: 'shared-boundary',
        confidence: 'medium',
        signals: [
          { type: 'export-surface', strength: 'moderate', note: 'exported from defining file' },
          { type: 'repo-wide-usage', strength: 'strong', note: 'broad fan-out' },
          { type: 'path-boundary', strength: 'moderate', note: 'infrastructure-style code' },
        ],
        summary: 'infrastructure utility with broad importer fan-out but no stable entry-surface signal',
      },
    ));
    analyzeSymbolImpactMock.mockResolvedValue(impactResult(
      'src/infrastructure/config/runtimeConfig.ts',
      'runtimeConfig',
      'variable',
      {
        directlyImpactedFiles: [
          directFile('src/app/page.tsx'),
          directFile('src/features/orders/OrderPage.tsx'),
          directFile('src/features/billing/BillingPage.tsx'),
          directFile('src/features/profile/ProfilePage.tsx'),
          directFile('src/features/admin/AdminPage.tsx'),
          directFile('src/lib/bootstrap/initRuntime.ts'),
        ],
        transitiveImpacts: [
          transitiveFile('src/app/layout.tsx'),
          transitiveFile('src/app/orders/page.tsx'),
        ],
        summary: {
          directFileCount: 6,
          directSymbolCount: 0,
          transitiveFileCount: 2,
          transitiveSymbolCount: 0,
          highConfidenceImpactCount: 6,
          mediumConfidenceImpactCount: 2,
          lowConfidenceImpactCount: 0,
          symbolDirectImpactCount: 0,
          fileDirectImpactCount: 6,
          proxyImpactCount: 2,
          localSymbolImpactCount: 0,
          overview: '',
          ambiguityDetected: false,
          notes: [],
        },
      },
    ));

    const result = await planSymbolChange({ symbolId: 'runtime-config' });

    expect(result.scope).toBe('broad-shared');
    expect(result.risk).toBe('high');
    expect(result.summary).toContain('high-risk');
    expect(result.orderedPlan[0]).toEqual(expect.objectContaining({
      filePath: 'src/infrastructure/config/runtimeConfig.ts',
      role: 'edit-primary',
    }));
    expect(result.reviewFiles).toContain('src/features/orders/OrderPage.tsx');
  });
});
