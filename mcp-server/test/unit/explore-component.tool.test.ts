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

  it('returns a normalized component response with target structure and related-file results', async () => {
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
        totalCandidateCount: 1,
        relatedFileCount: 0,
        totalRelatedFileCount: 0,
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
        totalRelatedFileCount: 2,
        neighboringFileCount: 0,
        definedSymbolCount: 1,
        exportedSymbolCount: 1,
      },
      relatedFileBuckets: {
        directConsumers: {
          kind: 'direct_consumers',
          label: 'Direct consumers (exact)',
          explanation: 'confirmed symbol-level usage',
          confidence: 'high',
          coverage: 'exact',
          entries: [],
          total: 0,
          shown: 0,
          truncated: false,
        },
        indirectConsumers: {
          kind: 'indirect_consumers',
          label: 'Indirect consumers (inferred)',
          explanation: 'likely usage via wrappers or re-exports',
          confidence: 'medium',
          coverage: 'inferred',
          entries: [],
          total: 0,
          shown: 0,
          truncated: false,
        },
        relatedContext: {
          kind: 'related_context',
          label: 'Related context (exploratory)',
          explanation: 'nearby or dependent files, not guaranteed direct usage',
          confidence: 'low',
          coverage: 'exploratory',
          entries: [
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
          total: 2,
          shown: 2,
          truncated: false,
        },
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
    expect(parsed).toEqual(
      expect.objectContaining({
        tool: 'explore_component',
        version: '1',
        mode: 'agent',
        query: expect.objectContaining({
          target: 'Button',
          repo: 'repo-gamma',
          filePath: 'components/ui/Button.tsx',
          symbolName: 'Button',
        }),
      }),
    );
    expect(parsed.target).toEqual(
      expect.objectContaining({
        status: 'resolved',
        symbolId: 'repo-gamma:components/ui/Button.tsx:function:Button:1',
        role: 'component',
        family: 'ui_component',
        clusterRef: 'cluster:component:button',
        confidence: 'high',
        ui: expect.objectContaining({
          renderTreeSummary: expect.objectContaining({
            completeness: 0.5,
          }),
          renderedByTreeSummary: expect.objectContaining({
            completeness: 1,
          }),
          observedProps: [
            { propName: 'variant', count: 2 },
            { propName: 'disabled', count: 1 },
          ],
        }),
      }),
    );
    expect(parsed.results.primary).toEqual([
      expect.objectContaining({
        kind: 'related_file',
        title: 'components/ui/DownloadButton.tsx',
        rank: 1,
        filePath: 'components/ui/DownloadButton.tsx',
        role: 'component',
        confidence: 'medium',
        matchStrength: 'high',
        relationshipKinds: ['file_imports_file'],
        family: 'ui_component',
      }),
      expect.objectContaining({
        kind: 'related_file',
        rank: 2,
        filePath: 'components/ContractList.tsx',
      }),
    ]);
    expect(parsed.results).not.toHaveProperty('secondary');
    expect(parsed.alternatives).toBeUndefined();
    expect(parsed.direct_consumers).toEqual(
      expect.objectContaining({
        label: 'Direct consumers (exact)',
        total: 0,
        shown: 0,
        truncated: false,
      }),
    );
    expect(parsed.related_context).toEqual(
      expect.objectContaining({
        label: 'Related context (exploratory)',
        total: 2,
        shown: 2,
        truncated: false,
      }),
    );
    expect(parsed.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'target_family',
          value: 'ui_component',
        }),
        expect.objectContaining({
          kind: 'ui_completeness',
          value: '50%',
        }),
      ]),
    );
    expect(parsed.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: 'explore_component',
          reason: 'inspect the strongest related component',
          query: expect.objectContaining({
            name: 'components/ui/DownloadButton.tsx',
            repo: 'repo-gamma',
          }),
        }),
        expect.objectContaining({
          tool: 'find_precedents',
          query: expect.objectContaining({
            name: 'components/ui/Button.tsx',
            repo: 'repo-gamma',
            mode: 'file',
          }),
        }),
        expect.objectContaining({
          tool: 'collect_refactor_context',
          query: expect.objectContaining({
            name: 'components/ui/Button.tsx',
            repo: 'repo-gamma',
            mode: 'file',
          }),
        }),
      ]),
    );
    expect(parsed).not.toHaveProperty('related_entities');
    expect(parsed).not.toHaveProperty('impact');
    expect(parsed.summary).toEqual(
      expect.objectContaining({
        resultCount: 2,
        primaryCount: 2,
        confidence: 'high',
      }),
    );
    expect(parsed.diagnostics).toEqual(
      expect.objectContaining({
        warnings: [],
        limits: expect.objectContaining({
          resultLimit: 8,
          navigationHintLimit: 3,
        }),
      }),
    );
    expect(parsed.expansions).toEqual(
      expect.objectContaining({
        'cluster:component:button': expect.objectContaining({
          kind: 'cluster-context',
        }),
        'ui-renders:repo-gamma:components/ui/Button.tsx:function:Button:1': expect.objectContaining({
          kind: 'ui-renders',
        }),
        'ui-rendered-by:repo-gamma:components/ui/Button.tsx:function:Button:1': expect.objectContaining({
          kind: 'ui-rendered-by',
        }),
      }),
    );
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
        totalCandidateCount: 0,
        relatedFileCount: 0,
        totalRelatedFileCount: 0,
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
    expect(parsed.results).not.toHaveProperty('secondary');
    expect(parsed.diagnostics.notes).toEqual(
      expect.arrayContaining(['No primary symbol resolved for the requested component']),
    );
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
        totalCandidateCount: 0,
        relatedFileCount: 0,
        totalRelatedFileCount: 0,
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
        totalRelatedFileCount: 0,
        neighboringFileCount: 0,
        definedSymbolCount: 0,
        exportedSymbolCount: 0,
      },
      rawContext: {},
    });

    const result = await runExploreComponentTool({
      name: 'Button',
      detail: 'debug',
      expandDebug: true,
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(buildIndexedSymbolExplainabilityMock).toHaveBeenCalledWith(expect.any(Object), 'debug');
    expect(parsed.mode).toBe('debug');
  });
});
