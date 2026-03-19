import type { NormalizedMode, NormalizedResultBase } from './normalized-types.js';
import { shapeSignalsForMode } from './mode-shaping.js';
import type { ResultExplainabilitySignals } from '../orchestrator/types.js';
import type { NormalizedExplanationSignalValue } from './normalized-types.js';

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

/**
 * Adapters often receive explainability signal maps from raw tool outputs.
 * This helper strips non-contract-safe values so adapters can consistently
 * reuse the canonical explanation shape.
 */
export function normalizeExplanationSignals(
  signals: ResultExplainabilitySignals | undefined,
): Record<string, NormalizedExplanationSignalValue> | undefined {
  if (!signals) {
    return undefined;
  }

  const entries = Object.entries(signals).filter(([, value]) => {
    return (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    );
  }) as Array<[string, NormalizedExplanationSignalValue]>;

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}
