import type { SymbolKind } from '../types.js';

export interface IndexedSymbol {
  name: string;
  kind: SymbolKind;
  repo: string;
  filePath: string;
  startLine: number;
  endLine: number;
  exported?: boolean;
}

export interface FileRelation {
  repo: string;
  filePath: string;
  symbols: string[];
  imports: string[];
}

export interface SymbolIndex {
  symbols: IndexedSymbol[];
  byName: Record<string, IndexedSymbol[]>;
  byNameLower: Record<string, IndexedSymbol[]>;
  byFile: Record<string, FileRelation>;
}
