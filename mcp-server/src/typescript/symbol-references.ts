import path from 'node:path';

import ts from 'typescript';

import type { RepositoryInfo } from '../types.js';
import type { IndexedSymbol } from '../symbol-index/types.js';
import { discoverRepositoryTsconfigs } from './tsconfig-discovery.js';
import { loadTypeScriptProject } from './project-loader.js';

export interface TypeScriptSymbolReferenceMatch {
  repo: string;
  filePath: string;
  line: number;
  snippet: string;
  isImportBinding: boolean;
  isCallReference: boolean;
  isJsxReference: boolean;
  isTypeReference: boolean;
}

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

function isIndexedSymbolDeclarationNode(node: ts.Node, target: IndexedSymbol): boolean {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  ) {
    return Boolean(node.name && ts.isIdentifier(node.name) && node.name.text === target.name);
  }

  if (ts.isVariableDeclaration(node)) {
    return ts.isIdentifier(node.name) && node.name.text === target.name;
  }

  if (ts.isMethodDeclaration(node)) {
    return Boolean(node.name && ts.isIdentifier(node.name) && node.name.text === target.name);
  }

  return false;
}

function isKindCompatible(node: ts.Node, target: IndexedSymbol): boolean {
  switch (target.kind) {
    case 'function':
      return ts.isFunctionDeclaration(node);
    case 'class':
      return ts.isClassDeclaration(node);
    case 'interface':
      return ts.isInterfaceDeclaration(node);
    case 'typeAlias':
      return ts.isTypeAliasDeclaration(node);
    case 'variable':
    case 'default_export':
      return ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node);
    case 'method':
      return ts.isMethodDeclaration(node);
  }
}

function getNodeStartLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function findTargetDeclarationNodes(sourceFile: ts.SourceFile, target: IndexedSymbol): ts.Node[] {
  const matches: ts.Node[] = [];

  const visit = (node: ts.Node): void => {
    if (isKindCompatible(node, target) && isIndexedSymbolDeclarationNode(node, target)) {
      const startLine = getNodeStartLine(sourceFile, node);

      if (startLine === target.startLine) {
        matches.push(node);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return matches;
}

function resolveAliasedSymbol(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined,
): ts.Symbol | undefined {
  if (!symbol) {
    return undefined;
  }

  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }

  return symbol;
}

function getLineSnippet(sourceFile: ts.SourceFile, position: number): { line: number; snippet: string } {
  const { line } = sourceFile.getLineAndCharacterOfPosition(position);
  const lineStarts = sourceFile.getLineStarts();
  const lineStart = lineStarts[line] ?? 0;
  const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] : sourceFile.text.length;

  return {
    line: line + 1,
    snippet: sourceFile.text.slice(lineStart, lineEnd).trim(),
  };
}

function isImportBindingReference(node: ts.Node): boolean {
  const parent = node.parent;

  return (
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent)
  );
}

function isCallReference(node: ts.Node): boolean {
  const parent = node.parent;

  if (ts.isCallExpression(parent) && parent.expression === node) {
    return true;
  }

  return ts.isPropertyAccessExpression(parent) && ts.isCallExpression(parent.parent) && parent.parent.expression === parent;
}

