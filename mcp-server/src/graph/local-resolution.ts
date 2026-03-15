import path from 'node:path';

import type { FileRelation } from '../symbol-index/types.js';
import type { RepoResolutionConfig, SimplePathMapping } from './repo-config.js';
import { getNearestRepoConfigEntry } from './repo-config.js';

export type LocalResolutionStatus = 'resolved' | 'unresolved' | 'ambiguous' | 'non_local';

export interface LocalResolutionResult {
  status: LocalResolutionStatus;
  targetFileId?: string;
  candidateFileIds: string[];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function buildCandidatePathsFromBasePath(basePath: string): string[] {
  const normalizedBasePath = normalizePath(basePath).replace(/^\/+/, '');
  const hasExplicitExtension = normalizedBasePath.endsWith('.ts') || normalizedBasePath.endsWith('.tsx');

  if (hasExplicitExtension) {
    return [normalizedBasePath];
  }

  return [
    `${normalizedBasePath}.ts`,
    `${normalizedBasePath}.tsx`,
    path.posix.join(normalizedBasePath, 'index.ts'),
    path.posix.join(normalizedBasePath, 'index.tsx'),
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

function applySimplePathMapping(mapping: SimplePathMapping, source: string): string | null {
  if (!mapping.wildcard) {
    return source === mapping.aliasPattern ? mapping.targetPattern : null;
  }

  if (!source.startsWith(mapping.aliasPrefix) || !source.endsWith(mapping.aliasSuffix)) {
    return null;
  }

  const matchedSegment = source.slice(mapping.aliasPrefix.length, source.length - mapping.aliasSuffix.length);
  return `${mapping.targetPrefix}${matchedSegment}${mapping.targetSuffix}`;
}

function buildConfiguredLocalCandidatePaths(
  relation: FileRelation,
  source: string,
  repoConfig: RepoResolutionConfig | undefined,
): string[] {
  const configEntry = getNearestRepoConfigEntry(repoConfig, relation.filePath);

  if (!configEntry) {
    return [];
  }

  const candidateBasePaths = new Set<string>();

  for (const mapping of configEntry.pathMappings) {
    const mappedPath = applySimplePathMapping(mapping, source);

    if (mappedPath) {
      candidateBasePaths.add(mappedPath);
    }
  }

  if (configEntry.baseUrlRelativePath) {
    const baseUrlPath =
      configEntry.baseUrlRelativePath === ''
        ? source
        : path.posix.join(configEntry.baseUrlRelativePath, normalizePath(source));
    candidateBasePaths.add(baseUrlPath);
  }

  return Array.from(candidateBasePaths).flatMap((candidateBasePath) =>
    buildCandidatePathsFromBasePath(candidateBasePath),
  );
}

export function resolveLocalFileTarget(
  relation: FileRelation,
  source: string,
  filesById: Record<string, FileRelation>,
  repoConfig?: RepoResolutionConfig,
): LocalResolutionResult {
  const candidatePaths = isRelativeLocalSpecifier(source)
    ? buildLocalResolutionCandidatePaths(relation.filePath, source)
    : buildConfiguredLocalCandidatePaths(relation, source, repoConfig);

  if (candidatePaths.length === 0) {
    return {
      status: 'non_local',
      candidateFileIds: [],
    };
  }
  const candidateFileIds = new Set<string>();

  for (const candidatePath of candidatePaths) {
    const normalizedCandidate = normalizePath(candidatePath).replace(/^\/+/, '');

    for (const fileRelation of Object.values(filesById)) {
      if (fileRelation.repo !== relation.repo) {
        continue;
      }

      if (normalizePath(fileRelation.filePath) === normalizedCandidate) {
        candidateFileIds.add(fileRelation.fileId);
      }
    }
  }

  const resolvedCandidates = Array.from(candidateFileIds).sort((left, right) => left.localeCompare(right));

  if (resolvedCandidates.length === 1) {
    return {
      status: 'resolved',
      targetFileId: resolvedCandidates[0],
      candidateFileIds: resolvedCandidates,
    };
  }

  if (resolvedCandidates.length > 1) {
    return {
      status: 'ambiguous',
      candidateFileIds: resolvedCandidates,
    };
  }

  return {
    status: 'unresolved',
    candidateFileIds: [],
  };
}
