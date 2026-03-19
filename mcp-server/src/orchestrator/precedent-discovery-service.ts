import { loadCodeGraph } from '../graph/store.js';
import { loadPatternIndex, PatternSimilarityService } from '../patterns/index.js';
import { mapPatternStructuralAlignment, type PatternStructuralAlignment } from '../patterns/structural-alignment.js';
import type { PatternCandidate, PatternKind, SimilarPatternMatch } from '../patterns/types.js';
import { loadRequiredSymbolIndex } from '../symbol-index/store.js';
import type { IndexedSymbol, SymbolIndex } from '../symbol-index/types.js';
import type {
  FindPrecedentsInput,
  PrecedentCandidate,
  PrecedentDiscoveryResult,
  PrecedentDiscoveryTarget,
} from './precedent-discovery-types.js';

const DEFAULT_PRECEDENT_LIMIT = 5;
const DEFAULT_SIMILAR_LIMIT = 20;
const MAX_REASON_SIGNALS = 5;
const PATTERN_KIND_PRIORITY: Record<PatternKind, number> = {
  component: 100,
  hook: 95,
  'async-data-flow': 90,
  'api-handler': 85,
  'utility-export': 80,
  'test-suite': 70,
  'storybook-story': 65,
  'conditional-rendering': 40,
  'list-rendering': 35,
  'form-handling': 30,
  'service-layer': 25,
  'data-access': 20,
};

interface EnrichedPatternCandidate {
  pattern: PatternCandidate;
  symbol: IndexedSymbol | null;
  exported: boolean;
  usageFrequency: number;
  importerCount: number;
  reexporterCount: number;
  structuralAlignment: PatternStructuralAlignment;
}

interface AggregateCandidate {
  candidate: PrecedentCandidate;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function dedupeReasonSignals(values: string[]): string[] {
  return Array.from(new Set(values));
}

function tokenizeName(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\s-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 0);
}

function jaccard(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);

  if (union.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const value of leftSet) {
    if (rightSet.has(value)) {
      intersection += 1;
    }
  }

  return intersection / union.size;
}

function computePathSimilarity(leftPath: string, rightPath: string): number {
  const leftTokens = leftPath
    .replace(/\.[^.]+$/u, '')
    .split(/[\\/]/u)
    .flatMap((segment) => tokenizeName(segment));
  const rightTokens = rightPath
    .replace(/\.[^.]+$/u, '')
    .split(/[\\/]/u)
    .flatMap((segment) => tokenizeName(segment));

  return jaccard(leftTokens, rightTokens);
}

function computeNameSimilarity(leftName: string, rightName: string): number {
  return jaccard(tokenizeName(leftName), tokenizeName(rightName));
}

function computeResponsibilityOverlap(left: PatternCandidate, right: PatternCandidate): number {
  return jaccard(
    left.fingerprint.responsibilitySignals ?? [],
    right.fingerprint.responsibilitySignals ?? [],
  );
}

function comparePatterns(left: PatternCandidate, right: PatternCandidate): number {
  const priorityDifference =
    (PATTERN_KIND_PRIORITY[right.kind] ?? 0) - (PATTERN_KIND_PRIORITY[left.kind] ?? 0);

  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  const confidenceOrder = { high: 3, medium: 2, low: 1 } as const;
  const confidenceDifference = confidenceOrder[right.confidence] - confidenceOrder[left.confidence];

  if (confidenceDifference !== 0) {
    return confidenceDifference;
  }

  return (
    (right.symbolId ? 1 : 0) - (left.symbolId ? 1 : 0) ||
    right.fingerprint.structuralSignals.length - left.fingerprint.structuralSignals.length ||
    left.patternId.localeCompare(right.patternId)
  );
}

