import { createPatternClusterId } from './ids.js';
import { getPatternById } from './repository.js';
import { loadPatternIndex } from './store.js';
import type {
  PatternCandidate,
  PatternCluster,
  PatternFingerprint,
  PatternIndex,
  PatternKind,
  SimilarPatternMatch,
} from './types.js';

const DEFAULT_CLUSTER_THRESHOLD = 0.7;
const DEFAULT_SIMILAR_LIMIT = 6;
const MAX_DOMINANT_SIGNALS = 5;
const SAME_FILE_NEIGHBOR_PENALTY = 0.9;
const BROAD_PATTERN_KINDS = new Set<PatternKind>(['component', 'hook', 'async-data-flow']);
const NAME_AWARE_PATTERN_KINDS = new Set<PatternKind>([
  'component',
  'hook',
  'async-data-flow',
  'utility-export',
]);

interface WeightedDimension {
  score: number;
  weight: number;
}

function compareSimilarPatterns(left: SimilarPatternMatch, right: SimilarPatternMatch): number {
  if (right.similarityScore !== left.similarityScore) {
    return right.similarityScore - left.similarityScore;
  }

  return (
    left.patternId.localeCompare(right.patternId) ||
    left.fileId.localeCompare(right.fileId) ||
    (left.symbolId ?? '').localeCompare(right.symbolId ?? '')
  );
}

function compareClusters(left: PatternCluster, right: PatternCluster): number {
  if (left.patternKind !== right.patternKind) {
    return left.patternKind.localeCompare(right.patternKind);
  }

  if (right.size !== left.size) {
    return right.size - left.size;
  }

  return left.clusterId.localeCompare(right.clusterId);
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function dedupeAndSort(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function toSet(values: string[] | undefined): Set<string> {
  return new Set(values ?? []);
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);

  if (union.size === 0) {
    return 1;
  }

  let intersection = 0;

  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }

  return intersection / union.size;
}

function countIntersection(left: Set<string>, right: Set<string>): number {
  let count = 0;

  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }

  return count;
}

function contextualOverlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  return jaccardSimilarity(left, right);
}

function tokenizeSymbolName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\s-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 0);
}

function countCommonPrefixTokens(left: string[], right: string[]): number {
  const limit = Math.min(left.length, right.length);
  let count = 0;

  while (count < limit && left[count] === right[count]) {
    count += 1;
  }

  return count;
}

function countCommonSuffixTokens(left: string[], right: string[]): number {
  const reversedLeft = [...left].reverse();
  const reversedRight = [...right].reverse();
  return countCommonPrefixTokens(reversedLeft, reversedRight);
}

function computeSymbolNameSimilarity(leftName: string, rightName: string): number {
  const leftTokens = tokenizeSymbolName(leftName);
  const rightTokens = tokenizeSymbolName(rightName);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const tokenOverlap = jaccardSimilarity(new Set(leftTokens), new Set(rightTokens));
  const maxTokenLength = Math.max(leftTokens.length, rightTokens.length);
  const prefixSimilarity = countCommonPrefixTokens(leftTokens, rightTokens) / maxTokenLength;
  const suffixSimilarity = countCommonSuffixTokens(leftTokens, rightTokens) / maxTokenLength;

  return Math.max(0, Math.min(1, roundScore(tokenOverlap + prefixSimilarity * 0.15 + suffixSimilarity * 0.15)));
}

function computeSymbolRoleSimilarity(
  left: PatternFingerprint['symbolRole'],
  right: PatternFingerprint['symbolRole'],
): number {
  if (left === right) {
    return 1;
  }

  const groups = [
    new Set(['component', 'hook']),
    new Set(['utility', 'module', 'handler']),
    new Set(['story', 'test']),
  ];

  for (const group of groups) {
    if (group.has(left) && group.has(right)) {
      return 0.45;
    }
  }

  if (left === 'unknown' || right === 'unknown') {
    return 0.25;
  }

  return 0;
}

