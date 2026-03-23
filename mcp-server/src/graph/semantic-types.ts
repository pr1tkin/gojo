export const SEMANTIC_GRAPH_SCHEMA_VERSION = 1;

export type SemanticEdgeKind =
  | 'symbol_call'
  | 'symbol_reference'
  | 'jsx_reference'
  | 'type_reference'
  | 'api_route_handler'
  | 'api_client_to_route'
  | 'api_propagation';

export type SemanticEdgeStrength = 'strong' | 'medium' | 'weak';
export type SemanticEdgeConfidence = 'high' | 'medium' | 'low';
export type SemanticEdgeExactness = 'exact' | 'inferred' | 'exploratory';

export interface SemanticGraphEdge {
  edgeId: string;
  kind: SemanticEdgeKind;
  strength: SemanticEdgeStrength;
  confidence: SemanticEdgeConfidence;
  exactness: SemanticEdgeExactness;
  fromSymbolId?: string;
  fromFileId?: string;
  toSymbolId?: string;
  toFileId?: string;
  metadata?: {
    routeId?: string;
    routeFileId?: string;
    routeFilePath?: string;
    httpMethod?: string;
    handlerName?: string;
    source?: 'typescript' | 'ast_fallback' | 'api_propagation';
    line?: number;
  };
}

export interface SemanticGraphSnapshot {
  schemaVersion: number;
  sourceSymbolIndexSchemaVersion: number;
  generatedAt: string;
  edges: SemanticGraphEdge[];
}
