import type { FileRelation } from '../symbol-index/types.js';
import { countIntersection, computePathCloseness, createReason } from './scoring.js';
import type { RankedRelatedFile, RelatedFileCandidate } from './types.js';

function determineReason(entry: RankedRelatedFile['reasons']): string {
  const graphReason = entry.find((reason) => reason.signal === 'graph_connection');

  if (graphReason?.note === 'call_reference') {
    return 'exact call reference';
  }

  if (graphReason?.note === 'symbol_reference') {
    return 'exact symbol reference';
  }

  if (graphReason?.note === 'incoming_file_imports_file') {
    return 'direct import';
  }

  if (graphReason?.note === 'incoming_file_reexports_file') {
    return 'reexport relation';
  }

  if (graphReason?.note === 'outgoing_file_imports_file') {
    return 'imported dependency';
  }

  if (graphReason?.note === 'outgoing_file_reexports_file') {
    return 'reexported dependency';
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

function graphEdgeWeight(edgeType: string | undefined): number {
  switch (edgeType) {
    case 'call_reference':
      return 18;
    case 'symbol_reference':
    case 'jsx_reference':
      return 16;
    case 'incoming_file_imports_file':
      return 12;
    case 'incoming_file_reexports_file':
      return 10;
    case 'type_reference':
      return 8;
    case 'outgoing_file_reexports_file':
      return 5;
    case 'outgoing_file_imports_file':
      return 4;
    default:
      return 8;
  }
}

function compareRelations(left: FileRelation, right: FileRelation): number {
  return left.repo.localeCompare(right.repo) || left.filePath.localeCompare(right.filePath);
}

function architecturalSurfaceScore(filePath: string): number {
  const normalized = filePath.replace(/\\/g, '/');

  if (/(^|\/)(page|route|layout)\.(tsx?|jsx?)$/i.test(normalized)) {
    return 4;
  }

  if (/^(app|pages)\//i.test(normalized) || /(^|\/)app\//i.test(normalized)) {
    return 2;
  }

  if (/(^|\/)lib\/(services?|db)\//i.test(normalized) || /(^|\/)(services?|db)\//i.test(normalized)) {
    return -2;
  }

  return 0;
}

function serviceConsumerBias(targetPath: string, candidatePath: string): number {
  const normalizedTarget = targetPath.replace(/\\/g, '/');
  const normalizedCandidate = candidatePath.replace(/\\/g, '/');
  const targetIsService = /(^|\/)(lib\/)?services?\//i.test(normalizedTarget);

  if (!targetIsService) {
    return 0;
  }

  if (/(^|\/)(app|pages)\//i.test(normalizedCandidate) || /(^|\/)(page|route|layout)\.(tsx?|jsx?)$/i.test(normalizedCandidate)) {
    return 4;
  }

  if (/(\b|\/)(lib\/)?(services?|db)\//i.test(normalizedCandidate)) {
    return -4;
  }

  return 0;
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
      const surfaceScore = architecturalSurfaceScore(candidate.relation.filePath);
      const serviceBias = serviceConsumerBias(target.filePath, candidate.relation.filePath);

      if (graphConnectionCount > 0) {
        const edgeType = candidate.graphSignals?.edgeTypes[0];
        const edgeScore = graphEdgeWeight(edgeType) + graphConnectionCount;
        score += edgeScore;
        reasons.push(createReason('graph_connection', edgeScore, edgeType));
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

      if (surfaceScore !== 0) {
        score += surfaceScore;
        reasons.push(createReason('architectural_surface', surfaceScore));
      }

      if (serviceBias !== 0) {
        score += serviceBias;
        reasons.push(createReason('service_consumer_bias', serviceBias));
      }

      return {
        fileId: candidate.relation.fileId,
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
