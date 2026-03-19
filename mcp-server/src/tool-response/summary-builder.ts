import type { ConfidenceLevel, NormalizedResultBase, NormalizedSummary } from './normalized-types.js';

export interface BuildNormalizedSummaryInput<T extends NormalizedResultBase> {
  results: {
    primary: T[];
    secondary?: T[];
  };
  confidence?: ConfidenceLevel;
  strongMatchCount?: number;
}

export function buildNormalizedSummary<T extends NormalizedResultBase>(
  input: BuildNormalizedSummaryInput<T>,
): NormalizedSummary {
  const primaryCount = input.results.primary.length;
  const secondaryCount = input.results.secondary?.length ?? 0;
  const resultCount = primaryCount + secondaryCount;
  const strongMatchCount =
    input.strongMatchCount ??
    [...input.results.primary, ...(input.results.secondary ?? [])].filter((result) => result.confidence === 'high')
      .length;

  return {
    resultCount,
    primaryCount,
    ...(secondaryCount > 0 ? { secondaryCount } : {}),
    ...(strongMatchCount > 0 ? { strongMatchCount } : {}),
    ...(input.confidence ? { confidence: input.confidence } : {}),
  };
}
