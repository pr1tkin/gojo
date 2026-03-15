import type { FileClassification } from '../symbol-index/types.js';
import type { SymbolKind } from '../types.js';

export const CODE_GRAPH_SCHEMA_VERSION = 1;

export interface RepoNode {
  nodeType: 'repo';
  repoId: string;
  name: string;
}

export interface FileNode {
  nodeType: 'file';
  fileId: string;
  repoId: string;
  filePath: string;
  classification: FileClassification;
}

export interface SymbolNode {
  nodeType: 'symbol';
  symbolId: string;
  fileId: string;
  repoId: string;
  filePath: string;
  name: string;
  kind: SymbolKind;
  exported: boolean;
  declarationFingerprint?: string;
  startLine: number;
  endLine: number;
}

export type GraphEdgeType =
  | 'repo_contains_file'
  | 'file_defines_symbol'
  | 'file_exports_symbol'
  | 'file_imports_file'
  | 'file_reexports_file';

export interface GraphEdge {
  edgeId: string;
  type: GraphEdgeType;
  fromId: string;
  toId: string;
  metadata?: {
    source?: string;
    symbolId?: string;
    exportedName?: string;
    localName?: string;
  };
}

export interface CodeGraphSnapshot {
  schemaVersion: number;
  sourceSymbolIndexSchemaVersion: number;
  generatedAt: string;
  nodes: {
    repos: Record<string, RepoNode>;
    files: Record<string, FileNode>;
    symbols: Record<string, SymbolNode>;
  };
  edges: GraphEdge[];
}
