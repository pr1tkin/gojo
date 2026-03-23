import type { FileNode, SymbolNode } from '../graph/types.js';
import type { IndexedSymbol } from '../symbol-index/types.js';
import type { SymbolKind } from '../types.js';

export type ImpactAnalysisMode = 'safe' | 'exploratory';

export type ImpactConfidence = 'high' | 'medium' | 'low';

export type ImpactEvidenceSource = 'symbol-index' | 'graph' | 'text-match';

export type ImpactTier = 'direct' | 'indirect' | 'context';

export type ImpactCoverageSignal = 'missing_graph_evidence' | 'approximate_scope' | 'proxy_only';

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
  tier: ImpactTier;
  depth: number;
  via: ImpactPathStep[];
  coverageSignals: ImpactCoverageSignal[];
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
  tier: ImpactTier;
  confidence: ImpactConfidence;
  coverageSignals: ImpactCoverageSignal[];
  evidence: ImpactEvidence[];
}

export interface ImpactedFile {
  file: FileNode | null;
  fileId?: string;
  filePath: string;
  repoId?: string;
  impactScope: Extract<ImpactScope, 'file-direct' | 'proxy' | 'fallback'>;
  tier: ImpactTier;
  confidence: ImpactConfidence;
  coverageSignals: ImpactCoverageSignal[];
  evidence: ImpactEvidence[];
}

export interface TransitiveImpact {
  depth: number;
  symbol?: ImpactedSymbol;
  file?: ImpactedFile;
  tier: Extract<ImpactTier, 'indirect'>;
  confidence: Extract<ImpactConfidence, 'medium' | 'low'>;
  coverageSignals: ImpactCoverageSignal[];
  evidence: ImpactEvidence[];
}

export interface ImpactResultBucket<TFile = ImpactedFile, TSymbol = ImpactedSymbol> {
  files: TFile[];
  symbols: TSymbol[];
}

export interface ImpactIndirectConsumers extends ImpactResultBucket {
  transitive: TransitiveImpact[];
}

export interface ImpactAnalysisSummary {
  directFileCount: number;
  directSymbolCount: number;
  indirectFileCount: number;
  indirectSymbolCount: number;
  relatedContextFileCount: number;
  relatedContextSymbolCount: number;
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
  indirectFiles: number;
  indirectSymbols: number;
  relatedContextFiles: number;
  relatedContextSymbols: number;
  transitiveFiles: number;
  transitiveSymbols: number;
  viaGroups: number;
  highlightedSurfaces: ImpactSummarySurface[];
  featureClusters: string[];
  transitiveGroups: ImpactSummaryTransitiveGroup[];
}

export interface UiImpactComponentRef {
  componentName: string;
  filePath?: string;
  symbolId?: string;
  resolved: boolean;
}

export interface UiImpactPropUsage {
  propName: string;
  count: number;
}

export interface UiImpactSummary {
  parentComponents: UiImpactComponentRef[];
  parentPages: UiImpactComponentRef[];
  observedPropUsage: UiImpactPropUsage[];
  confidence: Extract<ImpactConfidence, 'low' | 'medium'>;
}

export interface ImpactAnalysisResult {
  mode: ImpactAnalysisMode;
  target: ImpactAnalysisTarget;
  directConsumers: ImpactResultBucket;
  indirectConsumers: ImpactIndirectConsumers;
  relatedContext: ImpactResultBucket;
  directlyImpactedSymbols: ImpactedSymbol[];
  directlyImpactedFiles: ImpactedFile[];
  transitiveImpacts: TransitiveImpact[];
  impactSummary: ImpactResultSummary;
  uiImpact?: UiImpactSummary;
  publicSurfaceRisk?: {
    level: PublicSurfaceRisk;
    notes: string[];
  };
  summary: ImpactAnalysisSummary;
}
