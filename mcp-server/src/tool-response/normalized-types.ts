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

export interface NormalizedTruncation {
  type?: string;
  truncated: boolean;
  totalCount?: number;
  limitApplied?: number;
  omittedCount?: number;
  reason?: string;
}

export interface NormalizedDiagnostics {
  warnings: string[];
  // Primary truncation entry for consumers that only need one limit signal.
  truncation?: NormalizedTruncation;
  // Additional truncation entries beyond `truncation`, kept separate to avoid duplicate reporting.
  truncations?: NormalizedTruncation[];
  limits?: {
    resultLimit?: number;
    navigationHintLimit?: number;
    relatedItemLimit?: number;
    candidateLimit?: number;
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

export interface NormalizedDebugPayload {
  details?: Record<string, unknown>;
}

export interface NormalizedResultBase {
  id: string;
  kind: string;
  title: string;
  score?: number | null;
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
  // Present in both agent and debug modes so field presence stays stable across mode changes.
  debug?: NormalizedDebugPayload | null;
}

export interface NormalizedEvidenceItem {
  kind: string;
  label: string;
  value: string;
}

export interface NormalizedNextAction {
  action?: string;
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
  // Present in both agent and debug modes so adapters enrich values instead of mutating shape.
  debug?: NormalizedDebugPayload | null;
}
