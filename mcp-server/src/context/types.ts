import type { FileNode, GraphEdgeType, SymbolNode } from '../graph/types.js';
import type { RankedSymbolCandidate, RankingReason } from '../ranking/index.js';
import type { IndexedSymbol } from '../symbol-index/types.js';
import type { SymbolKind } from '../types.js';

export interface RankedFileContextItem {
  file: FileNode;
  score: number;
  reason: string;
  reasons: RankingReason[];
  via: GraphEdgeType[];
}

export interface FileContextBundle {
  fileId: string;
  file: FileNode | null;
  repo: string | null;
  neighboringFiles: FileNode[];
  relatedFiles: RankedFileContextItem[];
  definedSymbols: SymbolNode[];
  exportedSymbols: SymbolNode[];
}

export interface AssembleFileContextOptions {
  relatedLimit?: number;
}

export interface SymbolContextQuery {
  name: string;
  repo?: string;
  kind?: SymbolKind;
  limit?: number;
  relatedLimit?: number;
}

export interface SymbolContextBundle {
  query: string;
  repo?: string;
  kind?: SymbolKind;
  rankedSymbols: RankedSymbolCandidate[];
  primarySymbol: IndexedSymbol | null;
  primaryFile: FileNode | null;
  relatedFiles: RankedFileContextItem[];
  exportedSymbols: SymbolNode[];
}
