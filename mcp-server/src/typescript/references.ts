import path from 'node:path';

import ts from 'typescript';

import type { RepositoryInfo, FindReferenceMatch } from '../types.js';
import { discoverRepositoryTsconfigs } from './tsconfig-discovery.js';
import { loadTypeScriptProject } from './project-loader.js';

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

function collectDeclarationNameNodes(
  node: ts.Node,
  requestedName: string,
  results: ts.Node[],
): void {
  const nameNode = getNodeName(node);
  const name = nameNode && ts.isIdentifier(nameNode) ? nameNode.text : undefined;

  if (name === requestedName && nameNode) {
    results.push(nameNode);
  }

  ts.forEachChild(node, (child) => collectDeclarationNameNodes(child, requestedName, results));
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
  const snippet = sourceFile.text.slice(lineStart, lineEnd).trim();

  return {
    line: line + 1,
    snippet,
  };
}

function compareReferenceMatches(left: FindReferenceMatch, right: FindReferenceMatch): number {
  return (
    left.repo.localeCompare(right.repo) ||
    left.filePath.localeCompare(right.filePath) ||
    left.line - right.line ||
    left.snippet.localeCompare(right.snippet)
  );
}

function dedupeAndSort(matches: FindReferenceMatch[]): FindReferenceMatch[] {
  const seen = new Set<string>();
  const results: FindReferenceMatch[] = [];

  for (const match of matches) {
    const key = [match.symbol, match.repo, match.filePath, match.line, match.snippet].join(':');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(match);
  }

  return results.sort(compareReferenceMatches);
}

export async function findTypeScriptReferences(
  repository: RepositoryInfo,
  symbol: string,
): Promise<FindReferenceMatch[]> {
  const tsconfigPaths = await discoverRepositoryTsconfigs(repository.rootPath);

  if (tsconfigPaths.length === 0) {
    return [];
  }

  const matches: FindReferenceMatch[] = [];

  for (const tsconfigPath of tsconfigPaths) {
    const context = loadTypeScriptProject(repository.rootPath, tsconfigPath);

    if (!context) {
      continue;
    }

    const declarationLocations = new Set<string>();
    const targetSymbols = new Set<ts.Symbol>();

    for (const sourceFile of context.program.getSourceFiles()) {
      const absoluteFilePath = normalizePath(sourceFile.fileName);

      if (!isPathInsideRoot(repository.rootPath, absoluteFilePath)) {
        continue;
      }

      if (!isSupportedCompilerFile(absoluteFilePath)) {
        continue;
      }

      const declarationNameNodes: ts.Node[] = [];
      collectDeclarationNameNodes(sourceFile, symbol, declarationNameNodes);

      for (const nameNode of declarationNameNodes) {
        declarationLocations.add(`${sourceFile.fileName}:${nameNode.getStart(sourceFile)}`);
        const declarationSymbol = resolveAliasedSymbol(
          context.checker,
          context.checker.getSymbolAtLocation(nameNode),
        );

        if (declarationSymbol) {
          targetSymbols.add(declarationSymbol);
        }
      }
    }

    if (targetSymbols.size === 0) {
      continue;
    }

    for (const projectSourceFile of context.program.getSourceFiles()) {
      const absoluteProjectFilePath = normalizePath(projectSourceFile.fileName);

      if (!isPathInsideRoot(repository.rootPath, absoluteProjectFilePath)) {
        continue;
      }

      if (!isSupportedCompilerFile(absoluteProjectFilePath)) {
        continue;
      }

      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === symbol) {
          const locationKey = `${projectSourceFile.fileName}:${node.getStart(projectSourceFile)}`;

          if (!declarationLocations.has(locationKey)) {
            const nodeSymbol = resolveAliasedSymbol(
              context.checker,
              context.checker.getSymbolAtLocation(node),
            );

            if (
              (nodeSymbol && Array.from(targetSymbols).includes(nodeSymbol)) ||
              node.text === symbol
            ) {
              const { line, snippet } = getLineSnippet(projectSourceFile, node.getStart(projectSourceFile));

              matches.push({
                symbol,
                repo: repository.id,
                filePath: normalizeRelativePath(
                  path.relative(repository.rootPath, absoluteProjectFilePath),
                ),
                line,
                snippet,
              });
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(projectSourceFile);
    }
  }

  return dedupeAndSort(matches);
}
