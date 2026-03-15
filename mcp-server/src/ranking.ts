import type {
  FindReferenceMatch,
} from './types.js';
import type { FileRelation, IndexedSymbol } from './symbol-index/types.js';
import {
  rankReferenceCandidates,
  rankRelatedFileCandidates,
  rankSymbolCandidates,
  type RelatedFileCandidate,
} from './ranking/index.js';

export function rankFindSymbolResults(
  results: IndexedSymbol[],
  options: { kind?: string; repo?: string } = {},
): IndexedSymbol[] {
  const queryName = results[0]?.name ?? '';

  return rankSymbolCandidates(results, {
    queryName,
    kind: options.kind as IndexedSymbol['kind'] | undefined,
    repo: options.repo,
  }).map((entry) => entry.item);
}

export function rankFindReferenceResults(
  results: FindReferenceMatch[],
  symbol: string,
  relationsByKey: Record<string, FileRelation>,
): FindReferenceMatch[] {
  return rankReferenceCandidates(results, { symbol }, { relationsByKey }).map((entry) => entry.item);
}

export interface RelatedFileMatch {
  repo: string;
  filePath: string;
  reason: string;
  score?: number;
}

export function rankRelatedFiles(
  target: FileRelation,
  candidates: FileRelation[],
  limit: number,
): RelatedFileMatch[] {
  const relatedCandidates: RelatedFileCandidate[] = candidates.map((relation) => ({ relation }));
  return rankRelatedFileCandidates(target, relatedCandidates, limit).map((entry) => ({
    repo: entry.repo,
    filePath: entry.filePath,
    reason: entry.reason,
    score: entry.score,
  }));
}
