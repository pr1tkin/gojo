import type { NormalizedMode, NormalizedResultBase } from './normalized-types.js';

export interface NormalizedModeShape {
  mode: NormalizedMode;
  includeDebugSections: boolean;
  includeRawSignals: boolean;
  includeExpansionMetadata: boolean;
  defaultPrimaryCount: number;
  defaultSecondaryCount: number;
  defaultEvidenceCount: number;
  defaultNextActionCount: number;
  defaultSignalCount: number;
}

export function getNormalizedModeShape(mode: NormalizedMode): NormalizedModeShape {
  return {
    mode,
    includeDebugSections: mode === 'debug',
    includeRawSignals: mode === 'debug',
    includeExpansionMetadata: true,
    defaultPrimaryCount: 2,
    defaultSecondaryCount: mode === 'debug' ? 3 : 1,
    defaultEvidenceCount: mode === 'debug' ? 6 : 4,
    defaultNextActionCount: mode === 'debug' ? 4 : 3,
    defaultSignalCount: mode === 'debug' ? 6 : 4,
  };
}

export function shapeCollectionForMode<T>(items: T[], input: { limit?: number }): T[] {
  return items.slice(0, Math.max(0, input.limit ?? items.length));
}

export function shapeSignalsForMode(
  signals: NormalizedResultBase['explanation']['signals'] | undefined,
  mode: NormalizedMode,
  maxSignals?: number,
): NormalizedResultBase['explanation']['signals'] | undefined {
  if (!signals) {
    return undefined;
  }

  const limit = maxSignals ?? getNormalizedModeShape(mode).defaultSignalCount;
  const entries = Object.entries(signals).slice(0, limit);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}