function comparePrecedents(left: PrecedentCandidate, right: PrecedentCandidate): number {
  if (right.precedentScore !== left.precedentScore) {
    return right.precedentScore - left.precedentScore;
  }

  if (right.similarityScore !== left.similarityScore) {
    return right.similarityScore - left.similarityScore;
  }

  return (
    left.repoId.localeCompare(right.repoId) ||
    left.filePath.localeCompare(right.filePath) ||
    left.symbolName.localeCompare(right.symbolName) ||
    left.patternId.localeCompare(right.patternId)
  );
}

function pickTargetPatterns(patterns: PatternCandidate[]): PatternCandidate[] {
  return [...patterns].sort(comparePatterns).slice(0, 3);
}

function createTarget(
  symbol: IndexedSymbol | null,
  patterns: PatternCandidate[],
  input: FindPrecedentsInput,
): PrecedentDiscoveryTarget {
  const primaryPattern = pickTargetPatterns(patterns)[0] ?? null;
  const fallbackFileId = primaryPattern?.fileId ?? input.fileId ?? null;

  return {
    ...(input.symbolId ? { symbolId: input.symbolId } : {}),
    ...(input.patternId ? { patternId: input.patternId } : {}),
    fileId: symbol?.fileId ?? fallbackFileId,
    filePath: symbol?.filePath ?? (fallbackFileId ? fallbackFileId.split(':').slice(1).join(':') : null),
    repoId: symbol?.repo ?? primaryPattern?.repoId ?? null,
    ...(symbol?.name ? { symbolName: symbol.name } : {}),
    ...(primaryPattern ? { patternKind: primaryPattern.kind } : {}),
  };
}

function summarizePrecedents(target: PrecedentDiscoveryTarget, candidates: PrecedentCandidate[]): string {
  if (!target.symbolName) {
    return candidates.length > 0
      ? `Found ${candidates.length} structurally similar precedents.`
      : 'No strong precedents found.';
  }

  if (candidates.length === 0) {
    return `No strong precedents found for ${target.symbolName}.`;
  }

  const topCandidate = candidates[0];
  return `Found ${candidates.length} precedents for ${target.symbolName}; strongest match is ${topCandidate.symbolName} in ${topCandidate.filePath}.`;
}

export class PrecedentDiscoveryService {
  private readonly patternById: Map<string, PatternCandidate>;
  private readonly symbolById: Map<string, IndexedSymbol>;
  private readonly importCountsByFileId: Map<string, number>;
  private readonly reexportCountsByFileId: Map<string, number>;
  private readonly similarityService: PatternSimilarityService;
  private readonly relatedFileIdsByFileId: Map<string, string[]>;

  constructor(
    private readonly patternIndex: Awaited<ReturnType<typeof loadPatternIndex>>,
    private readonly symbolIndex: SymbolIndex,
    private readonly graph: Awaited<ReturnType<typeof loadCodeGraph>>,
  ) {
    this.patternById = new Map(patternIndex.patterns.map((pattern) => [pattern.patternId, pattern]));
    this.symbolById = new Map(symbolIndex.symbols.map((symbol) => [symbol.symbolId, symbol]));
    this.importCountsByFileId = new Map();
    this.reexportCountsByFileId = new Map();
    this.relatedFileIdsByFileId = new Map();
    this.similarityService = new PatternSimilarityService(patternIndex);
    this.buildGraphCounts();
  }

  private buildGraphCounts(): void {
    for (const edge of this.graph.edges) {
      if (edge.type === 'file_imports_file') {
        this.importCountsByFileId.set(edge.toId, (this.importCountsByFileId.get(edge.toId) ?? 0) + 1);
        this.recordRelatedFile(edge.fromId, edge.toId);
      }

      if (edge.type === 'file_reexports_file') {
        this.reexportCountsByFileId.set(edge.toId, (this.reexportCountsByFileId.get(edge.toId) ?? 0) + 1);
        this.recordRelatedFile(edge.fromId, edge.toId);
      }
    }
  }