function computeExportShapeSimilarity(
  left: PatternFingerprint['exportShape'],
  right: PatternFingerprint['exportShape'],
): number {
  if (left === right) {
    return 1;
  }

  const exported = new Set(['named', 'default', 'mixed']);

  if (exported.has(left) && exported.has(right)) {
    return 0.5;
  }

  if ((left === 'none' || left === 'internal') && (right === 'none' || right === 'internal')) {
    return 0.5;
  }

  if (left === 'unknown' || right === 'unknown') {
    return 0.25;
  }

  return 0;
}

function getSignalSets(pattern: PatternCandidate): {
  structuralSignals: Set<string>;
  importSet: Set<string>;
  uiSignals: Set<string>;
  asyncSignals: Set<string>;
  responsibilitySignals: Set<string>;
} {
  return {
    structuralSignals: toSet(pattern.fingerprint.structuralSignals),
    importSet: toSet(pattern.fingerprint.importSet),
    uiSignals: toSet(pattern.fingerprint.uiSignals),
    asyncSignals: toSet(pattern.fingerprint.asyncSignals),
    responsibilitySignals: toSet(pattern.fingerprint.responsibilitySignals),
  };
}

function computeRepresentativenessFactor(pattern: PatternCandidate): number {
  let factor = 1;
  const exportShape = pattern.fingerprint.exportShape;
  const signalCount = pattern.fingerprint.structuralSignals.length;

  if (exportShape === 'named' || exportShape === 'default' || exportShape === 'mixed') {
    factor += 0.05;
  } else if (exportShape === 'none' || exportShape === 'internal') {
    factor -= 0.05;
  }

  if (signalCount >= 3) {
    factor += 0.03;
  } else if (signalCount <= 1) {
    factor -= 0.08;
  }

  return Math.max(0.85, Math.min(1.08, factor));
}

function applyPairAdjustments(
  left: PatternCandidate,
  right: PatternCandidate,
  score: number,
  structuralOverlap: number,
): number {
  let adjustedScore = score;
  const nameSimilarity = NAME_AWARE_PATTERN_KINDS.has(left.kind)
    ? computeSymbolNameSimilarity(left.name, right.name)
    : 0;
  const responsibilityOverlap = jaccardSimilarity(
    toSet(left.fingerprint.responsibilitySignals),
    toSet(right.fingerprint.responsibilitySignals),
  );
  const leftHasResponsibility = (left.fingerprint.responsibilitySignals?.length ?? 0) > 0;
  const rightHasResponsibility = (right.fingerprint.responsibilitySignals?.length ?? 0) > 0;

  if (BROAD_PATTERN_KINDS.has(left.kind) && structuralOverlap < 0.5) {
    adjustedScore = Math.min(adjustedScore, 0.6);
  }

  const representativenessFactor =
    (computeRepresentativenessFactor(left) + computeRepresentativenessFactor(right)) / 2;
  adjustedScore *= representativenessFactor;

  if (
    left.fingerprint.structuralSignals.length <= 1 ||
    right.fingerprint.structuralSignals.length <= 1
  ) {
    adjustedScore *= 0.9;
  }

  if (NAME_AWARE_PATTERN_KINDS.has(left.kind)) {
    adjustedScore = adjustedScore * 0.85 + nameSimilarity * 0.15;
  }

  if (nameSimilarity > 0.6) {
    adjustedScore *= 1.05;
  }

  if (responsibilityOverlap > 0) {
    adjustedScore *= 1 + Math.min(0.08, responsibilityOverlap * 0.08);
  } else if (leftHasResponsibility && rightHasResponsibility) {
    adjustedScore *= 0.88;
  }

  return Math.max(0, Math.min(1, adjustedScore));
}

