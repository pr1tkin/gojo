import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const {
  getFileExplorationContextMock,
  getSymbolExplorationContextMock,
  getUiHierarchySummaryMock,
  buildExploreComponentTrustMetadataMock,
  buildIndexedSymbolExplainabilityMock,
  buildRelatedFileExplainabilityMock,
  buildSymbolCandidateExplainabilityMock,
} = vi.hoisted(() => ({
  getFileExplorationContextMock: vi.fn(),
  getSymbolExplorationContextMock: vi.fn(),
  getUiHierarchySummaryMock: vi.fn(),
  buildExploreComponentTrustMetadataMock: vi.fn(),
  buildIndexedSymbolExplainabilityMock: vi.fn(),
  buildRelatedFileExplainabilityMock: vi.fn(),
  buildSymbolCandidateExplainabilityMock: vi.fn(),
}));

vi.mock('../../src/orchestrator/index.js', () => ({
  getFileExplorationContext: getFileExplorationContextMock,
  getSymbolExplorationContext: getSymbolExplorationContextMock,
  getUiHierarchySummary: getUiHierarchySummaryMock,
}));

vi.mock('../../src/tools/trust-metadata.js', () => ({
  buildExploreComponentTrustMetadata: buildExploreComponentTrustMetadataMock,
}));

vi.mock('../../src/tools/explainability.js', () => ({
  buildIndexedSymbolExplainability: buildIndexedSymbolExplainabilityMock,
  buildRelatedFileExplainability: buildRelatedFileExplainabilityMock,
  buildSymbolCandidateExplainability: buildSymbolCandidateExplainabilityMock,
}));

import { exploreComponentToolDefinition, runExploreComponentTool } from '../../src/tools/explore-component.js';

