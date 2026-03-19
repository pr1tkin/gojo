export const UI_COMPOSITION_SCHEMA_VERSION = 3;

export type UiComponentResolution =
  | 'resolved_local'
  | 'external_dependency'
  | 'alias_not_resolved'
  | 'missing_symbol'
  | 'unresolved';

export type UiMemberExpressionResolution =
  | 'resolved_local_member'
  | 'external_dependency_member'
  | 'framework_member'
  | 'unresolved_member';

export interface UiMemberExpressionMetadata {
  expression: string;
  baseName: string;
  members: string[];
  resolutionKind: UiMemberExpressionResolution;
}

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
  memberExpression?: UiMemberExpressionMetadata;
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
