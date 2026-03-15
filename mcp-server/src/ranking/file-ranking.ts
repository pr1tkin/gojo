import type { FileRelation } from '../symbol-index/types.js';
import { countIntersection, computePathCloseness, createReason } from './scoring.js';
import type { RankedRelatedFile, RelatedFileCandidate } from './types.js';

function determineReason(entry: RankedRelatedFile['reasons']): string {
  const graphReason = entry.find((reason) => reason.signal === 'graph_connection');

  if (graphReason?.note === 'file_imports_file') {
    return 'direct import';
  }

  if (graphReason?.note === 'file_reexports_file') {
    return 'reexport relation';
  }

  if (entry.some((reason) => reason.signal === 'shared_import_tokens')) {
    return 'shared imports';
  }

  if (entry.some((reason) => reason.signal === 'shared_symbol_names')) {
    return 'shared symbols';
  }

  if (entry.some((reason) => reason.signal === 'same_repo')) {
    return 'same repository';
  }

  return 'related file';
}

function compareRelations(left: FileRelation, right: FileRelation): number {
  return left.repo.localeCompare(right.repo) || left.filePath.localeCompare(right.filePath);
}

export function rankRelatedFileCandidates(
  target: FileRelation,
  candidates: RelatedFileCandidate[],
  limit: number,
): RankedRelatedFile[] {
  return candidates
    .map((candidate) => {
      const reasons = [];
      let score = 0;
      const sharedImportTokens = countIntersection(target.importTokens, candidate.relation.importTokens);
      const sharedSymbolNames = countIntersection(target.symbolNames, candidate.relation.symbolNames);
      const sameRepo = candidate.relation.repo === target.repo ? 1 : 0;
      const pathCloseness = computePathCloseness(target.filePath, candidate.relation.filePath);
      const graphConnectionCount = candidate.graphSignals?.connectionCount ?? 0;

      if (graphConnectionCount > 0) {
        const edgeType = candidate.graphSignals?.edgeTypes[0];
        score += 8 + graphConnectionCount;
        reasons.push(createReason('graph_connection', 8 + graphConnectionCount, edgeType));
      }

      if (sharedImportTokens > 0) {
        score += sharedImportTokens * 4;
        reasons.push(createReason('shared_import_tokens', sharedImportTokens * 4));
      }

      if (sharedSymbolNames > 0) {
        score += sharedSymbolNames * 3;
        reasons.push(createReason('shared_symbol_names', sharedSymbolNames * 3));
      }

      if (sameRepo > 0) {
        score += 2;
        reasons.push(createReason('same_repo', 2));
      }

      if (pathCloseness > 0) {
        score += pathCloseness;
        reasons.push(createReason('path_closeness', pathCloseness));
      }

      return {
        repo: candidate.relation.repo,
        filePath: candidate.relation.filePath,
        score,
        reason: determineReason(reasons),
        reasons,
        relation: candidate.relation,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return compareRelations(left.relation, right.relation);
    })
    .slice(0, limit)
    .map(({ relation: _relation, ...entry }) => entry);
}
