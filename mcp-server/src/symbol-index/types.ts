import type { SymbolKind } from '../types.js';

export type FileClassification = 'source' | 'generated' | 'unknown';

export interface IndexedFileMetadata {
  fileId: string;
  repo: string;
  filePath: string;
  classification: FileClassification;
  language: 'ts' | 'tsx' | 'js' | 'jsx' | 'unknown';
}

export interface IndexedSymbol {
  symbolId: string;
  fileId: string;
  name: string;
  kind: SymbolKind;
  repo: string;
  filePath: string;
  startLine: number;
  endLine: number;
  exported?: boolean;
  declarationFingerprint?: string;
}

export interface ImportBinding {
  importedName: string | null;
  localName: string;
  kind: 'default' | 'named' | 'namespace';
  isTypeOnly: boolean;
}

export interface ImportRecord {
  fileId: string;
  source: string;
  bindings: ImportBinding[];
  resolvedKind?: 'local-file' | 'package' | 'unknown';
  resolvedTargetFileId?: string;
}

export interface ExportRecord {
  fileId: string;
  kind: 'named' | 'default' | 'reexport-all' | 'reexport-named';
  exportedName?: string;
  localName?: string;
  source?: string;
  isTypeOnly?: boolean;
  symbolId?: string;
}

export interface FileRelation {
  fileId: string;
  repo: string;
  filePath: string;
  classification: FileClassification;
  coverage?: 'full' | 'partial';
  analysisWarnings?: string[];
  symbolIds: string[];
  symbolNames: string[];
  imports: ImportRecord[];
  exports: ExportRecord[];
  importTokens: string[];
}

export interface SymbolFrequencyStats {
  globalByName: Record<string, number>;
  globalByNameLower: Record<string, number>;
  byRepo: Record<string, Record<string, number>>;
  exportedByName: Record<string, number>;
  byKind: Record<string, Record<string, number>>;
}

export interface SymbolIndex {
  schemaVersion: number;
  symbols: IndexedSymbol[];
  byName: Record<string, IndexedSymbol[]>;
  byNameLower: Record<string, IndexedSymbol[]>;
  byFile: Record<string, FileRelation>;
  stats: SymbolFrequencyStats;
}

export type SymbolIndexCoverageIssueStage =
  | 'read'
  | 'symbol_extraction'
  | 'file_metadata'
  | 'pattern_extraction'
  | 'semantic_graph'
  | 'ui_composition'
  | 'ui_props'
  | 'ui_semantics';
export type SymbolIndexCoverageIssueDisposition = 'partial' | 'skipped';
export type SymbolIndexCoverageIssueSource = 'io' | 'parser' | 'policy';

export interface SymbolIndexCoverageIssue {
  repoId: string;
  filePath: string;
  fileId?: string;
  classification: FileClassification;
  language: IndexedFileMetadata['language'];
  stage: SymbolIndexCoverageIssueStage;
  disposition: SymbolIndexCoverageIssueDisposition;
  source: SymbolIndexCoverageIssueSource;
  reason: string;
}

export interface SymbolIndexCoverageSummary {
  schemaVersion: number;
  generatedAt: string;
  totalSourceFiles: number;
  fullyIndexedFiles: number;
  partialFiles: number;
  skippedFiles: number;
  trustImpact: 'none' | 'degraded';
  issueCounts: {
    parserFailures: number;
    readFailures: number;
    metadataFallbacks: number;
    policySkipped: number;
  };
  issues: SymbolIndexCoverageIssue[];
  omittedIssueCount: number;
}

export interface SymbolIndexBuildResult {
  index: SymbolIndex;
  coverage: SymbolIndexCoverageSummary;
}
