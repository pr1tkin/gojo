import {
  filterChildrenForComponent,
  filterParentsForComponent,
  getChildrenForComponent,
  getParentsForComponent,
} from '../ui-composition/query.js';
import { loadUiCompositionIndex } from '../ui-composition/store.js';
import { getCommonPropNamesForComponent } from '../ui-props/query.js';
import type { UiCompositionComponentTarget } from '../ui-composition/types.js';
import type { UiPropComponentTarget } from '../ui-props/types.js';
import type {
  GetUiHierarchyInput,
  UiHierarchyComponentRef,
  UiHierarchyObservedProp,
  UiHierarchySummary,
  UiHierarchyTreeNode,
  UiHierarchyTreeSummary,
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
      resolved: edge.resolution === 'resolved_local',
      resolution: edge.resolution,
      hint: edge.hint ?? edge.note,
      source: edge.dependencySource,
    })),
  ).sort(compareComponentRefs);
}

function mapParents(edges: Awaited<ReturnType<typeof getParentsForComponent>>): UiHierarchyComponentRef[] {
  return dedupeComponentRefs(
    edges.map((edge) => ({
      componentName: edge.parentSymbolName ?? edge.parentFilePath.split('/').pop()?.replace(/\.(ts|tsx)$/, '') ?? edge.parentFilePath,
      filePath: edge.parentFilePath,
      symbolId: edge.parentSymbolId,
      resolved: Boolean(edge.parentSymbolId),
      resolution: edge.parentSymbolId ? 'resolved_local' : 'missing_symbol',
      hint: edge.parentSymbolId ? undefined : edge.parentFilePath,
    })),
  ).sort(compareComponentRefs);
}

function createTreeNodeFromChildEdge(edge: Awaited<ReturnType<typeof getChildrenForComponent>>[number]): UiHierarchyTreeNode {
  return {
    name: edge.childComponentName,
    filePath: edge.childFilePath,
    symbolId: edge.childSymbolId,
    resolved: edge.resolution === 'resolved_local',
    resolution: edge.resolution,
    hint: edge.hint ?? edge.note,
    source: edge.dependencySource,
    children: [],
  };
}

function createTreeNodeFromParentEdge(edge: Awaited<ReturnType<typeof getParentsForComponent>>[number]): UiHierarchyTreeNode {
  return {
    name: edge.parentSymbolName ?? edge.parentFilePath.split('/').pop()?.replace(/\.(ts|tsx|js|jsx)$/, '') ?? edge.parentFilePath,
    filePath: edge.parentFilePath,
    symbolId: edge.parentSymbolId,
    resolved: Boolean(edge.parentSymbolId),
    resolution: edge.parentSymbolId ? 'resolved_local' : 'missing_symbol',
    hint: edge.parentSymbolId ? undefined : edge.parentFilePath,
    children: [],
  };
}

function buildTraversalKey(node: { symbolId?: string; filePath?: string; name?: string }): string {
  return `${node.symbolId ?? ''}|${node.filePath ?? ''}|${node.name ?? ''}`;
}

function summarizeTree(nodes: UiHierarchyTreeNode[]): UiHierarchyTreeSummary {
  let totalNodes = 0;
  let resolvedNodes = 0;

  const visit = (items: UiHierarchyTreeNode[]) => {
    for (const item of items) {
      totalNodes += 1;

      if (item.resolution === 'resolved_local') {
        resolvedNodes += 1;
      }

      visit(item.children);
    }
  };

  visit(nodes);

  return {
    totalNodes,
    resolvedNodes,
    unresolvedNodes: totalNodes - resolvedNodes,
    completeness: totalNodes === 0 ? 0 : resolvedNodes / totalNodes,
  };
}

function buildChildTraversalTarget(node: UiHierarchyTreeNode): UiCompositionComponentTarget | null {
  if (node.symbolId) {
    return { symbolId: node.symbolId };
  }

  if (node.filePath) {
    return {
      filePath: node.filePath,
      childComponentName: node.name,
      symbolName: node.name,
    };
  }

  return null;
}

function buildParentTraversalTarget(node: UiHierarchyTreeNode): UiCompositionComponentTarget | null {
  if (node.symbolId) {
    return { symbolId: node.symbolId };
  }

  return null;
}

function buildRenderTree(
  edges: Awaited<ReturnType<typeof loadUiCompositionIndex>>['edges'],
  target: UiCompositionComponentTarget,
  visited: Set<string>,
): UiHierarchyTreeNode[] {
  const childEdges = filterChildrenForComponent(edges, target);

  return childEdges.map((edge) => {
    const node = createTreeNodeFromChildEdge(edge);
    const traversalTarget = buildChildTraversalTarget(node);
    const traversalKey = buildTraversalKey({ symbolId: node.symbolId, filePath: node.filePath, name: node.name });

    if (!traversalTarget || node.resolution !== 'resolved_local' || visited.has(traversalKey)) {
      return node;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(traversalKey);
    node.children = buildRenderTree(edges, traversalTarget, nextVisited);
    return node;
  });
}

function buildRenderedByTree(
  edges: Awaited<ReturnType<typeof loadUiCompositionIndex>>['edges'],
  target: UiCompositionComponentTarget,
  visited: Set<string>,
): UiHierarchyTreeNode[] {
  const parentEdges = filterParentsForComponent(edges, target);

  return parentEdges.map((edge) => {
    const node = createTreeNodeFromParentEdge(edge);
    const traversalTarget = buildParentTraversalTarget(node);
    const traversalKey = buildTraversalKey({ symbolId: node.symbolId, filePath: node.filePath, name: node.name });

    if (!traversalTarget || node.resolution !== 'resolved_local' || visited.has(traversalKey)) {
      return node;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(traversalKey);
    node.children = buildRenderedByTree(edges, traversalTarget, nextVisited);
    return node;
  });
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
  const [renders, renderedBy, observedProps, uiCompositionIndex] = await Promise.all([
    getUiChildrenForComponent(input),
    getUiParentsForComponent(input),
    getObservedPropNamesForComponent(input),
    loadUiCompositionIndex(),
  ]);

  if (renders.length === 0 && renderedBy.length === 0 && observedProps.length === 0) {
    return null;
  }

  const renderTree = buildRenderTree(
    uiCompositionIndex.edges,
    createCompositionTarget(input),
    new Set([buildTraversalKey({ symbolId: input.symbolId, filePath: input.filePath, name: input.symbolName })]),
  );
  const renderedByTree = buildRenderedByTree(
    uiCompositionIndex.edges,
    {
      symbolId: input.symbolId,
      filePath: input.filePath,
      childComponentName: input.symbolName,
    },
    new Set([buildTraversalKey({ symbolId: input.symbolId, filePath: input.filePath, name: input.symbolName })]),
  );

  return {
    target: {
      filePath: input.filePath,
      symbolId: input.symbolId,
      symbolName: input.symbolName,
    },
    renders,
    renderedBy,
    renderTree,
    renderTreeSummary: summarizeTree(renderTree),
    renderedByTree,
    renderedByTreeSummary: summarizeTree(renderedByTree),
    observedProps,
  };
}
