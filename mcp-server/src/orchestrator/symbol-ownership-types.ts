import type { FileNode } from '../graph/types.js';
import type { FileRelation, IndexedSymbol } from '../symbol-index/types.js';
import type { SymbolKind } from '../types.js';

export type OwnershipClassification =
  | 'internal-local'
  | 'feature-internal'
  | 'shared-internal'
  | 'shared-surface'
  | 'public-surface'
  | 'unknown';

export type ApiBoundaryClassification =
  | 'not-api-like'
  | 'local-boundary'
  | 'feature-boundary'
  | 'shared-boundary'
  | 'public-boundary'
  | 'unknown';

export type OwnershipConfidence = 'high' | 'medium' | 'low';

export type OwnershipSignalType =
  | 'export-surface'
  | 'path-boundary'
  | 'usage-fanout'
  | 'barrel-participation'
  | 'local-only-usage'
  | 'feature-local-usage'
  | 'cross-feature-usage'
  | 'repo-wide-usage';

export interface AnalyzeSymbolOwnershipInput {
  repoId?: string;
  symbolId?: string;
  filePath?: string;
  symbolName?: string;
}

export interface OwnershipSignal {
  type: OwnershipSignalType;
  strength: 'strong' | 'moderate' | 'weak';
  note?: string;
}

export interface SymbolOwnershipTarget {
  requestedRepoId?: string;
  requestedSymbolId?: string;
  requestedFilePath?: string;
  requestedSymbolName?: string;
  symbol: IndexedSymbol | null;
  file: FileNode | null;
  relation: FileRelation | null;
}

export interface SymbolOwnershipResult {
  target: {
    filePath: string;
    symbolId?: string;
    symbolName?: string;
    kind?: SymbolKind;
  };
  ownership: OwnershipClassification;
  apiBoundary: ApiBoundaryClassification;
  confidence: OwnershipConfidence;
  signals: OwnershipSignal[];
  summary: string;
}
