import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readRepositoryFile, resolveRepositoryFilePath } from '../../src/files.js';
import type { RepositoryInfo } from '../../src/types.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-files-test-'));
}

function createRepository(rootPath: string): RepositoryInfo {
  return {
    id: 'test-repo',
    name: 'test-repo',
    rootPath,
    isGitRepository: true,
  };
}

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('resolveRepositoryFilePath', () => {
  it('resolves a normal relative file path inside the repository root', async () => {
    const repositoryRoot = await createTempDirectory();
    tempDirectories.push(repositoryRoot);

    const repository = createRepository(repositoryRoot);
    const resolvedPath = resolveRepositoryFilePath(repository, 'src/hello.ts');

    expect(resolvedPath).toBe(path.resolve(repositoryRoot, 'src/hello.ts'));
  });

  it('rejects traversal attempts that escape the repository root', async () => {
    const repositoryRoot = await createTempDirectory();
    tempDirectories.push(repositoryRoot);

    const repository = createRepository(repositoryRoot);

    expect(() => resolveRepositoryFilePath(repository, '../../outside.txt')).toThrow(
      /escapes the repository root/i,
    );
  });

  it('rejects empty or repository-root-only paths', async () => {
    const repositoryRoot = await createTempDirectory();
    tempDirectories.push(repositoryRoot);

    const repository = createRepository(repositoryRoot);

    expect(() => resolveRepositoryFilePath(repository, '   ')).toThrow(/must not be empty/i);
    expect(() => resolveRepositoryFilePath(repository, '.')).toThrow(
      /must point to a file inside the repository/i,
    );
  });
});

describe('readRepositoryFile', () => {
  it('reads a UTF-8 text file successfully', async () => {
    const repositoryRoot = await createTempDirectory();
    tempDirectories.push(repositoryRoot);

    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(repositoryRoot, 'src', 'hello.ts'), 'hello\nworld', 'utf8');

    const result = await readRepositoryFile(createRepository(repositoryRoot), 'src/hello.ts');

    expect(result.filePath).toBe('src/hello.ts');
    expect(result.repositoryId).toBe('test-repo');
    expect(result.content).toBe('hello\nworld');
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(2);
    expect(result.totalLines).toBe(2);
  });

  it('returns the expected subset of lines when startLine and endLine are provided', async () => {
    const repositoryRoot = await createTempDirectory();
    tempDirectories.push(repositoryRoot);

    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'hello.ts'),
      'one\ntwo\nthree\nfour',
      'utf8',
    );

    const result = await readRepositoryFile(createRepository(repositoryRoot), 'src/hello.ts', {
      startLine: 2,
      endLine: 3,
    });

    expect(result.content).toBe('two\nthree');
    expect(result.startLine).toBe(2);
    expect(result.endLine).toBe(3);
    expect(result.totalLines).toBe(4);
  });

  it('supports a single startLine bound and clamps endLine to the file length', async () => {
    const repositoryRoot = await createTempDirectory();
    tempDirectories.push(repositoryRoot);

    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'hello.ts'),
      'one\ntwo\nthree\nfour',
      'utf8',
    );

    const startOnly = await readRepositoryFile(createRepository(repositoryRoot), 'src/hello.ts', {
      startLine: 3,
    });
    const endClamped = await readRepositoryFile(createRepository(repositoryRoot), 'src/hello.ts', {
      endLine: 99,
    });

    expect(startOnly.content).toBe('three\nfour');
    expect(startOnly.startLine).toBe(3);
    expect(startOnly.endLine).toBe(4);

    expect(endClamped.content).toBe('one\ntwo\nthree\nfour');
    expect(endClamped.startLine).toBe(1);
    expect(endClamped.endLine).toBe(4);
  });

  it('rejects non-existent files cleanly', async () => {
    const repositoryRoot = await createTempDirectory();
    tempDirectories.push(repositoryRoot);

    await expect(
      readRepositoryFile(createRepository(repositoryRoot), 'src/missing.ts'),
    ).rejects.toThrow(/enoent|no such file/i);
  });

  it('rejects directory paths because they are not regular files', async () => {
    const repositoryRoot = await createTempDirectory();
    tempDirectories.push(repositoryRoot);

    await fs.mkdir(path.join(repositoryRoot, 'src', 'nested'), { recursive: true });

    await expect(
      readRepositoryFile(createRepository(repositoryRoot), 'src/nested'),
    ).rejects.toThrow(/regular file/i);
  });

  it('rejects unsafe or invalid file paths cleanly', async () => {
    const repositoryRoot = await createTempDirectory();
    tempDirectories.push(repositoryRoot);

    await fs.writeFile(path.join(repositoryRoot, 'README.md'), 'readme', 'utf8');

    await expect(
      readRepositoryFile(createRepository(repositoryRoot), '../README.md'),
    ).rejects.toThrow(/escapes the repository root/i);

    await expect(readRepositoryFile(createRepository(repositoryRoot), 'README.md', { startLine: 0 }))
      .rejects.toThrow(/startLine must be a positive integer/i);

    await expect(readRepositoryFile(createRepository(repositoryRoot), 'README.md', { endLine: 0 }))
      .rejects.toThrow(/endLine must be a positive integer/i);

    await expect(
      readRepositoryFile(createRepository(repositoryRoot), 'README.md', {
        startLine: 3,
        endLine: 1,
      }),
    ).rejects.toThrow(/endLine must be greater than or equal to startLine/i);
  });

  it('rejects paths that escape the resolved repository root through a symlink', async () => {
    const workspaceRoot = await createTempDirectory();
    tempDirectories.push(workspaceRoot);

    const repositoryRoot = path.join(workspaceRoot, 'repo');
    const outsideRoot = path.join(workspaceRoot, 'outside');
    const linkedDirectoryPath = path.join(repositoryRoot, 'linked-dir');

    await fs.mkdir(repositoryRoot, { recursive: true });
    await fs.mkdir(outsideRoot, { recursive: true });
    await fs.writeFile(path.join(outsideRoot, 'secret.txt'), 'secret', 'utf8');
    await fs.symlink(
      outsideRoot,
      linkedDirectoryPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(
      readRepositoryFile(createRepository(repositoryRoot), 'linked-dir/secret.txt'),
    ).rejects.toThrow(/escapes the repository root/i);
  });
});
