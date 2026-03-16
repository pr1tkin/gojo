export const PATTERN_INDEX_SCHEMA_VERSION = 1;

export type PatternKind =
  | 'component'
  | 'hook'
  | 'async-data-flow'
  | 'list-rendering'
  | 'conditional-rendering'
  | 'form-handling'
  | 'api-handler'
  | 'utility-export'
  | 'test-suite'
  | 'storybook-story'
  | 'service-layer'
  | 'data-access';

export type PatternSignalType =
  | 'react-function-component'
  | 'uses-hooks'
  | 'jsx-return'
  | 'custom-hook'
  | 'async-function'
  | 'map-rendering'
  | 'conditional-render'
  | 'error-handling'
  | 'error-boundary'
  | 'form-state'
  | 'api-request'
  | 'db-access'
  | 'named-export'
  | 'route-handler'
  | 'test-describe-block'
  | 'storybook-meta';

export interface PatternSignal {
  type: PatternSignalType;
  strength: 'strong' | 'moderate' | 'weak';
  note?: string;
}

export interface PatternFingerprint {
  patternKind: PatternKind;
  structuralSignals: string[];
  importSet: string[];
  exportShape: 'none' | 'internal' | 'named' | 'default' | 'mixed' | 'unknown';
  symbolRole: 'module' | 'component' | 'hook' | 'handler' | 'utility' | 'test' | 'story' | 'unknown';
  uiSignals?: string[];
  asyncSignals?: string[];
}

export interface PatternCandidate {
  patternId: string;
  kind: PatternKind;
  repoId: string;
  fileId: string;
  symbolId?: string;
  name: string;
  language: 'ts' | 'tsx' | 'js' | 'jsx' | 'unknown';
  startLine: number;
  endLine: number;
  signals: PatternSignal[];
  fingerprint: PatternFingerprint;
  supportingImports: string[];
  relatedSymbolIds: string[];
  confidence: 'high' | 'medium' | 'low';
  createdAt: string;
}

export interface PatternIndex {
  schemaVersion: number;
  sourceSymbolIndexSchemaVersion: number;
  generatedAt: string;
  patterns: PatternCandidate[];
}

export interface SimilarPatternMatch {
  patternId: string;
  fileId: string;
  symbolId?: string;
  similarityScore: number;
}

export interface PatternCluster {
  clusterId: string;
  patternKind: PatternKind;
  memberPatternIds: string[];
  representativePatternId: string;
  size: number;
  dominantSignals: string[];
}
