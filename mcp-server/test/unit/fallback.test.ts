import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getRepositoryByIdMock,
  findSymbolMock,
  findTypeScriptDefinitionsMock,
} = vi.hoisted(() => ({
  getRepositoryByIdMock: vi.fn(),
  findSymbolMock: vi.fn(),
  findTypeScriptDefinitionsMock: vi.fn(),
}));

vi.mock('../../src/repositories.js', () => ({
  getRepositoryById: getRepositoryByIdMock,
}));

vi.mock('../../src/symbol-index/query.js', () => ({
  findSymbol: findSymbolMock,
}));

vi.mock('../../src/typescript/definitions.js', () => ({
  findTypeScriptDefinitions: findTypeScriptDefinitionsMock,
}));

import { findSymbolWithTypeScriptFallback } from '../../src/typescript/fallback.js';

describe('TypeScript fallback orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns baseline symbol-index results when no repo filter is provided and compiler refinement is unavailable', async () => {
    findSymbolMock.mockResolvedValue([
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
    getRepositoryByIdMock.mockResolvedValue({
      id: 'ts-project',
      name: 'ts-project',
      rootPath: '/repos/ts-project',
      isGitRepository: false,
    });
    findTypeScriptDefinitionsMock.mockResolvedValue([]);

    const result = await findSymbolWithTypeScriptFallback('/repos', {
      name: 'UserService',
    });

    expect(result).toEqual([
      expect.objectContaining({
        repo: 'ts-project',
        filePath: 'src/models.ts',
      }),
    ]);
  });

  it('replaces baseline results for a repo when compiler matches are available', async () => {
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
    getRepositoryByIdMock.mockResolvedValue({
      id: 'ts-project',
      name: 'ts-project',
      rootPath: '/repos/ts-project',
      isGitRepository: false,
    });
    findTypeScriptDefinitionsMock.mockResolvedValue([
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

    const result = await findSymbolWithTypeScriptFallback('/repos', {
      name: 'UserService',
      repo: 'ts-project',
    });

    expect(result).toEqual([
      expect.objectContaining({
        repo: 'ts-project',
        filePath: 'src/models.ts',
        exported: true,
      }),
    ]);
  });

  it('returns baseline repo-scoped results when compiler lookup returns no matches', async () => {
    findSymbolMock.mockResolvedValue([
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
    getRepositoryByIdMock.mockResolvedValue({
      id: 'ts-project',
      name: 'ts-project',
      rootPath: '/repos/ts-project',
      isGitRepository: false,
    });
    findTypeScriptDefinitionsMock.mockResolvedValue([]);

    const result = await findSymbolWithTypeScriptFallback('/repos', {
      name: 'UserService',
      repo: 'ts-project',
    });

    expect(result).toEqual([
      expect.objectContaining({
        repo: 'ts-project',
        filePath: 'src/models.ts',
      }),
    ]);
  });

  it('returns baseline results when compiler lookup throws', async () => {
    findSymbolMock.mockResolvedValue([
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
    getRepositoryByIdMock.mockResolvedValue({
      id: 'ts-project',
      name: 'ts-project',
      rootPath: '/repos/ts-project',
      isGitRepository: false,
    });
    findTypeScriptDefinitionsMock.mockRejectedValue(new Error('compiler failed'));

    const result = await findSymbolWithTypeScriptFallback('/repos', {
      name: 'UserService',
      repo: 'ts-project',
    });

    expect(result).toEqual([
      expect.objectContaining({
        repo: 'ts-project',
        filePath: 'src/models.ts',
      }),
    ]);
  });
});
