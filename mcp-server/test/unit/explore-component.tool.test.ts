import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { getFileExplorationContextMock, getSymbolExplorationContextMock } = vi.hoisted(() => ({
  getFileExplorationContextMock: vi.fn(),
  getSymbolExplorationContextMock: vi.fn(),
}));

vi.mock('../../src/orchestrator/index.js', () => ({
  getFileExplorationContext: getFileExplorationContextMock,
  getSymbolExplorationContext: getSymbolExplorationContextMock,
}));

import { exploreComponentToolDefinition, runExploreComponentTool } from '../../src/tools/explore-component.js';

describe('explore_component tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts the narrow public input shape', () => {
    const parsed = z.object(exploreComponentToolDefinition.inputSchema).parse({
      name: 'Button',
      repo: 'ifdt-gui',
      limit: 3,
      relatedLimit: 8,
    });

    expect(parsed).toEqual({
      name: 'Button',
      repo: 'ifdt-gui',
      limit: 3,
      relatedLimit: 8,
    });
  });

  it('resolves a primary component and includes related, defined, and exported symbols', async () => {
    getSymbolExplorationContextMock.mockResolvedValue({
      query: 'Button',
      repo: 'ifdt-gui',
      kind: undefined,
      primarySymbol: {
        symbolId: 'ifdt-gui:components/ui/Button.tsx:function:Button:1',
        fileId: 'ifdt-gui:components/ui/Button.tsx',
        name: 'Button',
        kind: 'function',
        repo: 'ifdt-gui',
        filePath: 'components/ui/Button.tsx',
        startLine: 1,
        endLine: 10,
        exported: true,
      },
      primaryFile: {
        nodeType: 'file',
        fileId: 'ifdt-gui:components/ui/Button.tsx',
        repoId: 'ifdt-gui',
        filePath: 'components/ui/Button.tsx',
        classification: 'source',
      },
      rankedSymbols: [
        {
          item: {
            symbolId: 'ifdt-gui:components/ui/Button.tsx:function:Button:1',
            fileId: 'ifdt-gui:components/ui/Button.tsx',
            name: 'Button',
            kind: 'function',
            repo: 'ifdt-gui',
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
          symbolId: 'ifdt-gui:components/ui/Button.tsx:function:Button:1',
          fileId: 'ifdt-gui:components/ui/Button.tsx',
          repoId: 'ifdt-gui',
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
      fileId: 'ifdt-gui:components/ui/Button.tsx',
      primaryFile: {
        nodeType: 'file',
        fileId: 'ifdt-gui:components/ui/Button.tsx',
        repoId: 'ifdt-gui',
        filePath: 'components/ui/Button.tsx',
        classification: 'source',
      },
      repo: 'ifdt-gui',
      relatedFiles: [
        {
          file: {
            nodeType: 'file',
            fileId: 'ifdt-gui:components/ui/DownloadButton.tsx',
            repoId: 'ifdt-gui',
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
            fileId: 'ifdt-gui:components/ContractList.tsx',
            repoId: 'ifdt-gui',
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
          symbolId: 'ifdt-gui:components/ui/Button.tsx:function:Button:1',
          fileId: 'ifdt-gui:components/ui/Button.tsx',
          repoId: 'ifdt-gui',
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
          symbolId: 'ifdt-gui:components/ui/Button.tsx:function:Button:1',
          fileId: 'ifdt-gui:components/ui/Button.tsx',
          repoId: 'ifdt-gui',
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

    const result = await runExploreComponentTool({
      name: 'Button',
      repo: 'ifdt-gui',
      relatedLimit: 8,
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(getSymbolExplorationContextMock).toHaveBeenCalledWith('Button', {
      repo: 'ifdt-gui',
      limit: 5,
      relatedLimit: 8,
    });
    expect(getFileExplorationContextMock).toHaveBeenCalledWith('ifdt-gui:components/ui/Button.tsx', {
      relatedLimit: 8,
    });
    expect(parsed).toEqual(
      expect.objectContaining({
        requestedName: 'Button',
        requestedRepo: 'ifdt-gui',
        resolution: expect.objectContaining({
          status: 'resolved',
          candidateCount: 1,
          ambiguityDetected: false,
          selectedCandidate: expect.objectContaining({
            fileId: 'ifdt-gui:components/ui/Button.tsx',
            name: 'Button',
            score: 16,
          }),
        }),
        resolvedPrimaryFile: expect.objectContaining({
          fileId: 'ifdt-gui:components/ui/Button.tsx',
        }),
        relatedFiles: [
          expect.objectContaining({
            file: expect.objectContaining({ fileId: 'ifdt-gui:components/ui/DownloadButton.tsx' }),
            score: 25,
          }),
          expect.objectContaining({
            file: expect.objectContaining({ fileId: 'ifdt-gui:components/ContractList.tsx' }),
            score: 20,
          }),
        ],
        definedSymbols: [expect.objectContaining({ name: 'Button' })],
        exportedSymbols: [expect.objectContaining({ name: 'Button' })],
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
      repo: 'dlf-web',
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
      repo: 'dlf-web',
      limit: 2,
      relatedLimit: 4,
    });

    expect(getSymbolExplorationContextMock).toHaveBeenCalledWith('Button', {
      repo: 'dlf-web',
      limit: 2,
      relatedLimit: 4,
    });
  });

  it('surfaces ambiguity conservatively while selecting the strongest ranked candidate', async () => {
    getSymbolExplorationContextMock.mockResolvedValue({
      query: 'AdminProjectPage',
      repo: 'ibm-strings',
      kind: undefined,
      primarySymbol: {
        symbolId: 'ibm-strings:pages/admin/cleanup.tsx:variable:AdminProjectPage:1',
        fileId: 'ibm-strings:pages/admin/cleanup.tsx',
        name: 'AdminProjectPage',
        kind: 'variable',
        repo: 'ibm-strings',
        filePath: 'pages/admin/cleanup.tsx',
        startLine: 1,
        endLine: 20,
        exported: false,
      },
      primaryFile: {
        nodeType: 'file',
        fileId: 'ibm-strings:pages/admin/cleanup.tsx',
        repoId: 'ibm-strings',
        filePath: 'pages/admin/cleanup.tsx',
        classification: 'source',
      },
      rankedSymbols: [
        {
          item: {
            symbolId: 'ibm-strings:pages/admin/cleanup.tsx:variable:AdminProjectPage:1',
            fileId: 'ibm-strings:pages/admin/cleanup.tsx',
            name: 'AdminProjectPage',
            kind: 'variable',
            repo: 'ibm-strings',
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
            symbolId: 'ibm-strings:pages/admin/project.tsx:variable:AdminProjectPage:1',
            fileId: 'ibm-strings:pages/admin/project.tsx',
            name: 'AdminProjectPage',
            kind: 'variable',
            repo: 'ibm-strings',
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
      fileId: 'ibm-strings:pages/admin/cleanup.tsx',
      primaryFile: {
        nodeType: 'file',
        fileId: 'ibm-strings:pages/admin/cleanup.tsx',
        repoId: 'ibm-strings',
        filePath: 'pages/admin/cleanup.tsx',
        classification: 'source',
      },
      repo: 'ibm-strings',
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
      repo: 'ibm-strings',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(parsed.resolution).toEqual(
      expect.objectContaining({
        status: 'resolved',
        candidateCount: 2,
        ambiguityDetected: true,
        selectedCandidate: expect.objectContaining({
          fileId: 'ibm-strings:pages/admin/cleanup.tsx',
        }),
        alternativeCandidates: [
          expect.objectContaining({
            fileId: 'ibm-strings:pages/admin/project.tsx',
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
    });
  });
});
