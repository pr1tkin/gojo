import type { FindReferenceMatch } from '../types.js';
import { createReason } from './scoring.js';
import type {
  RankedReferenceCandidate,
  ReferenceRankingContext,
  ReferenceRankingDependencies,
} from './types.js';

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
    left.repo.localeCompare(right.repo) ||
    left.filePath.localeCompare(right.filePath) ||
    left.line - right.line ||
    left.snippet.localeCompare(right.snippet)
  );
}

export function rankReferenceCandidates(
  candidates: FindReferenceMatch[],
  context: ReferenceRankingContext,
  dependencies: ReferenceRankingDependencies,
): RankedReferenceCandidate[] {
  return candidates
    .map((candidate) => {
      const reasons = [];
      let score = 0;
      const relation = dependencies.relationsByKey[`${candidate.repo}/${candidate.filePath}`];
      const importsSymbol = relation?.importTokens.includes(context.symbol) ? 1 : 0;

      if (importsSymbol) {
        score += 4;
        reasons.push(createReason('imports_symbol', 4));
      }

      const snippetScore = scoreReferenceBase(candidate.snippet, context.symbol);
      score += snippetScore;
      reasons.push(createReason('snippet_shape', snippetScore));

      return {
        item: candidate,
        score,
        reasons,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return compareReferenceMatches(left.item, right.item);
    });
}
