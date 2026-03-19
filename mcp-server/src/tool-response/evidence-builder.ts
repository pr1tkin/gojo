import type { NormalizedEvidenceItem, NormalizedMode } from './normalized-types.js';
import { getNormalizedModeShape, shapeCollectionForMode } from './mode-shaping.js';

export interface BuildNormalizedEvidenceOptions {
  mode: NormalizedMode;
  maxItems?: number;
}

function buildEvidenceKey(item: NormalizedEvidenceItem): string {
  return `${item.kind}::${item.label}::${item.value}`;
}

export function buildNormalizedEvidenceItem(input: NormalizedEvidenceItem): NormalizedEvidenceItem {
  return {
    kind: input.kind,
    label: input.label,
    value: input.value,
  };
}

export function buildNormalizedEvidence(
  items: NormalizedEvidenceItem[] = [],
  options: BuildNormalizedEvidenceOptions,
): NormalizedEvidenceItem[] {
  const deduped = Array.from(
    new Map(items.map((item) => [buildEvidenceKey(item), buildNormalizedEvidenceItem(item)])).values(),
  );
  const limit = options.maxItems ?? getNormalizedModeShape(options.mode).defaultEvidenceCount;
  return shapeCollectionForMode(deduped, { limit });
}
