import { createFileId } from '../symbol-index/ids.js';
import type { IndexedSymbol, SymbolIndex, SymbolIndexCoverageIssue } from '../symbol-index/types.js';
import type { RepositoryInfo } from '../types.js';
import { collectApiPropagationForSymbol } from '../typescript/api-propagation.js';
import { findTypeScriptReferencesForIndexedSymbol } from '../typescript/symbol-references.js';
import {
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  type SemanticEdgeConfidence,
  type SemanticEdgeExactness,
  type SemanticEdgeKind,
  type SemanticEdgeStrength,
  type SemanticGraphEdge,
  type SemanticGraphSnapshot,
} from './semantic-types.js';

function createEdgeId(edge: Omit<SemanticGraphEdge, 'edgeId'>): string {
  return [
    edge.kind,
    edge.fromSymbolId ?? '',
    edge.fromFileId ?? '',
    edge.toSymbolId ?? '',
    edge.toFileId ?? '',
    edge.metadata?.routeId ?? '',
    edge.metadata?.httpMethod ?? '',
    edge.metadata?.handlerName ?? '',
    edge.metadata?.line ?? '',
  ].join(':');
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function determineExactEdgeKind(match: {
  isCallReference: boolean;
  isJsxReference: boolean;
  isTypeReference: boolean;
}): SemanticEdgeKind {
  if (match.isCallReference) {
    return 'symbol_call';
  }

  if (match.isJsxReference) {
    return 'jsx_reference';
  }

  if (match.isTypeReference) {
    return 'type_reference';
  }

  return 'symbol_reference';
}

function pickOwningSymbol(symbols: IndexedSymbol[], line: number): IndexedSymbol | undefined {
  return symbols
    .filter((symbol) => line >= symbol.startLine && line <= symbol.endLine)
    .sort((left, right) => {
      const leftSpan = left.endLine - left.startLine;
      const rightSpan = right.endLine - right.startLine;
      return leftSpan - rightSpan || left.startLine - right.startLine;
    })[0];
}

function createEdge(input: {
  kind: SemanticEdgeKind;
  strength: SemanticEdgeStrength;
  confidence: SemanticEdgeConfidence;
  exactness: SemanticEdgeExactness;
  fromSymbolId?: string;
  fromFileId?: string;
  toSymbolId?: string;
  toFileId?: string;
  metadata?: SemanticGraphEdge['metadata'];
}): SemanticGraphEdge {
  return {
    edgeId: createEdgeId(input),
    ...input,
  };
}

function dedupeEdges(edges: SemanticGraphEdge[]): SemanticGraphEdge[] {
  const seen = new Set<string>();
  const deduped: SemanticGraphEdge[] = [];

  for (const edge of edges) {
    if (seen.has(edge.edgeId)) {
      continue;
    }

    seen.add(edge.edgeId);
    deduped.push(edge);
  }

  return deduped.sort((left, right) => left.edgeId.localeCompare(right.edgeId));
}

const LARGE_REPO_SEMANTIC_GRAPH_FILE_LIMIT = 12000;
const LARGE_REPO_SEMANTIC_GRAPH_EXPORTED_SYMBOL_LIMIT = 12000;

export async function buildSemanticGraph(
  index: SymbolIndex,
  repositories: RepositoryInfo[],
  options: {
    onIssue?: (issue: SymbolIndexCoverageIssue) => void;
  } = {},
): Promise<SemanticGraphSnapshot> {
  const repositoriesById = new Map(repositories.map((repository) => [repository.id, repository]));
  const symbolsByFileId = new Map<string, IndexedSymbol[]>();

  for (const symbol of index.symbols) {
    const existing = symbolsByFileId.get(symbol.fileId) ?? [];
    existing.push(symbol);
    symbolsByFileId.set(symbol.fileId, existing);
  }

  const exportedSymbols = index.symbols.filter((symbol) => symbol.exported);
  const edges: SemanticGraphEdge[] = [];

  if (
    Object.keys(index.byFile).length > LARGE_REPO_SEMANTIC_GRAPH_FILE_LIMIT ||
    exportedSymbols.length > LARGE_REPO_SEMANTIC_GRAPH_EXPORTED_SYMBOL_LIMIT
  ) {
    options.onIssue?.({
      repoId: repositories[0]?.id ?? 'unknown',
      filePath: '*',
      classification: 'source',
      language: 'unknown',
      stage: 'semantic_graph',
      disposition: 'partial',
      source: 'policy',
      reason:
        `bounded semantic graph build skipped full exact reference materialization for a large repository (${Object.keys(index.byFile).length} files, ${exportedSymbols.length} exported symbols) to avoid OOM`,
    });

    return {
      schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
      sourceSymbolIndexSchemaVersion: index.schemaVersion,
      generatedAt: new Date().toISOString(),
      edges: [],
    };
  }

  for (const target of exportedSymbols) {
    const repository = repositoriesById.get(target.repo);

    if (!repository) {
      continue;
    }

    let matches: Awaited<ReturnType<typeof findTypeScriptReferencesForIndexedSymbol>>;

    try {
      matches = await findTypeScriptReferencesForIndexedSymbol(repository, target);
    } catch {
      matches = [];
    }

    for (const match of matches) {
      if (match.filePath === target.filePath) {
        continue;
      }

      const referencingFileId = createFileId(target.repo, normalizePath(match.filePath));
      const owner = pickOwningSymbol(symbolsByFileId.get(referencingFileId) ?? [], match.line);
      const kind = determineExactEdgeKind(match);

      edges.push(
        createEdge({
          kind,
          strength: 'strong',
          confidence: 'high',
          exactness: 'exact',
          fromSymbolId: owner?.symbolId,
          fromFileId: referencingFileId,
          toSymbolId: target.symbolId,
          toFileId: target.fileId,
          metadata: {
            source: 'typescript',
            line: match.line,
          },
        }),
      );
    }

    let apiPropagation: Awaited<ReturnType<typeof collectApiPropagationForSymbol>>;

    try {
      apiPropagation = await collectApiPropagationForSymbol(repository, target, index.byFile, index.symbols);
    } catch {
      apiPropagation = {
        routeHandlers: [],
        clientCalls: [],
        propagatedClients: [],
      };
    }

    for (const routeHandler of apiPropagation.routeHandlers) {
      const owner = (symbolsByFileId.get(routeHandler.routeFileId) ?? []).find(
        (symbol) => symbol.name === routeHandler.handlerName,
      );

      edges.push(
        createEdge({
          kind: 'api_route_handler',
          strength: 'strong',
          confidence: 'high',
          exactness: 'exact',
          fromSymbolId: owner?.symbolId,
          fromFileId: routeHandler.routeFileId,
          toSymbolId: target.symbolId,
          toFileId: target.fileId,
          metadata: {
            routeId: routeHandler.routeId,
            routeFileId: routeHandler.routeFileId,
            routeFilePath: routeHandler.routeFilePath,
            httpMethod: routeHandler.handlerName,
            handlerName: routeHandler.handlerName,
            source: 'api_propagation',
          },
        }),
      );
    }

    const routeFileIdByRouteAndMethod = new Map<string, string>();

    for (const routeHandler of apiPropagation.routeHandlers) {
      routeFileIdByRouteAndMethod.set(`${routeHandler.routeId}:${routeHandler.handlerName}`, routeHandler.routeFileId);
    }

    for (const clientCall of apiPropagation.clientCalls) {
      const owner = pickOwningSymbol(symbolsByFileId.get(clientCall.clientFileId) ?? [], clientCall.line);
      const routeFileId =
        routeFileIdByRouteAndMethod.get(`${clientCall.routeId}:${clientCall.method}`) ??
        routeFileIdByRouteAndMethod.get(`${clientCall.routeId}:GET`);

      edges.push(
        createEdge({
          kind: 'api_client_to_route',
          strength: 'medium',
          confidence: 'medium',
          exactness: 'inferred',
          fromSymbolId: owner?.symbolId,
          fromFileId: clientCall.clientFileId,
          toFileId: routeFileId,
          metadata: {
            routeId: clientCall.routeId,
            routeFileId,
            httpMethod: clientCall.method,
            source: 'api_propagation',
            line: clientCall.line,
          },
        }),
      );
    }

    for (const propagatedClient of apiPropagation.propagatedClients) {
      const owner = pickOwningSymbol(symbolsByFileId.get(propagatedClient.clientFileId) ?? [], propagatedClient.line);

      edges.push(
        createEdge({
          kind: 'api_propagation',
          strength: 'medium',
          confidence: 'medium',
          exactness: 'inferred',
          fromSymbolId: owner?.symbolId,
          fromFileId: propagatedClient.clientFileId,
          toSymbolId: target.symbolId,
          toFileId: target.fileId,
          metadata: {
            routeId: propagatedClient.routeId,
            routeFileId: propagatedClient.routeFileId,
            routeFilePath: propagatedClient.routeFilePath,
            httpMethod: propagatedClient.method,
            handlerName: propagatedClient.handlerName,
            source: 'api_propagation',
            line: propagatedClient.line,
          },
        }),
      );
    }
  }

  return {
    schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion: index.schemaVersion,
    generatedAt: new Date().toISOString(),
    edges: dedupeEdges(edges),
  };
}