function computeSimilarityScoreInternal(left: PatternCandidate, right: PatternCandidate): number {
  if (left.kind !== right.kind || left.fingerprint.patternKind !== right.fingerprint.patternKind) {
    return 0;
  }

  const leftSets = getSignalSets(left);
  const rightSets = getSignalSets(right);
  const sharedStructuralSignals = countIntersection(leftSets.structuralSignals, rightSets.structuralSignals);
  const structuralOverlap = jaccardSimilarity(leftSets.structuralSignals, rightSets.structuralSignals);
  const dimensions: WeightedDimension[] = [
    { score: 1, weight: 0.2 },
    { score: structuralOverlap, weight: 0.3 },
    { score: jaccardSimilarity(leftSets.importSet, rightSets.importSet), weight: 0.2 },
    {
      score: computeExportShapeSimilarity(left.fingerprint.exportShape, right.fingerprint.exportShape),
      weight: 0.1,
    },
    {
      score: computeSymbolRoleSimilarity(left.fingerprint.symbolRole, right.fingerprint.symbolRole),
      weight: 0.1,
    },
  ];

  if (leftSets.uiSignals.size > 0 || rightSets.uiSignals.size > 0) {
    dimensions.push({ score: jaccardSimilarity(leftSets.uiSignals, rightSets.uiSignals), weight: 0.05 });
  }

  if (leftSets.asyncSignals.size > 0 || rightSets.asyncSignals.size > 0) {
    dimensions.push({ score: jaccardSimilarity(leftSets.asyncSignals, rightSets.asyncSignals), weight: 0.05 });
  }

  if (leftSets.responsibilitySignals.size > 0 || rightSets.responsibilitySignals.size > 0) {
    dimensions.push({
      score: jaccardSimilarity(leftSets.responsibilitySignals, rightSets.responsibilitySignals),
      weight: 0.1,
    });
  }

  const totalWeight = dimensions.reduce((sum, entry) => sum + entry.weight, 0);
  let score = dimensions.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / totalWeight;

  if (sharedStructuralSignals === 0) {
    score *= 0.25;
  } else if (Math.min(leftSets.structuralSignals.size, rightSets.structuralSignals.size) <= 1) {
    score *= 0.85;
  }

  score = applyPairAdjustments(left, right, score, structuralOverlap);

  return roundScore(score);
}

function passesClusteringGate(
  left: PatternCandidate,
  right: PatternCandidate,
  score: number,
  threshold: number,
): boolean {
  if (left.kind !== right.kind || score < threshold) {
    return false;
  }

  const leftStructuralSignals = toSet(left.fingerprint.structuralSignals);
  const rightStructuralSignals = toSet(right.fingerprint.structuralSignals);
  const sharedStructuralSignals = countIntersection(leftStructuralSignals, rightStructuralSignals);
  const structuralOverlap = jaccardSimilarity(leftStructuralSignals, rightStructuralSignals);
  const importOverlap = contextualOverlap(toSet(left.fingerprint.importSet), toSet(right.fingerprint.importSet));
  const uiOverlap = contextualOverlap(toSet(left.fingerprint.uiSignals), toSet(right.fingerprint.uiSignals));
  const asyncOverlap = contextualOverlap(toSet(left.fingerprint.asyncSignals), toSet(right.fingerprint.asyncSignals));
  const responsibilityOverlap = contextualOverlap(
    toSet(left.fingerprint.responsibilitySignals),
    toSet(right.fingerprint.responsibilitySignals),
  );
  const nameSimilarity = NAME_AWARE_PATTERN_KINDS.has(left.kind)
    ? computeSymbolNameSimilarity(left.name, right.name)
    : 0;

  if (sharedStructuralSignals >= 2) {
    if (BROAD_PATTERN_KINDS.has(left.kind) && structuralOverlap < 0.5) {
      return false;
    }

    if (
      BROAD_PATTERN_KINDS.has(left.kind) &&
      Math.min(leftStructuralSignals.size, rightStructuralSignals.size) <= 2 &&
      importOverlap < 0.2 &&
      nameSimilarity < 0.2
    ) {
      return false;
    }

    return true;
  }

  if (sharedStructuralSignals === 0) {
    return false;
  }

  if (BROAD_PATTERN_KINDS.has(left.kind) && structuralOverlap < 0.5) {
    return false;
  }

  return (
    importOverlap >= 0.35 ||
    uiOverlap > 0 ||
    asyncOverlap > 0 ||
    responsibilityOverlap > 0 ||
    nameSimilarity >= 0.35
  );
}