describe('explore_component tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUiHierarchySummaryMock.mockResolvedValue(null);
    buildIndexedSymbolExplainabilityMock.mockResolvedValue({
      family: 'ui_component',
      role: 'component',
      confidence: 'high',
      selectionReason: 'resolved primary symbol',
      explanationSignals: {},
      clusterContext: {
        parentClusterId: 'cluster:component:button',
        clusterRole: 'ui_component',
        isCoreMember: true,
      },
    });
    buildRelatedFileExplainabilityMock.mockResolvedValue({
      family: 'ui_component',
      role: 'component',
      confidence: 'medium',
      selectionReason: 'graph-related file context',
      explanationSignals: {},
      clusterContext: {
        parentClusterId: 'cluster:component:button',
        clusterRole: 'ui_component',
        isCoreMember: true,
      },
    });
    buildSymbolCandidateExplainabilityMock.mockResolvedValue({
      family: 'ui_component',
      role: 'component',
      confidence: 'high',
      selectionReason: 'exact name match',
      explanationSignals: {},
      clusterContext: {
        parentClusterId: 'cluster:component:button',
        clusterRole: 'ui_component',
        isCoreMember: true,
      },
    });
    buildExploreComponentTrustMetadataMock.mockResolvedValue({
      coverage: {
        filesAnalyzed: 95,
        filesTotal: 100,
        ratio: 0.95,
        scope: 'relevant_source',
        raw: {
          filesAnalyzed: 95,
          filesTotal: 400,
          ratio: 0.238,
        },
        relevant: {
          filesAnalyzed: 95,
          filesTotal: 100,
          ratio: 0.95,
        },
      },
      confidence: 'high',
    });
  });

  it('accepts the narrow public input shape', () => {
    const parsed = z.object(exploreComponentToolDefinition.inputSchema).parse({
      name: 'Button',
      repo: 'repo-gamma',
      limit: 3,
      relatedLimit: 8,
      expandRelated: true,
    });

    expect(parsed).toEqual({
      name: 'Button',
      repo: 'repo-gamma',
      limit: 3,
      relatedLimit: 8,
      expandRelated: true,
    });
  });

  it('returns shaped target, related-file tiers, and compact UI context', async () => {
    getSymbolExplorationContextMock.mockResolvedValue({
      query: 'Button',
      repo: 'repo-gamma',
      kind: undefined,
      primarySymbol: {
        symbolId: 'repo-gamma:components/ui/Button.tsx:function:Button:1',
        fileId: 'repo-gamma:components/ui/Button.tsx',
        name: 'Button',
        kind: 'function',
        repo: 'repo-gamma',
        filePath: 'components/ui/Button.tsx',
        startLine: 1,
        endLine: 10,
        exported: true,
      },
      primaryFile: {
        nodeType: 'file',
        fileId: 'repo-gamma:components/ui/Button.tsx',
        repoId: 'repo-gamma',
        filePath: 'components/ui/Button.tsx',
        classification: 'source',
      },
      rankedSymbols: [
        {
          item: {
            symbolId: 'repo-gamma:components/ui/Button.tsx:function:Button:1',
            fileId: 'repo-gamma:components/ui/Button.tsx',
            name: 'Button',
            kind: 'function',
            repo: 'repo-gamma',
            filePath: 'components/ui/Button.tsx',
            startLine: 1,
            endLine: 10,
            exported: true,
          },
          score: 16,
          reasons: [{ signal: 'exact_name', value: 10 }],
        },
      ],
      relatedFiles: [],
      exportedSymbols: [
        {
          nodeType: 'symbol',
          symbolId: 'repo-gamma:components/ui/Button.tsx:function:Button:1',
          fileId: 'repo-gamma:components/ui/Button.tsx',
          repoId: 'repo-gamma',
          filePath: 'components/ui/Button.tsx',
          name: 'Button',
          kind: 'function',
          exported: true,
          startLine: 1,
          endLine: 10,
        },
      ],
      summary: {
        candidateCount: 1,
        relatedFileCount: 0,
        exportedSymbolCount: 1,
      },
      rawContext: {},
    });
    getFileExplorationContextMock.mockResolvedValue({
      fileId: 'repo-gamma:components/ui/Button.tsx',
      primaryFile: {
        nodeType: 'file',
        fileId: 'repo-gamma:components/ui/Button.tsx',
        repoId: 'repo-gamma',
        filePath: 'components/ui/Button.tsx',
        classification: 'source',
      },
      repo: 'repo-gamma',
      relatedFiles: [
        {
          file: {
            nodeType: 'file',
            fileId: 'repo-gamma:components/ui/DownloadButton.tsx',
            repoId: 'repo-gamma',
            filePath: 'components/ui/DownloadButton.tsx',
            classification: 'source',
          },
          score: 25,
          reason: 'direct import',
          reasons: [{ signal: 'graph_connection', value: 9 }],
          via: ['file_imports_file'],
        },
        {
          file: {
            nodeType: 'file',
            fileId: 'repo-gamma:components/ContractList.tsx',
            repoId: 'repo-gamma',
            filePath: 'components/ContractList.tsx',
            classification: 'source',
          },
          score: 20,
          reason: 'direct import',
          reasons: [{ signal: 'graph_connection', value: 9 }],
          via: ['file_imports_file'],
        },
      ],
      neighboringFiles: [],
      definedSymbols: [
        {
          nodeType: 'symbol',
          symbolId: 'repo-gamma:components/ui/Button.tsx:function:Button:1',
          fileId: 'repo-gamma:components/ui/Button.tsx',
          repoId: 'repo-gamma',
          filePath: 'components/ui/Button.tsx',
          name: 'Button',
          kind: 'function',
          exported: true,
          startLine: 1,
          endLine: 10,
        },
      ],
      exportedSymbols: [
        {
          nodeType: 'symbol',
          symbolId: 'repo-gamma:components/ui/Button.tsx:function:Button:1',
          fileId: 'repo-gamma:components/ui/Button.tsx',
          repoId: 'repo-gamma',
          filePath: 'components/ui/Button.tsx',
          name: 'Button',
          kind: 'function',
          exported: true,
          startLine: 1,
          endLine: 10,
        },
      ],
      summary: {
        relatedFileCount: 2,
        neighboringFileCount: 0,
        definedSymbolCount: 1,
        exportedSymbolCount: 1,
      },
      rawContext: {},
    });
    getUiHierarchySummaryMock.mockResolvedValue({
      target: {
        filePath: 'components/ui/Button.tsx',
        symbolId: 'repo-gamma:components/ui/Button.tsx:function:Button:1',
        symbolName: 'Button',
      },
      renders: [],
      renderedBy: [],
      renderTree: [
        {
          name: 'Icon',
          filePath: 'components/ui/Icon.tsx',
          symbolId: 'repo-gamma:components/ui/Icon.tsx:function:Icon:1',
          resolved: true,
          resolution: 'resolved_local',
          children: [
            {
              name: 'Tooltip',
              resolved: false,
              resolution: 'external_dependency',
              source: '@pkg/tooltip',
              children: [],
            },
          ],
        },
      ],
      renderTreeSummary: {
        totalNodes: 2,
        resolvedNodes: 1,
        unresolvedNodes: 1,
        completeness: 0.5,
      },
      renderedByTree: [
        {
          name: 'ContractList',
          filePath: 'components/ContractList.tsx',
          symbolId: 'repo-gamma:components/ContractList.tsx:function:ContractList:1',
          resolved: true,
          resolution: 'resolved_local',
          children: [],
        },
      ],
      renderedByTreeSummary: {
        totalNodes: 1,
        resolvedNodes: 1,
        unresolvedNodes: 0,
        completeness: 1,
      },
      observedProps: [
        { propName: 'variant', count: 2 },
        { propName: 'disabled', count: 1 },
      ],
    });

    const result = await runExploreComponentTool({
      name: 'Button',
      repo: 'repo-gamma',
      relatedLimit: 8,
      expandRelated: true,
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(getSymbolExplorationContextMock).toHaveBeenCalledWith('Button', {
      repo: 'repo-gamma',
      limit: 5,
      relatedLimit: 8,
    });
    expect(parsed.target).toEqual(
      expect.objectContaining({
        status: 'resolved',
        symbolId: 'repo-gamma:components/ui/Button.tsx:function:Button:1',
        role: 'component',
        familyRef: 'ui_component',
        clusterRef: 'cluster:component:button',
      }),
    );
    expect(parsed.results.primary).toEqual([
      expect.objectContaining({
        rank: 1,
        filePath: 'components/ui/DownloadButton.tsx',
        role: 'component',
        confidence: 'medium',
      }),
      expect.objectContaining({
        rank: 2,
        filePath: 'components/ContractList.tsx',
      }),
    ]);
    expect(parsed.results.ui).toEqual(
      expect.objectContaining({
        renders: [
          expect.objectContaining({
            name: 'Icon',
            resolution: 'resolved_local',
            children: [
              expect.objectContaining({
                name: 'Tooltip',
                resolution: 'external_dependency',
              }),
            ],
          }),
        ],
      }),
    );
    expect(parsed.navigationHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'open_related',
          filePath: 'components/ui/DownloadButton.tsx',
        }),
        expect.objectContaining({
          type: 'inspect_ui_gaps',
        }),
      ]),
    );
    expect(parsed.summary).toEqual(
      expect.objectContaining({
        resultCount: 2,
        relatedFileCount: 2,
        uiCompleteness: 0.5,
      }),
    );
    expect(parsed.summary.tokenEstimate).toBeGreaterThan(0);
  });

  it('returns safe missing results when no symbol resolves', async () => {
    getSymbolExplorationContextMock.mockResolvedValue({
      query: 'MissingThing',
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
      rawContext: {},
    });

    const result = await runExploreComponentTool({ name: 'MissingThing' });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(parsed.target).toEqual(
      expect.objectContaining({
        status: 'missing',
      }),
    );
    expect(parsed.results.primary).toEqual([]);
    expect(parsed.results.secondary).toEqual([]);
  });

  it('passes debug explainability mode through helper calls', async () => {
    getSymbolExplorationContextMock.mockResolvedValue({
      query: 'Button',
      repo: undefined,
      kind: undefined,
      primarySymbol: {
        symbolId: 'repo-gamma:components/ui/Button.tsx:function:Button:1',
        fileId: 'repo-gamma:components/ui/Button.tsx',
        name: 'Button',
        kind: 'function',
        repo: 'repo-gamma',
        filePath: 'components/ui/Button.tsx',
        startLine: 1,
        endLine: 10,
        exported: true,
      },
      primaryFile: null,
      rankedSymbols: [],
      relatedFiles: [],
      exportedSymbols: [],
      summary: {
        candidateCount: 0,
        relatedFileCount: 0,
        exportedSymbolCount: 0,
      },
      rawContext: {},
    });
    getFileExplorationContextMock.mockResolvedValue({
      fileId: 'repo-gamma:components/ui/Button.tsx',
      primaryFile: null,
      repo: 'repo-gamma',
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
      rawContext: {},
    });

    await runExploreComponentTool({
      name: 'Button',
      detail: 'debug',
      expandDebug: true,
    });

    expect(buildIndexedSymbolExplainabilityMock).toHaveBeenCalledWith(expect.any(Object), 'debug');
  });
});
