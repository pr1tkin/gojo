import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const {
  findReferencesWithTypeScriptFallbackMock,
  buildStructuralTrustMetadataMock,
} = vi.hoisted(() => ({
  findReferencesWithTypeScriptFallbackMock: vi.fn(),
  buildStructuralTrustMetadataMock: vi.fn(),
}));

vi.mock('../../src/typescript/fallback.js', () => ({
  findReferencesWithTypeScriptFallback: findReferencesWithTypeScriptFallbackMock,
}));

vi.mock('../../src/tools/trust-metadata.js', () => ({
  buildStructuralTrustMetadata: buildStructuralTrustMetadataMock,
}));

import { findReferencesToolDefinition, runFindReferencesTool } from '../../src/tools/find-references.js';

describe('find_references tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildStructuralTrustMetadataMock.mockResolvedValue({
      coverage: {
        filesAnalyzed: 84,
        filesTotal: 100,
        ratio: 0.84,
      },
      confidence: 'medium',
      warnings: ['Large portion of repository not structurally analyzed (84% coverage)'],
    });
  });

  it('accepts the narrow public input shape', () => {
    const parsed = z.object(findReferencesToolDefinition.inputSchema).parse({
      symbol: 'Button',
      repo: 'repo-a',
      limit: 5,
    });

    expect(parsed).toEqual({
      symbol: 'Button',
      repo: 'repo-a',
      limit: 5,
    });
  });

  it('wraps reference results with additive trust metadata', async () => {
    findReferencesWithTypeScriptFallbackMock.mockResolvedValue([
      {
        symbol: 'Button',
        repo: 'repo-a',
        filePath: 'src/page.tsx',
        line: 10,
        snippet: '<Button />',
      },
    ]);

    const result = await runFindReferencesTool('C:/repos', 'http://zoekt', {
      symbol: 'Button',
      repo: 'repo-a',
      limit: 5,
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;

    expect(findReferencesWithTypeScriptFallbackMock).toHaveBeenCalledWith(
      'C:/repos',
      {
        symbol: 'Button',
        repo: 'repo-a',
        limit: 5,
      },
      expect.any(Function),
    );
    expect(parsed).toEqual({
      references: [
        {
          symbol: 'Button',
          repo: 'repo-a',
          filePath: 'src/page.tsx',
          line: 10,
          snippet: '<Button />',
        },
      ],
      metadata: {
        coverage: {
          filesAnalyzed: 84,
          filesTotal: 100,
          ratio: 0.84,
        },
        confidence: 'medium',
        warnings: ['Large portion of repository not structurally analyzed (84% coverage)'],
      },
    });
  });
});