  private recordRelatedFile(fromId: string, toId: string): void {
    const record = (fileId: string, relatedFileId: string) => {
      const existing = this.relatedFileIdsByFileId.get(fileId) ?? [];

      if (!existing.includes(relatedFileId)) {
        existing.push(relatedFileId);
        existing.sort((left, right) => left.localeCompare(right));
        this.relatedFileIdsByFileId.set(fileId, existing);
      }
    };

    record(fromId, toId);
    record(toId, fromId);
  }

  private getPatternsForSymbol(symbolId: string): PatternCandidate[] {
    return this.patternIndex.patterns
      .filter((pattern) => pattern.symbolId === symbolId)
      .sort(comparePatterns);
  }

  private getPatternsForFile(fileId: string): PatternCandidate[] {
    return this.patternIndex.patterns
      .filter((pattern) => pattern.fileId === fileId)
      .sort(comparePatterns);
  }

  private enrichPattern(pattern: PatternCandidate): EnrichedPatternCandidate {
    const symbol = pattern.symbolId ? this.symbolById.get(pattern.symbolId) ?? null : null;
    const exported = Boolean(symbol?.exported) || ['named', 'default', 'mixed'].includes(pattern.fingerprint.exportShape);
    const usageFrequency =
      this.symbolIndex.stats.exportedByName[pattern.name] ??
      this.symbolIndex.stats.globalByName[pattern.name] ??
      0;
    const importerCount = this.importCountsByFileId.get(pattern.fileId) ?? 0;
    const reexporterCount = this.reexportCountsByFileId.get(pattern.fileId) ?? 0;
    const structuralAlignment = mapPatternStructuralAlignment({
      structurallyIndexed: pattern.structuralAnchor?.structurallyIndexed ?? true,
      resolvedLocalDependencyFileIds: pattern.structuralAnchor?.resolvedLocalDependencyFileIds ?? [],
      relatedLocalFileIds: this.relatedFileIdsByFileId.get(pattern.fileId) ?? [],
      filesById: this.symbolIndex.byFile,
    });

    return {
      pattern,
      symbol,
      exported,
      usageFrequency,
      importerCount,
      reexporterCount,
      structuralAlignment,
    };
  }

  private buildReasonSignals(
    target: PatternCandidate,
    candidate: EnrichedPatternCandidate,
    match: SimilarPatternMatch,
  ): string[] {
    const reasons: string[] = [];
    const targetSignals = new Set(target.fingerprint.structuralSignals);

    if (computeNameSimilarity(target.name, candidate.pattern.name) >= 0.34) {
      reasons.push('name-family');
    }

    if (jaccard(target.fingerprint.importSet, candidate.pattern.fingerprint.importSet) > 0) {
      reasons.push('shared-imports');
    }

    if (
      jaccard(
        target.structuralAnchor?.resolvedLocalDependencyFileIds ?? [],
        candidate.pattern.structuralAnchor?.resolvedLocalDependencyFileIds ?? [],
      ) > 0
    ) {
      reasons.push('shared-local-dependencies');
    }

    if (computeResponsibilityOverlap(target, candidate.pattern) > 0) {
      reasons.push('responsibility-match');
    }

    if (candidate.exported) {
      reasons.push('exported-symbol');
    }

    if (target.fileId !== candidate.pattern.fileId) {
      reasons.push('cross-file');
    }

    if (candidate.importerCount > 0) {
      reasons.push('graph-importers');
    }

    if (candidate.reexporterCount > 0) {
      reasons.push('graph-reexports');
    }

    if (candidate.usageFrequency > 1) {
      reasons.push('frequent-usage');
    }

    if (candidate.structuralAlignment.graphAnchored) {
      reasons.push('graph-anchored');
    }

    if (match.similarityScore >= 0.85) {
      reasons.push('high-structural-similarity');
    }

    for (const signal of candidate.pattern.fingerprint.structuralSignals) {
      if (targetSignals.has(signal)) {
        reasons.push(signal);
      }
    }

    return dedupeReasonSignals(reasons).slice(0, MAX_REASON_SIGNALS);
  }

