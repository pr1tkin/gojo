import type { IndexedSymbol } from '../symbol-index/types.js';
import { compareReasons, createReason } from './scoring.js';
import type {
  RankedSymbolCandidate,
  SymbolRankingContext,
  SymbolRankingDependencies,
} from './types.js';

function compareIndexedSymbols(left: IndexedSymbol, right: IndexedSymbol): number {
  return (
    left.repo.localeCompare(right.repo) ||
    left.filePath.localeCompare(right.filePath) ||
    left.startLine - right.startLine ||
    left.endLine - right.endLine ||
    left.kind.localeCompare(right.kind)
  );
}

function scoreCandidate(
  candidate: IndexedSymbol,
  context: SymbolRankingContext,
  dependencies: SymbolRankingDependencies,
): RankedSymbolCandidate {
  const reasons = [];
  let score = 0;

  if (candidate.name === context.queryName) {
    score += 10;
    reasons.push(createReason('exact_name', 10));
  } else if (candidate.name.toLowerCase() === context.queryName.toLowerCase()) {
    score += 6;
    reasons.push(createReason('case_insensitive_name', 6));
  }

  if (context.kind && candidate.kind === context.kind) {
    score += 5;
    reasons.push(createReason('kind_match', 5));
  }

  if (context.repo && candidate.repo === context.repo) {
    score += 4;
    reasons.push(createReason('same_repo', 4));
  }

  if (candidate.exported) {
    score += 3;
    reasons.push(createReason('exported_symbol', 3));
  }

  const frequencyPenalty = dependencies.stats?.globalByName[candidate.name] ?? 0;

  if (frequencyPenalty > 1) {
    const penalty = Math.min(frequencyPenalty - 1, 5);
    score -= penalty;
    reasons.push(createReason('name_frequency_penalty', -penalty, candidate.name));
  }

  return {
    item: candidate,
    score,
    reasons,
  };
}

export function rankSymbolCandidates(
  candidates: IndexedSymbol[],
  context: SymbolRankingContext,
  dependencies: SymbolRankingDependencies = {},
): RankedSymbolCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(candidate, context, dependencies))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return compareIndexedSymbols(left.item, right.item) || compareReasons(left.item.name, right.item.name);
    });
}
