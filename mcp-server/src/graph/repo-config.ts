import fs from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';

const IGNORED_DIRECTORIES = new Set([
  '.data',
  '.git',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

export interface SimplePathMapping {
  aliasPattern: string;
  targetPattern: string;
  wildcard: boolean;
  aliasPrefix: string;
  aliasSuffix: string;
  targetPrefix: string;
  targetSuffix: string;
}

export interface RepoConfigEntry {
  configPath: string;
  configDirectory: string;
  configDirectoryRelativePath: string;
  baseUrlRelativePath?: string;
  pathMappings: SimplePathMapping[];
}

export interface RepoResolutionConfig {
  repoId: string;
  repoRootPath: string;
  entries: RepoConfigEntry[];
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function countWildcards(value: string): number {
  return (value.match(/\*/g) ?? []).length;
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function toRepoRelativePath(repoRootPath: string, targetPath: string): string | null {
  if (!isPathInsideRoot(repoRootPath, targetPath)) {
    return null;
  }

  const relativePath = path.relative(repoRootPath, targetPath);
  return relativePath === '' ? '' : normalizeSlashes(relativePath);
}

function compareConfigEntries(left: RepoConfigEntry, right: RepoConfigEntry): number {
  const leftDepth = left.configDirectoryRelativePath === '' ? 0 : left.configDirectoryRelativePath.split('/').length;
  const rightDepth = right.configDirectoryRelativePath === '' ? 0 : right.configDirectoryRelativePath.split('/').length;

  if (leftDepth !== rightDepth) {
    return rightDepth - leftDepth;
  }

  if (left.configPath.endsWith('tsconfig.json') !== right.configPath.endsWith('tsconfig.json')) {
    return left.configPath.endsWith('tsconfig.json') ? -1 : 1;
  }

  return left.configPath.localeCompare(right.configPath);
}

function createSimplePathMapping(
  repoRootPath: string,
  targetBasePath: string,
  aliasPattern: string,
  targetPattern: string,
): SimplePathMapping | null {
  const aliasWildcardCount = countWildcards(aliasPattern);
  const targetWildcardCount = countWildcards(targetPattern);

  if (aliasWildcardCount > 1 || targetWildcardCount > 1 || aliasWildcardCount !== targetWildcardCount) {
    return null;
  }

  const wildcard = aliasWildcardCount === 1;
  const resolvedTargetPattern = path.resolve(targetBasePath, targetPattern);
  const repoRelativeTargetPattern = toRepoRelativePath(repoRootPath, resolvedTargetPattern);

  if (repoRelativeTargetPattern === null) {
    return null;
  }

  if (!wildcard) {
    return {
      aliasPattern,
      targetPattern: repoRelativeTargetPattern,
      wildcard: false,
      aliasPrefix: aliasPattern,
      aliasSuffix: '',
      targetPrefix: repoRelativeTargetPattern,
      targetSuffix: '',
    };
  }

  const [aliasPrefix, aliasSuffix] = aliasPattern.split('*');
  const [targetPrefix, targetSuffix] = repoRelativeTargetPattern.split('*');

  return {
    aliasPattern,
    targetPattern: repoRelativeTargetPattern,
    wildcard: true,
    aliasPrefix,
    aliasSuffix,
    targetPrefix,
    targetSuffix,
  };
}

function readConfigFile(configPath: string): ts.ParsedCommandLine | null {
  try {
    return (
      ts.getParsedCommandLineOfConfigFile(configPath, {}, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => undefined,
      }) ?? null
    );
  } catch {
    return null;
  }
}

function parseConfigEntry(repoRootPath: string, configPath: string): RepoConfigEntry | null {
  const parsed = readConfigFile(configPath);

  if (!parsed) {
    return null;
  }

  const configDirectory = path.dirname(configPath);
  const configDirectoryRelativePath = toRepoRelativePath(repoRootPath, configDirectory);

  if (configDirectoryRelativePath === null) {
    return null;
  }

  const baseUrlAbsolutePath =
    typeof parsed.options.baseUrl === 'string'
      ? path.resolve(configDirectory, parsed.options.baseUrl)
      : undefined;
  const baseUrlRelativePath = baseUrlAbsolutePath
    ? toRepoRelativePath(repoRootPath, baseUrlAbsolutePath) ?? undefined
    : undefined;
  const pathMappings: SimplePathMapping[] = [];
  const pathsBasePath = baseUrlAbsolutePath ?? configDirectory;

  for (const [aliasPattern, targetPatterns] of Object.entries(parsed.options.paths ?? {})) {
    if (!Array.isArray(targetPatterns) || targetPatterns.length !== 1 || typeof targetPatterns[0] !== 'string') {
      continue;
    }

    const mapping = createSimplePathMapping(repoRootPath, pathsBasePath, aliasPattern, targetPatterns[0]);

    if (mapping) {
      pathMappings.push(mapping);
    }
  }

  if (!baseUrlRelativePath && pathMappings.length === 0) {
    return null;
  }

  return {
    configPath,
    configDirectory,
    configDirectoryRelativePath,
    baseUrlRelativePath,
    pathMappings,
  };
}


async function collectRepoConfigPaths(
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

      await collectRepoConfigPaths(repositoryRoot, entryPath, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (entry.name === 'tsconfig.json' || entry.name === 'jsconfig.json') {
      results.push(entryPath);
    }
  }
}

export async function loadRepoResolutionConfig(
  repoId: string,
  repoRootPath: string,
): Promise<RepoResolutionConfig> {
  const absoluteRepoRootPath = path.resolve(repoRootPath);
  const configPaths: string[] = [];
  await collectRepoConfigPaths(absoluteRepoRootPath, absoluteRepoRootPath, configPaths);

  const entries = configPaths
    .map((configPath) => parseConfigEntry(absoluteRepoRootPath, configPath))
    .filter((entry): entry is RepoConfigEntry => entry !== null)
    .sort(compareConfigEntries);

  return {
    repoId,
    repoRootPath: absoluteRepoRootPath,
    entries,
  };
}

export async function loadRepoResolutionConfigs(
  repoRootPathsById: Record<string, string>,
): Promise<Record<string, RepoResolutionConfig>> {
  const entries = await Promise.all(
    Object.entries(repoRootPathsById).map(async ([repoId, repoRootPath]) => [
      repoId,
      await loadRepoResolutionConfig(repoId, repoRootPath),
    ]),
  );

  return Object.fromEntries(entries);
}

export function getNearestRepoConfigEntry(
  repoConfig: RepoResolutionConfig | undefined,
  filePath: string,
): RepoConfigEntry | null {
  if (!repoConfig) {
    return null;
  }

  const normalizedFilePath = normalizeSlashes(filePath);
  const containingEntries = repoConfig.entries.filter((entry) => {
    if (entry.configDirectoryRelativePath === '') {
      return true;
    }

    return (
      normalizedFilePath === entry.configDirectoryRelativePath ||
      normalizedFilePath.startsWith(`${entry.configDirectoryRelativePath}/`)
    );
  });

  return containingEntries[0] ?? null;
}
