import type { FileNode, SymbolNode } from '../graph/types.js';
import type { IndexedSymbol } from '../symbol-index/types.js';
import type { SymbolKind } from '../types.js';

export type ImpactAnalysisMode = 'safe' | 'exploratory';

export type ImpactConfidence = 'high' | 'medium' | 'low';

export type ImpactEvidenceSource = 'symbol-index' | 'graph' | 'text-match';

export type ImpactScope =
  | 'symbol-direct'
  | 'file-direct'
  | 'proxy'
  | 'local-symbol'
  | 'fallback';

export type ImpactReason =
  | 'same-file-reference'
  | 'imports-target'
  | 'exports-target'
  | 'reexports-target'
  | 'calls-target'
  | 'jsx-uses-target'
  | 'constructs-target'
  | 'extends-target'
  | 'implements-target'
  | 'type-propagation'
  | 'textual-match';

export type PublicSurfaceRisk = 'low' | 'medium' | 'high' | 'unknown';

/**
 * Internal input contract for future impact analysis.
 *
 * Resolution can start from a stable symbol identity or fall back to a repo/file/name query.
 */
export interface AnalyzeSymbolImpactInput {
  repoId?: string;
  symbolId?: string;
  filePath?: string;
  symbolName?: string;
  mode: ImpactAnalysisMode;
  maxDepth?: number;
  includeTransitive?: boolean;
}

export interface ImpactAnalysisTarget {
  requestedRepoId?: string;
  requestedSymbolId?: string;
  requestedFilePath?: string;
  requestedSymbolName?: string;
  symbol: IndexedSymbol | null;
  symbolId: string | null;
  symbolName: string | null;
  kind: SymbolKind | null;
  repoId: string | null;
  file: FileNode | null;
}

export interface ImpactPathStep {
  fileId?: string;
  filePath: string;
  symbolId?: string;
  symbolName?: string;
  reason: ImpactReason;
}

/**
 * One explainable impact edge or heuristic that contributes to a result.
 */
export interface ImpactEvidence {
  reason: ImpactReason;
  confidence: ImpactConfidence;
  source: ImpactEvidenceSource;
  impactScope: ImpactScope;
  depth: number;
  via: ImpactPathStep[];
  notes: string[];
}

export interface ImpactedSymbol {
  symbol: SymbolNode | null;
  file: FileNode | null;
  symbolId?: string;
  symbolName: string;
  kind?: SymbolKind;
  exported?: boolean;
  filePath: string;
  repoId?: string;
  impactScope: Extract<ImpactScope, 'symbol-direct' | 'proxy' | 'local-symbol' | 'fallback'>;
  confidence: ImpactConfidence;
  evidence: ImpactEvidence[];
}

export interface ImpactedFile {
  file: FileNode | null;
  fileId?: string;
  filePath: string;
  repoId?: string;
  impactScope: Extract<ImpactScope, 'file-direct' | 'proxy' | 'fallback'>;
  confidence: ImpactConfidence;
  evidence: ImpactEvidence[];
}

export interface TransitiveImpact {
  depth: number;
  symbol?: ImpactedSymbol;
  file?: ImpactedFile;
  confidence: Extract<ImpactConfidence, 'medium' | 'low'>;
  evidence: ImpactEvidence[];
}

export interface ImpactAnalysisSummary {
  directFileCount: number;
  directSymbolCount: number;
  transitiveFileCount: number;
  transitiveSymbolCount: number;
  highConfidenceImpactCount: number;
  mediumConfidenceImpactCount: number;
  lowConfidenceImpactCount: number;
  symbolDirectImpactCount: number;
  fileDirectImpactCount: number;
  proxyImpactCount: number;
  localSymbolImpactCount: number;
  overview: string;
  ambiguityDetected: boolean;
  notes: string[];
}

export type ImpactSummarySurfaceCategory = 'page' | 'route' | 'layout' | 'feature-entry';

export interface ImpactSummarySurface {
  fileId?: string;
  filePath: string;
  category: ImpactSummarySurfaceCategory;
}

export interface ImpactSummaryTransitiveGroup {
  viaFileId?: string;
  viaFilePath: string;
  depth: number;
  fileCount: number;
  surfaces: ImpactSummarySurface[];
  featureClusters: string[];
}

export interface ImpactResultSummary {
  directFiles: number;
  directSymbols: number;
  transitiveFiles: number;
  transitiveSymbols: number;
  viaGroups: number;
  highlightedSurfaces: ImpactSummarySurface[];
  featureClusters: string[];
  transitiveGroups: ImpactSummaryTransitiveGroup[];
}

export interface ImpactAnalysisResult {
  mode: ImpactAnalysisMode;
  target: ImpactAnalysisTarget;
  directlyImpactedSymbols: ImpactedSymbol[];
  directlyImpactedFiles: ImpactedFile[];
  transitiveImpacts: TransitiveImpact[];
  impactSummary: ImpactResultSummary;
  publicSurfaceRisk?: {
    level: PublicSurfaceRisk;
    notes: string[];
  };
  summary: ImpactAnalysisSummary;
}
