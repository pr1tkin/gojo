import path from 'node:path';

import type { RankedFileContextItem } from '../context/index.js';
import type { FileRelation } from '../symbol-index/types.js';
import type { PatternStructuralAnchor } from './types.js';

export type PatternStructuralContextStrength = 'high' | 'medium' | 'low';

export interface PatternStructuralAlignment {
  structurallyIndexed: boolean;
  graphAnchored: boolean;
  structuralContextStrength: PatternStructuralContextStrength;
  resolvedLocalDependencies: string[];
  relatedLocalFiles: string[];
}

function dedupeAndSort(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function tokenizePathForFamily(value: string): string[] {
  return value
    .replace(/\.[^.]+$/g, '')
    .split(/[\\/]/)
    .flatMap((segment) =>
      segment
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean),
    );
}

function fileIdToPath(fileId: string): string {
  const separatorIndex = fileId.indexOf(':');
  return separatorIndex >= 0 ? fileId.slice(separatorIndex + 1) : fileId;
}

export function getResolvedLocalDependencyFileIds(relation: FileRelation): string[] {
  return dedupeAndSort(
    relation.imports
      .map((entry) => entry.resolvedTargetFileId)
      .filter((value): value is string => Boolean(value)),
  );
}

export function getLocalDependencyFamilyTokens(
  fileIds: string[],
  filesById: Record<string, FileRelation>,
): string[] {
  return dedupeAndSort(
    fileIds.flatMap((fileId) => {
      const relation = filesById[fileId];
      const filePath = relation?.filePath ?? fileIdToPath(fileId);
      const directory = path.posix.dirname(filePath);
      return tokenizePathForFamily(directory === '.' ? filePath : directory);
    }),
  );
}

export function buildPatternStructuralAnchor(
  relation: FileRelation,
  filesById: Record<string, FileRelation>,
): PatternStructuralAnchor {
  const resolvedLocalDependencyFileIds = getResolvedLocalDependencyFileIds(relation);

  return {
    structurallyIndexed: relation.classification === 'source',
    resolvedLocalDependencyFileIds,
    localDependencyFamilyTokens: getLocalDependencyFamilyTokens(resolvedLocalDependencyFileIds, filesById),
  };
}

export function mapPatternStructuralAlignment(input: {
  structurallyIndexed: boolean;
  resolvedLocalDependencyFileIds: string[];
  relatedLocalFileIds?: string[];
  filesById?: Record<string, FileRelation>;
}): PatternStructuralAlignment {
  const resolvedLocalDependencies = dedupeAndSort(
    input.resolvedLocalDependencyFileIds.map((fileId) => input.filesById?.[fileId]?.filePath ?? fileIdToPath(fileId)),
  );
  const relatedLocalFiles = dedupeAndSort(
    (input.relatedLocalFileIds ?? []).map((fileId) => input.filesById?.[fileId]?.filePath ?? fileIdToPath(fileId)),
  );
  const graphAnchored =
    input.structurallyIndexed &&
    (resolvedLocalDependencies.length > 0 || relatedLocalFiles.length > 0);
  let structuralContextStrength: PatternStructuralContextStrength = 'low';

  if (
    graphAnchored &&
    (
      resolvedLocalDependencies.length >= 2 ||
      relatedLocalFiles.length >= 2 ||
      (resolvedLocalDependencies.length >= 1 && relatedLocalFiles.length >= 1)
    )
  ) {
    structuralContextStrength = 'high';
  } else if (graphAnchored) {
    structuralContextStrength = 'medium';
  }

  return {
    structurallyIndexed: input.structurallyIndexed,
    graphAnchored,
    structuralContextStrength,
    resolvedLocalDependencies,
    relatedLocalFiles,
  };
}

export function mapRelatedFileIds(items: RankedFileContextItem[]): string[] {
  return dedupeAndSort(items.map((entry) => entry.file.fileId));
}
