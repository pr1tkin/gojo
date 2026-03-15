import path from 'node:path';

import type { RankingReason } from './types.js';

export function createReason(signal: string, value: number, note?: string): RankingReason {
  return { signal, value, note };
}

export function compareReasons(left: string, right: string): number {
  return left.localeCompare(right);
}

export function computePathCloseness(left: string, right: string): number {
  const leftSegments = left.split('/').filter(Boolean);
  const rightSegments = right.split('/').filter(Boolean);
  const maxSegments = Math.min(leftSegments.length, rightSegments.length);
  let sharedPrefix = 0;

  while (sharedPrefix < maxSegments && leftSegments[sharedPrefix] === rightSegments[sharedPrefix]) {
    sharedPrefix += 1;
  }

  if (sharedPrefix > 0) {
    return sharedPrefix;
  }

  if (path.dirname(left) === path.dirname(right)) {
    return 1;
  }

  return 0;
}

export function countIntersection(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).length;
}
