import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { findSymbolMock } = vi.hoisted(() => ({
  findSymbolMock: vi.fn(),
}));

vi.mock('../../src/symbol-index/query.js', () => ({
  findSymbol: findSymbolMock,
}));

import { clearTypeScriptProjectCache } from '../../src/typescript/project-loader.js';
import { findSymbolToolDefinition, runFindSymbolTool } from '../../src/tools/find-symbol.js';

describe('find_symbol compiler-aware integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTypeScriptProjectCache();
  });

  it('keeps the same public input contract', () => {
    const parsed = z.object(findSymbolToolDefinition.inputSchema).parse({
      name: 'UserService',
      kind: 'class',
      repo: 'ts-project',
    });

    expect(parsed).toEqual({
      name: 'UserService',
      kind: 'class',
      repo: 'ts-project',
    });
  });

  it('returns compiler-refined results with the existing public result shape when compiler context exists', async () => {
    findSymbolMock.mockResolvedValue([
      {
        name: 'UserService',
        kind: 'class',
        repo: 'ts-project',
        filePath: 'src/wrong.ts',
        startLine: 1,
        endLine: 1,
        exported: false,
      },
    ]);

    const result = await runFindSymbolTool(path.resolve('test/fixtures'), {
      name: 'UserService',
      repo: 'ts-project',
    });

    const parsed = JSON.parse(result.content[0].text) as Array<Record<string, unknown>>;

    expect(parsed).toEqual([
      {
        name: 'UserService',
        kind: 'class',
        repo: 'ts-project',
        filePath: 'src/models.ts',
        startLine: 5,
        endLine: 9,
        exported: true,
      },
    ]);
  });

  it('falls back to the baseline result shape when compiler context does not exist', async () => {
    findSymbolMock.mockResolvedValue([
      {
        name: 'MissingService',
        kind: 'class',
        repo: 'missing-project',
        filePath: 'src/missing.ts',
        startLine: 1,
        endLine: 3,
        exported: false,
      },
    ]);

    const result = await runFindSymbolTool(path.resolve('test/fixtures'), {
      name: 'MissingService',
      repo: 'missing-project',
    });

    const parsed = JSON.parse(result.content[0].text) as Array<Record<string, unknown>>;

    expect(parsed).toEqual([
      {
        name: 'MissingService',
        kind: 'class',
        repo: 'missing-project',
        filePath: 'src/missing.ts',
        startLine: 1,
        endLine: 3,
        exported: false,
      },
    ]);
  });
});
