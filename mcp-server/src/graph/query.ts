import { loadCodeGraph } from './store.js';
import type { CodeGraphSnapshot, GraphEdge, GraphEdgeType } from './types.js';

export async function getGraph(): Promise<CodeGraphSnapshot> {
  return loadCodeGraph();
}

export async function getFileNode(fileId: string): Promise<CodeGraphSnapshot['nodes']['files'][string] | null> {
  const graph = await loadCodeGraph();
  return graph.nodes.files[fileId] ?? null;
}

export async function getSymbolNode(symbolId: string): Promise<CodeGraphSnapshot['nodes']['symbols'][string] | null> {
  const graph = await loadCodeGraph();
  return graph.nodes.symbols[symbolId] ?? null;
}

export async function getOutgoingEdges(nodeId: string, edgeType?: GraphEdgeType): Promise<GraphEdge[]> {
  const graph = await loadCodeGraph();
  return graph.edges.filter((edge) => edge.fromId === nodeId && (!edgeType || edge.type === edgeType));
}

export async function getIncomingEdges(nodeId: string, edgeType?: GraphEdgeType): Promise<GraphEdge[]> {
  const graph = await loadCodeGraph();
  return graph.edges.filter((edge) => edge.toId === nodeId && (!edgeType || edge.type === edgeType));
}
