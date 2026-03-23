import fs from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';

import { collectRepositorySourceFiles } from '../symbol-index/build-index.js';
import { createFileId } from '../symbol-index/ids.js';
import type { ImportBinding } from '../symbol-index/types.js';
import type { FileRelation, IndexedSymbol } from '../symbol-index/types.js';
import type { RepositoryInfo } from '../types.js';
import { findTypeScriptReferencesForIndexedSymbol } from './symbol-references.js';

export type ApiPropagationEdgeKind = 'api_route_handler' | 'api_client_to_route' | 'api_propagation';

export interface ApiRouteHandlerEdge {
  kind: 'api_route_handler';
  routeId: string;
  routeFileId: string;
  routeFilePath: string;
  handlerName: string;
  referenceCount: number;
}

export interface ApiClientRouteEdge {
  kind: 'api_client_to_route';
  routeId: string;
  clientFileId: string;
  clientFilePath: string;
  method: string;
  line: number;
  snippet: string;
}

export interface ApiPropagationEdge {
  kind: 'api_propagation';
  routeId: string;
  routeFileId: string;
  routeFilePath: string;
  clientFileId: string;
  clientFilePath: string;
  method: string;
  line: number;
  snippet: string;
  handlerName: string;
}

export interface ApiPropagationResult {
  routeHandlers: ApiRouteHandlerEdge[];
  clientCalls: ApiClientRouteEdge[];
  propagatedClients: ApiPropagationEdge[];
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function isRouteFilePath(filePath: string): boolean {
  return /(^|\/)app\/api\/.+\/route\.(tsx?|jsx?)$/i.test(normalizePath(filePath));
}

function scriptKindForFile(filePath: string): ts.ScriptKind {
  const normalized = normalizePath(filePath).toLowerCase();

  if (normalized.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }

  if (normalized.endsWith('.jsx')) {
    return ts.ScriptKind.JSX;
  }

  if (normalized.endsWith('.js')) {
    return ts.ScriptKind.JS;
  }

  return ts.ScriptKind.TS;
}

function isRouteHandlerName(name: string): boolean {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(name);
}

function resolveApiRouteIdFromString(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, '/');

  if (!normalized.startsWith('/api/')) {
    return null;
  }

  const withoutQuery = normalized.split('?')[0]?.split('#')[0] ?? normalized;
  const canonical = withoutQuery.replace(/\/+$/, '');
  return canonical.length > 0 ? canonical : null;
}

function collectStringConstants(sourceFile: ts.SourceFile): Map<string, string> {
  const constants = new Map<string, string>();

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const resolved = resolveStringExpression(node.initializer, constants);

      if (resolved !== null) {
        constants.set(node.name.text, resolved);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return constants;
}

function resolveStringExpression(expression: ts.Expression, constants: Map<string, string>): string | null {
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }

  if (ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }

  if (ts.isIdentifier(expression)) {
    return constants.get(expression.text) ?? null;
  }

  if (ts.isTemplateExpression(expression)) {
    let result = expression.head.text;

    for (const span of expression.templateSpans) {
      const resolved = resolveStringExpression(span.expression, constants);

      if (resolved === null) {
        return null;
      }

      result += resolved;
      result += span.literal.text;
    }

    return result;
  }

  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveStringExpression(expression.left, constants);
    const right = resolveStringExpression(expression.right, constants);

    if (left === null || right === null) {
      return null;
    }

    return left + right;
  }

  return null;
}

function resolveApiRouteIdFromExpression(expression: ts.Expression, constants: Map<string, string>): string | null {
  const resolved = resolveStringExpression(expression, constants);
  return resolved ? resolveApiRouteIdFromString(resolved) : null;
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

function isFetchCallExpression(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
    return true;
  }

  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'fetch'
  );
}

export function getCanonicalApiRouteId(filePath: string): string | null {
  const normalized = normalizePath(filePath);
  const match = normalized.match(/(^|\/)app\/api\/(.+)\/route\.(tsx?|jsx?)$/i);

  if (!match || !match[2]) {
    return null;
  }

  return `/api/${match[2]}`.replace(/\/+/g, '/');
}

function inferFetchMethod(argument: ts.Expression | undefined, constants: Map<string, string>): string {
  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    return 'GET';
  }

  for (const property of argument.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === 'method') ||
        (ts.isStringLiteral(property.name) && property.name.text === 'method'))
    ) {
      const resolved = resolveStringExpression(property.initializer, constants);
      return (resolved ?? 'GET').toUpperCase();
    }
  }

  return 'GET';
}

