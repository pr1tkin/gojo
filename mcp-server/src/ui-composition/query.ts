import { loadUiCompositionIndex } from './store.js';
import type { UiCompositionComponentTarget, UiCompositionEdge } from './types.js';

export function matchesComponentTarget(
  edge: UiCompositionEdge,
  target: UiCompositionComponentTarget,
  direction: 'parent' | 'child',
): boolean {
  if (direction === 'parent') {
    if (target.symbolId) {
      return edge.parentSymbolId === target.symbolId;
    }

    if (target.filePath && target.symbolName) {
      return edge.parentFilePath === target.filePath && edge.parentSymbolName === target.symbolName;
    }

    if (target.filePath) {
      return edge.parentFilePath === target.filePath;
    }

    if (target.symbolName) {
      return edge.parentSymbolName === target.symbolName;
    }

    return false;
  }

  if (target.symbolId) {
    return edge.childSymbolId === target.symbolId;
  }

  if (target.filePath && target.childComponentName) {
    return edge.childFilePath === target.filePath && edge.childComponentName === target.childComponentName;
  }

  if (target.filePath) {
    return edge.childFilePath === target.filePath;
  }

  if (target.childComponentName) {
    return edge.childComponentName === target.childComponentName;
  }

  return false;
}

export function filterChildrenForComponent(
  edges: UiCompositionEdge[],
  target: UiCompositionComponentTarget,
): UiCompositionEdge[] {
  return edges.filter((edge) => matchesComponentTarget(edge, target, 'parent'));
}

export function filterParentsForComponent(
  edges: UiCompositionEdge[],
  target: UiCompositionComponentTarget,
): UiCompositionEdge[] {
  return edges.filter((edge) => matchesComponentTarget(edge, target, 'child'));
}

export async function getChildrenForComponent(
  target: UiCompositionComponentTarget,
): Promise<UiCompositionEdge[]> {
  const index = await loadUiCompositionIndex();
  return filterChildrenForComponent(index.edges, target);
}

export async function getParentsForComponent(
  target: UiCompositionComponentTarget,
): Promise<UiCompositionEdge[]> {
  const index = await loadUiCompositionIndex();
  return filterParentsForComponent(index.edges, target);
}
