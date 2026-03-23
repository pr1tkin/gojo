import { loadCodeGraph } from './store.js';
import type { CodeGraphSnapshot, FileNode, GraphEdge, GraphEdgeType, RepoNode, SymbolNode } from './types.js';

export interface RelatedFileResult {
  file: FileNode;
  via: string;
}

function getEdgeMatches(
  graph: CodeGraphSnapshot,
  nodeId: string,
  direction: 'incoming' | 'outgoing',
  edgeType?: GraphEdgeType,
): GraphEdge[] {
  return graph.edges.filter((edge) => {
    const matchesDirection = direction === 'outgoing' ? edge.fromId === nodeId : edge.toId === nodeId;
    return matchesDirection && (!edgeType || edge.type === edgeType);
  });
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
          via: `outgoing_${edge.type}`,
        });
      }
    }

    for (const edge of getEdgeMatches(graph, fileId, 'incoming', edgeType)) {
      const source = graph.nodes.files[edge.fromId];

      if (source) {
        relatedFiles.push({
          file: source,
          via: `incoming_${edge.type}`,
        });
      }
    }
  }

  return dedupeRelatedFiles(relatedFiles);
}
