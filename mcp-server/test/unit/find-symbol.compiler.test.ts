import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createFileId, createSymbolId } from '../../src/symbol-index/ids.js';

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
        symbolId: createSymbolId(
          createFileId('ts-project', 'src/wrong.ts'),
          'class',
          'UserService',
          1,
        ),
        fileId: createFileId('ts-project', 'src/wrong.ts'),
        name: 'UserService',
        kind: 'class',
        repo: 'ts-project',
        filePath: 'src/wrong.ts',
        startLine: 1,
        endLine: 1,
        exported: false,
        declarationFingerprint: 'class:UserService:1',
      },
    ]);

    const result = await runFindSymbolTool(path.resolve('test/fixtures'), {
      name: 'UserService',
      repo: 'ts-project',
    });

    const parsed = JSON.parse(result.content[0].text) as Array<Record<string, unknown>>;

    expect(parsed).toEqual([
      {
        symbolId: createSymbolId(
          createFileId('ts-project', 'src/models.ts'),
          'class',
          'UserService',
          1,
        ),
        fileId: createFileId('ts-project', 'src/models.ts'),
        name: 'UserService',
        kind: 'class',
        repo: 'ts-project',
        filePath: 'src/models.ts',
        startLine: 5,
        endLine: 9,
        exported: true,
        declarationFingerprint: 'class:UserService:1',
      },
    ]);
  });

  it('falls back to the baseline result shape when compiler context does not exist', async () => {
    findSymbolMock.mockResolvedValue([
      {
        symbolId: createSymbolId(
          createFileId('missing-project', 'src/missing.ts'),
          'class',
          'MissingService',
          1,
        ),
        fileId: createFileId('missing-project', 'src/missing.ts'),
        name: 'MissingService',
        kind: 'class',
        repo: 'missing-project',
        filePath: 'src/missing.ts',
        startLine: 1,
        endLine: 3,
        exported: false,
        declarationFingerprint: 'class:MissingService:1',
      },
    ]);

    const result = await runFindSymbolTool(path.resolve('test/fixtures'), {
      name: 'MissingService',
      repo: 'missing-project',
    });

    const parsed = JSON.parse(result.content[0].text) as Array<Record<string, unknown>>;

    expect(parsed).toEqual([
      {
        symbolId: createSymbolId(
          createFileId('missing-project', 'src/missing.ts'),
          'class',
          'MissingService',
          1,
        ),
        fileId: createFileId('missing-project', 'src/missing.ts'),
        name: 'MissingService',
        kind: 'class',
        repo: 'missing-project',
        filePath: 'src/missing.ts',
        startLine: 1,
        endLine: 3,
        exported: false,
        declarationFingerprint: 'class:MissingService:1',
      },
    ]);
  });
});
