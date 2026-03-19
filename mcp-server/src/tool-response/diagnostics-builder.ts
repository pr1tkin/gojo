import type { NormalizedDiagnostics } from './normalized-types.js';

export interface BuildNormalizedDiagnosticsInput {
  warnings?: string[];
  truncation?: NormalizedDiagnostics['truncation'];
  limits?: NormalizedDiagnostics['limits'];
  notes?: string[];
}

function dedupe(values: string[] | undefined): string[] | undefined {
  if (!values?.length) {
    return undefined;
  }

  return Array.from(new Set(values));
}

export interface BuildNormalizedTruncationInput {
  returnedCount: number;
  totalCount?: number;
  limitApplied?: number;
  reason?: string;
}

export function buildNormalizedTruncation(
  input: BuildNormalizedTruncationInput,
): NormalizedDiagnostics['truncation'] | undefined {
  const totalCount = input.totalCount ?? input.returnedCount;
  const omittedCount = Math.max(totalCount - input.returnedCount, 0);
  const truncated = omittedCount > 0;

  if (!truncated && input.limitApplied === undefined && !input.reason) {
    return undefined;
  }

  return {
    truncated,
    ...(input.limitApplied !== undefined ? { limitApplied: input.limitApplied } : {}),
    ...(omittedCount > 0 ? { omittedCount } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

export function mergeNormalizedDiagnostics(
  ...inputs: Array<BuildNormalizedDiagnosticsInput | undefined>
): NormalizedDiagnostics {
  const warnings = dedupe(inputs.flatMap((input) => input?.warnings ?? [])) ?? [];
  const notes = dedupe(inputs.flatMap((input) => input?.notes ?? []));
  const truncation = inputs.map((input) => input?.truncation).filter(Boolean).at(-1);
  const limits = Object.assign({}, ...inputs.map((input) => input?.limits ?? {}));

  return buildNormalizedDiagnostics({
    warnings,
    ...(truncation ? { truncation } : {}),
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
    ...(notes ? { notes } : {}),
  });
}

export function buildNormalizedDiagnostics(
  input: BuildNormalizedDiagnosticsInput = {},
): NormalizedDiagnostics {
  const warnings = dedupe(input.warnings) ?? [];
  const notes = dedupe(input.notes);

  return {
    warnings,
    ...(input.truncation ? { truncation: input.truncation } : {}),
    ...(input.limits ? { limits: input.limits } : {}),
    ...(notes?.length ? { notes } : {}),
  };
}
