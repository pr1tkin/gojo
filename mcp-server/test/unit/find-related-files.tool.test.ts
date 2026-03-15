import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { getFileRelationMock, listFileRelationsMock, getRelatedFilesMock } = vi.hoisted(() => ({
  getFileRelationMock: vi.fn(),
  listFileRelationsMock: vi.fn(),
  getRelatedFilesMock: vi.fn(),
}));

vi.mock('../../src/symbol-index/query.js', () => ({
  getFileRelation: getFileRelationMock,
  listFileRelations: listFileRelationsMock,
}));

vi.mock('../../src/graph/query.js', () => ({
  getRelatedFiles: getRelatedFilesMock,
}));

import { findRelatedFilesToolDefinition, runFindRelatedFilesTool } from '../../src/tools/find-related-files.js';

describe('find_related_files tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts valid public input', () => {
    const parsed = z.object(findRelatedFilesToolDefinition.inputSchema).parse({
      filePath: 'repo-a/src/target.ts',
      repo: 'repo-a',
      limit: 5,
    });

    expect(parsed).toEqual({
      filePath: 'repo-a/src/target.ts',
      repo: 'repo-a',
      limit: 5,
    });
  });

  it('returns the existing public result shape while using graph signals internally', async () => {
    getFileRelationMock.mockResolvedValue({
      fileId: 'repo-a:src/target.ts',
      repo: 'repo-a',
      filePath: 'src/target.ts',
      classification: 'source',
      symbolIds: ['repo-a:src/target.ts:function:target:1'],
      symbolNames: ['target'],
      imports: [],
      exports: [],
      importTokens: ['./shared', 'target'],
    });
    listFileRelationsMock.mockResolvedValue([
      {
        fileId: 'repo-a:src/direct.ts',
        repo: 'repo-a',
        filePath: 'src/direct.ts',
        classification: 'source',
        symbolIds: [],
        symbolNames: ['shared'],
        imports: [],
        exports: [],
        importTokens: ['./target'],
      },
      {
        fileId: 'repo-a:src/weak.ts',
        repo: 'repo-a',
        filePath: 'src/weak.ts',
        classification: 'source',
        symbolIds: [],
        symbolNames: ['target'],
        imports: [],
        exports: [],
        importTokens: [],
      },
    ]);
    getRelatedFilesMock.mockResolvedValue([
      {
        file: {
          nodeType: 'file',
          fileId: 'repo-a:src/direct.ts',
          repoId: 'repo-a',
          filePath: 'src/direct.ts',
          classification: 'source',
        },
        via: 'file_imports_file',
      },
    ]);

    const result = await runFindRelatedFilesTool({
      filePath: 'src/target.ts',
      repo: 'repo-a',
      limit: 5,
    });
    const parsed = JSON.parse(result.content[0].text) as Array<Record<string, unknown>>;

    expect(parsed[0]).toEqual({
      repo: 'repo-a',
      filePath: 'src/direct.ts',
      reason: 'direct import',
      score: 12,
    });
    expect(parsed[1]).toEqual({
      repo: 'repo-a',
      filePath: 'src/weak.ts',
      reason: 'shared symbols',
      score: 6,
    });
  });
});
