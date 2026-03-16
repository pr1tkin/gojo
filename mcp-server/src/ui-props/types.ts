export const UI_PROP_SURFACE_SCHEMA_VERSION = 1;

export type UiPropValueKind =
  | 'string-literal'
  | 'number-literal'
  | 'boolean-literal'
  | 'identifier'
  | 'expression'
  | 'object'
  | 'array'
  | 'unknown';

export interface UiPropUsage {
  parentFilePath: string;
  parentSymbolId?: string;
  parentSymbolName?: string;
  childComponentName: string;
  childFilePath?: string;
  childSymbolId?: string;
  propName: string;
  valueKind: UiPropValueKind;
  source: 'jsx-attribute';
  confidence: 'high' | 'medium';
  note?: string;
}

export interface UiPropSurfaceIndex {
  schemaVersion: number;
  sourceSymbolIndexSchemaVersion: number;
  generatedAt: string;
  propUsages: UiPropUsage[];
}

export interface UiPropComponentTarget {
  filePath?: string;
  symbolId?: string;
  symbolName?: string;
  childComponentName?: string;
}