function collectDominantSignals(patterns: PatternCandidate[]): string[] {
  const counts = new Map<string, number>();

  for (const pattern of patterns) {
    for (const signal of pattern.fingerprint.structuralSignals) {
      counts.set(signal, (counts.get(signal) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_DOMINANT_SIGNALS)
    .map(([signal]) => signal);
}

function pickRepresentativePattern(
  patterns: PatternCandidate[],
  similarityMatrix: Map<string, Map<string, number>>,
): PatternCandidate {
  const scored = patterns.map((pattern) => {
    const neighbors = similarityMatrix.get(pattern.patternId) ?? new Map<string, number>();
    const totalSimilarity = patterns.reduce((sum, candidate) => {
      if (candidate.patternId === pattern.patternId) {
        return sum;
      }

      return sum + (neighbors.get(candidate.patternId) ?? 0);
    }, 0);

    return {
      pattern,
      totalSimilarity: roundScore(totalSimilarity),
      sharedSignalCount: pattern.fingerprint.structuralSignals.length,
    };
  });

  scored.sort((left, right) => {
    if (right.totalSimilarity !== left.totalSimilarity) {
      return right.totalSimilarity - left.totalSimilarity;
    }

    if (right.sharedSignalCount !== left.sharedSignalCount) {
      return right.sharedSignalCount - left.sharedSignalCount;
    }

    return left.pattern.patternId.localeCompare(right.pattern.patternId);
  });

  return scored[0]?.pattern ?? patterns[0];
}

function applyNeighborAdjustments(target: PatternCandidate, candidate: PatternCandidate, score: number): number {
  let adjustedScore = score;

  if (target.fileId === candidate.fileId) {
    adjustedScore *= SAME_FILE_NEIGHBOR_PENALTY;
  }

  return roundScore(adjustedScore);
}

function buildSimilarityMatrix(patterns: PatternCandidate[]): Map<string, Map<string, number>> {
  const matrix = new Map<string, Map<string, number>>();

  for (const pattern of patterns) {
    matrix.set(pattern.patternId, new Map<string, number>());
  }

  for (let index = 0; index < patterns.length; index += 1) {
    for (let innerIndex = index + 1; innerIndex < patterns.length; innerIndex += 1) {
      const left = patterns[index];
      const right = patterns[innerIndex];
      const score = computeSimilarityScoreInternal(left, right);

      matrix.get(left.patternId)?.set(right.patternId, score);
      matrix.get(right.patternId)?.set(left.patternId, score);
    }
  }

  return matrix;
}

function clusterPatternsOfKind(patterns: PatternCandidate[], threshold: number): PatternCluster[] {
  if (patterns.length === 0) {
    return [];
  }

  const orderedPatterns = [...patterns].sort((left, right) => left.patternId.localeCompare(right.patternId));
  const similarityMatrix = buildSimilarityMatrix(orderedPatterns);
  const visited = new Set<string>();
  const clusters: PatternCluster[] = [];

  for (const pattern of orderedPatterns) {
    if (visited.has(pattern.patternId)) {
      continue;
    }

    const queue = [pattern.patternId];
    const memberIds: string[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift() as string;

      if (visited.has(currentId)) {
        continue;
      }

      visited.add(currentId);
      memberIds.push(currentId);
      const currentPattern = orderedPatterns.find((entry) => entry.patternId === currentId) as PatternCandidate;
      const currentNeighbors = similarityMatrix.get(currentId) ?? new Map<string, number>();

      for (const candidate of orderedPatterns) {
        if (visited.has(candidate.patternId) || candidate.patternId === currentId) {
          continue;
        }

        const score = currentNeighbors.get(candidate.patternId) ?? 0;

        if (passesClusteringGate(currentPattern, candidate, score, threshold)) {
          queue.push(candidate.patternId);
        }
      }
    }

    const memberPatterns = memberIds
      .map((memberId) => orderedPatterns.find((entry) => entry.patternId === memberId) as PatternCandidate)
      .sort((left, right) => left.patternId.localeCompare(right.patternId));
    const representative = pickRepresentativePattern(memberPatterns, similarityMatrix);

    clusters.push({
      clusterId: createPatternClusterId(pattern.kind, representative.patternId),
      patternKind: pattern.kind,
      memberPatternIds: memberPatterns.map((entry) => entry.patternId),
      representativePatternId: representative.patternId,
      size: memberPatterns.length,
      dominantSignals: collectDominantSignals(memberPatterns),
    });
  }

  return clusters.sort(compareClusters);
}

export class PatternSimilarityService {
  private readonly patternById: Map<string, PatternCandidate>;

  constructor(private readonly index: PatternIndex) {
    this.patternById = new Map(index.patterns.map((pattern) => [pattern.patternId, pattern]));
  }

  computeSimilarityScore(left: PatternCandidate, right: PatternCandidate): number {
    return computeSimilarityScoreInternal(left, right);
  }

  findSimilarPatterns(patternId: string, limit: number = DEFAULT_SIMILAR_LIMIT): SimilarPatternMatch[] {
    const target = this.patternById.get(patternId);

    if (!target) {
      return [];
    }

    return this.index.patterns
      .filter((pattern) => pattern.patternId !== patternId)
      .filter((pattern) => pattern.kind === target.kind)
      .map((pattern) => ({
        patternId: pattern.patternId,
        fileId: pattern.fileId,
        ...(pattern.symbolId ? { symbolId: pattern.symbolId } : {}),
        similarityScore: applyNeighborAdjustments(
          target,
          pattern,
          this.computeSimilarityScore(target, pattern),
        ),
      }))
      .filter((pattern) => pattern.similarityScore > 0)
      .sort(compareSimilarPatterns)
      .slice(0, limit);
  }

  buildClusters(threshold: number = DEFAULT_CLUSTER_THRESHOLD): PatternCluster[] {
    const clusters: PatternCluster[] = [];

    for (const kind of dedupeAndSort(this.index.patterns.map((pattern) => pattern.kind))) {
      const patterns = this.index.patterns.filter((pattern) => pattern.kind === kind);
      clusters.push(...clusterPatternsOfKind(patterns, threshold));
    }

    return clusters.filter((cluster) => cluster.size > 0).sort(compareClusters);
  }

  formatClusterDebug(cluster: PatternCluster): string {
    const patterns = cluster.memberPatternIds
      .map((patternId) => this.patternById.get(patternId))
      .filter((pattern): pattern is PatternCandidate => Boolean(pattern))
      .sort((left, right) => left.fileId.localeCompare(right.fileId) || left.name.localeCompare(right.name));
    const members = patterns
      .map((pattern) => `- ${pattern.fileId} -> ${pattern.name}`)
      .join('\n');

    return [
      `Cluster (${cluster.patternKind}) size=${cluster.size}`,
      `signals: ${cluster.dominantSignals.join(', ')}`,
      '',
      'Members:',
      members,
    ].join('\n');
  }
}

export function createPatternSimilarityService(index: PatternIndex): PatternSimilarityService {
  return new PatternSimilarityService(index);
}

export async function computePatternSimilarity(
  left: PatternCandidate,
  right: PatternCandidate,
): Promise<number> {
  return computeSimilarityScoreInternal(left, right);
}

export async function findSimilarPatterns(patternId: string, limit: number = DEFAULT_SIMILAR_LIMIT): Promise<SimilarPatternMatch[]> {
  const index = await loadPatternIndex();
  return createPatternSimilarityService(index).findSimilarPatterns(patternId, limit);
}

export async function buildPatternClusters(threshold: number = DEFAULT_CLUSTER_THRESHOLD): Promise<PatternCluster[]> {
  const index = await loadPatternIndex();
  return createPatternSimilarityService(index).buildClusters(threshold);
}

export async function findSimilarPatternsForPattern(patternId: string, limit: number = DEFAULT_SIMILAR_LIMIT): Promise<{
  pattern: PatternCandidate | null;
  similarPatterns: SimilarPatternMatch[];
}> {
  const pattern = await getPatternById(patternId);

  if (!pattern) {
    return {
      pattern: null,
      similarPatterns: [],
    };
  }

  return {
    pattern,
    similarPatterns: await findSimilarPatterns(patternId, limit),
  };
}
