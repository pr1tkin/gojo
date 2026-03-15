import path from 'node:path';

import ts from 'typescript';

import type { RepositoryInfo, SymbolKind } from '../types.js';
import {
  createDeclarationFingerprint,
  createFileId,
  createSymbolId,
} from '../symbol-index/ids.js';
import { discoverRepositoryTsconfigs } from './tsconfig-discovery.js';
import { loadTypeScriptProject } from './project-loader.js';
import type { IndexedSymbol } from '../symbol-index/types.js';

function normalizePath(value: string): string {
  return path.resolve(value);
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isSupportedCompilerFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return (extension === '.ts' || extension === '.tsx') && !filePath.endsWith('.d.ts');
}

function getNodeName(node: ts.Node): ts.Node | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isMethodDeclaration(node)
  ) {
    return node.name;
  }

  if (ts.isVariableDeclaration(node)) {
    return ts.isIdentifier(node.name) ? node.name : undefined;
  }

  return undefined;
}

function getSymbolKind(node: ts.Node): SymbolKind | null {
  if (ts.isFunctionDeclaration(node)) {
    return 'function';
  }

  if (ts.isClassDeclaration(node)) {
    return 'class';
  }

  if (ts.isInterfaceDeclaration(node)) {
    return 'interface';
  }

  if (ts.isTypeAliasDeclaration(node)) {
    return 'typeAlias';
  }

  if (ts.isMethodDeclaration(node)) {
    return 'method';
  }

  if (ts.isVariableDeclaration(node)) {
    return 'variable';
  }

  return null;
}

function hasExportModifier(node: ts.Node): boolean {
  if ((ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0) {
    return true;
  }

  if (
    ts.isVariableDeclaration(node) &&
    node.parent &&
    node.parent.parent &&
    ts.isVariableStatement(node.parent.parent)
  ) {
    return (
      ts.getModifiers(node.parent.parent)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) ?? false
    );
  }

  return false;
}

function createIndexedSymbol(
  repository: RepositoryInfo,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  kind: SymbolKind,
  ordinal: number,
): IndexedSymbol {
  const absoluteFilePath = normalizePath(sourceFile.fileName);
  const relativeFilePath = normalizeRelativePath(path.relative(repository.rootPath, absoluteFilePath));
  const fileId = createFileId(repository.id, relativeFilePath);
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

  return {
    symbolId: createSymbolId(fileId, kind, name, ordinal),
    fileId,
    name,
    kind,
    repo: repository.id,
    filePath: relativeFilePath,
    startLine,
    endLine,
    exported: hasExportModifier(node),
    declarationFingerprint: createDeclarationFingerprint(kind, name, ordinal),
  };
}

function collectDefinitionMatches(
  repository: RepositoryInfo,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  requestedName: string,
  requestedKind: SymbolKind | undefined,
  results: IndexedSymbol[],
  ordinalsByFile: Map<string, Map<string, number>>,
): void {
  const kind = getSymbolKind(node);

  if (kind) {
    const nameNode = getNodeName(node);
    const name = nameNode && ts.isIdentifier(nameNode) ? nameNode.text : undefined;

    if (name === requestedName && (!requestedKind || requestedKind === kind)) {
      const relativeFilePath = normalizeRelativePath(
        path.relative(repository.rootPath, normalizePath(sourceFile.fileName)),
      );
      const fileId = createFileId(repository.id, relativeFilePath);

      if (!ordinalsByFile.has(fileId)) {
        ordinalsByFile.set(fileId, new Map<string, number>());
      }

      const fileOrdinals = ordinalsByFile.get(fileId) as Map<string, number>;
      const ordinalKey = `${kind}:${name}`;
      const ordinal = (fileOrdinals.get(ordinalKey) ?? 0) + 1;
      fileOrdinals.set(ordinalKey, ordinal);

      results.push(createIndexedSymbol(repository, sourceFile, node, name, kind, ordinal));
    }
  }

  ts.forEachChild(node, (child) => {
    collectDefinitionMatches(
      repository,
      sourceFile,
      child,
      requestedName,
      requestedKind,
      results,
      ordinalsByFile,
    );
  });
}

function dedupeSymbols(symbols: IndexedSymbol[]): IndexedSymbol[] {
  const seen = new Set<string>();
  const results: IndexedSymbol[] = [];

  for (const symbol of symbols) {
    const key = [
      symbol.repo,
      symbol.filePath,
      symbol.startLine,
      symbol.endLine,
      symbol.name,
      symbol.kind,
    ].join(':');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(symbol);
  }

  return results;
}

export async function findTypeScriptDefinitions(
  repository: RepositoryInfo,
  name: string,
  kind?: SymbolKind,
): Promise<IndexedSymbol[]> {
  const tsconfigPaths = await discoverRepositoryTsconfigs(repository.rootPath);

  if (tsconfigPaths.length === 0) {
    return [];
  }

  const matches: IndexedSymbol[] = [];
  const ordinalsByFile = new Map<string, Map<string, number>>();

  for (const tsconfigPath of tsconfigPaths) {
    const context = loadTypeScriptProject(repository.rootPath, tsconfigPath);

    if (!context) {
      continue;
    }

    for (const sourceFile of context.program.getSourceFiles()) {
      const absoluteFilePath = normalizePath(sourceFile.fileName);

      if (!isPathInsideRoot(repository.rootPath, absoluteFilePath)) {
        continue;
      }

      if (!isSupportedCompilerFile(absoluteFilePath)) {
        continue;
      }

      collectDefinitionMatches(
        repository,
        sourceFile,
        sourceFile,
        name,
        kind,
        matches,
        ordinalsByFile,
      );
    }
  }

  return dedupeSymbols(matches);
}
