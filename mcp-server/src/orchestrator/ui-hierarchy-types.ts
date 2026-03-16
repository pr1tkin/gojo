export interface UiHierarchyComponentRef {
  componentName: string;
  filePath?: string;
  symbolId?: string;
  resolved: boolean;
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
  observedProps: UiHierarchyObservedProp[];
}

export interface GetUiHierarchyInput {
  filePath: string;
  symbolId?: string;
  symbolName?: string;
}
