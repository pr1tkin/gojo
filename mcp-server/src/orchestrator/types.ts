import type { FileContextBundle, RankedFileContextItem, SymbolContextBundle } from '../context/index.js';
import type { FileNode, SymbolNode } from '../graph/types.js';
import type { RankedSymbolCandidate } from '../ranking/index.js';
import type { IndexedSymbol } from '../symbol-index/types.js';
import type { SymbolKind } from '../types.js';

export interface FileExplorationContext {
  fileId: string;
  primaryFile: FileNode | null;
  repo: string | null;
  relatedFiles: RankedFileContextItem[];
  neighboringFiles: FileNode[];
  definedSymbols: SymbolNode[];
  exportedSymbols: SymbolNode[];
  summary: {
    relatedFileCount: number;
    neighboringFileCount: number;
    definedSymbolCount: number;
    exportedSymbolCount: number;
  };
  rawContext: FileContextBundle;
}

export interface GetFileExplorationContextOptions {
  relatedLimit?: number;
}

export interface GetSymbolExplorationContextOptions {
  repo?: string;
  kind?: SymbolKind;
  limit?: number;
  relatedLimit?: number;
}

export interface SymbolExplorationContext {
  query: string;
  repo?: string;
  kind?: SymbolKind;
  primarySymbol: IndexedSymbol | null;
  primaryFile: FileNode | null;
  rankedSymbols: RankedSymbolCandidate[];
  relatedFiles: RankedFileContextItem[];
  exportedSymbols: SymbolNode[];
  summary: {
    candidateCount: number;
    relatedFileCount: number;
    exportedSymbolCount: number;
  };
  rawContext: SymbolContextBundle;
}
