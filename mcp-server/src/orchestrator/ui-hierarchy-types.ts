import type {
  UiComponentResolution,
  UiMemberExpressionMetadata,
} from '../ui-composition/types.js';

export interface UiHierarchyComponentRef {
  componentName: string;
  filePath?: string;
  symbolId?: string;
  resolved: boolean;
  resolution: UiComponentResolution;
  hint?: string;
  source?: string;
  memberExpression?: UiMemberExpressionMetadata;
}

export interface UiHierarchyTreeNode {
  name: string;
  filePath?: string;
  symbolId?: string;
  resolved: boolean;
  resolution: UiComponentResolution;
  hint?: string;
  source?: string;
  memberExpression?: UiMemberExpressionMetadata;
  children: UiHierarchyTreeNode[];
}

export interface UiHierarchyTreeSummary {
  totalNodes: number;
  resolvedNodes: number;
  unresolvedNodes: number;
  completeness: number;
}

export interface UiHierarchyObservedProp {
  propName: string;
  count: number;
}

export interface UiHierarchySummary {
  target: {
    filePath: string;
    symbolId?: string;
    symbolName?: string;
  };
  renders: UiHierarchyComponentRef[];
  renderedBy: UiHierarchyComponentRef[];
  renderTree: UiHierarchyTreeNode[];
  renderTreeSummary: UiHierarchyTreeSummary;
  renderedByTree: UiHierarchyTreeNode[];
  renderedByTreeSummary: UiHierarchyTreeSummary;
  observedProps: UiHierarchyObservedProp[];
}

export interface GetUiHierarchyInput {
  filePath: string;
  symbolId?: string;
  symbolName?: string;
}
