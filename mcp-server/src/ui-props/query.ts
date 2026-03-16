import { loadUiPropSurfaceIndex } from './store.js';
import type { UiPropComponentTarget, UiPropUsage } from './types.js';

function matchesParentTarget(usage: UiPropUsage, target: UiPropComponentTarget): boolean {
  if (target.symbolId) {
    return usage.parentSymbolId === target.symbolId;
  }

  if (target.filePath && target.symbolName) {
    return usage.parentFilePath === target.filePath && usage.parentSymbolName === target.symbolName;
  }

  if (target.filePath) {
    return usage.parentFilePath === target.filePath;
  }

  if (target.symbolName) {
    return usage.parentSymbolName === target.symbolName;
  }

  return false;
}

function matchesChildTarget(usage: UiPropUsage, target: UiPropComponentTarget): boolean {
  if (target.symbolId) {
    return usage.childSymbolId === target.symbolId;
  }

  if (target.filePath && target.childComponentName) {
    return usage.childFilePath === target.filePath && usage.childComponentName === target.childComponentName;
  }

  if (target.filePath) {
    return usage.childFilePath === target.filePath;
  }

  if (target.childComponentName) {
    return usage.childComponentName === target.childComponentName;
  }

  return false;
}

export async function getPropsPassedToComponent(
  target: UiPropComponentTarget,
): Promise<UiPropUsage[]> {
  const index = await loadUiPropSurfaceIndex();
  return index.propUsages.filter((usage) => matchesChildTarget(usage, target));
}

export async function getPropUsageForParent(
  target: UiPropComponentTarget,
): Promise<UiPropUsage[]> {
  const index = await loadUiPropSurfaceIndex();
  return index.propUsages.filter((usage) => matchesParentTarget(usage, target));
}

export async function getCommonPropNamesForComponent(
  target: UiPropComponentTarget,
): Promise<Array<{ propName: string; count: number }>> {
  const usages = await getPropsPassedToComponent(target);
  const counts = new Map<string, number>();

  for (const usage of usages) {
    counts.set(usage.propName, (counts.get(usage.propName) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([propName, count]) => ({ propName, count }))
    .sort((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }

      return left.propName.localeCompare(right.propName);
    });
}
