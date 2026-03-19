import type { NormalizedExpansion } from './normalized-types.js';

export function buildNormalizedExpansions(
  expansions: NormalizedExpansion[] = [],
): Record<string, NormalizedExpansion> {
  return Object.fromEntries(expansions.map((expansion) => [expansion.id, expansion]));
}
