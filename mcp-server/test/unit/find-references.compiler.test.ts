import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getRepositoryByIdMock,
  findSymbolMock,
  findTypeScriptDefinitionsMock,
  findTypeScriptReferencesMock,
} = vi.hoisted(() => ({
  getRepositoryByIdMock: vi.fn(),
  findSymbolMock: vi.fn(),
  findTypeScriptDefinitionsMock: vi.fn(),
  findTypeScriptReferencesMock: vi.fn(),
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

vi.mock('../../src/typescript/references.js', () => ({
  findTypeScriptReferences: findTypeScriptReferencesMock,
}));

import { findReferencesWithTypeScriptFallback } from '../../src/typescript/fallback.js';

describe('find_references compiler-aware fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses compiler-backed references when compiler context exists', async () => {
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
    findTypeScriptReferencesMock.mockResolvedValue([
      {
        symbol: 'UserService',
        repo: 'ts-project',
        filePath: 'src/component.tsx',
        line: 1,
        snippet: "import { UserService } from './models';",
      },
      {
        symbol: 'UserService',
        repo: 'ts-project',
        filePath: 'src/component.tsx',
        line: 4,
        snippet: 'const service = new UserService();',
      },
    ]);
    const heuristicProvider = vi.fn().mockResolvedValue([
      {
        symbol: 'UserService',
        repo: 'ts-project',
        filePath: 'src/heuristic.ts',
        line: 10,
        snippet: 'UserService',
      },
    ]);

    const result = await findReferencesWithTypeScriptFallback(
      '/repos',
      { symbol: 'UserService', repo: 'ts-project', limit: 10 },
      heuristicProvider,
    );

    expect(heuristicProvider).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        symbol: 'UserService',
        repo: 'ts-project',
        filePath: 'src/component.tsx',
        line: 1,
        snippet: "import { UserService } from './models';",
      },
      {
        symbol: 'UserService',
        repo: 'ts-project',
        filePath: 'src/component.tsx',
        line: 4,
        snippet: 'const service = new UserService();',
      },
    ]);
  });

  it('falls back to heuristic references when compiler lookup returns no results', async () => {
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
    findTypeScriptReferencesMock.mockResolvedValue([]);
    const heuristicProvider = vi.fn().mockResolvedValue([
      {
        symbol: 'UserService',
        repo: 'ts-project',
        filePath: 'src/heuristic.ts',
        line: 10,
        snippet: 'UserService',
      },
    ]);

    const result = await findReferencesWithTypeScriptFallback(
      '/repos',
      { symbol: 'UserService', repo: 'ts-project', limit: 10 },
      heuristicProvider,
    );

    expect(heuristicProvider).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        symbol: 'UserService',
        repo: 'ts-project',
        filePath: 'src/heuristic.ts',
        line: 10,
        snippet: 'UserService',
      },
    ]);
  });

  it('falls back to heuristic references when compiler lookup fails', async () => {
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
    findTypeScriptReferencesMock.mockRejectedValue(new Error('compiler failed'));
    const heuristicProvider = vi.fn().mockResolvedValue([
      {
        symbol: 'UserService',
        repo: 'ts-project',
        filePath: 'src/heuristic.ts',
        line: 10,
        snippet: 'UserService',
      },
    ]);

    const result = await findReferencesWithTypeScriptFallback(
      '/repos',
      { symbol: 'UserService', repo: 'ts-project', limit: 10 },
      heuristicProvider,
    );

    expect(heuristicProvider).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        symbol: 'UserService',
        repo: 'ts-project',
        filePath: 'src/heuristic.ts',
        line: 10,
        snippet: 'UserService',
      },
    ]);
  });

  it('returns an empty list when no symbol definitions exist', async () => {
    findSymbolMock.mockResolvedValue([]);
    const heuristicProvider = vi.fn();

    const result = await findReferencesWithTypeScriptFallback(
      '/repos',
      { symbol: 'MissingSymbol' },
      heuristicProvider,
    );

    expect(heuristicProvider).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
