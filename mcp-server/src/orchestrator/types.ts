import type { FileContextBundle, RankedFileContextItem, RelatedFileContextBuckets, SymbolContextBundle } from '../context/index.js';
import type { FileNode, SymbolNode } from '../graph/types.js';
import type { PatternStructuralAlignment } from '../patterns/structural-alignment.js';
import type { RankedSymbolCandidate } from '../ranking/index.js';
import type { RankingReason } from '../ranking/index.js';
import type { IndexedSymbol } from '../symbol-index/types.js';
import type { RefactorContextMode, SearchPatternsMode, SymbolKind } from '../types.js';

export type ExplainabilityMode = 'agent' | 'debug';
export type ExplainabilityConfidence = 'high' | 'medium' | 'low';
export type ExplainabilitySignalStrength = 'high' | 'medium' | 'low';

export interface ResultExplainabilitySignals {
  alignment?: ExplainabilitySignalStrength;
  dependencyOverlap?: ExplainabilitySignalStrength;
  familyMatch?: boolean;
  clusterCohesion?: ExplainabilitySignalStrength;
}

export interface ResultExplainabilityClusterContext {
  parentClusterId?: string;
  subClusterId?: string;
  clusterRole?: string;
  isCoreMember?: boolean;
  relatedClusterIds?: string[];
}

export interface ResultExplainabilityRelatedContext {
  relatedClusterIds?: string[];
  neighborTypes?: string[];
}

export interface ResultExplainability {
  family?: string | null;
  subClusterId?: string | null;
  role: string;
  confidence: ExplainabilityConfidence;
  selectionReason: string;
  explanationSignals: ResultExplainabilitySignals;
  clusterContext?: ResultExplainabilityClusterContext;
  relatedContext?: ResultExplainabilityRelatedContext;
  debug?: {
    score?: number;
    baseScore?: number;
    rawReasons?: RankingReason[];
    signalScores?: Record<string, number>;
    reasonSignals?: string[];
  };
}

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
    totalRelatedFileCount: number;
    neighboringFileCount: number;
    definedSymbolCount: number;
    exportedSymbolCount: number;
  };
  relatedFileBuckets: RelatedFileContextBuckets;
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
    totalCandidateCount: number;
    ambiguityDetected: boolean;
    viableAlternativeCount: number;
    relatedFileCount: number;
    totalRelatedFileCount: number;
    exportedSymbolCount: number;
  };
  relatedFileBuckets: RelatedFileContextBuckets;
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
  structuralAlignment: PatternStructuralAlignment;
  explanation?: ResultExplainability;
}

export interface PatternTargetSummary {
  file: FileNode | null;
  symbol: IndexedSymbol | null;
  definedSymbols: Array<{ name: string; kind: SymbolKind }>;
  exportedSymbols: Array<{ name: string; kind: SymbolKind }>;
  structuralAlignment: PatternStructuralAlignment | null;
  explanation?: ResultExplainability | null;
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
        explanation?: ResultExplainability;
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
    explanation?: ResultExplainability;
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
    graphAnchoredMatchCount: number;
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
  explanation?: ResultExplainability;
}

export interface RefactorNearbyFile {
  file: FileNode;
  category: 'same_directory' | 'bundle_family';
  explanation?: ResultExplainability;
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
    symbolCandidateCount: number;
    exportedSymbolCount: number;
    definedSymbolCount: number;
    ambiguityDetected: boolean;
    notes: string[];
  };
}

export interface SymbolAnalysisCandidate {
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

export interface NearbySymbolSummary {
  symbolId: string;
  name: string;
  kind: SymbolKind;
  exported: boolean;
  startLine: number;
  endLine: number;
}

export interface SymbolAnalysis {
  target: {
    requestedName: string;
    requestedRepo?: string;
    requestedFile?: string;
    symbol: IndexedSymbol | null;
    symbolId: string | null;
    repo: string | null;
    file: FileNode | null;
  };
  primarySymbol: IndexedSymbol | null;
  primaryFile: FileNode | null;
  kind: SymbolKind | null;
  exported: boolean;
  roleSummary: string;
  definedInFile: FileNode | null;
  exportedFromFile: FileNode | null;
  importingFiles: FileNode[];
  importedFiles: FileNode[];
  reexportingFiles: FileNode[];
  reexportedFiles: FileNode[];
  graphNeighbors: FileNode[];
  relatedFiles: RankedFileContextItem[];
  nearbyFiles: RefactorNearbyFile[];
  nearbySymbols: NearbySymbolSummary[];
  siblingSymbols: NearbySymbolSummary[];
  exportedSymbols: SymbolNode[];
  symbolCandidates: SymbolAnalysisCandidate[];
  usageSummary: {
    importerCount: number;
    fileImporters: number;
    importCount: number;
    relatedFileCount: number;
    symbolReferences?: number | null;
    usageScope: 'symbol-level' | 'file-level proxy' | 'unknown';
    exportedStatus: 'exported' | 'local';
    ambiguityDetected: boolean;
    notes: string[];
  };
}
