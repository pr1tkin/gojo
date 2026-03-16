import fs from 'node:fs/promises';
import path from 'node:path';
import type Parser from 'tree-sitter';

import { listRepositories } from '../repositories.js';
import { resolveLocalFileTarget } from '../graph/local-resolution.js';
import { loadRepoResolutionConfigs, type RepoResolutionConfig } from '../graph/repo-config.js';
import { collectRepositorySourceFiles } from '../symbol-index/build-index.js';
import { createFileId } from '../symbol-index/ids.js';
import type { IndexedSymbol, ImportBinding, ImportRecord, SymbolIndex } from '../symbol-index/types.js';
import { parseTypeScriptSource } from '../tree-sitter.js';
import {
  UI_COMPOSITION_SCHEMA_VERSION,
  type UiCompositionEdge,
  type UiCompositionIndex,
} from './types.js';

function isTsxFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.tsx';
}

function getNodeText(node: Parser.SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function isPascalCaseComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_$]*$/.test(name);
}

function extractChildComponentCandidate(
  node: Parser.SyntaxNode,
  source: string,
): { name: string; note?: string } | null {
  const nameNode = node.childForFieldName('name');

  if (!nameNode) {
    return null;
  }

  if (nameNode.type === 'identifier') {
    const name = getNodeText(nameNode, source);
    return isPascalCaseComponentName(name) ? { name } : null;
  }

  if (nameNode.type === 'member_expression') {
    const propertyNode = nameNode.namedChildren[nameNode.namedChildren.length - 1];

    if (!propertyNode) {
      return null;
    }

    const propertyName = getNodeText(propertyNode, source);

    if (!isPascalCaseComponentName(propertyName)) {
      return null;
    }

    return {
      name: propertyName,
      note: `jsx member expression ${getNodeText(nameNode, source)}`,
    };
  }

  return null;
}

function resolveParentSymbol(
  fileSymbols: IndexedSymbol[],
  line: number,
): Pick<UiCompositionEdge, 'parentSymbolId' | 'parentSymbolName'> {
  const containingSymbols = fileSymbols
    .filter((symbol) => symbol.startLine <= line && symbol.endLine >= line)
    .sort((left, right) => {
      const leftSpan = left.endLine - left.startLine;
      const rightSpan = right.endLine - right.startLine;

      if (leftSpan !== rightSpan) {
        return leftSpan - rightSpan;
      }

      return left.startLine - right.startLine;
    });

  const symbol = containingSymbols[0];

  if (!symbol) {
    return {};
  }

  return {
    parentSymbolId: symbol.symbolId,
    parentSymbolName: symbol.name,
  };
}

function resolveSameFileChildSymbol(
  fileSymbols: IndexedSymbol[],
  childComponentName: string,
): IndexedSymbol | null {
  const matches = fileSymbols.filter((symbol) => symbol.name === childComponentName);
  return matches.length === 1 ? matches[0] : null;
}

function resolveTargetFileId(
  relation: SymbolIndex['byFile'][string],
  importRecord: ImportRecord,
  filesById: SymbolIndex['byFile'],
  repoConfigById: Record<string, RepoResolutionConfig>,
): string | null {
  const resolution = resolveLocalFileTarget(
    relation,
    importRecord.source,
    filesById,
    repoConfigById[relation.repo],
  );

  return resolution.status === 'resolved' ? resolution.targetFileId ?? null : null;
}

