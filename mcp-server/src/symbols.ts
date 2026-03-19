import path from 'node:path';
import type Parser from 'tree-sitter';

import { readRepositoryFile } from './files.js';
import { getRepositoryById } from './repositories.js';
import { createSyntheticDefaultExportName } from './symbol-index/ids.js';
import { isSupportedSymbolFile, parseTypeScriptSource } from './tree-sitter.js';
import type {
  FileSymbol,
  ListSymbolsResult,
  RepositoryInfo,
  SymbolKind,
} from './types.js';

function normalizeRequestedFilePath(filePath: string): string {
  const trimmed = filePath.trim();

  if (!trimmed) {
    throw new Error('filePath must not be empty.');
  }

  return trimmed.replace(/\\/g, '/');
}

function splitRepositoryFilePath(filePath: string): { repositoryId: string; repositoryFilePath: string } {
  const normalizedPath = normalizeRequestedFilePath(filePath);
  const segments = normalizedPath.split('/').filter(Boolean);

  if (segments.length < 2) {
    throw new Error('filePath must include the repository directory and an in-repository file path.');
  }

  return {
    repositoryId: segments[0],
    repositoryFilePath: segments.slice(1).join('/'),
  };
}

function createSymbol(
  node: Parser.SyntaxNode,
  name: string | undefined,
  kind: SymbolKind,
  filePath: string,
): FileSymbol | null {
  if (!name) {
    return null;
  }

  const trimmedName = name.trim();

  if (!trimmedName) {
    return null;
  }

  return {
    name: trimmedName,
    kind,
    filePath,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
}

function getNodeText(node: Parser.SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function getNamedChildText(node: Parser.SyntaxNode, source: string): string | undefined {
  const nameNode = node.childForFieldName('name');

  if (!nameNode) {
    return undefined;
  }

  return getNodeText(nameNode, source);
}

function collectVariableSymbols(
  node: Parser.SyntaxNode,
  source: string,
  filePath: string,
): FileSymbol[] {
  const symbols: FileSymbol[] = [];

  for (const child of node.namedChildren) {
    if (child.type === 'variable_declarator') {
      const nameNode = child.childForFieldName('name');

      if (nameNode?.type === 'identifier') {
        const symbol = createSymbol(child, getNodeText(nameNode, source), 'variable', filePath);

        if (symbol) {
          symbols.push(symbol);
        }
      }
    }
  }

  return symbols;
}

function collectSymbolsFromNode(
  node: Parser.SyntaxNode,
  source: string,
  filePath: string,
  symbols: FileSymbol[],
): void {
  switch (node.type) {
    case 'function_declaration': {
      const symbol = createSymbol(node, getNamedChildText(node, source), 'function', filePath);
      if (symbol) {
        symbols.push(symbol);
      }
      break;
    }
    case 'class_declaration': {
      const symbol = createSymbol(node, getNamedChildText(node, source), 'class', filePath);
      if (symbol) {
        symbols.push(symbol);
      }
      break;
    }
    case 'interface_declaration': {
      const symbol = createSymbol(node, getNamedChildText(node, source), 'interface', filePath);
      if (symbol) {
        symbols.push(symbol);
      }
      break;
    }
    case 'type_alias_declaration': {
      const symbol = createSymbol(node, getNamedChildText(node, source), 'typeAlias', filePath);
      if (symbol) {
        symbols.push(symbol);
      }
      break;
    }
    case 'method_definition': {
      const symbol = createSymbol(node, getNamedChildText(node, source), 'method', filePath);
      if (symbol) {
        symbols.push(symbol);
      }
      break;
    }
    case 'lexical_declaration':
    case 'variable_declaration': {
      symbols.push(...collectVariableSymbols(node, source, filePath));
      break;
    }
    default:
      break;
  }

  for (const child of node.namedChildren) {
    collectSymbolsFromNode(child, source, filePath, symbols);
  }
}

function hasNamedSymbol(symbols: FileSymbol[], name: string): boolean {
  return symbols.some((symbol) => symbol.name === name);
}

function getDefaultExportedNode(
  node: Parser.SyntaxNode,
  source: string,
): Parser.SyntaxNode | null {
  if (node.type !== 'export_statement') {
    return null;
  }

  if (!getNodeText(node, source).trimStart().startsWith('export default')) {
    return null;
  }

  return node.namedChildren[0] ?? null;
}

function classifyAnonymousDefaultExport(node: Parser.SyntaxNode | null): SymbolKind {
  if (!node) {
    return 'default_export';
  }

  if (node.type === 'arrow_function' || node.type === 'function_expression') {
    return 'function';
  }

  if (node.type === 'class') {
    return 'class';
  }

  return 'default_export';
}

function createSyntheticDefaultExportSymbol(
  exportStatement: Parser.SyntaxNode,
  exportedNode: Parser.SyntaxNode | null,
  filePath: string,
  symbolIdentityFilePath: string,
): FileSymbol {
  const targetNode = exportedNode ?? exportStatement;

  return {
    name: createSyntheticDefaultExportName(symbolIdentityFilePath),
    kind: classifyAnonymousDefaultExport(exportedNode),
    filePath,
    startLine: targetNode.startPosition.row + 1,
    endLine: targetNode.endPosition.row + 1,
    identityDiscriminator: 'default',
  };
}

function maybeCollectSyntheticDefaultExportSymbol(
  tree: Parser.Tree,
  source: string,
  symbols: FileSymbol[],
  filePath: string,
  symbolIdentityFilePath: string,
): void {
  for (const child of tree.rootNode.namedChildren) {
    const exportedNode = getDefaultExportedNode(child, source);

    if (!exportedNode) {
      continue;
    }

    if (exportedNode.type === 'function_declaration' || exportedNode.type === 'class_declaration') {
      const exportedName = getNamedChildText(exportedNode, source);

      if (exportedName && hasNamedSymbol(symbols, exportedName)) {
        return;
      }
    }

    if (exportedNode.type === 'identifier') {
      const exportedName = getNodeText(exportedNode, source);

      if (exportedName && hasNamedSymbol(symbols, exportedName)) {
        return;
      }
    }

    symbols.push(
      createSyntheticDefaultExportSymbol(child, exportedNode, filePath, symbolIdentityFilePath),
    );
    return;
  }
}

export function extractSymbolsFromSource(
  source: string,
  filePath: string,
  symbolIdentityFilePath: string = filePath,
): FileSymbol[] {
  const tree = parseTypeScriptSource(filePath, source);
  const symbols: FileSymbol[] = [];

  collectSymbolsFromNode(tree.rootNode, source, filePath, symbols);
  maybeCollectSyntheticDefaultExportSymbol(tree, source, symbols, filePath, symbolIdentityFilePath);

  return symbols;
}

async function getRepositoryForFilePath(
  reposRoot: string,
  filePath: string,
): Promise<{ repository: RepositoryInfo; repositoryFilePath: string; normalizedFilePath: string }> {
  const normalizedFilePath = normalizeRequestedFilePath(filePath);
  const { repositoryId, repositoryFilePath } = splitRepositoryFilePath(normalizedFilePath);
  const repository = await getRepositoryById(reposRoot, repositoryId);

  if (!repository) {
    throw new Error(`Repository not found: ${repositoryId}`);
  }

  return {
    repository,
    repositoryFilePath,
    normalizedFilePath,
  };
}

export async function listSymbolsForFile(
  reposRoot: string,
  filePath: string,
): Promise<ListSymbolsResult> {
  const { repository, repositoryFilePath, normalizedFilePath } = await getRepositoryForFilePath(
    reposRoot,
    filePath,
  );

  if (!isSupportedSymbolFile(repositoryFilePath)) {
    const extension = path.extname(repositoryFilePath) || '<none>';
    throw new Error(`Unsupported file type for symbol extraction: ${extension}`);
  }

  const file = await readRepositoryFile(repository, repositoryFilePath);
  const symbols = extractSymbolsFromSource(file.content, normalizedFilePath, repositoryFilePath);

  return {
    filePath: normalizedFilePath,
    symbolCount: symbols.length,
    symbols,
  };
}
