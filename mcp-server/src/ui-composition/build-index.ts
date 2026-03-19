import fs from 'node:fs/promises';
import path from 'node:path';
import type Parser from 'tree-sitter';

import { listRepositories } from '../repositories.js';
import { loadRepoResolutionConfigs, type RepoResolutionConfig } from '../graph/repo-config.js';
import { collectRepositorySourceFiles } from '../symbol-index/build-index.js';
import { createFileId } from '../symbol-index/ids.js';
import type { IndexedSymbol, SymbolIndex } from '../symbol-index/types.js';
import { parseTypeScriptSource } from '../tree-sitter.js';
import {
  UI_COMPOSITION_SCHEMA_VERSION,
  type UiCompositionEdge,
  type UiCompositionIndex,
} from './types.js';
import {
  extractChildComponentCandidate,
  isJsxLikeFile,
  resolveChildComponent,
  resolveParentSymbol,
  walkJsxNodes,
} from './shared.js';

function createEdge(
  relation: SymbolIndex['byFile'][string],
  fileSymbols: IndexedSymbol[],
  node: Parser.SyntaxNode,
  source: string,
  index: SymbolIndex,
  repoConfigById: Record<string, RepoResolutionConfig>,
): UiCompositionEdge | null {
  const childCandidate = extractChildComponentCandidate(node, source);

  if (!childCandidate) {
    return null;
  }

  const parent = resolveParentSymbol(fileSymbols, node.startPosition.row + 1);
  const resolvedChild = resolveChildComponent(
    relation,
    childCandidate,
    index,
    fileSymbols,
    repoConfigById,
  );

  return {
    parentFilePath: relation.filePath,
    parentSymbolId: parent.parentSymbolId,
    parentSymbolName: parent.parentSymbolName,
    childComponentName: childCandidate.name,
    childFilePath: resolvedChild.childFilePath,
    childSymbolId: resolvedChild.childSymbolId,
    resolution: resolvedChild.resolution,
    source: 'jsx',
    confidence: resolvedChild.confidence,
    note: resolvedChild.note,
    hint: resolvedChild.hint,
    dependencySource: resolvedChild.dependencySource,
    memberExpression: resolvedChild.memberExpression,
  };
}

function dedupeEdges(edges: UiCompositionEdge[]): UiCompositionEdge[] {
  const seen = new Set<string>();
  const deduped: UiCompositionEdge[] = [];

  for (const edge of edges) {
      const key = [
      edge.parentFilePath,
      edge.parentSymbolId ?? '',
      edge.childComponentName,
      edge.childFilePath ?? '',
      edge.childSymbolId ?? '',
      edge.memberExpression?.expression ?? '',
      edge.memberExpression?.resolutionKind ?? '',
    ].join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(edge);
  }

  return deduped;
}

export async function buildUiCompositionIndex(
  reposRoot: string,
  index: SymbolIndex,
  options: { repoConfigById?: Record<string, RepoResolutionConfig> } = {},
): Promise<UiCompositionIndex> {
  const repositories = await listRepositories(reposRoot);
  const repoConfigById =
    options.repoConfigById ??
    (await loadRepoResolutionConfigs(
      Object.fromEntries(repositories.map((repository) => [repository.id, repository.rootPath])),
    ));
  const edges: UiCompositionEdge[] = [];

  for (const repository of repositories) {
    const files = (await collectRepositorySourceFiles(repository.rootPath, repository.id)).filter(isJsxLikeFile);

    for (const filePath of files) {
      const relation = index.byFile[createFileId(repository.id, filePath)];

      if (!relation) {
        continue;
      }

      const absolutePath = path.join(repository.rootPath, filePath);
      const source = await fs.readFile(absolutePath, 'utf8');
      const tree = parseTypeScriptSource(filePath, source);
      const fileSymbols = index.symbols.filter((symbol) => symbol.fileId === relation.fileId);

      walkJsxNodes(tree.rootNode, (node) => {
        const edge = createEdge(relation, fileSymbols, node, source, index, repoConfigById);

        if (edge) {
          edges.push(edge);
        }
      });
    }
  }

  return {
    schemaVersion: UI_COMPOSITION_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion: index.schemaVersion,
    generatedAt: new Date().toISOString(),
    edges: dedupeEdges(edges).sort((left, right) => {
      const leftKey = `${left.parentFilePath}:${left.parentSymbolName ?? ''}:${left.childComponentName}`;
      const rightKey = `${right.parentFilePath}:${right.parentSymbolName ?? ''}:${right.childComponentName}`;
      return leftKey.localeCompare(rightKey);
    }),
  };
}
