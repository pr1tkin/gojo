import fs from 'node:fs/promises';
import path from 'node:path';

import type { RepositoryInfo } from './types.js';

async function isGitRepository(repositoryRoot: string): Promise<boolean> {
  try {
    await fs.stat(path.join(repositoryRoot, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function isRepositoryLikeDirectory(repositoryRoot: string): Promise<boolean> {
  const markers = ['.git', 'package.json', 'tsconfig.json', 'next.config.ts', 'next.config.js'];

  for (const marker of markers) {
    try {
      await fs.stat(path.join(repositoryRoot, marker));
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

async function resolveRepositoryRootPath(entryPath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(entryPath);

    if (!stat.isDirectory()) {
      return null;
    }

    return await fs.realpath(entryPath);
  } catch {
    return null;
  }
}

export async function listRepositories(reposRoot: string): Promise<RepositoryInfo[]> {
  const resolvedReposRoot = await resolveRepositoryRootPath(reposRoot);

  if (resolvedReposRoot && (await isRepositoryLikeDirectory(resolvedReposRoot))) {
    const repositoryName = path.basename(resolvedReposRoot);

    return [
      {
        id: repositoryName,
        name: repositoryName,
        rootPath: resolvedReposRoot,
        isGitRepository: await isGitRepository(resolvedReposRoot),
      },
    ];
  }

  const entries = await fs.readdir(reposRoot, { withFileTypes: true });
  const repositories: RepositoryInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const entryPath = path.join(reposRoot, entry.name);
    const rootPath = await resolveRepositoryRootPath(entryPath);

    if (!rootPath) {
      continue;
    }

    repositories.push({
      id: entry.name,
      name: entry.name,
      rootPath,
      isGitRepository: await isGitRepository(rootPath),
    });
  }

  repositories.sort((left, right) => left.name.localeCompare(right.name));

  return repositories;
}

export async function getRepositoryById(
  reposRoot: string,
  repositoryId: string,
): Promise<RepositoryInfo | null> {
  const repositories = await listRepositories(reposRoot);
  return repositories.find((repository) => repository.id === repositoryId) ?? null;
}
