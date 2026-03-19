import type { NormalizedDiagnostics } from './normalized-types.js';

export interface BuildNormalizedDiagnosticsInput {
  warnings?: string[];
  truncation?: NormalizedDiagnostics['truncation'];
  truncations?: NormalizedDiagnostics['truncations'];
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
  type?: string;
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
    ...(input.type ? { type: input.type } : {}),
    truncated,
    ...(input.totalCount !== undefined ? { totalCount } : {}),
    ...(input.limitApplied !== undefined ? { limitApplied: input.limitApplied } : {}),
    ...(omittedCount > 0 ? { omittedCount } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

function buildTruncationKey(truncation: NonNullable<NormalizedDiagnostics['truncation']>): string {
  return JSON.stringify(truncation);
}

function dedupeTruncations(
  truncations: Array<NormalizedDiagnostics['truncation'] | undefined>,
): NormalizedDiagnostics['truncations'] | undefined {
  const values = truncations.filter(Boolean) as NonNullable<NormalizedDiagnostics['truncation']>[];

  if (values.length === 0) {
    return undefined;
  }

  return Array.from(new Map(values.map((truncation) => [buildTruncationKey(truncation), truncation])).values());
}

function splitPrimaryAndAdditionalTruncations(
  truncations: NormalizedDiagnostics['truncations'] | undefined,
): {
  truncation?: NormalizedDiagnostics['truncation'];
  truncations?: NormalizedDiagnostics['truncations'];
} {
  if (!truncations?.length) {
    return {};
  }

  const [truncation, ...additional] = truncations;
  return {
    truncation,
    ...(additional.length > 0 ? { truncations: additional } : {}),
  };
}

export function mergeNormalizedDiagnostics(
  ...inputs: Array<BuildNormalizedDiagnosticsInput | undefined>
): NormalizedDiagnostics {
  const warnings = dedupe(inputs.flatMap((input) => input?.warnings ?? [])) ?? [];
  const notes = dedupe(inputs.flatMap((input) => input?.notes ?? []));
  const truncations = dedupeTruncations(
    inputs.flatMap((input) => [input?.truncation, ...(input?.truncations ?? [])]),
  );
  const { truncation, truncations: additionalTruncations } = splitPrimaryAndAdditionalTruncations(truncations);
  const limits = Object.assign({}, ...inputs.map((input) => input?.limits ?? {}));

  return buildNormalizedDiagnostics({
    warnings,
    ...(truncation ? { truncation } : {}),
    ...(additionalTruncations ? { truncations: additionalTruncations } : {}),
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
    ...(notes ? { notes } : {}),
  });
}

export function buildNormalizedDiagnostics(
  input: BuildNormalizedDiagnosticsInput = {},
): NormalizedDiagnostics {
  const warnings = dedupe(input.warnings) ?? [];
  const notes = dedupe(input.notes);
  const dedupedTruncations = dedupeTruncations([input.truncation, ...(input.truncations ?? [])]);
  const {
    truncation,
    truncations,
  } = input.truncation
    ? {
        truncation: input.truncation,
        truncations: dedupeTruncations(
          (input.truncations ?? []).filter(
            (entry): entry is NonNullable<typeof entry> =>
              Boolean(entry) && buildTruncationKey(entry) !== buildTruncationKey(input.truncation!),
          ),
        ),
      }
    : splitPrimaryAndAdditionalTruncations(dedupedTruncations);

  return {
    warnings,
    ...(truncation ? { truncation } : {}),
    ...(truncations ? { truncations } : {}),
    ...(input.limits ? { limits: input.limits } : {}),
    ...(notes?.length ? { notes } : {}),
  };
}
