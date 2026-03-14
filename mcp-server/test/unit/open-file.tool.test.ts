import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const {
  getRepositoryByIdMock,
  readRepositoryFileMock,
  formatOpenFileResultMock,
} = vi.hoisted(() => ({
  getRepositoryByIdMock: vi.fn(),
  readRepositoryFileMock: vi.fn(),
  formatOpenFileResultMock: vi.fn(),
}));

vi.mock('../../src/repositories.js', () => ({
  getRepositoryById: getRepositoryByIdMock,
}));

vi.mock('../../src/files.js', () => ({
  readRepositoryFile: readRepositoryFileMock,
}));

vi.mock('../../src/formatters.js', () => ({
  formatOpenFileResult: formatOpenFileResultMock,
}));

import { openFileToolDefinition, runOpenFileTool } from '../../src/tools/open-file.js';

describe('open_file tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts valid inputs through the public schema', () => {
    const parsed = z.object(openFileToolDefinition.inputSchema).parse({
      filePath: 'test-repo/src/hello.ts',
      startLine: 2,
      endLine: 4,
    });

    expect(parsed).toEqual({
      filePath: 'test-repo/src/hello.ts',
      startLine: 2,
      endLine: 4,
    });
  });

  it('returns formatted file content for a valid repo-scoped input', async () => {
    getRepositoryByIdMock.mockResolvedValue({
      id: 'test-repo',
      name: 'test-repo',
      rootPath: '/repos/test-repo',
      isGitRepository: true,
    });
    readRepositoryFileMock.mockResolvedValue({
      repositoryId: 'test-repo',
      filePath: 'src/hello.ts',
      absolutePath: '/repos/test-repo/src/hello.ts',
      content: 'hello\nworld',
      startLine: 2,
      endLine: 3,
      totalLines: 10,
    });
    formatOpenFileResultMock.mockReturnValue('formatted file output');

    const result = await runOpenFileTool('/repos', {
      filePath: 'test-repo/src/hello.ts',
      startLine: 2,
      endLine: 3,
    });

    expect(getRepositoryByIdMock).toHaveBeenCalledWith('/repos', 'test-repo');
    expect(readRepositoryFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test-repo' }),
      'src/hello.ts',
      { startLine: 2, endLine: 3 },
    );
    expect(formatOpenFileResultMock).toHaveBeenCalledWith({
      filePath: 'test-repo/src/hello.ts',
      startLine: 2,
      endLine: 3,
      totalLines: 10,
      content: 'hello\nworld',
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'formatted file output' }],
    });
  });

  it('normalizes backslashes before resolving the repository and formatting output', async () => {
    getRepositoryByIdMock.mockResolvedValue({
      id: 'test-repo',
      name: 'test-repo',
      rootPath: '/repos/test-repo',
      isGitRepository: true,
    });
    readRepositoryFileMock.mockResolvedValue({
      repositoryId: 'test-repo',
      filePath: 'src/hello.ts',
      absolutePath: '/repos/test-repo/src/hello.ts',
      content: 'hello',
      startLine: 1,
      endLine: 1,
      totalLines: 1,
    });
    formatOpenFileResultMock.mockReturnValue('formatted');

    await runOpenFileTool('/repos', {
      filePath: 'test-repo\\src\\hello.ts',
    });

    expect(getRepositoryByIdMock).toHaveBeenCalledWith('/repos', 'test-repo');
    expect(readRepositoryFileMock).toHaveBeenCalledWith(
      expect.any(Object),
      'src/hello.ts',
      { startLine: undefined, endLine: undefined },
    );
    expect(formatOpenFileResultMock).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: 'test-repo/src/hello.ts' }),
    );
  });

  it('rejects invalid filePath input through the public schema', () => {
    expect(() => z.object(openFileToolDefinition.inputSchema).parse({ filePath: '' })).toThrow();
  });

  it('rejects file paths without a repository prefix', async () => {
    await expect(runOpenFileTool('/repos', { filePath: 'hello.ts' })).rejects.toThrow(
      /must include the repository directory/i,
    );
    expect(getRepositoryByIdMock).not.toHaveBeenCalled();
  });

  it('surfaces repository lookup failures predictably', async () => {
    getRepositoryByIdMock.mockResolvedValue(null);

    await expect(
      runOpenFileTool('/repos', { filePath: 'missing-repo/src/hello.ts' }),
    ).rejects.toThrow(/repository not found/i);
  });

  it('propagates safe file-access errors from the lower layer', async () => {
    getRepositoryByIdMock.mockResolvedValue({
      id: 'test-repo',
      name: 'test-repo',
      rootPath: '/repos/test-repo',
      isGitRepository: true,
    });
    readRepositoryFileMock.mockRejectedValue(new Error('filePath escapes the repository root.'));

    await expect(
      runOpenFileTool('/repos', { filePath: 'test-repo/../secret.txt' }),
    ).rejects.toThrow(/escapes the repository root/i);
  });
});
