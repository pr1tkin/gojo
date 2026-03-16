import type { PatternKind } from './types.js';

function normalizeSegment(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function createPatternId(
  repoId: string,
  fileId: string,
  kind: PatternKind,
  name: string,
  startLine: number,
  endLine: number,
  symbolId?: string,
): string {
  const symbolSegment = symbolId ? normalizeSegment(symbolId) : 'file-scope';
  return `${normalizeSegment(repoId)}:${normalizeSegment(fileId)}:${kind}:${name}:${startLine}-${endLine}:${symbolSegment}`;
}

export function createPatternClusterId(kind: PatternKind, representativePatternId: string): string {
  return `cluster:${kind}:${normalizeSegment(representativePatternId)}`;
}
