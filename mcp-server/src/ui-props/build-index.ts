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
  extractChildComponentCandidate,
  getJsxOpeningNode,
  getNodeText,
  isJsxLikeFile,
  resolveChildComponent,
  resolveParentSymbol,
  walkJsxNodes,
} from '../ui-composition/shared.js';
import {
  UI_PROP_SURFACE_SCHEMA_VERSION,
  type UiPropSurfaceIndex,
  type UiPropUsage,
  type UiPropValueKind,
} from './types.js';

function getAttributeValueKind(attribute: Parser.SyntaxNode, source: string): UiPropValueKind {
  const valueNode = attribute.namedChildren.find((child) => child.type !== 'property_identifier');

  if (!valueNode) {
    return 'boolean-literal';
  }

  if (valueNode.type === 'string') {
    return 'string-literal';
  }

  if (valueNode.type !== 'jsx_expression') {
    return 'unknown';
  }

  const expressionNode = valueNode.namedChildren[0];

  if (!expressionNode) {
    return 'unknown';
  }

  if (expressionNode.type === 'string') {
    return 'string-literal';
  }

  if (expressionNode.type === 'number') {
    return 'number-literal';
  }

  if (expressionNode.type === 'true' || expressionNode.type === 'false') {
    return 'boolean-literal';
  }

  if (expressionNode.type === 'identifier') {
    return 'identifier';
  }

  if (expressionNode.type === 'object') {
    return 'object';
  }

  if (expressionNode.type === 'array') {
    return 'array';
  }

  const rawExpression = getNodeText(expressionNode, source);

  if (rawExpression === 'true' || rawExpression === 'false') {
    return 'boolean-literal';
  }

  return 'expression';
}

function createPropUsagesForNode(
  relation: SymbolIndex['byFile'][string],
  fileSymbols: IndexedSymbol[],
  node: Parser.SyntaxNode,
  source: string,
  index: SymbolIndex,
  repoConfigById: Record<string, RepoResolutionConfig>,
): UiPropUsage[] {
  const childCandidate = extractChildComponentCandidate(node, source);

  if (!childCandidate) {
    return [];
  }

  const parent = resolveParentSymbol(fileSymbols, node.startPosition.row + 1);
  const resolvedChild = resolveChildComponent(
    relation,
    childCandidate,
    index,
    fileSymbols,
    repoConfigById,
  );
  const attributes = getJsxOpeningNode(node).namedChildren.filter((child) => child.type === 'jsx_attribute');
  const propUsages: UiPropUsage[] = [];

  for (const attribute of attributes) {
    const propNameNode = attribute.childForFieldName('name') ?? attribute.namedChildren[0];

    if (!propNameNode) {
      continue;
    }

    const propName = getNodeText(propNameNode, source).trim();

    if (!propName) {
      continue;
    }

    propUsages.push({
      parentFilePath: relation.filePath,
      parentSymbolId: parent.parentSymbolId,
      parentSymbolName: parent.parentSymbolName,
      childComponentName: childCandidate.name,
      childFilePath: resolvedChild?.childFilePath,
      childSymbolId: resolvedChild?.childSymbolId,
      propName,
      valueKind: getAttributeValueKind(attribute, source),
      source: 'jsx-attribute',
      confidence: resolvedChild?.confidence ?? 'medium',
      note: resolvedChild?.note ?? childCandidate.note ?? 'unresolved JSX component candidate',
    });
  }

  return propUsages;
}

function dedupePropUsages(propUsages: UiPropUsage[]): UiPropUsage[] {
  const seen = new Set<string>();
  const deduped: UiPropUsage[] = [];

  for (const usage of propUsages) {
    const key = [
      usage.parentFilePath,
      usage.parentSymbolId ?? '',
      usage.childComponentName,
      usage.childFilePath ?? '',
      usage.childSymbolId ?? '',
      usage.propName,
      usage.valueKind,
    ].join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(usage);
  }

  return deduped;
}

export async function buildUiPropSurfaceIndex(
  reposRoot: string,
  index: SymbolIndex,
  options: { repoConfigById?: Record<string, RepoResolutionConfig> } = {},
): Promise<UiPropSurfaceIndex> {
  const repositories = await listRepositories(reposRoot);
  const repoConfigById =
    options.repoConfigById ??
    (await loadRepoResolutionConfigs(
      Object.fromEntries(repositories.map((repository) => [repository.id, repository.rootPath])),
    ));
  const propUsages: UiPropUsage[] = [];

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
        propUsages.push(
          ...createPropUsagesForNode(relation, fileSymbols, node, source, index, repoConfigById),
        );
      });
    }
  }

  return {
    schemaVersion: UI_PROP_SURFACE_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion: index.schemaVersion,
    generatedAt: new Date().toISOString(),
    propUsages: dedupePropUsages(propUsages).sort((left, right) => {
      const leftKey = `${left.parentFilePath}:${left.parentSymbolName ?? ''}:${left.childComponentName}:${left.propName}`;
      const rightKey = `${right.parentFilePath}:${right.parentSymbolName ?? ''}:${right.childComponentName}:${right.propName}`;
      return leftKey.localeCompare(rightKey);
    }),
  };
}
