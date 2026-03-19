export type NormalizedMode = 'agent' | 'debug';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface NormalizedQuery {
  target?: string;
  repo?: string;
  mode?: string;
  filePath?: string;
  symbolName?: string;
  [key: string]: unknown;
}

export interface NormalizedSummary {
  resultCount: number;
  primaryCount?: number;
  secondaryCount?: number;
  strongMatchCount?: number;
  confidence?: ConfidenceLevel;
}

export interface NormalizedDiagnostics {
  warnings: string[];
  truncation?: {
    truncated: boolean;
    limitApplied?: number;
    omittedCount?: number;
    reason?: string;
  };
  limits?: {
    resultLimit?: number;
    navigationHintLimit?: number;
    relatedItemLimit?: number;
  };
  notes?: string[];
}

export interface NormalizedExpansion {
  id: string;
  kind: string;
  title: string;
  status?: 'available' | 'deferred';
  summary?: string;
}

export type NormalizedExplanationSignalValue = ConfidenceLevel | string | number | boolean | null;

export interface NormalizedResultBase {
  id: string;
  kind: string;
  title: string;
  score?: number;
  confidence?: ConfidenceLevel;
  explanation: {
    short: string;
    signals?: Record<string, NormalizedExplanationSignalValue>;
  };
  references: {
    filePaths?: string[];
    symbolNames?: string[];
  };
  expansionId?: string;
}

export interface NormalizedEvidenceItem {
  kind: string;
  label: string;
  value: string;
}

export interface NormalizedNextAction {
  tool: string;
  reason: string;
  query?: Record<string, unknown>;
}

export interface NormalizedResults<T extends NormalizedResultBase> {
  primary: T[];
  secondary?: T[];
}

export interface NormalizedToolResponse<T extends NormalizedResultBase> {
  tool: string;
  version: string;
  mode: NormalizedMode;
  query: NormalizedQuery;
  summary: NormalizedSummary;
  results: NormalizedResults<T>;
  evidence: NormalizedEvidenceItem[];
  nextActions: NormalizedNextAction[];
  diagnostics: NormalizedDiagnostics;
  expansions: Record<string, NormalizedExpansion>;
}
