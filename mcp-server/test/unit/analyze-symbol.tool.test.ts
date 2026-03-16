import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { getAnalyzeSymbolContextMock } = vi.hoisted(() => ({
  getAnalyzeSymbolContextMock: vi.fn(),
}));

vi.mock('../../src/orchestrator/index.js', () => ({
  getAnalyzeSymbolContext: getAnalyzeSymbolContextMock,
}));

import { analyzeSymbolToolDefinition, runAnalyzeSymbolTool } from '../../src/tools/analyze-symbol.js';

describe('analyze_symbol tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts the public input shape', () => {
    const parsed = z.object(analyzeSymbolToolDefinition.inputSchema).parse({
      name: 'Button',
      repo: 'example-saas-dashboard',
      file: 'components/ui/Button.tsx',
      limit: 5,
    });

    expect(parsed).toEqual({
      name: 'Button',
      repo: 'example-saas-dashboard',
      file: 'components/ui/Button.tsx',
      limit: 5,
    });
  });

  it('returns structured symbol analysis from the orchestrator service', async () => {
    getAnalyzeSymbolContextMock.mockResolvedValue({
      target: {
        requestedName: 'Button',
        requestedRepo: 'example-saas-dashboard',
        requestedFile: undefined,
        symbol: { symbolId: 'button-symbol' },
        symbolId: 'button-symbol',
        repo: 'example-saas-dashboard',
        file: { fileId: 'example-saas-dashboard:components/ui/Button.tsx' },
      },
      primarySymbol: { symbolId: 'button-symbol', name: 'Button' },
      primaryFile: { fileId: 'example-saas-dashboard:components/ui/Button.tsx' },
      kind: 'function',
      exported: true,
      roleSummary: 'exported shared UI function in Button with 2 direct importers',
      definedInFile: { fileId: 'example-saas-dashboard:components/ui/Button.tsx' },
      exportedFromFile: { fileId: 'example-saas-dashboard:components/ui/Button.tsx' },
      importingFiles: [{ fileId: 'example-saas-dashboard:app/page.tsx' }],
      importedFiles: [{ fileId: 'example-saas-dashboard:lib/utils.ts' }],
      reexportingFiles: [],
      reexportedFiles: [],
      graphNeighbors: [{ fileId: 'example-saas-dashboard:components/ui/index.ts' }],
      relatedFiles: [{ file: { fileId: 'example-saas-dashboard:components/ui/DownloadButton.tsx' }, score: 18 }],
      nearbyFiles: [{ file: { fileId: 'example-saas-dashboard:components/ui/Badge.tsx' }, category: 'same_directory' }],
      nearbySymbols: [{ symbolId: 'button-props', name: 'ButtonProps', kind: 'interface', exported: false, startLine: 5, endLine: 10 }],
      siblingSymbols: [{ symbolId: 'button-props', name: 'ButtonProps', kind: 'interface', exported: false, startLine: 5, endLine: 10 }],
      exportedSymbols: [{ symbolId: 'button-symbol', name: 'Button' }],
      symbolCandidates: [{ symbolId: 'button-symbol', filePath: 'components/ui/Button.tsx', score: 16 }],
      usageSummary: {
        importerCount: 1,
        importCount: 1,
        relatedFileCount: 1,
        exportedStatus: 'exported',
        ambiguityDetected: false,
        notes: ['symbol is exported from its defining file'],
      },
    });

    const result = await runAnalyzeSymbolTool({ name: 'Button', repo: 'example-saas-dashboard' });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(getAnalyzeSymbolContextMock).toHaveBeenCalledWith({ name: 'Button', repo: 'example-saas-dashboard' });
    expect(parsed).toEqual(expect.objectContaining({
      roleSummary: 'exported shared UI function in Button with 2 direct importers',
      usageSummary: expect.objectContaining({ importerCount: 1, exportedStatus: 'exported' }),
    }));
  });

  it('preserves safe missing-symbol analysis', async () => {
    getAnalyzeSymbolContextMock.mockResolvedValue({
      target: {
        requestedName: 'MissingSymbol',
        requestedRepo: undefined,
        requestedFile: undefined,
        symbol: null,
        symbolId: null,
        repo: null,
        file: null,
      },
      primarySymbol: null,
      primaryFile: null,
      kind: null,
      exported: false,
      roleSummary: 'symbol could not be resolved from the current symbol index',
      definedInFile: null,
      exportedFromFile: null,
      importingFiles: [],
      importedFiles: [],
      reexportingFiles: [],
      reexportedFiles: [],
      graphNeighbors: [],
      relatedFiles: [],
      nearbyFiles: [],
      nearbySymbols: [],
      siblingSymbols: [],
      exportedSymbols: [],
      symbolCandidates: [],
      usageSummary: {
        importerCount: 0,
        importCount: 0,
        relatedFileCount: 0,
        exportedStatus: 'local',
        ambiguityDetected: false,
        notes: ['symbol could not be resolved from the current symbol index'],
      },
    });

    const result = await runAnalyzeSymbolTool({ name: 'MissingSymbol' });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(parsed.primarySymbol).toBeNull();
    expect(parsed.usageSummary.notes).toContain('symbol could not be resolved from the current symbol index');
  });
});
