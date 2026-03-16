export const UI_COMPOSITION_SCHEMA_VERSION = 1;

export interface UiCompositionEdge {
  parentFilePath: string;
  parentSymbolId?: string;
  parentSymbolName?: string;
  childComponentName: string;
  childFilePath?: string;
  childSymbolId?: string;
  source: 'jsx';
  confidence: 'high' | 'medium';
  note?: string;
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
