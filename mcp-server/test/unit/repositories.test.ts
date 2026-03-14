import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getRepositoryById, listRepositories } from '../../src/repositories.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-repositories-test-'));
}

async function createDirectoryLink(targetPath: string, linkPath: string): Promise<void> {
  await fs.symlink(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('listRepositories', () => {
  it('discovers first-level directory entries and ignores nested directories', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    await fs.mkdir(path.join(reposRoot, 'alpha', '.git'), { recursive: true });
    await fs.mkdir(path.join(reposRoot, 'beta', 'nested'), { recursive: true });

    const repositories = await listRepositories(reposRoot);

    expect(repositories.map((repository) => repository.id)).toEqual(['alpha', 'beta']);
    expect(repositories.map((repository) => repository.name)).toEqual(['alpha', 'beta']);
  });

  it('ignores regular files and other non-directory entries', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    await fs.mkdir(path.join(reposRoot, 'repo-a'), { recursive: true });
    await fs.writeFile(path.join(reposRoot, 'notes.txt'), 'not a repository', 'utf8');

    const repositories = await listRepositories(reposRoot);

    expect(repositories.map((repository) => repository.id)).toEqual(['repo-a']);
  });

  it('marks git repositories based on the presence of a .git entry', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    await fs.mkdir(path.join(reposRoot, 'git-repo', '.git'), { recursive: true });
    await fs.mkdir(path.join(reposRoot, 'plain-repo'), { recursive: true });

    const repositories = await listRepositories(reposRoot);

    expect(repositories).toEqual([
      expect.objectContaining({
        id: 'git-repo',
        isGitRepository: true,
      }),
      expect.objectContaining({
        id: 'plain-repo',
        isGitRepository: false,
      }),
    ]);
  });

  it('supports first-level symlinks to directories and preserves the entry name as the repository identity', async () => {
    const workspaceRoot = await createTempDirectory();
    tempDirectories.push(workspaceRoot);

    const reposRoot = path.join(workspaceRoot, 'repos');
    const targetRoot = path.join(workspaceRoot, 'actual-target');

    await fs.mkdir(reposRoot, { recursive: true });
    await fs.mkdir(path.join(targetRoot, '.git'), { recursive: true });
    await createDirectoryLink(targetRoot, path.join(reposRoot, 'linked-repo'));

    const repositories = await listRepositories(reposRoot);

    expect(repositories).toHaveLength(1);
    expect(repositories[0]).toEqual(
      expect.objectContaining({
        id: 'linked-repo',
        name: 'linked-repo',
        rootPath: path.resolve(targetRoot),
        isGitRepository: true,
      }),
    );
  });

  it('skips broken symlinks cleanly', async () => {
    const workspaceRoot = await createTempDirectory();
    tempDirectories.push(workspaceRoot);

    const reposRoot = path.join(workspaceRoot, 'repos');
    const targetRoot = path.join(workspaceRoot, 'missing-target');

    await fs.mkdir(reposRoot, { recursive: true });
    await createDirectoryLink(targetRoot, path.join(reposRoot, 'broken-link'));
    await fs.mkdir(path.join(reposRoot, 'real-repo'), { recursive: true });

    const repositories = await listRepositories(reposRoot);

    expect(repositories.map((repository) => repository.id)).toEqual(['real-repo']);
  });

  it('rejects when the repos root does not exist', async () => {
    const missingRoot = path.join(os.tmpdir(), `reporadar-missing-${Date.now()}`);

    await expect(listRepositories(missingRoot)).rejects.toThrow(/enoent|no such file/i);
  });
});

describe('getRepositoryById', () => {
  it('returns the matching repository by first-level entry name', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    await fs.mkdir(path.join(reposRoot, 'alpha'), { recursive: true });
    await fs.mkdir(path.join(reposRoot, 'beta'), { recursive: true });

    const repository = await getRepositoryById(reposRoot, 'beta');

    expect(repository).toEqual(
      expect.objectContaining({
        id: 'beta',
        name: 'beta',
      }),
    );
  });

  it('returns null for an unknown repository id', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    await fs.mkdir(path.join(reposRoot, 'alpha'), { recursive: true });

    await expect(getRepositoryById(reposRoot, 'missing')).resolves.toBeNull();
  });
});
