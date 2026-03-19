import type { NormalizedDiagnostics } from './normalized-types.js';

export interface BuildNormalizedDiagnosticsInput {
  warnings?: string[];
  truncation?: NormalizedDiagnostics['truncation'];
  limits?: NormalizedDiagnostics['limits'];
  notes?: string[];
}

export function buildNormalizedDiagnostics(
  input: BuildNormalizedDiagnosticsInput = {},
): NormalizedDiagnostics {
  return {
    warnings: input.warnings ?? [],
    ...(input.truncation ? { truncation: input.truncation } : {}),
    ...(input.limits ? { limits: input.limits } : {}),
    ...(input.notes?.length ? { notes: input.notes } : {}),
  };
}
