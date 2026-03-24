import type { FileRelation } from '../symbol-index/types.js';
import { countIntersection, computePathCloseness, createReason } from './scoring.js';
import type { RankedRelatedFile, RelatedFileCandidate } from './types.js';

type EdgeStrength = 'strong' | 'medium' | 'weak';

function edgeStrength(edgeType: string | undefined): EdgeStrength {
  switch (edgeType) {
    case 'import_usage':
    case 'call_reference':
    case 'symbol_reference':
    case 'jsx_reference':
    case 'type_reference':
    case 'api_route_handler':
      return 'strong';
    case 'file_imports_file':
    case 'incoming_file_imports_file':
    case 'file_reexports_file':
    case 'incoming_file_reexports_file':
    case 'api_client_to_route':
    case 'api_propagation':
      return 'medium';
    default:
      return 'weak';
  }
}

function edgeStrengthRank(edgeType: string | undefined): number {
  switch (edgeStrength(edgeType)) {
    case 'strong':
      return 3;
    case 'medium':
      return 2;
    case 'weak':
      return 1;
  }
}

function strongestGraphEdgeType(edgeTypes: string[] | undefined): string | undefined {
  const values = edgeTypes ?? [];

  return values
    .slice()
    .sort((left, right) => {
      const strengthDelta = edgeStrengthRank(right) - edgeStrengthRank(left);

      if (strengthDelta !== 0) {
        return strengthDelta;
      }

      return graphEdgeWeight(right) - graphEdgeWeight(left);
    })[0];
}

function determineReason(entry: RankedRelatedFile['reasons']): string {
  const graphReason = entry.find((reason) => reason.signal === 'graph_connection');

  if (graphReason?.note === 'call_reference') {
    return 'exact call reference';
  }

  if (graphReason?.note === 'import_usage') {
    return 'exact import usage';
  }

  if (graphReason?.note === 'symbol_reference') {
    return 'exact symbol reference';
  }

  if (graphReason?.note === 'api_route_handler') {
    return 'api route handler';
  }

  if (graphReason?.note === 'api_propagation') {
    return 'api-mediated consumer';
  }

  if (graphReason?.note === 'api_client_to_route') {
    return 'client calls api route';
  }

  if (graphReason?.note === 'incoming_file_imports_file' || graphReason?.note === 'file_imports_file') {
    return 'direct import';
  }

  if (graphReason?.note === 'incoming_file_reexports_file' || graphReason?.note === 'file_reexports_file') {
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
    case 'import_usage':
      return 19;
    case 'call_reference':
      return 18;
    case 'api_route_handler':
      return 17;
    case 'symbol_reference':
    case 'jsx_reference':
      return 16;
    case 'api_propagation':
      return 13;
    case 'api_client_to_route':
      return 11;
    case 'file_imports_file':
    case 'incoming_file_imports_file':
      return 12;
    case 'file_reexports_file':
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

function noisePenalty(filePath: string): number {
  const normalized = filePath.replace(/\\/g, '/');

  if (/\.(test|spec)\.(tsx?|jsx?)$/i.test(normalized) || /(^|\/)__tests__\//i.test(normalized)) {
    return -10;
  }

  if (/\.(stories|story)\.(tsx?|jsx?)$/i.test(normalized)) {
    return -8;
  }

  if (/(^|\/)(demo|demos|playground|playgrounds|example|examples)\//i.test(normalized)) {
    return -6;
  }

  return 0;
}

function graphEvidenceScore(edgeTypes: string[], connectionCount: number): { score: number; primaryEdgeType?: string; strengthRank: number } {
  const primaryEdgeType = strongestGraphEdgeType(edgeTypes);
  const strengthRank = edgeStrengthRank(primaryEdgeType);
  const strongCount = edgeTypes.filter((edgeType) => edgeStrength(edgeType) === 'strong').length;
  const mediumCount = edgeTypes.filter((edgeType) => edgeStrength(edgeType) === 'medium').length;
  const weakCount = edgeTypes.filter((edgeType) => edgeStrength(edgeType) === 'weak').length;
  const score =
    graphEdgeWeight(primaryEdgeType) +
    connectionCount +
    strongCount * 8 +
    mediumCount * 2 -
    weakCount;

  return {
    score,
    primaryEdgeType,
    strengthRank,
  };
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
      const graphEdgeTypes = candidate.graphSignals?.edgeTypes ?? [];
      const surfaceScore = architecturalSurfaceScore(candidate.relation.filePath);
      const serviceBias = serviceConsumerBias(target.filePath, candidate.relation.filePath);
      const candidateNoisePenalty = noisePenalty(candidate.relation.filePath);
      let primaryEdgeStrengthRank = 0;

      if (graphConnectionCount > 0) {
        const graphEvidence = graphEvidenceScore(graphEdgeTypes, graphConnectionCount);
        primaryEdgeStrengthRank = graphEvidence.strengthRank;
        score += graphEvidence.score;
        reasons.push(createReason('graph_connection', graphEvidence.score, graphEvidence.primaryEdgeType));
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

      if (candidateNoisePenalty !== 0) {
        score += candidateNoisePenalty;
        reasons.push(createReason('noise_penalty', candidateNoisePenalty));
      }

      return {
        fileId: candidate.relation.fileId,
        repo: candidate.relation.repo,
        filePath: candidate.relation.filePath,
        score,
        reason: determineReason(reasons),
        reasons,
        relation: candidate.relation,
        edgeStrengthRank: primaryEdgeStrengthRank,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.edgeStrengthRank !== left.edgeStrengthRank) {
        return right.edgeStrengthRank - left.edgeStrengthRank;
      }

      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return compareRelations(left.relation, right.relation);
    })
    .slice(0, limit)
    .map(({ relation: _relation, edgeStrengthRank: _edgeStrengthRank, ...entry }) => entry);
}