function resolveImportedChildSymbol(
  relation: SymbolIndex['byFile'][string],
  childComponentName: string,
  index: SymbolIndex,
  repoConfigById: Record<string, RepoResolutionConfig>,
): Pick<UiCompositionEdge, 'childFilePath' | 'childSymbolId' | 'confidence' | 'note'> | null {
  for (const importRecord of relation.imports) {
    const binding = importRecord.bindings.find(
      (candidate) => candidate.localName === childComponentName,
    );

    if (!binding || binding.kind === 'namespace' || binding.isTypeOnly) {
      continue;
    }

    const targetFileId = resolveTargetFileId(relation, importRecord, index.byFile, repoConfigById);

    if (!targetFileId) {
      continue;
    }

    const targetRelation = index.byFile[targetFileId];

    if (!targetRelation) {
      continue;
    }

    const resolved = resolveImportedBinding(targetRelation, binding);

    return {
      childFilePath: targetRelation.filePath,
      childSymbolId: resolved?.symbolId,
      confidence: resolved?.symbolId ? 'high' : 'medium',
      note: resolved?.note ?? `resolved from import ${importRecord.source}`,
    };
  }

  return null;
}

function resolveImportedBinding(
  targetRelation: SymbolIndex['byFile'][string],
  binding: ImportBinding,
): { symbolId?: string; note: string } | null {
  if (binding.kind === 'default') {
    const defaultExport = targetRelation.exports.find((entry) => entry.kind === 'default');

    if (!defaultExport) {
      return {
        note: 'resolved imported default component file',
      };
    }

    return {
      symbolId: defaultExport.symbolId,
      note: defaultExport.symbolId
        ? 'resolved imported default component symbol'
        : 'resolved imported default component file',
    };
  }

  if (binding.kind === 'named' && binding.importedName) {
    const namedExport = targetRelation.exports.find(
      (entry) => entry.exportedName === binding.importedName && entry.kind === 'named',
    );

    if (!namedExport) {
      return {
        note: `resolved imported component file for ${binding.importedName}`,
      };
    }

    return {
      symbolId: namedExport.symbolId,
      note: namedExport.symbolId
        ? `resolved imported symbol ${binding.importedName}`
        : `resolved imported component file for ${binding.importedName}`,
    };
  }

  return null;
}

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
  const sameFileSymbol = resolveSameFileChildSymbol(fileSymbols, childCandidate.name);

  if (sameFileSymbol) {
    return {
      parentFilePath: relation.filePath,
      parentSymbolId: parent.parentSymbolId,
      parentSymbolName: parent.parentSymbolName,
      childComponentName: childCandidate.name,
      childFilePath: sameFileSymbol.filePath,
      childSymbolId: sameFileSymbol.symbolId,
      source: 'jsx',
      confidence: childCandidate.note ? 'medium' : 'high',
      note: childCandidate.note ?? 'resolved to same-file symbol',
    };
  }

  const importedResolution = resolveImportedChildSymbol(
    relation,
    childCandidate.name,
    index,
    repoConfigById,
  );

  if (importedResolution) {
    return {
      parentFilePath: relation.filePath,
      parentSymbolId: parent.parentSymbolId,
      parentSymbolName: parent.parentSymbolName,
      childComponentName: childCandidate.name,
      childFilePath: importedResolution.childFilePath,
      childSymbolId: importedResolution.childSymbolId,
      source: 'jsx',
      confidence: childCandidate.note ? 'medium' : importedResolution.confidence,
      note: childCandidate.note ?? importedResolution.note,
    };
  }

  return {
    parentFilePath: relation.filePath,
    parentSymbolId: parent.parentSymbolId,
    parentSymbolName: parent.parentSymbolName,
    childComponentName: childCandidate.name,
    source: 'jsx',
    confidence: 'medium',
    note: childCandidate.note ?? 'unresolved JSX component candidate',
  };
}

function walkJsxNodes(
  node: Parser.SyntaxNode,
  visit: (candidate: Parser.SyntaxNode) => void,
): void {
  if (node.type === 'jsx_element' || node.type === 'jsx_self_closing_element') {
    visit(node);
  }

  for (const child of node.namedChildren) {
    walkJsxNodes(child, visit);
  }
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
    const files = (await collectRepositorySourceFiles(repository.rootPath, repository.id)).filter(isTsxFile);

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
