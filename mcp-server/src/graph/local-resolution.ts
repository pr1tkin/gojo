import path from 'node:path';

import type { FileRelation } from '../symbol-index/types.js';

export type LocalResolutionStatus = 'resolved' | 'unresolved' | 'ambiguous' | 'non_local';

export interface LocalResolutionResult {
  status: LocalResolutionStatus;
  targetFileId?: string;
  candidateFileIds: string[];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
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
  ).replace(/^\/+/, '');
  const hasExplicitExtension = resolvedBase.endsWith('.ts') || resolvedBase.endsWith('.tsx');

  if (hasExplicitExtension) {
    return [resolvedBase];
  }

  return [
    `${resolvedBase}.ts`,
    `${resolvedBase}.tsx`,
    path.posix.join(resolvedBase, 'index.ts'),
    path.posix.join(resolvedBase, 'index.tsx'),
  ];
}

export function resolveLocalFileTarget(
  relation: FileRelation,
  source: string,
  filesById: Record<string, FileRelation>,
): LocalResolutionResult {
  if (!isRelativeLocalSpecifier(source)) {
    return {
      status: 'non_local',
      candidateFileIds: [],
    };
  }

  const candidatePaths = buildLocalResolutionCandidatePaths(relation.filePath, source);
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
