import fs from 'node:fs/promises';
import path from 'node:path';

import {
  getGenerationArtifactFilePath,
  resolveArtifactFilePath,
  resolveArtifactFilePathSync,
} from '../indexing/generation-store.js';
import { getProductEnvironment } from '../product/environment.js';
import { CODE_GRAPH_SCHEMA_VERSION, type CodeGraphSnapshot, type GraphEdge, type GraphEdgeType } from './types.js';

function getCodeGraphDirectory(): string {
  return getProductEnvironment().paths.dataDir;
}

function getCodeGraphTempFilePath(): string {
  return path.join(getCodeGraphDirectory(), 'code-graph.tmp.json');
}

function getCodeGraphFilePathInternal(): string {
  return path.join(getCodeGraphDirectory(), 'code-graph.json');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isGraphEdgeType(value: unknown): value is GraphEdgeType {
  return (
    value === 'repo_contains_file' ||
    value === 'file_defines_symbol' ||
    value === 'file_exports_symbol' ||
    value === 'file_imports_file' ||
    value === 'file_reexports_file'
  );
}

function isGraphEdge(value: unknown): value is GraphEdge {
  return (
    isObject(value) &&
    typeof value.edgeId === 'string' &&
    isGraphEdgeType(value.type) &&
    typeof value.fromId === 'string' &&
    typeof value.toId === 'string' &&
    (value.metadata === undefined || isObject(value.metadata))
  );
}

function createEmptyGraphSnapshot(): CodeGraphSnapshot {
  return {
    schemaVersion: CODE_GRAPH_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion: 0,
    generatedAt: '',
    nodes: {
      repos: Object.create(null) as CodeGraphSnapshot['nodes']['repos'],
      files: Object.create(null) as CodeGraphSnapshot['nodes']['files'],
      symbols: Object.create(null) as CodeGraphSnapshot['nodes']['symbols'],
    },
    edges: [],
  };
}

function normalizeGraphSnapshot(value: unknown): CodeGraphSnapshot {
  if (!isObject(value)) {
    return createEmptyGraphSnapshot();
  }

  const repos = isObject(value.nodes) && isObject(value.nodes.repos)
    ? (value.nodes.repos as CodeGraphSnapshot['nodes']['repos'])
    : Object.create(null);
  const files = isObject(value.nodes) && isObject(value.nodes.files)
    ? (value.nodes.files as CodeGraphSnapshot['nodes']['files'])
    : Object.create(null);
  const symbols = isObject(value.nodes) && isObject(value.nodes.symbols)
    ? (value.nodes.symbols as CodeGraphSnapshot['nodes']['symbols'])
    : Object.create(null);
  const edges = Array.isArray(value.edges)
    ? value.edges.filter((edge): edge is GraphEdge => isGraphEdge(edge))
    : [];

  return {
    schemaVersion:
      typeof value.schemaVersion === 'number' && Number.isInteger(value.schemaVersion)
        ? value.schemaVersion
        : CODE_GRAPH_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion:
      typeof value.sourceSymbolIndexSchemaVersion === 'number' &&
      Number.isInteger(value.sourceSymbolIndexSchemaVersion)
        ? value.sourceSymbolIndexSchemaVersion
        : 0,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
    nodes: {
      repos,
      files,
      symbols,
    },
    edges,
  };
}

export async function loadCodeGraph(): Promise<CodeGraphSnapshot> {
  try {
    const content = await fs.readFile(await resolveArtifactFilePath('code-graph.json'), 'utf8');
    return normalizeGraphSnapshot(JSON.parse(content) as unknown);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return createEmptyGraphSnapshot();
    }

    throw error;
  }
}

export async function saveCodeGraph(
  graph: CodeGraphSnapshot,
  options: { generationId?: string } = {},
): Promise<string> {
  const directory = getCodeGraphDirectory();
  const tempFilePath = getCodeGraphTempFilePath();
  const filePath = options.generationId
    ? getGenerationArtifactFilePath(options.generationId, 'code-graph.json')
    : getCodeGraphFilePathInternal();

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

export function getCodeGraphFilePath(): string {
  return resolveArtifactFilePathSync('code-graph.json');
}
