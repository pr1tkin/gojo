import { getChildrenForComponent, getParentsForComponent } from '../ui-composition/query.js';
import { getCommonPropNamesForComponent } from '../ui-props/query.js';
import type { UiCompositionComponentTarget } from '../ui-composition/types.js';
import type { UiPropComponentTarget } from '../ui-props/types.js';
import type {
  GetUiHierarchyInput,
  UiHierarchyComponentRef,
  UiHierarchyObservedProp,
  UiHierarchySummary,
} from './ui-hierarchy-types.js';

function createCompositionTarget(input: GetUiHierarchyInput): UiCompositionComponentTarget {
  return {
    filePath: input.filePath,
    symbolId: input.symbolId,
    symbolName: input.symbolName,
  };
}

function createPropTarget(input: GetUiHierarchyInput): UiPropComponentTarget {
  return {
    filePath: input.filePath,
    symbolId: input.symbolId,
    childComponentName: input.symbolName,
  };
}

function dedupeComponentRefs(items: UiHierarchyComponentRef[]): UiHierarchyComponentRef[] {
  const seen = new Set<string>();
  const deduped: UiHierarchyComponentRef[] = [];

  for (const item of items) {
    const key = `${item.componentName}|${item.filePath ?? ''}|${item.symbolId ?? ''}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function compareComponentRefs(left: UiHierarchyComponentRef, right: UiHierarchyComponentRef): number {
  const leftKey = `${left.componentName}:${left.filePath ?? ''}:${left.symbolId ?? ''}`;
  const rightKey = `${right.componentName}:${right.filePath ?? ''}:${right.symbolId ?? ''}`;
  return leftKey.localeCompare(rightKey);
}

function mapChildren(edges: Awaited<ReturnType<typeof getChildrenForComponent>>): UiHierarchyComponentRef[] {
  return dedupeComponentRefs(
    edges.map((edge) => ({
      componentName: edge.childComponentName,
      filePath: edge.childFilePath,
      symbolId: edge.childSymbolId,
      resolved: Boolean(edge.childFilePath || edge.childSymbolId),
    })),
  ).sort(compareComponentRefs);
}

function mapParents(edges: Awaited<ReturnType<typeof getParentsForComponent>>): UiHierarchyComponentRef[] {
  return dedupeComponentRefs(
    edges.map((edge) => ({
      componentName: edge.parentSymbolName ?? edge.parentFilePath.split('/').pop()?.replace(/\.(ts|tsx)$/, '') ?? edge.parentFilePath,
      filePath: edge.parentFilePath,
      symbolId: edge.parentSymbolId,
      resolved: Boolean(edge.parentSymbolId || edge.parentFilePath),
    })),
  ).sort(compareComponentRefs);
}

function mapObservedProps(
  entries: Awaited<ReturnType<typeof getCommonPropNamesForComponent>>,
): UiHierarchyObservedProp[] {
  return entries
    .map((entry) => ({
      propName: entry.propName,
      count: entry.count,
    }))
    .sort((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }

      return left.propName.localeCompare(right.propName);
    });
}

export async function getUiChildrenForComponent(
  input: GetUiHierarchyInput,
): Promise<UiHierarchyComponentRef[]> {
  const edges = await getChildrenForComponent(createCompositionTarget(input));
  return mapChildren(edges);
}

export async function getUiParentsForComponent(
  input: GetUiHierarchyInput,
): Promise<UiHierarchyComponentRef[]> {
  const edges = await getParentsForComponent({
    symbolId: input.symbolId,
    filePath: input.filePath,
    childComponentName: input.symbolName,
  });
  return mapParents(edges);
}

export async function getObservedPropNamesForComponent(
  input: GetUiHierarchyInput,
): Promise<UiHierarchyObservedProp[]> {
  const entries = await getCommonPropNamesForComponent(createPropTarget(input));
  return mapObservedProps(entries);
}

export async function getUiHierarchySummary(
  input: GetUiHierarchyInput,
): Promise<UiHierarchySummary | null> {
  const [renders, renderedBy, observedProps] = await Promise.all([
    getUiChildrenForComponent(input),
    getUiParentsForComponent(input),
    getObservedPropNamesForComponent(input),
  ]);

  if (renders.length === 0 && renderedBy.length === 0 && observedProps.length === 0) {
    return null;
  }

  return {
    target: {
      filePath: input.filePath,
      symbolId: input.symbolId,
      symbolName: input.symbolName,
    },
    renders,
    renderedBy,
    observedProps,
  };
}
