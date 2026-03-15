import type { SymbolKind } from '../types.js';

export type FileClassification = 'source' | 'generated' | 'unknown';

export interface IndexedFileMetadata {
  fileId: string;
  repo: string;
  filePath: string;
  classification: FileClassification;
  language: 'ts' | 'tsx';
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
  symbolIds: string[];
  symbolNames: string[];
  imports: ImportRecord[];
  exports: ExportRecord[];
  importTokens: string[];
}

export interface SymbolIndex {
  schemaVersion: number;
  symbols: IndexedSymbol[];
  byName: Record<string, IndexedSymbol[]>;
  byNameLower: Record<string, IndexedSymbol[]>;
  byFile: Record<string, FileRelation>;
}
