import type { NormalizedMode, NormalizedResultBase, NormalizedToolResponse } from './normalized-types.js';

export interface ExploreComponentNormalizationInput {
  rawResponse: unknown;
  mode: NormalizedMode;
}

export type ExploreComponentNormalizedResponse = NormalizedToolResponse<NormalizedResultBase>;

// TODO(8.X.6.C): implement raw -> normalized adaptation for the public
// explore_component tool without changing the existing raw tool output shape.
