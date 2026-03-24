import { loadCodeGraph } from './store.js';
import { loadSemanticGraph } from './semantic-store.js';
import type { SemanticEdgeExactness, SemanticGraphEdge } from './semantic-types.js';
import type { CodeGraphSnapshot, FileNode, GraphEdge, GraphEdgeType, RepoNode, SymbolNode } from './types.js';

export interface RelatedFileResult {
  file: FileNode;
  via: string;
  direction?: 'incoming' | 'outgoing';
}

export interface SemanticEdgeResult {
  edge: SemanticGraphEdge;
  fromFile: FileNode | null;
  fromSymbol: SymbolNode | null;
  toFile: FileNode | null;
  toSymbol: SymbolNode | null;
}

interface GraphLookupIndex {
  incomingByNodeId: Map<string, GraphEdge[]>;
  outgoingByNodeId: Map<string, GraphEdge[]>;
}

interface SemanticLookupIndex {
  incomingBySymbolId: Map<string, SemanticGraphEdge[]>;
  outgoingBySymbolId: Map<string, SemanticGraphEdge[]>;
}

const graphLookupIndexCache = new WeakMap<CodeGraphSnapshot, GraphLookupIndex>();
const semanticLookupIndexCache = new WeakMap<object, SemanticLookupIndex>();

function buildGraphLookupIndex(graph: CodeGraphSnapshot): GraphLookupIndex {
  const cached = graphLookupIndexCache.get(graph);

  if (cached) {
    return cached;
  }

  const incomingByNodeId = new Map<string, GraphEdge[]>();
  const outgoingByNodeId = new Map<string, GraphEdge[]>();

  for (const edge of graph.edges) {
    const outgoing = outgoingByNodeId.get(edge.fromId) ?? [];
    outgoing.push(edge);
    outgoingByNodeId.set(edge.fromId, outgoing);

    const incoming = incomingByNodeId.get(edge.toId) ?? [];
    incoming.push(edge);
    incomingByNodeId.set(edge.toId, incoming);
  }

  const index = {
    incomingByNodeId,
    outgoingByNodeId,
  };
  graphLookupIndexCache.set(graph, index);
  return index;
}

function buildSemanticLookupIndex(graph: { edges: SemanticGraphEdge[] }): SemanticLookupIndex {
  const cached = semanticLookupIndexCache.get(graph);

  if (cached) {
    return cached;
  }

  const incomingBySymbolId = new Map<string, SemanticGraphEdge[]>();
  const outgoingBySymbolId = new Map<string, SemanticGraphEdge[]>();

  for (const edge of graph.edges) {
    if (edge.toSymbolId) {
      const incoming = incomingBySymbolId.get(edge.toSymbolId) ?? [];
      incoming.push(edge);
      incomingBySymbolId.set(edge.toSymbolId, incoming);
    }

    if (edge.fromSymbolId) {
      const outgoing = outgoingBySymbolId.get(edge.fromSymbolId) ?? [];
      outgoing.push(edge);
      outgoingBySymbolId.set(edge.fromSymbolId, outgoing);
    }
  }

  const index = {
    incomingBySymbolId,
    outgoingBySymbolId,
  };
  semanticLookupIndexCache.set(graph, index);
  return index;
}

function getEdgeMatches(
  graph: CodeGraphSnapshot,
  nodeId: string,
  direction: 'incoming' | 'outgoing',
  edgeType?: GraphEdgeType,
): GraphEdge[] {
  const index = buildGraphLookupIndex(graph);
  const edges =
    direction === 'outgoing'
      ? index.outgoingByNodeId.get(nodeId) ?? []
      : index.incomingByNodeId.get(nodeId) ?? [];

  if (!edgeType) {
    return edges;
  }

  return edges.filter((edge) => edge.type === edgeType);
}

function mapEdgesToFileNodes(
  graph: CodeGraphSnapshot,
  edges: GraphEdge[],
  direction: 'incoming' | 'outgoing',
): FileNode[] {
  const seen = new Set<string>();
  const results: FileNode[] = [];

  for (const edge of edges) {
    const nodeId = direction === 'outgoing' ? edge.toId : edge.fromId;
    const fileNode = graph.nodes.files[nodeId];

    if (!fileNode || seen.has(fileNode.fileId)) {
      continue;
    }

    seen.add(fileNode.fileId);
    results.push(fileNode);
  }

  return results;
}

