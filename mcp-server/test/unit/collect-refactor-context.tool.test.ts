import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const {
  getCollectRefactorContextMock,
  buildIndexedSymbolExplainabilityMock,
  buildNearbyFileExplainabilityMock,
  buildRefactorSymbolCandidateExplainabilityMock,
  buildRelatedFileExplainabilityMock,
} = vi.hoisted(() => ({
  getCollectRefactorContextMock: vi.fn(),
  buildIndexedSymbolExplainabilityMock: vi.fn(),
  buildNearbyFileExplainabilityMock: vi.fn(),
  buildRefactorSymbolCandidateExplainabilityMock: vi.fn(),
  buildRelatedFileExplainabilityMock: vi.fn(),
}));

vi.mock('../../src/orchestrator/index.js', () => ({
  getCollectRefactorContext: getCollectRefactorContextMock,
}));

vi.mock('../../src/tools/explainability.js', () => ({
  buildIndexedSymbolExplainability: buildIndexedSymbolExplainabilityMock,
  buildNearbyFileExplainability: buildNearbyFileExplainabilityMock,
  buildRefactorSymbolCandidateExplainability: buildRefactorSymbolCandidateExplainabilityMock,
  buildRelatedFileExplainability: buildRelatedFileExplainabilityMock,
}));

import {
  collectRefactorContextToolDefinition,
  runCollectRefactorContextTool,
} from '../../src/tools/collect-refactor-context.js';

