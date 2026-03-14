import fs from 'node:fs/promises';
import path from 'node:path';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.data',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

function normalizePath(value: string): string {
  return path.resolve(value);
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function discoverTsconfigForFile(
  repositoryRoot: string,
  filePath: string,
): Promise<string | null> {
  const absoluteRepositoryRoot = normalizePath(repositoryRoot);
  const absoluteFilePath = normalizePath(filePath);

  if (!isPathInsideRoot(absoluteRepositoryRoot, absoluteFilePath)) {
    return null;
  }

  let currentDirectory = path.dirname(absoluteFilePath);

  while (isPathInsideRoot(absoluteRepositoryRoot, currentDirectory)) {
    const tsconfigPath = path.join(currentDirectory, 'tsconfig.json');

    if (await fileExists(tsconfigPath)) {
      return tsconfigPath;
    }

    if (currentDirectory === absoluteRepositoryRoot) {
      break;
    }

    currentDirectory = path.dirname(currentDirectory);
  }

  return null;
}

async function collectTsconfigPaths(
  repositoryRoot: string,
  currentDirectory: string,
  results: string[],
): Promise<void> {
  const entries = await fs.readdir(currentDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      await collectTsconfigPaths(repositoryRoot, entryPath, results);
      continue;
    }

    if (entry.isFile() && entry.name === 'tsconfig.json') {
      results.push(entryPath);
    }
  }
}

export async function discoverRepositoryTsconfigs(repositoryRoot: string): Promise<string[]> {
  const absoluteRepositoryRoot = normalizePath(repositoryRoot);
  const results: string[] = [];
  await collectTsconfigPaths(absoluteRepositoryRoot, absoluteRepositoryRoot, results);

  return results.sort((left, right) => {
    const leftDepth = path.relative(absoluteRepositoryRoot, left).split(path.sep).length;
    const rightDepth = path.relative(absoluteRepositoryRoot, right).split(path.sep).length;

    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }

    return left.localeCompare(right);
  });
}
