import type { NormalizedMode } from './normalized-types.js';

export interface NormalizedModeShape {
  mode: NormalizedMode;
  includeDebugSections: boolean;
  includeRawSignals: boolean;
  includeExpansionMetadata: boolean;
}

export function getNormalizedModeShape(mode: NormalizedMode): NormalizedModeShape {
  return {
    mode,
    includeDebugSections: mode === 'debug',
    includeRawSignals: mode === 'debug',
    includeExpansionMetadata: true,
  };
}
