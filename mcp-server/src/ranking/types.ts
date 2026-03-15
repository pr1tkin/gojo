import type { FileRelation, IndexedSymbol, SymbolFrequencyStats } from '../symbol-index/types.js';
import type { FindReferenceMatch } from '../types.js';

export interface RankingReason {
  signal: string;
  value: number;
  note?: string;
}

export interface RankedCandidate<T> {
  item: T;
  score: number;
  reasons: RankingReason[];
}

export interface SymbolRankingContext {
  queryName: string;
  repo?: string;
  kind?: IndexedSymbol['kind'];
}

export interface RelatedFileCandidate {
  relation: FileRelation;
  graphSignals?: {
    edgeTypes: string[];
    connectionCount: number;
  };
}

export interface RankedRelatedFile {
  fileId: string;
  repo: string;
  filePath: string;
  reason: string;
  score: number;
  reasons: RankingReason[];
}

export interface ReferenceRankingContext {
  symbol: string;
}

export interface ReferenceRankingDependencies {
  relationsByKey: Record<string, FileRelation>;
}

export interface SymbolRankingDependencies {
  stats?: SymbolFrequencyStats;
}

export type RankedSymbolCandidate = RankedCandidate<IndexedSymbol>;
export type RankedReferenceCandidate = RankedCandidate<FindReferenceMatch>;