  private computePrecedentScore(
    target: PatternCandidate,
    candidate: EnrichedPatternCandidate,
    match: SimilarPatternMatch,
  ): number {
    const pathSimilarity = computePathSimilarity(target.fileId, candidate.pattern.fileId);
    const responsibilityOverlap = computeResponsibilityOverlap(target, candidate.pattern);
    const localDependencyOverlap = jaccard(
      target.structuralAnchor?.resolvedLocalDependencyFileIds ?? [],
      candidate.pattern.structuralAnchor?.resolvedLocalDependencyFileIds ?? [],
    );
    const graphReach = candidate.importerCount + candidate.reexporterCount;
    let score = match.similarityScore * 0.82;

    if (candidate.exported) {
      score += 0.06;
    }

    if (target.fileId !== candidate.pattern.fileId) {
      score += 0.04;
    }

    if (candidate.usageFrequency > 0) {
      score += Math.min(0.04, candidate.usageFrequency * 0.01);
    }

    if (graphReach > 0) {
      score += Math.min(0.04, graphReach * 0.01);
    }

    if (candidate.structuralAlignment.graphAnchored) {
      score += candidate.structuralAlignment.structuralContextStrength === 'high' ? 0.04 : 0.02;
    }

    score += Math.min(0.05, localDependencyOverlap * 0.05);

    score += pathSimilarity * 0.04;
    score += Math.min(0.05, responsibilityOverlap * 0.05);

    return clampScore(score);
  }

  private collectCandidatesForPattern(
    targetPattern: PatternCandidate,
    limit: number,
  ): AggregateCandidate[] {
    const matches = this.similarityService.findSimilarPatterns(targetPattern.patternId, DEFAULT_SIMILAR_LIMIT);
    const candidates: AggregateCandidate[] = [];

    for (const match of matches) {
      const candidatePattern = this.patternById.get(match.patternId);

      if (!candidatePattern) {
        continue;
      }

      if (targetPattern.symbolId && candidatePattern.symbolId === targetPattern.symbolId) {
        continue;
      }

      const enriched = this.enrichPattern(candidatePattern);
      const reasonSignals = this.buildReasonSignals(targetPattern, enriched, match);
      const precedentScore = this.computePrecedentScore(targetPattern, enriched, match);

      candidates.push({
        candidate: {
          ...(candidatePattern.symbolId ? { symbolId: candidatePattern.symbolId } : {}),
          patternId: candidatePattern.patternId,
          fileId: candidatePattern.fileId,
          filePath: enriched.symbol?.filePath ?? candidatePattern.fileId.split(':').slice(1).join(':'),
          repoId: candidatePattern.repoId,
          symbolName: candidatePattern.name,
          patternKind: candidatePattern.kind,
          similarityScore: match.similarityScore,
          precedentScore,
          reasonSignals,
          structuralAlignment: enriched.structuralAlignment,
        },
      });
    }

    return candidates.sort((left, right) => comparePrecedents(left.candidate, right.candidate)).slice(0, limit);
  }

  findPrecedentsForSymbol(symbolId: string, limit: number = DEFAULT_PRECEDENT_LIMIT): PrecedentDiscoveryResult {
    const patterns = this.getPatternsForSymbol(symbolId);
    const symbol = this.symbolById.get(symbolId) ?? null;
    const target = createTarget(symbol, patterns, { symbolId, limit });

    if (patterns.length === 0) {
      return {
        target,
        candidates: [],
        summary: summarizePrecedents(target, []),
      };
    }

    return this.findPrecedentsFromPatterns(target, pickTargetPatterns(patterns), limit);
  }

  findPrecedentsForPattern(patternId: string, limit: number = DEFAULT_PRECEDENT_LIMIT): PrecedentDiscoveryResult {
    const pattern = this.patternById.get(patternId) ?? null;
    const symbol = pattern?.symbolId ? this.symbolById.get(pattern.symbolId) ?? null : null;
    const target = createTarget(symbol, pattern ? [pattern] : [], { patternId, limit });

    if (!pattern) {
      return {
        target,
        candidates: [],
        summary: summarizePrecedents(target, []),
      };
    }

    return this.findPrecedentsFromPatterns(target, [pattern], limit);
  }

