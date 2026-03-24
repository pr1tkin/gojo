import fs from 'node:fs/promises';
import path from 'node:path';

import {
  getIndexesDirectory,
  getTempDirectory,
  getGenerationArtifactFilePath,
  resolveArtifactFilePath,
  resolveArtifactFilePathSync,
} from '../indexing/generation-store.js';
import { traceHotspot } from '../instrumentation/trace.js';
import { CODE_GRAPH_SCHEMA_VERSION, type CodeGraphSnapshot, type GraphEdge, type GraphEdgeType } from './types.js';

function getCodeGraphDirectory(): string {
  return getIndexesDirectory();
}

function getCodeGraphTempFilePath(): string {
  return path.join(getTempDirectory(), 'code-graph.tmp.json');
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

let cachedGraphPath: string | null = null;
let cachedGraphValue: CodeGraphSnapshot | null = null;
let cachedGraphPromise: Promise<CodeGraphSnapshot> | null = null;
let cachedGraphSignature: string | null = null;

async function getFileSignature(filePath: string): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return 'missing';
    }

    throw error;
  }
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
  const filePath = await resolveArtifactFilePath('code-graph.json');
  const fileSignature = await getFileSignature(filePath);

  if (cachedGraphPath === filePath && cachedGraphSignature === fileSignature && cachedGraphValue) {
    traceHotspot('code_graph', 'cache_hit', { filePath });
    return cachedGraphValue;
  }

  if (cachedGraphPath === filePath && cachedGraphSignature === fileSignature && cachedGraphPromise) {
    traceHotspot('code_graph', 'cache_wait', { filePath });
    return cachedGraphPromise;
  }

  cachedGraphPath = filePath;
  cachedGraphSignature = fileSignature;
  cachedGraphPromise = (async () => {
    try {
      const started = process.hrtime.bigint();
      const content = await fs.readFile(filePath, 'utf8');
      const graph = normalizeGraphSnapshot(JSON.parse(content) as unknown);
      cachedGraphValue = graph;
      traceHotspot('code_graph', 'load', {
        filePath,
        ms: Number(process.hrtime.bigint() - started) / 1_000_000,
        files: Object.keys(graph.nodes.files).length,
        symbols: Object.keys(graph.nodes.symbols).length,
        edges: graph.edges.length,
      });
      return graph;
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: string }).code)
          : '';

      if (code === 'ENOENT') {
        const empty = createEmptyGraphSnapshot();
        cachedGraphValue = empty;
        return empty;
      }

      cachedGraphPath = null;
      throw error;
    } finally {
      cachedGraphPromise = null;
    }
  })();

  return cachedGraphPromise;
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

  if (cachedGraphPath === filePath) {
    cachedGraphValue = graph;
    cachedGraphSignature = await getFileSignature(filePath);
  }

  return filePath;
}

export function getCodeGraphFilePath(): string {
  return resolveArtifactFilePathSync('code-graph.json');
}
