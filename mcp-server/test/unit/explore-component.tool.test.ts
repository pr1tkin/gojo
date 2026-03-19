import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const {
  getFileExplorationContextMock,
  getSymbolExplorationContextMock,
  getUiHierarchySummaryMock,
  buildExploreComponentTrustMetadataMock,
} = vi.hoisted(() => ({
  getFileExplorationContextMock: vi.fn(),
  getSymbolExplorationContextMock: vi.fn(),
  getUiHierarchySummaryMock: vi.fn(),
  buildExploreComponentTrustMetadataMock: vi.fn(),
}));

vi.mock('../../src/orchestrator/index.js', () => ({
  getFileExplorationContext: getFileExplorationContextMock,
  getSymbolExplorationContext: getSymbolExplorationContextMock,
  getUiHierarchySummary: getUiHierarchySummaryMock,
}));

vi.mock('../../src/tools/trust-metadata.js', () => ({
  buildExploreComponentTrustMetadata: buildExploreComponentTrustMetadataMock,
}));

import { exploreComponentToolDefinition, runExploreComponentTool } from '../../src/tools/explore-component.js';

describe('explore_component tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUiHierarchySummaryMock.mockResolvedValue(null);
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
    });

    expect(parsed).toEqual({
      name: 'Button',
      repo: 'repo-gamma',
      limit: 3,
      relatedLimit: 8,
    });
  });

  it('resolves a primary component and includes related, defined, and exported symbols', async () => {
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
      renders: [
        {
          componentName: 'Icon',
          filePath: 'components/ui/Icon.tsx',
          symbolId: 'repo-gamma:components/ui/Icon.tsx:function:Icon:1',
          resolved: true,
        },
      ],
      renderedBy: [
        {
          componentName: 'ContractList',
          filePath: 'components/ContractList.tsx',
          symbolId: 'repo-gamma:components/ContractList.tsx:function:ContractList:1',
          resolved: true,
          resolution: 'resolved_local',
        },
      ],
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
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(getSymbolExplorationContextMock).toHaveBeenCalledWith('Button', {
      repo: 'repo-gamma',
      limit: 5,
      relatedLimit: 8,
    });
    expect(getFileExplorationContextMock).toHaveBeenCalledWith('repo-gamma:components/ui/Button.tsx', {
      relatedLimit: 8,
    });
    expect(getUiHierarchySummaryMock).toHaveBeenCalledWith({
      filePath: 'components/ui/Button.tsx',
      symbolId: 'repo-gamma:components/ui/Button.tsx:function:Button:1',
      symbolName: 'Button',
    });
    expect(parsed).toEqual(
      expect.objectContaining({
        requestedName: 'Button',
        requestedRepo: 'repo-gamma',
        resolution: expect.objectContaining({
          status: 'resolved',
          candidateCount: 1,
          ambiguityDetected: false,
          selectedCandidate: expect.objectContaining({
            fileId: 'repo-gamma:components/ui/Button.tsx',
            name: 'Button',
            score: 16,
          }),
        }),
        resolvedPrimaryFile: expect.objectContaining({
          fileId: 'repo-gamma:components/ui/Button.tsx',
        }),
        relatedFiles: [
          expect.objectContaining({
            file: expect.objectContaining({ fileId: 'repo-gamma:components/ui/DownloadButton.tsx' }),
            score: 25,
          }),
          expect.objectContaining({
            file: expect.objectContaining({ fileId: 'repo-gamma:components/ContractList.tsx' }),
            score: 20,
          }),
        ],
        definedSymbols: [expect.objectContaining({ name: 'Button' })],
        exportedSymbols: [expect.objectContaining({ name: 'Button' })],
        uiHierarchy: {
          target: {
            filePath: 'components/ui/Button.tsx',
            symbolId: 'repo-gamma:components/ui/Button.tsx:function:Button:1',
            symbolName: 'Button',
          },
          renders: [
            expect.objectContaining({
              componentName: 'Icon',
              filePath: 'components/ui/Icon.tsx',
            }),
          ],
          renderTree: [
            expect.objectContaining({
              name: 'Icon',
              filePath: 'components/ui/Icon.tsx',
              resolution: 'resolved_local',
            }),
          ],
          renderTreeSummary: {
            totalNodes: 2,
            resolvedNodes: 1,
            unresolvedNodes: 1,
            completeness: 0.5,
          },
          renderedBy: [
            expect.objectContaining({
              componentName: 'ContractList',
              filePath: 'components/ContractList.tsx',
            }),
          ],
          renderedByTree: [
            expect.objectContaining({
              name: 'ContractList',
              filePath: 'components/ContractList.tsx',
              resolution: 'resolved_local',
            }),
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
        },
        metadata: {
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
        },
        summary: {
          relatedFileCount: 2,
          definedSymbolCount: 1,
          exportedSymbolCount: 1,
        },
      }),
    );
  });

  it('passes repo filtering through to the existing orchestrator service', async () => {
    getSymbolExplorationContextMock.mockResolvedValue({
      query: 'Button',
      repo: 'repo-alpha',
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

    await runExploreComponentTool({
      name: 'Button',
      repo: 'repo-alpha',
      limit: 2,
      relatedLimit: 4,
    });

    expect(getSymbolExplorationContextMock).toHaveBeenCalledWith('Button', {
      repo: 'repo-alpha',
      limit: 2,
      relatedLimit: 4,
    });
  });

  it('surfaces ambiguity conservatively while selecting the strongest ranked candidate', async () => {
    getSymbolExplorationContextMock.mockResolvedValue({
      query: 'AdminProjectPage',
      repo: 'repo-beta',
      kind: undefined,
      primarySymbol: {
        symbolId: 'repo-beta:pages/admin/cleanup.tsx:variable:AdminProjectPage:1',
        fileId: 'repo-beta:pages/admin/cleanup.tsx',
        name: 'AdminProjectPage',
        kind: 'variable',
        repo: 'repo-beta',
        filePath: 'pages/admin/cleanup.tsx',
        startLine: 1,
        endLine: 20,
        exported: false,
      },
      primaryFile: {
        nodeType: 'file',
        fileId: 'repo-beta:pages/admin/cleanup.tsx',
        repoId: 'repo-beta',
        filePath: 'pages/admin/cleanup.tsx',
        classification: 'source',
      },
      rankedSymbols: [
        {
          item: {
            symbolId: 'repo-beta:pages/admin/cleanup.tsx:variable:AdminProjectPage:1',
            fileId: 'repo-beta:pages/admin/cleanup.tsx',
            name: 'AdminProjectPage',
            kind: 'variable',
            repo: 'repo-beta',
            filePath: 'pages/admin/cleanup.tsx',
            startLine: 1,
            endLine: 20,
            exported: false,
          },
          score: 12,
          reasons: [{ signal: 'exact_name', value: 10 }],
        },
        {
          item: {
            symbolId: 'repo-beta:pages/admin/project.tsx:variable:AdminProjectPage:1',
            fileId: 'repo-beta:pages/admin/project.tsx',
            name: 'AdminProjectPage',
            kind: 'variable',
            repo: 'repo-beta',
            filePath: 'pages/admin/project.tsx',
            startLine: 1,
            endLine: 20,
            exported: false,
          },
          score: 12,
          reasons: [{ signal: 'exact_name', value: 10 }],
        },
      ],
      relatedFiles: [],
      exportedSymbols: [],
      summary: {
        candidateCount: 2,
        relatedFileCount: 0,
        exportedSymbolCount: 0,
      },
      rawContext: {},
    });
    getFileExplorationContextMock.mockResolvedValue({
      fileId: 'repo-beta:pages/admin/cleanup.tsx',
      primaryFile: {
        nodeType: 'file',
        fileId: 'repo-beta:pages/admin/cleanup.tsx',
        repoId: 'repo-beta',
        filePath: 'pages/admin/cleanup.tsx',
        classification: 'source',
      },
      repo: 'repo-beta',
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

    const result = await runExploreComponentTool({
      name: 'AdminProjectPage',
      repo: 'repo-beta',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(parsed.resolution).toEqual(
      expect.objectContaining({
        status: 'resolved',
        candidateCount: 2,
        ambiguityDetected: true,
        selectedCandidate: expect.objectContaining({
          fileId: 'repo-beta:pages/admin/cleanup.tsx',
        }),
        alternativeCandidates: [
          expect.objectContaining({
            fileId: 'repo-beta:pages/admin/project.tsx',
          }),
        ],
      }),
    );
  });

  it('degrades safely for missing component names', async () => {
    getSymbolExplorationContextMock.mockResolvedValue({
      query: 'MissingComponent',
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

    const result = await runExploreComponentTool({
      name: 'MissingComponent',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(getFileExplorationContextMock).not.toHaveBeenCalled();
    expect(parsed).toEqual({
      requestedName: 'MissingComponent',
      requestedRepo: undefined,
      resolution: {
        status: 'missing',
        candidateCount: 0,
        ambiguityDetected: false,
        selectedCandidate: null,
        alternativeCandidates: [],
      },
      resolvedPrimarySymbol: null,
      resolvedPrimaryFile: null,
      relatedFiles: [],
      definedSymbols: [],
      exportedSymbols: [],
      summary: {
        relatedFileCount: 0,
        definedSymbolCount: 0,
        exportedSymbolCount: 0,
      },
      metadata: {
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
      },
    });
    expect(getUiHierarchySummaryMock).not.toHaveBeenCalled();
  });

  it('degrades safely when a repo filter removes all candidates', async () => {
    getSymbolExplorationContextMock.mockResolvedValue({
      query: 'Button',
      repo: 'missing-repo',
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

    const result = await runExploreComponentTool({
      name: 'Button',
      repo: 'missing-repo',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(getSymbolExplorationContextMock).toHaveBeenCalledWith('Button', {
      repo: 'missing-repo',
      limit: 5,
      relatedLimit: 10,
    });
    expect(getFileExplorationContextMock).not.toHaveBeenCalled();
    expect(parsed).toEqual({
      requestedName: 'Button',
      requestedRepo: 'missing-repo',
      resolution: {
        status: 'missing',
        candidateCount: 0,
        ambiguityDetected: false,
        selectedCandidate: null,
        alternativeCandidates: [],
      },
      resolvedPrimarySymbol: null,
      resolvedPrimaryFile: null,
      relatedFiles: [],
      definedSymbols: [],
      exportedSymbols: [],
      summary: {
        relatedFileCount: 0,
        definedSymbolCount: 0,
        exportedSymbolCount: 0,
      },
      metadata: {
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
      },
    });
    expect(getUiHierarchySummaryMock).not.toHaveBeenCalled();
  });

  it('keeps explore_component unchanged when no UI hierarchy signals exist', async () => {
    getSymbolExplorationContextMock.mockResolvedValue({
      query: 'Card',
      repo: 'repo-gamma',
      kind: undefined,
      primarySymbol: {
        symbolId: 'repo-gamma:components/ui/Card.tsx:function:Card:1',
        fileId: 'repo-gamma:components/ui/Card.tsx',
        name: 'Card',
        kind: 'function',
        repo: 'repo-gamma',
        filePath: 'components/ui/Card.tsx',
        startLine: 1,
        endLine: 12,
        exported: true,
      },
      primaryFile: {
        nodeType: 'file',
        fileId: 'repo-gamma:components/ui/Card.tsx',
        repoId: 'repo-gamma',
        filePath: 'components/ui/Card.tsx',
        classification: 'source',
      },
      rankedSymbols: [
        {
          item: {
            symbolId: 'repo-gamma:components/ui/Card.tsx:function:Card:1',
            fileId: 'repo-gamma:components/ui/Card.tsx',
            name: 'Card',
            kind: 'function',
            repo: 'repo-gamma',
            filePath: 'components/ui/Card.tsx',
            startLine: 1,
            endLine: 12,
            exported: true,
          },
          score: 14,
          reasons: [{ signal: 'exact_name', value: 10 }],
        },
      ],
      relatedFiles: [],
      exportedSymbols: [],
      summary: {
        candidateCount: 1,
        relatedFileCount: 0,
        exportedSymbolCount: 0,
      },
      rawContext: {},
    });
    getFileExplorationContextMock.mockResolvedValue({
      fileId: 'repo-gamma:components/ui/Card.tsx',
      primaryFile: {
        nodeType: 'file',
        fileId: 'repo-gamma:components/ui/Card.tsx',
        repoId: 'repo-gamma',
        filePath: 'components/ui/Card.tsx',
        classification: 'source',
      },
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
    getUiHierarchySummaryMock.mockResolvedValue(null);

    const result = await runExploreComponentTool({ name: 'Card', repo: 'repo-gamma' });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(parsed).not.toHaveProperty('uiHierarchy');
  });
});