function containsIdentifier(source: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(source);
}

function bindingTargetsSymbol(binding: ImportBinding, targetName: string): boolean {
  return binding.localName === targetName || binding.importedName === targetName;
}

function extractRouteHandlerSpans(
  filePath: string,
  source: string,
): Array<{ handlerName: string; start: number; end: number }> {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(filePath),
  );
  const handlers: Array<{ handlerName: string; start: number; end: number }> = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      isRouteHandlerName(node.name.text) &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      handlers.push({
        handlerName: node.name.text,
        start: node.getStart(sourceFile),
        end: node.getEnd(),
      });
    }

    if (ts.isVariableStatement(node) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && isRouteHandlerName(declaration.name.text) && declaration.initializer) {
          handlers.push({
            handlerName: declaration.name.text,
            start: declaration.initializer.getStart(sourceFile),
            end: declaration.initializer.getEnd(),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return handlers;
}

export function extractApiClientRouteCalls(
  filePath: string,
  source: string,
): Array<{ routeId: string; method: string; line: number; snippet: string }> {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(filePath),
  );
  const constants = collectStringConstants(sourceFile);
  const results: Array<{ routeId: string; method: string; line: number; snippet: string }> = [];
  const seen = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0 && isFetchCallExpression(node)) {
      const routeId = resolveApiRouteIdFromExpression(node.arguments[0] as ts.Expression, constants);

      if (routeId) {
        const { line, snippet } = getLineSnippet(sourceFile, node.getStart(sourceFile));
        const method = inferFetchMethod(node.arguments[1] as ts.Expression | undefined, constants);
        const key = `${routeId}:${method}:${line}:${snippet}`;

        if (!seen.has(key)) {
          seen.add(key);
          results.push({ routeId, method, line, snippet });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return results.sort(
    (left, right) =>
      left.routeId.localeCompare(right.routeId) ||
      left.method.localeCompare(right.method) ||
      left.line - right.line,
  );
}

export async function collectApiPropagationForSymbol(
  repository: RepositoryInfo,
  target: IndexedSymbol,
  _relationsByFile: Record<string, FileRelation>,
  indexedSymbols: IndexedSymbol[] = [],
): Promise<ApiPropagationResult> {
  let matches;

  try {
    matches = await findTypeScriptReferencesForIndexedSymbol(repository, target);
  } catch {
    return {
      routeHandlers: [],
      clientCalls: [],
      propagatedClients: [],
    };
  }

  const routeHandlerSymbolsByFileId = new Map<string, IndexedSymbol[]>();

  for (const symbol of indexedSymbols) {
    if (!isRouteHandlerName(symbol.name)) {
      continue;
    }

    const existing = routeHandlerSymbolsByFileId.get(symbol.fileId) ?? [];
    existing.push(symbol);
    routeHandlerSymbolsByFileId.set(symbol.fileId, existing);
  }

  const routeHandlersByFile = new Map<string, ApiRouteHandlerEdge>();

  const routeMatchesByFile = new Map<string, typeof matches>();

  for (const match of matches) {
    if (match.filePath === target.filePath || !isRouteFilePath(match.filePath)) {
      continue;
    }

    const existing = routeMatchesByFile.get(match.filePath) ?? [];
    existing.push(match);
    routeMatchesByFile.set(match.filePath, existing);
  }

  for (const [routeFilePath, fileMatches] of routeMatchesByFile.entries()) {
    const routeId = getCanonicalApiRouteId(routeFilePath);

    if (!routeId) {
      continue;
    }

    const routeFileId = createFileId(repository.id, routeFilePath);
    const relevantMatches = fileMatches.some((match) => !match.isImportBinding)
      ? fileMatches.filter((match) => !match.isImportBinding)
      : fileMatches;

    for (const match of relevantMatches) {
      const routeHandlerSymbol = (routeHandlerSymbolsByFileId.get(routeFileId) ?? []).find(
        (symbol) => match.line >= symbol.startLine && match.line <= symbol.endLine,
      );

      if (!routeHandlerSymbol) {
        continue;
      }

      const handlerKey = `${routeFileId}:${routeHandlerSymbol.name}`;
      const existing = routeHandlersByFile.get(handlerKey);

      if (existing) {
        existing.referenceCount += 1;
        continue;
      }

      routeHandlersByFile.set(handlerKey, {
        kind: 'api_route_handler',
        routeId,
        routeFileId,
        routeFilePath,
        handlerName: routeHandlerSymbol.name,
        referenceCount: 1,
      });
    }
  }

  for (const relation of Object.values(_relationsByFile)) {
    if (relation.repo !== repository.id || !isRouteFilePath(relation.filePath)) {
      continue;
    }

    const matchingLocalNames = relation.imports
      .filter((entry) => entry.resolvedTargetFileId === target.fileId)
      .flatMap((entry) => entry.bindings.filter((binding) => bindingTargetsSymbol(binding, target.name)).map((binding) => binding.localName));

    if (matchingLocalNames.length === 0) {
      continue;
    }

    let source = '';

    try {
      source = await fs.readFile(path.join(repository.rootPath, relation.filePath), 'utf8');
    } catch {
      continue;
    }

    const routeId = getCanonicalApiRouteId(relation.filePath);

    if (!routeId) {
      continue;
    }

    for (const handler of extractRouteHandlerSpans(relation.filePath, source)) {
      const handlerSlice = source.slice(handler.start, handler.end);

      if (!matchingLocalNames.some((localName) => containsIdentifier(handlerSlice, localName))) {
        continue;
      }

      const handlerKey = `${relation.fileId}:${handler.handlerName}`;

      if (routeHandlersByFile.has(handlerKey)) {
        continue;
      }

      routeHandlersByFile.set(handlerKey, {
        kind: 'api_route_handler',
        routeId,
        routeFileId: relation.fileId,
        routeFilePath: relation.filePath,
        handlerName: handler.handlerName,
        referenceCount: 1,
      });
    }
  }

  if (routeHandlersByFile.size === 0) {
    return {
      routeHandlers: [],
      clientCalls: [],
      propagatedClients: [],
    };
  }

  const routeHandlers = Array.from(routeHandlersByFile.values()).sort((left, right) =>
    left.routeFilePath.localeCompare(right.routeFilePath) || left.handlerName.localeCompare(right.handlerName),
  );
  const routeIds = new Map(routeHandlers.map((entry) => [`${entry.routeId}:${entry.handlerName}`, entry]));
  const sourceFiles = await collectRepositorySourceFiles(repository.rootPath, repository.id);
  const clientCallsByKey = new Map<string, ApiClientRouteEdge>();
  const propagatedClientsByKey = new Map<string, ApiPropagationEdge>();

  for (const relativeFilePath of sourceFiles) {
    if (relativeFilePath === target.filePath || isRouteFilePath(relativeFilePath)) {
      continue;
    }

    const absoluteFilePath = path.join(repository.rootPath, relativeFilePath);
    let source = '';

    try {
      source = await fs.readFile(absoluteFilePath, 'utf8');
    } catch {
      continue;
    }

    for (const call of extractApiClientRouteCalls(relativeFilePath, source)) {
      const routeHandler = routeIds.get(`${call.routeId}:${call.method}`);

      if (!routeHandler) {
        continue;
      }

      const clientFileId = createFileId(repository.id, relativeFilePath);
      const clientCallKey = `${clientFileId}:${call.routeId}:${call.line}`;

      if (!clientCallsByKey.has(clientCallKey)) {
        clientCallsByKey.set(clientCallKey, {
          kind: 'api_client_to_route',
          routeId: call.routeId,
          clientFileId,
          clientFilePath: relativeFilePath,
          method: call.method,
          line: call.line,
          snippet: call.snippet,
        });
      }

      const propagationKey = `${clientFileId}:${routeHandler.routeFileId}`;

      if (!propagatedClientsByKey.has(propagationKey)) {
        propagatedClientsByKey.set(propagationKey, {
          kind: 'api_propagation',
          routeId: call.routeId,
          routeFileId: routeHandler.routeFileId,
          routeFilePath: routeHandler.routeFilePath,
          clientFileId,
          clientFilePath: relativeFilePath,
          method: call.method,
          line: call.line,
          snippet: call.snippet,
          handlerName: routeHandler.handlerName,
        });
      }
    }
  }

  return {
    routeHandlers,
    clientCalls: Array.from(clientCallsByKey.values()).sort((left, right) =>
      left.clientFilePath.localeCompare(right.clientFilePath) || left.line - right.line,
    ),
    propagatedClients: Array.from(propagatedClientsByKey.values()).sort((left, right) =>
      left.clientFilePath.localeCompare(right.clientFilePath) || left.routeFilePath.localeCompare(right.routeFilePath),
    ),
  };
}
