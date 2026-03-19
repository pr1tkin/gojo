import path from 'node:path';

import type { FileRelation } from '../symbol-index/types.js';
import type { RepoResolutionConfig, SimplePathMapping } from './repo-config.js';
import { getNearestRepoConfigEntry } from './repo-config.js';

export type LocalResolutionStatus = 'resolved' | 'unresolved' | 'ambiguous' | 'non_local';
export type LocalResolutionAttemptKind = 'relative' | 'alias' | 'baseUrl' | 'non_local';

export interface LocalResolutionResult {
  status: LocalResolutionStatus;
  targetFileId?: string;
  candidateFileIds: string[];
  attemptedKind: LocalResolutionAttemptKind;
  matchedAlias: boolean;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function buildCandidatePathsFromBasePath(basePath: string): string[] {
  const normalizedBasePath = normalizePath(basePath).replace(/^\/+/, '');
  const hasExplicitExtension =
    normalizedBasePath.endsWith('.js') ||
    normalizedBasePath.endsWith('.jsx') ||
    normalizedBasePath.endsWith('.ts') ||
    normalizedBasePath.endsWith('.tsx');

  if (hasExplicitExtension) {
    return [normalizedBasePath];
  }

  return [
    `${normalizedBasePath}.ts`,
    `${normalizedBasePath}.tsx`,
    `${normalizedBasePath}.js`,
    `${normalizedBasePath}.jsx`,
    path.posix.join(normalizedBasePath, 'index.ts'),
    path.posix.join(normalizedBasePath, 'index.tsx'),
    path.posix.join(normalizedBasePath, 'index.js'),
    path.posix.join(normalizedBasePath, 'index.jsx'),
  ];
}

export function isRelativeLocalSpecifier(source: string): boolean {
  return source.startsWith('./') || source.startsWith('../') || source === '.' || source === '..';
}

export function buildLocalResolutionCandidatePaths(
  fromFilePath: string,
  source: string,
): string[] {
  const normalizedFilePath = normalizePath(fromFilePath);
  const normalizedSource = normalizePath(source);
  const baseDirectory = path.posix.dirname(normalizedFilePath);
  const normalizedBase = baseDirectory === '.' ? '' : baseDirectory;
  const resolvedBase = normalizePath(
    path.posix.normalize(path.posix.join(normalizedBase, normalizedSource)),
  );

  return buildCandidatePathsFromBasePath(resolvedBase);
}

export function matchesConfiguredPathAlias(mapping: SimplePathMapping, source: string): boolean {
  if (!mapping.wildcard) {
    return source === mapping.aliasPattern;
  }

  return source.startsWith(mapping.aliasPrefix) && source.endsWith(mapping.aliasSuffix);
}

export function isAliasLikeLocalSpecifier(source: string): boolean {
  return source.startsWith('@/') || source.startsWith('~/') || source.startsWith('#/');
}

function buildAliasCandidateBasePaths(mappings: SimplePathMapping[], source: string): string[] {
  const candidateBasePaths = new Set<string>();

  for (const mapping of mappings) {
    if (!matchesConfiguredPathAlias(mapping, source)) {
      continue;
    }

    if (!mapping.wildcard) {
      for (const targetEntry of mapping.targetEntries) {
        candidateBasePaths.add(targetEntry.targetPattern);
      }

      continue;
    }

    const matchedSegment = source.slice(mapping.aliasPrefix.length, source.length - mapping.aliasSuffix.length);

    for (const targetEntry of mapping.targetEntries) {
      candidateBasePaths.add(`${targetEntry.targetPrefix}${matchedSegment}${targetEntry.targetSuffix}`);
    }
  }

  return Array.from(candidateBasePaths);
}

function buildBaseUrlCandidateBasePaths(baseUrlRelativePath: string | undefined, source: string): string[] {
  if (baseUrlRelativePath === undefined) {
    return [];
  }

  return [
    baseUrlRelativePath === ''
      ? normalizePath(source)
      : path.posix.join(baseUrlRelativePath, normalizePath(source)),
  ];
}

const repoFilePathIndexCache = new WeakMap<Record<string, FileRelation>, Map<string, Map<string, string[]>>>();

function getRepoFilePathIndex(filesById: Record<string, FileRelation>): Map<string, Map<string, string[]>> {
  const cached = repoFilePathIndexCache.get(filesById);

  if (cached) {
    return cached;
  }

  const index = new Map<string, Map<string, string[]>>();

  for (const relation of Object.values(filesById)) {
    let repoIndex = index.get(relation.repo);

    if (!repoIndex) {
      repoIndex = new Map<string, string[]>();
      index.set(relation.repo, repoIndex);
    }

    const normalizedFilePath = normalizePath(relation.filePath);
    const existing = repoIndex.get(normalizedFilePath) ?? [];
    existing.push(relation.fileId);
    repoIndex.set(normalizedFilePath, existing);
  }

  repoFilePathIndexCache.set(filesById, index);
  return index;
}

function hasRepoPathPrefix(
  relation: FileRelation,
  filesById: Record<string, FileRelation>,
  prefix: string,
): boolean {
  const normalizedPrefix = normalizePath(prefix).replace(/^\/+/, '');

  if (!normalizedPrefix) {
    return false;
  }

  const repoFilePathIndex = getRepoFilePathIndex(filesById).get(relation.repo) ?? new Map<string, string[]>();

  for (const filePath of repoFilePathIndex.keys()) {
    if (
      filePath === normalizedPrefix ||
      filePath.startsWith(`${normalizedPrefix}/`) ||
      filePath.startsWith(`${normalizedPrefix}.`)
    ) {
      return true;
    }
  }

  return false;
}

function isPlausibleBaseUrlSource(
  relation: FileRelation,
  source: string,
  filesById: Record<string, FileRelation>,
  baseUrlRelativePath: string | undefined,
): boolean {
  const normalizedSource = normalizePath(source).replace(/^\/+/, '');
  const sourceSegments = normalizedSource.split('/').filter(Boolean);

  if (sourceSegments.length < 2) {
    return false;
  }

  if (sourceSegments[0]?.startsWith('@')) {
    return false;
  }

  const prefixSegments =
    baseUrlRelativePath && baseUrlRelativePath !== ''
      ? [...normalizePath(baseUrlRelativePath).split('/').filter(Boolean), sourceSegments[0]]
      : [sourceSegments[0]];

  return hasRepoPathPrefix(relation, filesById, prefixSegments.join('/'));
}

function finalizeResolution(
  relation: FileRelation,
  candidatePaths: string[],
  filesById: Record<string, FileRelation>,
  options: {
    attemptedKind: LocalResolutionAttemptKind;
    matchedAlias?: boolean;
  },
): LocalResolutionResult {
  if (candidatePaths.length === 0) {
    return {
      status: options.attemptedKind === 'non_local' ? 'non_local' : 'unresolved',
      candidateFileIds: [],
      attemptedKind: options.attemptedKind,
      matchedAlias: options.matchedAlias ?? false,
    };
  }

  const repoFilePathIndex = getRepoFilePathIndex(filesById).get(relation.repo) ?? new Map<string, string[]>();
  const candidateFileIds = new Set<string>();

  for (const candidatePath of candidatePaths) {
    const normalizedCandidate = normalizePath(candidatePath).replace(/^\/+/, '');

    for (const fileId of repoFilePathIndex.get(normalizedCandidate) ?? []) {
      candidateFileIds.add(fileId);
    }
  }

  const resolvedCandidates = Array.from(candidateFileIds).sort((left, right) => left.localeCompare(right));

  if (resolvedCandidates.length === 1) {
    return {
      status: 'resolved',
      targetFileId: resolvedCandidates[0],
      candidateFileIds: resolvedCandidates,
      attemptedKind: options.attemptedKind,
      matchedAlias: options.matchedAlias ?? false,
    };
  }

  if (resolvedCandidates.length > 1) {
    return {
      status: 'ambiguous',
      candidateFileIds: resolvedCandidates,
      attemptedKind: options.attemptedKind,
      matchedAlias: options.matchedAlias ?? false,
    };
  }

  return {
    status: 'unresolved',
    candidateFileIds: [],
    attemptedKind: options.attemptedKind,
    matchedAlias: options.matchedAlias ?? false,
  };
}

export function resolveLocalFileTarget(
  relation: FileRelation,
  source: string,
  filesById: Record<string, FileRelation>,
  repoConfig?: RepoResolutionConfig,
): LocalResolutionResult {
  if (isRelativeLocalSpecifier(source)) {
    return finalizeResolution(
      relation,
      buildLocalResolutionCandidatePaths(relation.filePath, source),
      filesById,
      { attemptedKind: 'relative' },
    );
  }

  const configEntry = getNearestRepoConfigEntry(repoConfig, relation.filePath);
  const aliasCandidateBasePaths = buildAliasCandidateBasePaths(configEntry?.pathMappings ?? [], source);
  const matchedAlias =
    aliasCandidateBasePaths.length > 0 ||
    (configEntry?.pathMappings.some((mapping) => matchesConfiguredPathAlias(mapping, source)) ?? false) ||
    isAliasLikeLocalSpecifier(source);

  if (aliasCandidateBasePaths.length > 0 || matchedAlias) {
    return finalizeResolution(
      relation,
      aliasCandidateBasePaths.flatMap((candidateBasePath) => buildCandidatePathsFromBasePath(candidateBasePath)),
      filesById,
      {
        attemptedKind: 'alias',
        matchedAlias,
      },
    );
  }

  const baseUrlCandidateBasePaths = buildBaseUrlCandidateBasePaths(configEntry?.baseUrlRelativePath, source);

  if (baseUrlCandidateBasePaths.length > 0) {
    const baseUrlResolution = finalizeResolution(
      relation,
      baseUrlCandidateBasePaths.flatMap((candidateBasePath) => buildCandidatePathsFromBasePath(candidateBasePath)),
      filesById,
      {
        attemptedKind: 'baseUrl',
      },
    );

    if (
      baseUrlResolution.status === 'unresolved' &&
      !isPlausibleBaseUrlSource(relation, source, filesById, configEntry?.baseUrlRelativePath)
    ) {
      return {
        status: 'non_local',
        candidateFileIds: [],
        attemptedKind: 'non_local',
        matchedAlias: false,
      };
    }

    return baseUrlResolution;
  }

  return {
    status: 'non_local',
    candidateFileIds: [],
    attemptedKind: 'non_local',
    matchedAlias: false,
  };
}
