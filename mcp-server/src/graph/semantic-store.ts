import fs from 'node:fs/promises';
import path from 'node:path';

import {
  getGenerationArtifactFilePath,
  getIndexesDirectory,
  getTempDirectory,
  resolveArtifactFilePath,
  resolveArtifactFilePathSync,
} from '../indexing/generation-store.js';
import {
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  type SemanticEdgeConfidence,
  type SemanticEdgeExactness,
  type SemanticEdgeKind,
  type SemanticEdgeStrength,
  type SemanticGraphEdge,
  type SemanticGraphSnapshot,
} from './semantic-types.js';

function getSemanticGraphDirectory(): string {
  return getIndexesDirectory();
}

function getSemanticGraphTempFilePath(): string {
  return path.join(getTempDirectory(), 'semantic-graph.tmp.json');
}

function getSemanticGraphFilePathInternal(): string {
  return path.join(getSemanticGraphDirectory(), 'semantic-graph.json');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEdgeKind(value: unknown): value is SemanticEdgeKind {
  return (
    value === 'symbol_call' ||
    value === 'symbol_reference' ||
    value === 'jsx_reference' ||
    value === 'type_reference' ||
    value === 'api_route_handler' ||
    value === 'api_client_to_route' ||
    value === 'api_propagation'
  );
}

function isStrength(value: unknown): value is SemanticEdgeStrength {
  return value === 'strong' || value === 'medium' || value === 'weak';
}

function isConfidence(value: unknown): value is SemanticEdgeConfidence {
  return value === 'high' || value === 'medium' || value === 'low';
}

function isExactness(value: unknown): value is SemanticEdgeExactness {
  return value === 'exact' || value === 'inferred' || value === 'exploratory';
}

function isSemanticGraphEdge(value: unknown): value is SemanticGraphEdge {
  return (
    isObject(value) &&
    typeof value.edgeId === 'string' &&
    isEdgeKind(value.kind) &&
    isStrength(value.strength) &&
    isConfidence(value.confidence) &&
    isExactness(value.exactness) &&
    (value.fromSymbolId === undefined || typeof value.fromSymbolId === 'string') &&
    (value.fromFileId === undefined || typeof value.fromFileId === 'string') &&
    (value.toSymbolId === undefined || typeof value.toSymbolId === 'string') &&
    (value.toFileId === undefined || typeof value.toFileId === 'string') &&
    (value.metadata === undefined || isObject(value.metadata))
  );
}

function createEmptySemanticGraphSnapshot(): SemanticGraphSnapshot {
  return {
    schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion: 0,
    generatedAt: '',
    edges: [],
  };
}

function normalizeSemanticGraphSnapshot(value: unknown): SemanticGraphSnapshot {
  if (!isObject(value)) {
    return createEmptySemanticGraphSnapshot();
  }

  return {
    schemaVersion:
      typeof value.schemaVersion === 'number' && Number.isInteger(value.schemaVersion)
        ? value.schemaVersion
        : SEMANTIC_GRAPH_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion:
      typeof value.sourceSymbolIndexSchemaVersion === 'number' && Number.isInteger(value.sourceSymbolIndexSchemaVersion)
        ? value.sourceSymbolIndexSchemaVersion
        : 0,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
    edges: Array.isArray(value.edges)
      ? value.edges.filter((edge): edge is SemanticGraphEdge => isSemanticGraphEdge(edge))
      : [],
  };
}

export async function loadSemanticGraph(): Promise<SemanticGraphSnapshot> {
  try {
    const content = await fs.readFile(await resolveArtifactFilePath('semantic-graph.json'), 'utf8');
    return normalizeSemanticGraphSnapshot(JSON.parse(content) as unknown);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return createEmptySemanticGraphSnapshot();
    }

    throw error;
  }
}

export async function saveSemanticGraph(
  graph: SemanticGraphSnapshot,
  options: { generationId?: string } = {},
): Promise<string> {
  const directory = getSemanticGraphDirectory();
  const tempFilePath = getSemanticGraphTempFilePath();
  const filePath = options.generationId
    ? getGenerationArtifactFilePath(options.generationId, 'semantic-graph.json')
    : getSemanticGraphFilePathInternal();

  if (options.generationId) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(graph, null, 2), 'utf8');
  } else {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(tempFilePath, JSON.stringify(graph, null, 2), 'utf8');
    await fs.rename(tempFilePath, filePath);
  }

  return filePath;
}

export function getSemanticGraphFilePath(): string {
  return resolveArtifactFilePathSync('semantic-graph.json');
}
