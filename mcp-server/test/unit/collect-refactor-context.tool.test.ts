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

  it('returns shaped refactor context with related tiers and nearby/candidate sections', async () => {
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
    expect(parsed.explainabilityMode).toBe('agent');
    expect(parsed.target).toEqual(
      expect.objectContaining({
        filePath: 'src/app/articles/[id]/ArticleContent.tsx',
        role: 'component',
        familyRef: 'ui_component',
        clusterRef: 'cluster:article-content',
      }),
    );
    expect(parsed.results.primary).toEqual([
      expect.objectContaining({
        filePath: 'src/app/_components/articleHeaderText/ArticleHeaderText.tsx',
        selectionReason: 'graph-related file context',
      }),
    ]);
    expect(parsed.results.nearby).toEqual([
      expect.objectContaining({
        category: 'bundle_family',
        filePath: 'src/app/articles/[id]/ArticleContent.stories.tsx',
        selectionReason: 'bundle-family companion',
      }),
    ]);
    expect(parsed.results.candidates).toEqual([
      expect.objectContaining({
        filePath: 'src/app/_components/articleHeaderText/ArticleHeaderText.tsx',
        name: 'ArticleHeaderText',
        selectionReason: 'ranked symbol candidate',
      }),
    ]);
    expect(parsed.navigationHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'open_related',
          filePath: 'src/app/_components/articleHeaderText/ArticleHeaderText.tsx',
        }),
      ]),
    );
    expect(parsed.summary).toEqual(
      expect.objectContaining({
        resultCount: 3,
        importingFileCount: 1,
        importedFileCount: 1,
      }),
    );
    expect(parsed.summary.tokenEstimate).toBeGreaterThan(0);
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
    expect(parsed.explainabilityMode).toBe('agent');
    expect(parsed.summary.notes).toContain('target could not be resolved from the current symbol index and graph');
    expect(parsed.results.primary).toEqual([]);
    expect(parsed.results.secondary).toEqual([]);
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
        exportedSymbolCount: 0,
        definedSymbolCount: 0,
        ambiguityDetected: false,
        notes: [],
      },
    });

    await runCollectRefactorContextTool({
      name: 'ArticleContent',
      detail: 'debug',
      expandDebug: true,
    });

    expect(buildIndexedSymbolExplainabilityMock).toHaveBeenCalledWith(expect.any(Object), 'debug');
  });
});
