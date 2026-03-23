import type { FileNode, SymbolNode } from '../graph/types.js';
import type { ResultExplainability } from '../orchestrator/types.js';
import type { RankedSymbolCandidate, RankingReason } from '../ranking/index.js';
import type { IndexedSymbol } from '../symbol-index/types.js';
import type { SymbolKind } from '../types.js';

export type FileContextConnectionKind =
  | 'incoming_file_imports_file'
  | 'outgoing_file_imports_file'
  | 'incoming_file_reexports_file'
  | 'outgoing_file_reexports_file'
  | 'symbol_reference'
  | 'call_reference'
  | 'jsx_reference'
  | 'type_reference';

export interface RankedFileContextItem {
  file: FileNode;
  score: number;
  reason: string;
  reasons: RankingReason[];
  via: FileContextConnectionKind[];
  explanation?: ResultExplainability;
}

export interface FileContextBundle {
  fileId: string;
  file: FileNode | null;
  repo: string | null;
  neighboringFiles: FileNode[];
  relatedFiles: RankedFileContextItem[];
  totalRelatedFiles: number;
  definedSymbols: SymbolNode[];
  exportedSymbols: SymbolNode[];
}

export interface AssembleFileContextOptions {
  relatedLimit?: number;
  referenceSignalsByFileId?: Record<
    string,
    {
      kinds: FileContextConnectionKind[];
      connectionCount: number;
    }
  >;
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
  totalRankedSymbols: number;
  ambiguityDetected: boolean;
  viableAlternativeCount: number;
  primarySymbol: IndexedSymbol | null;
  primaryFile: FileNode | null;
  relatedFiles: RankedFileContextItem[];
  totalRelatedFiles: number;
  exportedSymbols: SymbolNode[];
}