function isJsxReference(node: ts.Node): boolean {
  const parent = node.parent;

  return (
    (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
    parent.tagName === node
  );
}

function isTypeReference(node: ts.Node): boolean {
  const parent = node.parent;

  return (
    ts.isTypeReferenceNode(parent) ||
    ts.isExpressionWithTypeArguments(parent) ||
    ts.isHeritageClause(parent)
  );
}

function isReferenceNode(node: ts.Node, targetName: string): node is ts.Identifier {
  return ts.isIdentifier(node) && node.text === targetName;
}

function getDeclarationNameNode(node: ts.Node): ts.Node {
  const namedNode = (node as { name?: ts.Node }).name;

  if (namedNode && ts.isIdentifier(namedNode)) {
    return namedNode;
  }

  return node;
}

function compareMatches(left: TypeScriptSymbolReferenceMatch, right: TypeScriptSymbolReferenceMatch): number {
  return (
    left.repo.localeCompare(right.repo) ||
    left.filePath.localeCompare(right.filePath) ||
    left.line - right.line ||
    left.snippet.localeCompare(right.snippet)
  );
}

const symbolReferenceCache = new Map<string, Promise<TypeScriptSymbolReferenceMatch[]>>();

export async function findTypeScriptReferencesForIndexedSymbol(
  repository: RepositoryInfo,
  target: IndexedSymbol,
): Promise<TypeScriptSymbolReferenceMatch[]> {
  const cacheKey = `${repository.id}:${target.filePath}:${target.symbolId}`;
  const cached = symbolReferenceCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const pending = (async (): Promise<TypeScriptSymbolReferenceMatch[]> => {
    const tsconfigPaths = await discoverRepositoryTsconfigs(repository.rootPath);

    if (tsconfigPaths.length === 0) {
      return [];
    }

    const targetAbsoluteFilePath = normalizePath(path.join(repository.rootPath, target.filePath));
    const matches: TypeScriptSymbolReferenceMatch[] = [];
    const seen = new Set<string>();

    for (const tsconfigPath of tsconfigPaths) {
      const context = loadTypeScriptProject(repository.rootPath, tsconfigPath);

      if (!context) {
        continue;
      }

      const sourceFile = context.program.getSourceFile(targetAbsoluteFilePath);

      if (!sourceFile) {
        continue;
      }

      const declarationSymbols = new Set<ts.Symbol>();
      const declarationLocations = new Set<string>();

      for (const declarationNode of findTargetDeclarationNodes(sourceFile, target)) {
        const nameNode = getDeclarationNameNode(declarationNode);
        const resolved = resolveAliasedSymbol(context.checker, context.checker.getSymbolAtLocation(nameNode));

        if (!resolved) {
          continue;
        }

        declarationSymbols.add(resolved);
        declarationLocations.add(`${sourceFile.fileName}:${nameNode.getStart(sourceFile)}`);
      }

      if (declarationSymbols.size === 0) {
        continue;
      }

      for (const projectSourceFile of context.program.getSourceFiles()) {
        const absoluteProjectFilePath = normalizePath(projectSourceFile.fileName);

        if (!isPathInsideRoot(repository.rootPath, absoluteProjectFilePath) || !isSupportedCompilerFile(absoluteProjectFilePath)) {
          continue;
        }

        const visit = (node: ts.Node): void => {
          if (isReferenceNode(node, target.name)) {
            const locationKey = `${projectSourceFile.fileName}:${node.getStart(projectSourceFile)}`;

            if (!declarationLocations.has(locationKey)) {
              const resolved = resolveAliasedSymbol(context.checker, context.checker.getSymbolAtLocation(node));

              if (resolved && declarationSymbols.has(resolved)) {
                const { line, snippet } = getLineSnippet(projectSourceFile, node.getStart(projectSourceFile));
                const normalizedFilePath = normalizeRelativePath(
                  path.relative(repository.rootPath, absoluteProjectFilePath),
                );
                const matchKey = `${normalizedFilePath}:${line}:${snippet}`;

                if (!seen.has(matchKey)) {
                  seen.add(matchKey);
                  matches.push({
                    repo: repository.id,
                    filePath: normalizedFilePath,
                    line,
                    snippet,
                    isImportBinding: isImportBindingReference(node),
                    isCallReference: isCallReference(node),
                    isJsxReference: isJsxReference(node),
                    isTypeReference: isTypeReference(node),
                  });
                }
              }
            }
          }

          ts.forEachChild(node, visit);
        };

        visit(projectSourceFile);
      }
    }

    return matches.sort(compareMatches);
  })();

  symbolReferenceCache.set(cacheKey, pending);
  return pending;
}
