import path from 'node:path';

import { loadRequiredSymbolIndex } from '../symbol-index/store.js';
import type { ExportRecord, FileRelation, ImportRecord, SymbolIndex } from '../symbol-index/types.js';
import {
  CODE_GRAPH_SCHEMA_VERSION,
  type CodeGraphSnapshot,
  type FileNode,
  type GraphEdge,
  type GraphEdgeType,
  type RepoNode,
  type SymbolNode,
} from './types.js';

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function createRepoNode(repoId: string): RepoNode {
  return {
    nodeType: 'repo',
    repoId,
    name: repoId,
  };
}

function createFileNode(relation: FileRelation): FileNode {
  return {
    nodeType: 'file',
    fileId: relation.fileId,
    repoId: relation.repo,
    filePath: relation.filePath,
    classification: relation.classification,
  };
}

function createSymbolNode(symbol: SymbolIndex['symbols'][number]): SymbolNode {
  return {
    nodeType: 'symbol',
    symbolId: symbol.symbolId,
    fileId: symbol.fileId,
    repoId: symbol.repo,
    filePath: symbol.filePath,
    name: symbol.name,
    kind: symbol.kind,
    exported: Boolean(symbol.exported),
    declarationFingerprint: symbol.declarationFingerprint,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
  };
}

function createEdgeId(type: GraphEdgeType, fromId: string, toId: string, discriminator?: string): string {
  return discriminator ? `${type}:${fromId}:${toId}:${discriminator}` : `${type}:${fromId}:${toId}`;
}

function createEdge(
  type: GraphEdgeType,
  fromId: string,
  toId: string,
  metadata?: GraphEdge['metadata'],
  discriminator?: string,
): GraphEdge {
  return {
    edgeId: createEdgeId(type, fromId, toId, discriminator),
    type,
    fromId,
    toId,
    metadata,
  };
}

function resolveRelativeTargetFileId(
  relation: FileRelation,
  source: string,
  filesById: Record<string, FileRelation>,
): string | null {
  if (!source.startsWith('.')) {
    return null;
  }

  const baseDirectory = path.posix.dirname(normalizePath(relation.filePath));
  const normalizedBase =
    baseDirectory === '.' ? '' : baseDirectory;
  const resolvedBase = normalizePath(path.posix.normalize(path.posix.join(normalizedBase, source)));
  const candidates = new Set<string>();

  const candidatePaths = source.endsWith('.ts') || source.endsWith('.tsx')
    ? [resolvedBase]
    : [
        resolvedBase,
        `${resolvedBase}.ts`,
        `${resolvedBase}.tsx`,
        path.posix.join(resolvedBase, 'index.ts'),
        path.posix.join(resolvedBase, 'index.tsx'),
      ];

  for (const candidatePath of candidatePaths) {
    const normalizedCandidate = normalizePath(candidatePath).replace(/^\/+/, '');

    for (const fileRelation of Object.values(filesById)) {
      if (fileRelation.repo !== relation.repo) {
        continue;
      }

      if (normalizePath(fileRelation.filePath) === normalizedCandidate) {
        candidates.add(fileRelation.fileId);
      }
    }
  }

  return candidates.size === 1 ? Array.from(candidates)[0] : null;
}

function maybeCreateFileImportEdge(
  relation: FileRelation,
  importRecord: ImportRecord,
  filesById: Record<string, FileRelation>,
): GraphEdge | null {
  const targetFileId = resolveRelativeTargetFileId(relation, importRecord.source, filesById);

  if (!targetFileId) {
    return null;
  }

  return createEdge(
    'file_imports_file',
    relation.fileId,
    targetFileId,
    { source: importRecord.source },
    importRecord.source,
  );
}

function maybeCreateFileReexportEdge(
  relation: FileRelation,
  exportRecord: ExportRecord,
  filesById: Record<string, FileRelation>,
): GraphEdge | null {
  if (!exportRecord.source) {
    return null;
  }

  const targetFileId = resolveRelativeTargetFileId(relation, exportRecord.source, filesById);

  if (!targetFileId) {
    return null;
  }

  return createEdge(
    'file_reexports_file',
    relation.fileId,
    targetFileId,
    {
      source: exportRecord.source,
      exportedName: exportRecord.exportedName,
      localName: exportRecord.localName,
    },
    `${exportRecord.source}:${exportRecord.exportedName ?? '*'}`,
  );
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const deduped: GraphEdge[] = [];

  for (const edge of edges) {
    if (seen.has(edge.edgeId)) {
      continue;
    }

    seen.add(edge.edgeId);
    deduped.push(edge);
  }

  return deduped;
}

export function buildCodeGraphFromSymbolIndex(index: SymbolIndex): CodeGraphSnapshot {
  const repos: CodeGraphSnapshot['nodes']['repos'] = Object.create(null);
  const files: CodeGraphSnapshot['nodes']['files'] = Object.create(null);
  const symbols: CodeGraphSnapshot['nodes']['symbols'] = Object.create(null);
  const edges: GraphEdge[] = [];

  for (const relation of Object.values(index.byFile)) {
    if (!repos[relation.repo]) {
      repos[relation.repo] = createRepoNode(relation.repo);
    }

    files[relation.fileId] = createFileNode(relation);
    edges.push(createEdge('repo_contains_file', relation.repo, relation.fileId));
  }

  for (const symbol of index.symbols) {
    symbols[symbol.symbolId] = createSymbolNode(symbol);
    edges.push(createEdge('file_defines_symbol', symbol.fileId, symbol.symbolId));
  }

  for (const relation of Object.values(index.byFile)) {
    for (const exportRecord of relation.exports) {
      if (exportRecord.symbolId && symbols[exportRecord.symbolId]) {
        edges.push(
          createEdge(
            'file_exports_symbol',
            relation.fileId,
            exportRecord.symbolId,
            {
              symbolId: exportRecord.symbolId,
              exportedName: exportRecord.exportedName,
              localName: exportRecord.localName,
            },
            exportRecord.symbolId,
          ),
        );
      }
    }

    for (const importRecord of relation.imports) {
      const edge = maybeCreateFileImportEdge(relation, importRecord, index.byFile);

      if (edge) {
        edges.push(edge);
      }
    }

    for (const exportRecord of relation.exports) {
      const edge = maybeCreateFileReexportEdge(relation, exportRecord, index.byFile);

      if (edge) {
        edges.push(edge);
      }
    }
  }

  return {
    schemaVersion: CODE_GRAPH_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion: index.schemaVersion,
    generatedAt: new Date().toISOString(),
    nodes: {
      repos,
      files,
      symbols,
    },
    edges: dedupeEdges(edges),
  };
}

export async function buildCodeGraph(): Promise<CodeGraphSnapshot> {
  const index = await loadRequiredSymbolIndex();
  return buildCodeGraphFromSymbolIndex(index);
}