  findPrecedentsForFile(fileId: string, limit: number = DEFAULT_PRECEDENT_LIMIT): PrecedentDiscoveryResult {
    const patterns = this.getPatternsForFile(fileId);
    const symbol = this.symbolIndex.symbols.find((entry) => entry.fileId === fileId && Boolean(entry.exported)) ?? null;
    const target = createTarget(symbol, patterns, { fileId, limit });

    if (patterns.length === 0) {
      return {
        target,
        candidates: [],
        summary: summarizePrecedents(target, []),
      };
    }

    return this.findPrecedentsFromPatterns(target, pickTargetPatterns(patterns), limit);
  }

  private findPrecedentsFromPatterns(
    target: PrecedentDiscoveryTarget,
    patterns: PatternCandidate[],
    limit: number,
  ): PrecedentDiscoveryResult {
    const aggregated = new Map<string, AggregateCandidate>();

    for (const pattern of patterns) {
      for (const entry of this.collectCandidatesForPattern(pattern, limit * 4)) {
        const key = entry.candidate.symbolId ?? entry.candidate.patternId;
        const existing = aggregated.get(key);

        if (!existing || comparePrecedents(entry.candidate, existing.candidate) < 0) {
          aggregated.set(key, entry);
          continue;
        }

        if (existing) {
          existing.candidate.reasonSignals = dedupeReasonSignals([
            ...existing.candidate.reasonSignals,
            ...entry.candidate.reasonSignals,
          ]).slice(0, MAX_REASON_SIGNALS);
        }
      }
    }

    const candidates = [...aggregated.values()]
      .map((entry) => entry.candidate)
      .sort(comparePrecedents)
      .slice(0, limit);

    return {
      target,
      candidates,
      summary: summarizePrecedents(target, candidates),
    };
  }

  formatPrecedentDebug(result: PrecedentDiscoveryResult): string {
    const targetName = result.target.symbolName ?? result.target.patternId ?? result.target.fileId ?? 'unknown-target';

    if (result.candidates.length === 0) {
      return `Precedent search for ${targetName}:\nNo strong precedents found.`;
    }

    return [
      `Precedent search for ${targetName}:`,
      ...result.candidates.map(
        (candidate, index) =>
          `${index + 1}. ${candidate.symbolName} -> score ${candidate.precedentScore.toFixed(2)}\n   reasons: ${candidate.reasonSignals.join(', ')}`,
      ),
    ].join('\n');
  }
}

export async function createPrecedentDiscoveryService(): Promise<PrecedentDiscoveryService> {
  const [patternIndex, symbolIndex, graph] = await Promise.all([
    loadPatternIndex(),
    loadRequiredSymbolIndex(),
    loadCodeGraph(),
  ]);

  return new PrecedentDiscoveryService(patternIndex, symbolIndex, graph);
}

export async function findPrecedentsForSymbol(
  symbolId: string,
  limit: number = DEFAULT_PRECEDENT_LIMIT,
): Promise<PrecedentDiscoveryResult> {
  return (await createPrecedentDiscoveryService()).findPrecedentsForSymbol(symbolId, limit);
}

export async function findPrecedentsForPattern(
  patternId: string,
  limit: number = DEFAULT_PRECEDENT_LIMIT,
): Promise<PrecedentDiscoveryResult> {
  return (await createPrecedentDiscoveryService()).findPrecedentsForPattern(patternId, limit);
}

export async function findPrecedentsForFile(
  fileId: string,
  limit: number = DEFAULT_PRECEDENT_LIMIT,
): Promise<PrecedentDiscoveryResult> {
  return (await createPrecedentDiscoveryService()).findPrecedentsForFile(fileId, limit);
}