function mapEdgesToSymbolNodes(
  graph: CodeGraphSnapshot,
  edges: GraphEdge[],
  direction: 'incoming' | 'outgoing',
): SymbolNode[] {
  const seen = new Set<string>();
  const results: SymbolNode[] = [];

  for (const edge of edges) {
    const nodeId = direction === 'outgoing' ? edge.toId : edge.fromId;
    const symbolNode = graph.nodes.symbols[nodeId];

    if (!symbolNode || seen.has(symbolNode.symbolId)) {
      continue;
    }

    seen.add(symbolNode.symbolId);
    results.push(symbolNode);
  }

  return results;
}

function dedupeRelatedFiles(results: RelatedFileResult[]): RelatedFileResult[] {
  const seen = new Set<string>();
  const deduped: RelatedFileResult[] = [];

  for (const result of results) {
    const key = `${result.file.fileId}:${result.via}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

export async function getGraph(): Promise<CodeGraphSnapshot> {
  return loadCodeGraph();
}

export async function getSemanticGraph() {
  return loadSemanticGraph();
}

export async function getFileNode(fileId: string): Promise<FileNode | null> {
  const graph = await loadCodeGraph();
  return graph.nodes.files[fileId] ?? null;
}

export async function getSymbolNode(symbolId: string): Promise<SymbolNode | null> {
  const graph = await loadCodeGraph();
  return graph.nodes.symbols[symbolId] ?? null;
}

export async function getOutgoingEdges(nodeId: string, edgeType?: GraphEdgeType): Promise<GraphEdge[]> {
  const graph = await loadCodeGraph();
  return getEdgeMatches(graph, nodeId, 'outgoing', edgeType);
}

export async function getIncomingEdges(nodeId: string, edgeType?: GraphEdgeType): Promise<GraphEdge[]> {
  const graph = await loadCodeGraph();
  return getEdgeMatches(graph, nodeId, 'incoming', edgeType);
}

export async function getImportedFiles(fileId: string): Promise<FileNode[]> {
  const graph = await loadCodeGraph();
  return mapEdgesToFileNodes(graph, getEdgeMatches(graph, fileId, 'outgoing', 'file_imports_file'), 'outgoing');
}

export async function getReexportedFiles(fileId: string): Promise<FileNode[]> {
  const graph = await loadCodeGraph();
  return mapEdgesToFileNodes(graph, getEdgeMatches(graph, fileId, 'outgoing', 'file_reexports_file'), 'outgoing');
}

export async function getImportingFiles(fileId: string): Promise<FileNode[]> {
  const graph = await loadCodeGraph();
  return mapEdgesToFileNodes(graph, getEdgeMatches(graph, fileId, 'incoming', 'file_imports_file'), 'incoming');
}

export async function getReexportingFiles(fileId: string): Promise<FileNode[]> {
  const graph = await loadCodeGraph();
  return mapEdgesToFileNodes(graph, getEdgeMatches(graph, fileId, 'incoming', 'file_reexports_file'), 'incoming');
}

export async function getNeighboringFiles(fileId: string): Promise<FileNode[]> {
  const graph = await loadCodeGraph();
  const seen = new Set<string>();
  const results: FileNode[] = [];
  const outgoingFileEdges = [
    ...getEdgeMatches(graph, fileId, 'outgoing', 'file_imports_file'),
    ...getEdgeMatches(graph, fileId, 'outgoing', 'file_reexports_file'),
  ];
  const incomingFileEdges = [
    ...getEdgeMatches(graph, fileId, 'incoming', 'file_imports_file'),
    ...getEdgeMatches(graph, fileId, 'incoming', 'file_reexports_file'),
  ];

  for (const fileNode of [
    ...mapEdgesToFileNodes(graph, outgoingFileEdges, 'outgoing'),
    ...mapEdgesToFileNodes(graph, incomingFileEdges, 'incoming'),
  ]) {
    if (seen.has(fileNode.fileId)) {
      continue;
    }

    seen.add(fileNode.fileId);
    results.push(fileNode);
  }

  return results;
}

export async function getDefinedSymbols(fileId: string): Promise<SymbolNode[]> {
  const graph = await loadCodeGraph();
  return mapEdgesToSymbolNodes(graph, getEdgeMatches(graph, fileId, 'outgoing', 'file_defines_symbol'), 'outgoing');
}

export async function getExportedSymbols(fileId: string): Promise<SymbolNode[]> {
  const graph = await loadCodeGraph();
  return mapEdgesToSymbolNodes(graph, getEdgeMatches(graph, fileId, 'outgoing', 'file_exports_symbol'), 'outgoing');
}

export async function getSymbolFile(symbolId: string): Promise<FileNode | null> {
  const graph = await loadCodeGraph();
  const incoming = getEdgeMatches(graph, symbolId, 'incoming', 'file_defines_symbol');
  const fileNode = incoming.length > 0 ? graph.nodes.files[incoming[0].fromId] : null;
  return fileNode ?? null;
}

export async function getRepoFiles(repoId: string): Promise<FileNode[]> {
  const graph = await loadCodeGraph();
  return Object.values(graph.nodes.files).filter((fileNode) => fileNode.repoId === repoId);
}

export async function getFileRepo(fileId: string): Promise<RepoNode | null> {
  const graph = await loadCodeGraph();
  const fileNode = graph.nodes.files[fileId];

  if (!fileNode) {
    return null;
  }

  return graph.nodes.repos[fileNode.repoId] ?? null;
}

export async function getRelatedFiles(fileId: string): Promise<RelatedFileResult[]> {
  const graph = await loadCodeGraph();
  const fileNode = graph.nodes.files[fileId];

  if (!fileNode) {
    return [];
  }

  const relatedFiles: RelatedFileResult[] = [];

  for (const edgeType of ['file_imports_file', 'file_reexports_file'] as const) {
    for (const edge of getEdgeMatches(graph, fileId, 'outgoing', edgeType)) {
      const target = graph.nodes.files[edge.toId];

      if (target) {
        relatedFiles.push({
          file: target,
          via: edge.type,
          direction: 'outgoing',
        });
      }
    }

    for (const edge of getEdgeMatches(graph, fileId, 'incoming', edgeType)) {
      const source = graph.nodes.files[edge.fromId];

      if (source) {
        relatedFiles.push({
          file: source,
          via: edge.type,
          direction: 'incoming',
        });
      }
    }
  }

  return dedupeRelatedFiles(relatedFiles);
}

function matchesExactness(edge: SemanticGraphEdge, exactness: SemanticEdgeExactness | undefined): boolean {
  return exactness === undefined || edge.exactness === exactness;
}

function mapSemanticEdges(
  graph: CodeGraphSnapshot,
  edges: SemanticGraphEdge[],
): SemanticEdgeResult[] {
  return edges.map((edge) => ({
    edge,
    fromFile: edge.fromFileId ? graph.nodes.files[edge.fromFileId] ?? null : null,
    fromSymbol: edge.fromSymbolId ? graph.nodes.symbols[edge.fromSymbolId] ?? null : null,
    toFile: edge.toFileId ? graph.nodes.files[edge.toFileId] ?? null : null,
    toSymbol: edge.toSymbolId ? graph.nodes.symbols[edge.toSymbolId] ?? null : null,
  }));
}

export async function getIncomingSemanticEdgesForSymbol(
  symbolId: string,
  options: { exactness?: SemanticEdgeExactness } = {},
): Promise<SemanticEdgeResult[]> {
  const [semanticGraph, graph] = await Promise.all([loadSemanticGraph(), loadCodeGraph()]);
  const index = buildSemanticLookupIndex(semanticGraph);

  return mapSemanticEdges(
    graph,
    (index.incomingBySymbolId.get(symbolId) ?? []).filter((edge) => matchesExactness(edge, options.exactness)),
  );
}

export async function getOutgoingSemanticEdgesForSymbol(
  symbolId: string,
  options: { exactness?: SemanticEdgeExactness } = {},
): Promise<SemanticEdgeResult[]> {
  const [semanticGraph, graph] = await Promise.all([loadSemanticGraph(), loadCodeGraph()]);
  const index = buildSemanticLookupIndex(semanticGraph);

  return mapSemanticEdges(
    graph,
    (index.outgoingBySymbolId.get(symbolId) ?? []).filter((edge) => matchesExactness(edge, options.exactness)),
  );
}

export async function getSemanticConsumersForSymbol(
  symbolId: string,
  options: { exactness?: SemanticEdgeExactness } = {},
): Promise<SemanticEdgeResult[]> {
  return getIncomingSemanticEdgesForSymbol(symbolId, options);
}
