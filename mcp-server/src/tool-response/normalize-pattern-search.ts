import type { NormalizedMode, NormalizedResultBase, NormalizedToolResponse } from './normalized-types.js';

export interface PatternSearchNormalizationInput {
  rawResponse: unknown;
  mode: NormalizedMode;
}

export type PatternSearchNormalizedResponse = NormalizedToolResponse<NormalizedResultBase>;

// TODO(8.X.6.C): implement raw -> normalized adaptation for the internal
// pattern-search tool where normalization still matters for shared builders.
