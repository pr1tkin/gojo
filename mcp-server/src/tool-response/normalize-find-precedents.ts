import type { NormalizedMode, NormalizedResultBase, NormalizedToolResponse } from './normalized-types.js';

export interface FindPrecedentsNormalizationInput {
  rawResponse: unknown;
  mode: NormalizedMode;
}

export type FindPrecedentsNormalizedResponse = NormalizedToolResponse<NormalizedResultBase>;

// TODO(8.X.6.C): implement raw -> normalized adaptation for the public
// find_precedents tool without changing the existing raw tool output shape.
