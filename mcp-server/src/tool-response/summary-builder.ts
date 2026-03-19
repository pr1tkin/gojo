import type { ConfidenceLevel, NormalizedMode, NormalizedResultBase, NormalizedSummary } from './normalized-types.js';
import { getNormalizedModeShape, shapeCollectionForMode } from './mode-shaping.js';

export interface NormalizedResultTiers<T extends NormalizedResultBase> {
  primary: T[];
  secondary?: T[];
}

export interface BuildNormalizedResultTiersInput<T> {
  items: T[];
  mode: NormalizedMode;
  primaryCount?: number;
  secondaryCount?: number;
}

export interface BuildNormalizedSummaryInput<T extends NormalizedResultBase> {
  results: NormalizedResultTiers<T>;
  confidence?: ConfidenceLevel;
  strongMatchCount?: number;
}

export function buildNormalizedResultTiers<T>(
  input: BuildNormalizedResultTiersInput<T>,
): { primary: T[]; secondary?: T[] } {
  const shape = getNormalizedModeShape(input.mode);
  const primaryCount = input.primaryCount ?? shape.defaultPrimaryCount;
  const secondaryCount = input.secondaryCount ?? shape.defaultSecondaryCount;
  const primary = shapeCollectionForMode(input.items, { limit: primaryCount });
  const secondaryItems = shapeCollectionForMode(input.items.slice(primary.length), { limit: secondaryCount });

  return {
    primary,
    ...(secondaryItems.length > 0 ? { secondary: secondaryItems } : {}),
  };
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
