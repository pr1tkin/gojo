import type { ConfidenceLevel } from './normalized-types.js';

export type CanonicalBucketCoverage = 'exact' | 'inferred' | 'exploratory';

export interface CanonicalBucket<TEntry> {
  label: string;
  explanation: string;
  entries: TEntry[];
  total: number;
  shown: number;
  truncated: boolean;
  confidence: ConfidenceLevel;
  coverage: CanonicalBucketCoverage;
}

export interface CanonicalBucketedResult<TEntry> {
  direct_consumers: CanonicalBucket<TEntry>;
  indirect_consumers: CanonicalBucket<TEntry>;
  related_context: CanonicalBucket<TEntry>;
}
