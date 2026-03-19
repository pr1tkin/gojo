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
  targetPatterns: string[];
  wildcard: boolean;
  aliasPrefix: string;
  aliasSuffix: string;
  targetEntries: Array<{
    targetPattern: string;
    targetPrefix: string;
    targetSuffix: string;
  }>;
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

  const leftPriority = getConfigPriority(left.configPath);
  const rightPriority = getConfigPriority(right.configPath);

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return left.configPath.localeCompare(right.configPath);
}

function getConfigPriority(configPath: string): number {
  const fileName = path.basename(configPath).toLowerCase();

  if (fileName === 'tsconfig.json') {
    return 0;
  }

  if (fileName === 'jsconfig.json') {
    return 1;
  }

  if (fileName === 'tsconfig.base.json') {
    return 2;
  }

  return 3;
}

function createSimplePathMapping(
  repoRootPath: string,
  targetBasePath: string,
  aliasPattern: string,
  targetPatterns: string[],
): SimplePathMapping | null {
  const aliasWildcardCount = countWildcards(aliasPattern);
  if (aliasWildcardCount > 1) {
    return null;
  }

  const wildcard = aliasWildcardCount === 1;
  const targetEntries: SimplePathMapping['targetEntries'] = [];

  for (const targetPattern of targetPatterns) {
    const targetWildcardCount = countWildcards(targetPattern);

    if (targetWildcardCount > 1 || aliasWildcardCount !== targetWildcardCount) {
      continue;
    }

    const resolvedTargetPattern = path.resolve(targetBasePath, targetPattern);
    const repoRelativeTargetPattern = toRepoRelativePath(repoRootPath, resolvedTargetPattern);

    if (repoRelativeTargetPattern === null) {
      continue;
    }

    if (!wildcard) {
      targetEntries.push({
        targetPattern: repoRelativeTargetPattern,
        targetPrefix: repoRelativeTargetPattern,
        targetSuffix: '',
      });
      continue;
    }

    const [targetPrefix, targetSuffix] = repoRelativeTargetPattern.split('*');
    targetEntries.push({
      targetPattern: repoRelativeTargetPattern,
      targetPrefix,
      targetSuffix,
    });
  }

  if (targetEntries.length === 0) {
    return null;
  }

  const [aliasPrefix, aliasSuffix] = wildcard ? aliasPattern.split('*') : [aliasPattern, ''];

  return {
    aliasPattern,
    targetPattern: targetEntries[0]?.targetPattern ?? '',
    targetPatterns: targetEntries.map((entry) => entry.targetPattern),
    wildcard,
    aliasPrefix,
    aliasSuffix,
    targetEntries,
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

const repoResolutionConfigCache = new Map<string, Promise<RepoResolutionConfig>>();

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
    if (!Array.isArray(targetPatterns)) {
      continue;
    }

    const normalizedTargets = targetPatterns.filter((value): value is string => typeof value === 'string');

    if (normalizedTargets.length === 0) {
      continue;
    }

    const mapping = createSimplePathMapping(repoRootPath, pathsBasePath, aliasPattern, normalizedTargets);

    if (mapping) {
      pathMappings.push(mapping);
    }
  }

  if (baseUrlRelativePath === undefined && pathMappings.length === 0) {
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

    if (entry.name === 'tsconfig.json' || entry.name === 'tsconfig.base.json' || entry.name === 'jsconfig.json') {
      results.push(entryPath);
    }
  }
}

export async function loadRepoResolutionConfig(
  repoId: string,
  repoRootPath: string,
): Promise<RepoResolutionConfig> {
  const absoluteRepoRootPath = path.resolve(repoRootPath);
  const cacheKey = `${repoId}:${absoluteRepoRootPath}`;
  const cached = repoResolutionConfigCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const pending = (async (): Promise<RepoResolutionConfig> => {
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
  })();

  repoResolutionConfigCache.set(cacheKey, pending);
  return pending;
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