describe('collect_refactor_context tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildIndexedSymbolExplainabilityMock.mockResolvedValue({
      family: 'ui_component',
      role: 'component',
      confidence: 'high',
      selectionReason: 'resolved primary symbol',
      explanationSignals: {},
      clusterContext: {
        parentClusterId: 'cluster:article-content',
        clusterRole: 'ui_component',
        isCoreMember: true,
      },
    });
    buildNearbyFileExplainabilityMock.mockResolvedValue({
      family: 'support_runtime',
      role: 'story',
      confidence: 'medium',
      selectionReason: 'bundle-family companion',
      explanationSignals: {},
    });
    buildRefactorSymbolCandidateExplainabilityMock.mockResolvedValue({
      family: 'ui_component',
      role: 'component',
      confidence: 'medium',
      selectionReason: 'ranked symbol candidate',
      explanationSignals: {},
    });
    buildRelatedFileExplainabilityMock.mockResolvedValue({
      family: 'ui_component',
      role: 'component',
      confidence: 'medium',
      selectionReason: 'graph-related file context',
      explanationSignals: {},
    });
  });

  it('accepts the public input shape', () => {
    const parsed = z.object(collectRefactorContextToolDefinition.inputSchema).parse({
      name: 'ArticleContent',
      repo: 'example-news-app',
      mode: 'component',
      limit: 8,
      expandRelated: true,
    });

    expect(parsed).toEqual({
      name: 'ArticleContent',
      repo: 'example-news-app',
      mode: 'component',
      limit: 8,
      expandRelated: true,
    });
  });

  it('returns a normalized refactor-context response with grouped context semantics preserved', async () => {
    getCollectRefactorContextMock.mockResolvedValue({
      target: {
        requestedName: 'ArticleContent',
        requestedMode: 'component',
        repo: 'example-news-app',
        file: { fileId: 'example-news-app:src/app/articles/[id]/ArticleContent.tsx' },
        symbol: {
          symbolId: 'article-content-symbol',
          fileId: 'example-news-app:src/app/articles/[id]/ArticleContent.tsx',
          repo: 'example-news-app',
          filePath: 'src/app/articles/[id]/ArticleContent.tsx',
          name: 'ArticleContent',
          kind: 'function',
          exported: true,
          startLine: 1,
          endLine: 20,
        },
      },
      primaryFile: { fileId: 'example-news-app:src/app/articles/[id]/ArticleContent.tsx' },
      exportedSymbols: [{ name: 'ArticleContent' }],
      importingFiles: [{ fileId: 'example-news-app:src/app/articles/[id]/page.tsx' }],
      importedFiles: [{ fileId: 'example-news-app:src/app/_components/text/Text.tsx' }],
      reexportingFiles: [],
      reexportedFiles: [],
      graphNeighbors: [],
      relatedFiles: [
        {
          score: 20,
          reason: 'direct import',
          reasons: [{ signal: 'graph_connection', value: 9 }],
          via: ['file_imports_file'],
          file: { fileId: 'example-news-app:src/app/_components/articleHeaderText/ArticleHeaderText.tsx' },
        },
      ],
      nearbyFiles: [
        {
          category: 'bundle_family',
          file: { fileId: 'example-news-app:src/app/articles/[id]/ArticleContent.stories.tsx' },
        },
      ],
      definedSymbols: [{ name: 'ArticleContent' }],
      symbolCandidates: [
        {
          symbolId: 'candidate:article-header',
          fileId: 'example-news-app:src/app/_components/articleHeaderText/ArticleHeaderText.tsx',
          repo: 'example-news-app',
          filePath: 'src/app/_components/articleHeaderText/ArticleHeaderText.tsx',
          name: 'ArticleHeaderText',
          kind: 'function',
          exported: true,
          score: 9,
          reasons: [{ signal: 'graph_connection', value: 4 }],
        },
      ],
      summary: {
        importingFileCount: 1,
        importedFileCount: 1,
        reexportingFileCount: 0,
        reexportedFileCount: 0,
        graphNeighborCount: 0,
        relatedFileCount: 1,
        nearbyFileCount: 1,
        symbolCandidateCount: 1,
        exportedSymbolCount: 1,
        definedSymbolCount: 1,
        ambiguityDetected: false,
        notes: [],
      },
    });

    const result = await runCollectRefactorContextTool({
      name: 'ArticleContent',
      repo: 'example-news-app',
      mode: 'component',
      limit: 8,
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(getCollectRefactorContextMock).toHaveBeenCalledWith({
      name: 'ArticleContent',
      repo: 'example-news-app',
      mode: 'component',
      limit: 8,
    });
    expect(parsed).toEqual(
      expect.objectContaining({
        tool: 'collect_refactor_context',
        version: '1',
        mode: 'agent',
        query: expect.objectContaining({
          target: 'ArticleContent',
          repo: 'example-news-app',
          mode: 'component',
          filePath: 'src/app/articles/[id]/ArticleContent.tsx',
          symbolName: 'ArticleContent',
        }),
      }),
    );
    expect(parsed.target).toEqual(
      expect.objectContaining({
        status: 'resolved',
        filePath: 'src/app/articles/[id]/ArticleContent.tsx',
        role: 'component',
        family: 'ui_component',
        clusterRef: 'cluster:article-content',
      }),
    );
    expect(parsed.results.primary).toEqual([
      expect.objectContaining({
        kind: 'refactor_related_file',
        filePath: 'src/app/_components/articleHeaderText/ArticleHeaderText.tsx',
        relationshipKinds: ['file_imports_file'],
        explanation: expect.objectContaining({
          short: 'graph-related file context',
        }),
      }),
    ]);
    expect(parsed.nearbyFiles).toEqual([
      expect.objectContaining({
        kind: 'refactor_nearby_file',
        category: 'bundle_family',
        filePath: 'src/app/articles/[id]/ArticleContent.stories.tsx',
        explanation: expect.objectContaining({
          short: 'bundle-family companion',
        }),
      }),
    ]);
    expect(parsed.symbolCandidates).toEqual([
      expect.objectContaining({
        kind: 'refactor_symbol_candidate',
        filePath: 'src/app/_components/articleHeaderText/ArticleHeaderText.tsx',
        symbolName: 'ArticleHeaderText',
        explanation: expect.objectContaining({
          short: 'ranked symbol candidate',
        }),
      }),
    ]);
    expect(parsed.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: 'explore_component',
          reason: 'inspect the strongest neighboring file before refactor',
          query: expect.objectContaining({
            name: 'src/app/_components/articleHeaderText/ArticleHeaderText.tsx',
            repo: 'example-news-app',
          }),
        }),
        expect.objectContaining({
          tool: 'plan_change',
          query: expect.objectContaining({
            symbol: 'ArticleContent',
            filePath: 'src/app/articles/[id]/ArticleContent.tsx',
            repo: 'example-news-app',
          }),
        }),
      ]),
    );
    expect(parsed.summary).toEqual(
      expect.objectContaining({
        resultCount: 1,
        primaryCount: 1,
        confidence: 'high',
      }),
    );
    expect(parsed.contextSummary).toEqual(
      expect.objectContaining({
        importingFileCount: 1,
        importedFileCount: 1,
        nearbyFileCount: 1,
        relatedFileCount: 1,
        ambiguityDetected: false,
      }),
    );
    expect(parsed.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'target_family',
          value: 'ui_component',
        }),
        expect.objectContaining({
          kind: 'importing_files',
          value: '1',
        }),
      ]),
    );
    expect(parsed.diagnostics).toEqual(
      expect.objectContaining({
        warnings: [],
        limits: expect.objectContaining({
          resultLimit: 8,
          navigationHintLimit: 3,
          relatedItemLimit: 3,
        }),
      }),
    );
    expect(parsed.expansions).toEqual(
      expect.objectContaining({
        'cluster:article-content': expect.objectContaining({
          kind: 'cluster-context',
        }),
        'refactor:importing-files': expect.objectContaining({
          kind: 'refactor-importing-files',
        }),
        'refactor:imported-files': expect.objectContaining({
          kind: 'refactor-imported-files',
        }),
      }),
    );
  });

  it('defaults to component mode and preserves weak contexts safely', async () => {
    getCollectRefactorContextMock.mockResolvedValue({
      target: {
        requestedName: 'MissingThing',
        requestedMode: 'component',
        repo: undefined,
        file: null,
        symbol: null,
      },
      primaryFile: null,
      exportedSymbols: [],
      importingFiles: [],
      importedFiles: [],
      reexportingFiles: [],
      reexportedFiles: [],
      graphNeighbors: [],
      relatedFiles: [],
      nearbyFiles: [],
      definedSymbols: [],
      symbolCandidates: [],
      summary: {
        importingFileCount: 0,
        importedFileCount: 0,
        reexportingFileCount: 0,
        reexportedFileCount: 0,
        graphNeighborCount: 0,
        relatedFileCount: 0,
        nearbyFileCount: 0,
        symbolCandidateCount: 0,
        exportedSymbolCount: 0,
        definedSymbolCount: 0,
        ambiguityDetected: false,
        notes: ['target could not be resolved from the current symbol index and graph'],
      },
    });

    const result = await runCollectRefactorContextTool({ name: 'MissingThing' });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(getCollectRefactorContextMock).toHaveBeenCalledWith({
      name: 'MissingThing',
      repo: undefined,
      mode: 'component',
      limit: undefined,
    });
    expect(parsed.mode).toBe('agent');
    expect(parsed.diagnostics.notes).toContain('target could not be resolved from the current symbol index and graph');
    expect(parsed.results.primary).toEqual([]);
    expect(parsed.results).not.toHaveProperty('secondary');
  });

  it('passes debug explainability mode through helper calls', async () => {
    getCollectRefactorContextMock.mockResolvedValue({
      target: {
        requestedName: 'ArticleContent',
        requestedMode: 'component',
        repo: 'example-news-app',
        file: { fileId: 'example-news-app:src/app/articles/[id]/ArticleContent.tsx' },
        symbol: {
          symbolId: 'article-content-symbol',
          fileId: 'example-news-app:src/app/articles/[id]/ArticleContent.tsx',
          repo: 'example-news-app',
          filePath: 'src/app/articles/[id]/ArticleContent.tsx',
          name: 'ArticleContent',
          kind: 'function',
          exported: true,
          startLine: 1,
          endLine: 20,
        },
      },
      primaryFile: { fileId: 'example-news-app:src/app/articles/[id]/ArticleContent.tsx' },
      exportedSymbols: [],
      importingFiles: [],
      importedFiles: [],
      reexportingFiles: [],
      reexportedFiles: [],
      graphNeighbors: [],
      relatedFiles: [],
      nearbyFiles: [],
      definedSymbols: [],
      symbolCandidates: [],
      summary: {
        importingFileCount: 0,
        importedFileCount: 0,
        reexportingFileCount: 0,
        reexportedFileCount: 0,
        graphNeighborCount: 0,
        relatedFileCount: 0,
        nearbyFileCount: 0,
        symbolCandidateCount: 0,
        exportedSymbolCount: 0,
        definedSymbolCount: 0,
        ambiguityDetected: false,
        notes: [],
      },
    });

    const result = await runCollectRefactorContextTool({
      name: 'ArticleContent',
      detail: 'debug',
      expandDebug: true,
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(buildIndexedSymbolExplainabilityMock).toHaveBeenCalledWith(expect.any(Object), 'debug');
    expect(parsed.mode).toBe('debug');
  });
});
