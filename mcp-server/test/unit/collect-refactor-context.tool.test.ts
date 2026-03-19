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
    });

    expect(parsed).toEqual({
      name: 'ArticleContent',
      repo: 'example-news-app',
      mode: 'component',
      limit: 8,
    });
  });

  it('delegates to the orchestrator service and returns structured refactor context', async () => {
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
      symbolCandidates: [],
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
    expect(parsed.target.symbol.explanation).toEqual(
      expect.objectContaining({
        selectionReason: 'resolved primary symbol',
      }),
    );
    expect(parsed.relatedFiles[0].explanation).toEqual(
      expect.objectContaining({
        selectionReason: 'graph-related file context',
      }),
    );
    expect(parsed.nearbyFiles[0].explanation).toEqual(
      expect.objectContaining({
        selectionReason: 'bundle-family companion',
      }),
    );
    expect(parsed.summary).toEqual(expect.objectContaining({
      importingFileCount: 1,
      relatedFileCount: 1,
      ambiguityDetected: false,
    }));
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
    expect(parsed.primaryFile).toBeNull();
    expect(parsed.summary.notes).toContain('target could not be resolved from the current symbol index and graph');
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
    });

    expect(buildIndexedSymbolExplainabilityMock).toHaveBeenCalledWith(expect.any(Object), 'debug');
  });
});
