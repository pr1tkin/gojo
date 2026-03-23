import type { SymbolKind } from '../types.js';
import type { ImpactAnalysisMode } from './impact-analysis-types.js';

export type ChangeRiskLevel =
  | 'low'
  | 'medium'
  | 'high'
  | 'unknown';

export type ChangeScope =
  | 'local-file'
  | 'feature-bounded'
  | 'shared-internal'
  | 'shared-surface'
  | 'broad-shared'
  | 'unknown';

export type PlannedFileRole =
  | 'edit-primary'
  | 'edit-secondary'
  | 'review-only'
  | 'entry-surface'
  | 'dependent-consumer'
  | 'test-or-story'
  | 'unknown';

export type ChangePlanningSignalType =
  | 'ownership'
  | 'api-boundary'
  | 'direct-impact'
  | 'transitive-impact'
  | 'barrel-surface'
  | 'framework-entry'
  | 'local-only'
  | 'cross-feature'
  | 'repo-wide'
  | 'high-fanout'
  | 'feature-bounded';

export interface AnalyzeSymbolChangePlanInput {
  repoId?: string;
  symbolId?: string;
  filePath?: string;
  symbolName?: string;
  impactMode?: ImpactAnalysisMode;
  maxDepth?: number;
}

export interface ChangePlanningSignal {
  type: ChangePlanningSignalType;
  strength: 'strong' | 'moderate' | 'weak';
  note?: string;
}

export interface ChangePlanStep {
  order: number;
  filePath: string;
  role: PlannedFileRole;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface UiPlanningComponentRef {
  componentName: string;
  filePath?: string;
  symbolId?: string;
  resolved: boolean;
}

export interface UiPlanningPropHint {
  propName: string;
  count: number;
}

export interface UiPlanningHints {
  renderingComponents: UiPlanningComponentRef[];
  renderingPages: UiPlanningComponentRef[];
  observedPropSurface: UiPlanningPropHint[];
  confidence: 'low' | 'medium';
}

export type ChangeImpactBucketKind = 'direct_consumers' | 'indirect_consumers' | 'related_context';

export type ChangeImpactBucketConfidence = 'high' | 'medium' | 'low';

export type ChangeImpactBucketCoverage = 'exact' | 'inferred' | 'exploratory';

export interface ChangeImpactBucketEntry {
  filePath: string;
  symbolName?: string;
  confidence: ChangeImpactBucketConfidence;
  coverage: ChangeImpactBucketCoverage;
  signals: string[];
}

export interface ChangeImpactBucket {
  kind: ChangeImpactBucketKind;
  label: string;
  explanation: string;
  confidence: ChangeImpactBucketConfidence;
  coverage: ChangeImpactBucketCoverage;
  signals: string[];
  entries: ChangeImpactBucketEntry[];
}

export interface SymbolChangePlanResult {
  target: {
    filePath: string;
    symbolId?: string;
    symbolName?: string;
    kind?: SymbolKind;
  };
  scope: ChangeScope;
  risk: ChangeRiskLevel;
  summary: string;
  signals: ChangePlanningSignal[];
  primaryEditFiles: string[];
  secondaryEditFiles: string[];
  reviewFiles: string[];
  orderedPlan: ChangePlanStep[];
  impactBuckets: {
    directConsumers: ChangeImpactBucket;
    indirectConsumers: ChangeImpactBucket;
    relatedContext: ChangeImpactBucket;
  };
  uiPlanningHints?: UiPlanningHints;
  notes?: string[];
}
