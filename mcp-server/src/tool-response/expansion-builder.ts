import type { NormalizedExpansion } from './normalized-types.js';

export interface BuildNormalizedExpansionInput {
  id?: string;
  kind: string;
  title: string;
  summary?: string;
  status?: 'available' | 'deferred';
  stableKey?: string;
}

function sanitizeExpansionPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function buildExpansionRefId(namespace: string, value: string): string {
  return value.startsWith(`${namespace}:`) ? value : `${namespace}:${value}`;
}

export function buildNormalizedExpansionId(input: {
  kind: string;
  stableKey: string;
}): string {
  return `${sanitizeExpansionPart(input.kind)}:${sanitizeExpansionPart(input.stableKey)}`;
}

export function buildNormalizedExpansion(
  input: BuildNormalizedExpansionInput,
): NormalizedExpansion {
  return {
    id: input.id ?? buildNormalizedExpansionId({ kind: input.kind, stableKey: input.stableKey ?? input.title }),
    kind: input.kind,
    title: input.title,
    ...(input.status ? { status: input.status } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
  };
}

export function buildNormalizedExpansions(
  expansions: NormalizedExpansion[] = [],
): Record<string, NormalizedExpansion> {
  return Object.fromEntries(expansions.map((expansion) => [expansion.id, buildNormalizedExpansion(expansion)]));
}
