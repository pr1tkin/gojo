export const UI_COMPOSITION_SCHEMA_VERSION = 2;

export type UiComponentResolution =
  | 'resolved_local'
  | 'external_dependency'
  | 'alias_not_resolved'
  | 'missing_symbol'
  | 'unresolved';

export interface UiCompositionEdge {
  parentFilePath: string;
  parentSymbolId?: string;
  parentSymbolName?: string;
  childComponentName: string;
  childFilePath?: string;
  childSymbolId?: string;
  resolution: UiComponentResolution;
  source: 'jsx';
  confidence: 'high' | 'medium';
  note?: string;
  hint?: string;
  dependencySource?: string;
}

export interface UiCompositionIndex {
  schemaVersion: number;
  sourceSymbolIndexSchemaVersion: number;
  generatedAt: string;
  edges: UiCompositionEdge[];
}

export interface UiCompositionComponentTarget {
  filePath?: string;
  symbolId?: string;
  symbolName?: string;
  childComponentName?: string;
}
