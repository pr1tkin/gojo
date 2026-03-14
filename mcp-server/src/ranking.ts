import path from 'node:path';

import type {
  FindReferenceMatch,
} from './types.js';
import type { FileRelation, IndexedSymbol } from './symbol-index/types.js';

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareIndexedSymbols(left: IndexedSymbol, right: IndexedSymbol): number {
  return (
    compareStrings(left.repo, right.repo) ||
    compareStrings(left.filePath, right.filePath) ||
    left.startLine - right.startLine ||
    left.endLine - right.endLine ||
    compareStrings(left.kind, right.kind)
  );
}

export function rankFindSymbolResults(
  results: IndexedSymbol[],
  options: { kind?: string; repo?: string } = {},
): IndexedSymbol[] {
  return [...results].sort((left, right) => {
    const leftExactKind = options.kind && left.kind === options.kind ? 1 : 0;
    const rightExactKind = options.kind && right.kind === options.kind ? 1 : 0;

    if (rightExactKind !== leftExactKind) {
      return rightExactKind - leftExactKind;
    }

    const leftExactRepo = options.repo && left.repo === options.repo ? 1 : 0;
    const rightExactRepo = options.repo && right.repo === options.repo ? 1 : 0;

    if (rightExactRepo !== leftExactRepo) {
      return rightExactRepo - leftExactRepo;
    }

    const leftExported = left.exported ? 1 : 0;
    const rightExported = right.exported ? 1 : 0;

    if (rightExported !== leftExported) {
      return rightExported - leftExported;
    }

    return compareIndexedSymbols(left, right);
  });
}

function scoreReferenceBase(snippet: string, symbol: string): number {
  const trimmed = snippet.trim();
  const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (new RegExp(`\\bimport\\b.*\\b${escapedSymbol}\\b`).test(trimmed)) {
    return 4;
  }

  if (new RegExp(`\\bnew\\s+${escapedSymbol}\\s*\\(`).test(trimmed)) {
    return 3;
  }

  if (new RegExp(`\\.${escapedSymbol}\\b`).test(trimmed)) {
    return 2;
  }

  if (new RegExp(`\\b${escapedSymbol}\\s*\\(`).test(trimmed)) {
    return 2;
  }

  return 1;
}

function compareReferenceMatches(left: FindReferenceMatch, right: FindReferenceMatch): number {
  return (
    compareStrings(left.repo, right.repo) ||
    compareStrings(left.filePath, right.filePath) ||
    left.line - right.line ||
    compareStrings(left.snippet, right.snippet)
  );
}

export function rankFindReferenceResults(
  results: FindReferenceMatch[],
  symbol: string,
  relationsByKey: Record<string, FileRelation>,
): FindReferenceMatch[] {
  return [...results].sort((left, right) => {
    const leftRelation = relationsByKey[`${left.repo}/${left.filePath}`];
    const rightRelation = relationsByKey[`${right.repo}/${right.filePath}`];
    const leftImportsSymbol = leftRelation?.imports.includes(symbol) ? 1 : 0;
    const rightImportsSymbol = rightRelation?.imports.includes(symbol) ? 1 : 0;

    if (rightImportsSymbol !== leftImportsSymbol) {
      return rightImportsSymbol - leftImportsSymbol;
    }

    const leftScore = scoreReferenceBase(left.snippet, symbol);
    const rightScore = scoreReferenceBase(right.snippet, symbol);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return compareReferenceMatches(left, right);
  });
}

export interface RelatedFileMatch {
  repo: string;
  filePath: string;
  reason: string;
  score?: number;
}

function countIntersection(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).length;
}

function computePathCloseness(left: string, right: string): number {
  const leftSegments = left.split('/').filter(Boolean);
  const rightSegments = right.split('/').filter(Boolean);
  const maxSegments = Math.min(leftSegments.length, rightSegments.length);
  let sharedPrefix = 0;

  while (sharedPrefix < maxSegments && leftSegments[sharedPrefix] === rightSegments[sharedPrefix]) {
    sharedPrefix += 1;
  }

  if (sharedPrefix > 0) {
    return sharedPrefix;
  }

  if (path.dirname(left) === path.dirname(right)) {
    return 1;
  }

  return 0;
}

function determineReason(
  sharedImports: number,
  sharedSymbols: number,
  pathCloseness: number,
): string {
  if (sharedImports > 0) {
    return 'shared imports';
  }

  if (sharedSymbols > 0) {
    return 'shared symbols';
  }

  if (pathCloseness > 0) {
    return 'nearby path';
  }

  return 'same repository';
}

export function rankRelatedFiles(
  target: FileRelation,
  candidates: FileRelation[],
  limit: number,
): RelatedFileMatch[] {
  return candidates
    .map((candidate) => {
      const sharedImports = countIntersection(target.imports, candidate.imports);
      const sharedSymbols = countIntersection(target.symbols, candidate.symbols);
      const sameRepo = candidate.repo === target.repo ? 1 : 0;
      const pathCloseness = computePathCloseness(target.filePath, candidate.filePath);
      const score =
        sharedImports * 5 + sharedSymbols * 3 + sameRepo * 2 + pathCloseness;

      return {
        candidate,
        score,
        reason: determineReason(sharedImports, sharedSymbols, pathCloseness),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return (
        compareStrings(left.candidate.repo, right.candidate.repo) ||
        compareStrings(left.candidate.filePath, right.candidate.filePath)
      );
    })
    .slice(0, limit)
    .map((entry) => ({
      repo: entry.candidate.repo,
      filePath: entry.candidate.filePath,
      reason: entry.reason,
      score: entry.score,
    }));
}
