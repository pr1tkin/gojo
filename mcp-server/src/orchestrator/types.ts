import type { FileContextBundle, RankedFileContextItem, SymbolContextBundle } from '../context/index.js';
import type { FileNode, SymbolNode } from '../graph/types.js';
import type { RankedSymbolCandidate } from '../ranking/index.js';
import type { RankingReason } from '../ranking/index.js';
import type { IndexedSymbol } from '../symbol-index/types.js';
import type { RefactorContextMode, SearchPatternsMode, SymbolKind } from '../types.js';

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

export interface PatternMatchItem {
  file: FileNode;
  score: number;
  reason: string;
  reasons: RankingReason[];
  definedSymbols: Array<{ name: string; kind: SymbolKind }>;
  exportedSymbols: Array<{ name: string; kind: SymbolKind }>;
  bundle: {
    familyStem: string;
    siblingFiles: string[];
  };
}

export interface PatternTargetSummary {
  file: FileNode | null;
  symbol: IndexedSymbol | null;
  definedSymbols: Array<{ name: string; kind: SymbolKind }>;
  exportedSymbols: Array<{ name: string; kind: SymbolKind }>;
}

export interface PatternResolutionSummary {
  status: 'resolved' | 'missing';
  mode: SearchPatternsMode;
  candidateCount: number;
  ambiguityDetected: boolean;
  selectedCandidate:
    | {
        symbolId: string;
        fileId: string;
        repo: string;
        filePath: string;
        name: string;
        kind: SymbolKind;
        exported: boolean;
        score: number;
        reasons: RankingReason[];
      }
    | null;
  alternativeCandidates: Array<{
    symbolId: string;
    fileId: string;
    repo: string;
    filePath: string;
    name: string;
    kind: SymbolKind;
    exported: boolean;
    score: number;
    reasons: RankingReason[];
  }>;
}

export interface PatternMatchContext {
  query: string;
  mode: SearchPatternsMode;
  repo?: string;
  primaryTarget: PatternTargetSummary;
  patternMatches: PatternMatchItem[];
  resolution: PatternResolutionSummary;
  summary: {
    matchCount: number;
    strongMatchCount: number;
  };
}

export interface RefactorTargetSummary {
  requestedName: string;
  requestedMode: RefactorContextMode;
  repo?: string;
  file: FileNode | null;
  symbol: IndexedSymbol | null;
}

export interface RefactorSymbolCandidate {
  symbolId: string;
  fileId: string;
  repo: string;
  filePath: string;
  name: string;
  kind: SymbolKind;
  exported: boolean;
  score: number;
  reasons: RankingReason[];
}

export interface RefactorNearbyFile {
  file: FileNode;
  category: 'same_directory' | 'bundle_family';
}

export interface RefactorContext {
  target: RefactorTargetSummary;
  primaryFile: FileNode | null;
  exportedSymbols: SymbolNode[];
  importingFiles: FileNode[];
  importedFiles: FileNode[];
  reexportingFiles: FileNode[];
  reexportedFiles: FileNode[];
  graphNeighbors: FileNode[];
  relatedFiles: RankedFileContextItem[];
  nearbyFiles: RefactorNearbyFile[];
  definedSymbols: SymbolNode[];
  symbolCandidates: RefactorSymbolCandidate[];
  summary: {
    importingFileCount: number;
    importedFileCount: number;
    reexportingFileCount: number;
    reexportedFileCount: number;
    graphNeighborCount: number;
    relatedFileCount: number;
    nearbyFileCount: number;
    exportedSymbolCount: number;
    definedSymbolCount: number;
    ambiguityDetected: boolean;
    notes: string[];
  };
}
