import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { listSymbolsForFileMock } = vi.hoisted(() => ({
  listSymbolsForFileMock: vi.fn(),
}));

vi.mock('../../src/symbols.js', () => ({
  listSymbolsForFile: listSymbolsForFileMock,
}));

import { listSymbolsToolDefinition, runListSymbolsTool } from '../../src/tools/list-symbols.js';

describe('list_symbols tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a valid file path through the public schema', () => {
    const parsed = z.object(listSymbolsToolDefinition.inputSchema).parse({
      filePath: 'test-repo/src/hello.ts',
    });

    expect(parsed).toEqual({
      filePath: 'test-repo/src/hello.ts',
    });
  });

  it('rejects empty filePath input through the public schema', () => {
    expect(() => z.object(listSymbolsToolDefinition.inputSchema).parse({ filePath: '' })).toThrow();
  });

  it('returns the current symbol result structure predictably for a valid file', async () => {
    listSymbolsForFileMock.mockResolvedValue({
      filePath: 'test-repo/src/hello.ts',
      symbolCount: 2,
      symbols: [
        {
          name: 'User',
          kind: 'interface',
          filePath: 'test-repo/src/hello.ts',
          startLine: 1,
          endLine: 3,
        },
        {
          name: 'greet',
          kind: 'function',
          filePath: 'test-repo/src/hello.ts',
          startLine: 11,
          endLine: 13,
        },
      ],
    });

    const result = await runListSymbolsTool('/repos', {
      filePath: 'test-repo/src/hello.ts',
    });

    expect(listSymbolsForFileMock).toHaveBeenCalledWith('/repos', 'test-repo/src/hello.ts');
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              filePath: 'test-repo/src/hello.ts',
              symbolCount: 2,
              symbols: [
                {
                  name: 'User',
                  kind: 'interface',
                  filePath: 'test-repo/src/hello.ts',
                  startLine: 1,
                  endLine: 3,
                },
                {
                  name: 'greet',
                  kind: 'function',
                  filePath: 'test-repo/src/hello.ts',
                  startLine: 11,
                  endLine: 13,
                },
              ],
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it('surfaces unsupported file type failures predictably', async () => {
    listSymbolsForFileMock.mockRejectedValue(
      new Error('Unsupported file type for symbol extraction: .md'),
    );

    await expect(
      runListSymbolsTool('/repos', { filePath: 'test-repo/README.md' }),
    ).rejects.toThrow(/unsupported file type/i);
  });

  it('surfaces lower-level symbol extraction failures predictably', async () => {
    listSymbolsForFileMock.mockRejectedValue(
      new Error('filePath must include the repository directory and an in-repository file path.'),
    );

    await expect(runListSymbolsTool('/repos', { filePath: 'hello.ts' })).rejects.toThrow(
      /must include the repository directory/i,
    );
  });
});
