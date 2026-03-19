import type { NormalizedMode, NormalizedResultBase } from './normalized-types.js';
import { shapeSignalsForMode } from './mode-shaping.js';

export interface BuildNormalizedExplanationInput {
  mode: NormalizedMode;
  short: string;
  signals?: NormalizedResultBase['explanation']['signals'];
  maxSignals?: number;
}

/**
 * Packs explanation content into the canonical result shape while keeping
 * signal density mode-aware. Adapters should use this instead of formatting
 * signal maps ad hoc.
 */
export function buildNormalizedExplanation(
  input: BuildNormalizedExplanationInput,
): NormalizedResultBase['explanation'] {
  const signals = shapeSignalsForMode(input.signals, input.mode, input.maxSignals);

  return {
    short: input.short,
    ...(signals ? { signals } : {}),
  };
}
