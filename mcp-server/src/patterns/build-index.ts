import path from 'node:path';
import type Parser from 'tree-sitter';

import { readRepositoryFile } from '../files.js';
import { listRepositories } from '../repositories.js';
import { parseTypeScriptSource } from '../tree-sitter.js';
import type { SymbolKind } from '../types.js';
import type { FileRelation, IndexedSymbol, SymbolIndex } from '../symbol-index/types.js';
import {
  createEmptyPatternIndex,
  createPatternCandidate,
  registerPatternCandidateInIndex,
} from './repository.js';
import type {
  PatternCandidate,
  PatternFingerprint,
  PatternIndex,
  PatternKind,
  PatternSignal,
} from './types.js';

interface SymbolNodeMatch {
  symbol: IndexedSymbol;
  node: Parser.SyntaxNode;
}

function comparePatterns(left: PatternCandidate, right: PatternCandidate): number {
  return (
    left.repoId.localeCompare(right.repoId) ||
    left.fileId.localeCompare(right.fileId) ||
    (left.symbolId ?? '').localeCompare(right.symbolId ?? '') ||
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    left.startLine - right.startLine ||
    left.endLine - right.endLine
  );
}

function getLanguage(filePath: string): PatternCandidate['language'] {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case '.ts':
      return 'ts';
    case '.tsx':
      return 'tsx';
    case '.js':
      return 'js';
    case '.jsx':
      return 'jsx';
    default:
      return 'unknown';
  }
}

function getNodeText(node: Parser.SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function normalizeImportSource(value: string): string {
  if (value.startsWith('@')) {
    return value;
  }

  const withoutExtension = value.replace(/\.(tsx?|jsx?)$/i, '');
  return withoutExtension.replace(/\/index$/i, '');
}

function getSupportingImports(relation: FileRelation): string[] {
  return Array.from(new Set(relation.imports.map((entry) => normalizeImportSource(entry.source)))).sort((left, right) => left.localeCompare(right));
}

function hasDescendant(node: Parser.SyntaxNode, predicate: (child: Parser.SyntaxNode) => boolean): boolean {
  if (predicate(node)) {
    return true;
  }

  for (const child of node.namedChildren) {
    if (hasDescendant(child, predicate)) {
      return true;
    }
  }

  return false;
}

function getNameNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  return node.childForFieldName('name');
}

function getCallExpressionCalleeName(node: Parser.SyntaxNode, source: string): string | null {
  if (node.type !== 'call_expression') {
    return null;
  }

  const functionNode = node.childForFieldName('function') ?? node.namedChildren[0];

  if (!functionNode) {
    return null;
  }

  const text = getNodeText(functionNode, source).trim();
  const match = text.match(/([A-Za-z0-9_$]+)$/);
  return match ? match[1] : text;
}

function getCallExpressionArguments(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const argumentsNode = node.childForFieldName('arguments');

  if (!argumentsNode) {
    return node.namedChildren.slice(1);
  }

  return argumentsNode.namedChildren;
}

function unwrapFunctionLikeExpression(
  node: Parser.SyntaxNode | null,
  source: string,
  options: {
    wrapperNames?: string[];
    searchAnyCallArgument?: boolean;
  } = {},
): Parser.SyntaxNode | null {
  if (!node) {
    return null;
  }

  if (
    node.type === 'arrow_function' ||
    node.type === 'function' ||
    node.type === 'function_expression' ||
    node.type === 'function_declaration' ||
    node.type === 'method_definition'
  ) {
    return node;
  }

  if (
    node.type === 'parenthesized_expression' ||
    node.type === 'type_assertion' ||
    node.type === 'as_expression' ||
    node.type === 'satisfies_expression'
  ) {
    for (const child of node.namedChildren) {
      const unwrapped = unwrapFunctionLikeExpression(child, source, options);

      if (unwrapped) {
        return unwrapped;
      }
    }

    return null;
  }

  if (node.type !== 'call_expression') {
    return null;
  }

  const calleeName = getCallExpressionCalleeName(node, source);
  const argumentsNodes = getCallExpressionArguments(node);
  const canUseWrapper = options.wrapperNames?.includes(calleeName ?? '') ?? false;

  if (canUseWrapper) {
    for (const argumentNode of argumentsNodes) {
      const unwrapped = unwrapFunctionLikeExpression(argumentNode, source, options);

      if (unwrapped) {
        return unwrapped;
      }
    }
  }

  if (options.searchAnyCallArgument) {
    for (const argumentNode of argumentsNodes) {
      const unwrapped = unwrapFunctionLikeExpression(argumentNode, source, {
        ...options,
        searchAnyCallArgument: true,
      });

      if (unwrapped) {
        return unwrapped;
      }
    }
  }

  return null;
}

function getFunctionLikeValueNode(node: Parser.SyntaxNode, source: string): Parser.SyntaxNode | null {
  if (node.type === 'variable_declarator') {
    const valueNode = node.childForFieldName('value');
    return unwrapFunctionLikeExpression(valueNode, source, {
      wrapperNames: ['forwardRef', 'memo'],
    });
  }

  return unwrapFunctionLikeExpression(node, source, {
    wrapperNames: ['forwardRef', 'memo'],
  });
}

function getHandlerLikeValueNode(node: Parser.SyntaxNode, source: string): Parser.SyntaxNode | null {
  if (node.type === 'variable_declarator') {
    const valueNode = node.childForFieldName('value');
    return unwrapFunctionLikeExpression(valueNode, source, {
      wrapperNames: ['forwardRef', 'memo'],
      searchAnyCallArgument: true,
    });
  }

  return unwrapFunctionLikeExpression(node, source, {
    wrapperNames: ['forwardRef', 'memo'],
    searchAnyCallArgument: true,
  });
}

function isAsyncFunctionLike(node: Parser.SyntaxNode, source: string): boolean {
  const valueNode = getFunctionLikeValueNode(node, source);

  if (!valueNode) {
    return false;
  }

  return /\basync\b/.test(getNodeText(valueNode, source).slice(0, 60));
}

function isExportedSymbol(symbol: IndexedSymbol, relation: FileRelation): boolean {
  if (symbol.exported) {
    return true;
  }

  return relation.exports.some((entry) => entry.symbolId === symbol.symbolId || entry.localName === symbol.name);
}

function resolveExportShape(symbol: IndexedSymbol | undefined, relation: FileRelation): PatternFingerprint['exportShape'] {
  if (!symbol) {
    if (relation.exports.length === 0) {
      return 'none';
    }

    const kinds = new Set(relation.exports.map((entry) => entry.kind));

    if (kinds.has('default') && kinds.size === 1) {
      return 'default';
    }

    if (kinds.size === 1) {
      return 'named';
    }

    return 'mixed';
  }

  const exports = relation.exports.filter((entry) => entry.symbolId === symbol.symbolId || entry.localName === symbol.name);

  if (exports.length === 0) {
    return 'none';
  }

  const kinds = new Set(exports.map((entry) => entry.kind));

  if (exports.some((entry) => entry.kind === 'default')) {
    return exports.length === 1 ? 'default' : 'mixed';
  }

  if (kinds.size === 1) {
    return 'named';
  }

  return 'mixed';
}

function determineSymbolRole(kind: PatternKind): PatternFingerprint['symbolRole'] {
  switch (kind) {
    case 'component':
      return 'component';
    case 'hook':
      return 'hook';
    case 'api-handler':
      return 'handler';
    case 'utility-export':
      return 'utility';
    case 'test-suite':
      return 'test';
    case 'storybook-story':
      return 'story';
    default:
      return 'module';
  }
}

function makeFingerprint(
  kind: PatternKind,
  signals: PatternSignal[],
  relation: FileRelation,
  symbol: IndexedSymbol | undefined,
  extra: {
    uiSignals?: string[];
    asyncSignals?: string[];
    responsibilitySignals?: string[];
  } = {},
): PatternFingerprint {
  return {
    patternKind: kind,
    structuralSignals: Array.from(new Set(signals.map((entry) => entry.type))).sort((left, right) => left.localeCompare(right)),
    importSet: getSupportingImports(relation),
    exportShape: resolveExportShape(symbol, relation),
    symbolRole: determineSymbolRole(kind),
    ...(extra.uiSignals && extra.uiSignals.length > 0
      ? { uiSignals: [...new Set(extra.uiSignals)].sort((left, right) => left.localeCompare(right)) }
      : {}),
    ...(extra.asyncSignals && extra.asyncSignals.length > 0
      ? { asyncSignals: [...new Set(extra.asyncSignals)].sort((left, right) => left.localeCompare(right)) }
      : {}),
    ...(extra.responsibilitySignals && extra.responsibilitySignals.length > 0
      ? {
          responsibilitySignals: [...new Set(extra.responsibilitySignals)].sort((left, right) =>
            left.localeCompare(right),
          ),
        }
      : {}),
  };
}

function hasJsxTagNames(node: Parser.SyntaxNode, source: string, tagNames: string[]): boolean {
  const normalizedTagNames = new Set(tagNames.map((entry) => entry.toLowerCase()));

  return hasDescendant(node, (child) => {
    if (
      child.type !== 'jsx_element' &&
      child.type !== 'jsx_self_closing_element' &&
      child.type !== 'jsx_opening_element'
    ) {
      return false;
    }

    const openingNode =
      child.type === 'jsx_element'
        ? child.namedChildren.find((entry) => entry.type === 'jsx_opening_element') ?? null
        : child;
    const nameNode = openingNode?.childForFieldName('name') ?? openingNode?.namedChildren[0] ?? null;

    if (!nameNode) {
      return false;
    }

    return normalizedTagNames.has(getNodeText(nameNode, source).trim().toLowerCase());
  });
}

function collectComponentResponsibilitySignals(
  relation: FileRelation,
  match: SymbolNodeMatch,
  source: string,
): string[] {
  const signals: string[] = [];
  const normalizedName = match.symbol.name.toLowerCase();
  const normalizedImports = relation.imports.map((entry) => entry.source.toLowerCase());
  const functionLike = getFunctionLikeValueNode(match.node, source);
  const hasLayoutName = /(^rootlayout$|layout$|^page$|page$)/i.test(match.symbol.name);
  const hasLayoutMarkup = hasJsxTagNames(functionLike ?? match.node, source, ['main', 'section', 'header', 'footer']);
  const hasPageLevelImports = normalizedImports.some(
    (entry) => /^next\//.test(entry) || /routing|router|navigation|metadata/.test(entry),
  );

  if (hasLayoutName || (hasLayoutMarkup && hasPageLevelImports)) {
    signals.push('layout-component');
  }

  if (/(button|input|textarea|checkbox|radio|toggle|switch|field|control)/i.test(match.symbol.name)) {
    signals.push('ui-control');
  }

  if (/(select)/i.test(match.symbol.name) || normalizedImports.some((entry) => /react-select/.test(entry))) {
    signals.push('ui-select');
  }

  if (/(modal|dialog|drawer)/i.test(match.symbol.name)) {
    signals.push('ui-modal');
  }

  return signals;
}

function collectHookResponsibilitySignals(relation: FileRelation, match: SymbolNodeMatch): string[] {
  const signals: string[] = [];
  const normalizedImports = relation.imports.map((entry) => entry.source.toLowerCase());

  if (
    /^use(Get|Fetch|Load)/.test(match.symbol.name) ||
    normalizedImports.some((entry) => /react-query|@tanstack\/react-query|swr/.test(entry))
  ) {
    signals.push('query-hook');
  }

  if (
    /^use[A-Za-z0-9]*Store$/.test(match.symbol.name) ||
    /^useStore/.test(match.symbol.name) ||
    normalizedImports.some((entry) => /zustand|store|context/.test(entry))
  ) {
    signals.push('store-hook');
  }

  if (
    /^use(Position|Overlay|Measure|Resize|Popover|Scroll|Viewport)/.test(match.symbol.name) ||
    /(overlay|measure|resize|position|popover)/i.test(match.symbol.name)
  ) {
    signals.push('dom-hook');
  }

  return signals;
}

function collectAsyncResponsibilitySignals(match: SymbolNodeMatch): string[] {
  const signals: string[] = [];

  if (/^(fetch|get|load)/i.test(match.symbol.name)) {
    signals.push('fetch-helper');
  }

  if (/^(create|update|delete|remove|save|patch|upsert|add)/i.test(match.symbol.name)) {
    signals.push('service-crud');
  }

  return signals;
}

function collectTestResponsibilitySignals(relation: FileRelation): string[] {
  const signals: string[] = [];
  const baseName = path.posix.basename(relation.filePath).replace(/\.[^.]+$/g, '');
  const normalizedImports = relation.imports.map((entry) => entry.source.toLowerCase());

  if (/^use[A-Z]/.test(baseName)) {
    signals.push('test-hook');
  } else if (/service|services|api|fetch|client/i.test(relation.filePath)) {
    signals.push('test-service');
  } else if (
    relation.filePath.endsWith('.test.tsx') ||
    normalizedImports.some((entry) => /testing-library\/react/.test(entry))
  ) {
    signals.push('test-component');
  }

  return signals;
}

function isHookName(name: string): boolean {
  return /^use[A-Z0-9_]/.test(name);
}

function isUppercaseName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function isFrameworkUiSurfaceSymbol(relation: FileRelation, symbolName: string): boolean {
  const normalizedFilePath = relation.filePath.replace(/\\/g, '/').toLowerCase();
  const baseName = path.posix.basename(normalizedFilePath);

  if (baseName === 'not-found.tsx' && symbolName === 'notFound') {
    return true;
  }

  return false;
}

function isLikelyComponentSymbol(
  relation: FileRelation,
  match: SymbolNodeMatch,
  source: string,
): boolean {
  const language = getLanguage(relation.filePath);

  if (language !== 'tsx' && language !== 'jsx') {
    return false;
  }

  const functionLike = getFunctionLikeValueNode(match.node, source);

  if (!functionLike || !hasJsxReturn(functionLike)) {
    return false;
  }

  return isUppercaseName(match.symbol.name) || isFrameworkUiSurfaceSymbol(relation, match.symbol.name);
}

function hasHookCalls(node: Parser.SyntaxNode, source: string): boolean {
  return hasDescendant(node, (child) => {
    if (child.type !== 'call_expression') {
      return false;
    }

    const functionNode = child.childForFieldName('function') ?? child.namedChildren[0];

    if (!functionNode) {
      return false;
    }

    return /^use[A-Z0-9_]/.test(getNodeText(functionNode, source).trim());
  });
}

function hasJsxReturn(node: Parser.SyntaxNode): boolean {
  return hasDescendant(node, (child) => (
    child.type === 'jsx_element' ||
    child.type === 'jsx_self_closing_element' ||
    child.type === 'jsx_fragment'
  ));
}

function hasMapRendering(node: Parser.SyntaxNode, source: string): boolean {
  return hasDescendant(node, (child) => {
    if (child.type !== 'jsx_expression') {
      return false;
    }

    return hasDescendant(child, (descendant) => {
      if (descendant.type !== 'call_expression') {
        return false;
      }

      return /\.map\s*\(/.test(getNodeText(descendant, source));
    });
  });
}

function hasConditionalRendering(node: Parser.SyntaxNode, source: string): boolean {
  return hasDescendant(node, (child) => (
    child.type === 'ternary_expression' ||
    (child.type === 'binary_expression' && getNodeText(child, source).includes('&&'))
  ));
}

function hasErrorHandling(node: Parser.SyntaxNode): boolean {
  return hasDescendant(node, (child) => child.type === 'try_statement' || child.type === 'catch_clause');
}

function hasAwait(node: Parser.SyntaxNode): boolean {
  return hasDescendant(node, (child) => child.type === 'await_expression');
}

function hasApiRequest(node: Parser.SyntaxNode, source: string, relation: FileRelation): boolean {
  if (relation.imports.some((entry) => /axios|api|service|client|request|fetch/i.test(entry.source))) {
    return true;
  }

  return hasDescendant(node, (child) => {
    if (child.type !== 'call_expression' && child.type !== 'await_expression') {
      return false;
    }

    return /\b(fetch|axios|request|client|service)\b/.test(getNodeText(child, source));
  });
}

function hasDescribeBlock(node: Parser.SyntaxNode, source: string): boolean {
  return hasDescendant(node, (child) => {
    if (child.type !== 'call_expression') {
      return false;
    }

    const functionNode = child.childForFieldName('function') ?? child.namedChildren[0];

    if (!functionNode) {
      return false;
    }

    const text = getNodeText(functionNode, source).trim();
    return text === 'describe' || text === 'it' || text === 'test';
  });
}

function isStorybookFile(filePath: string): boolean {
  return /\.(stories|story)\.(tsx?|jsx?)$/i.test(filePath);
}

function isStorybookSupportFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();

  return (
    /(^|\/)\.storybook\/(main|preview|manager)\.(tsx?|jsx?)$/i.test(normalized) ||
    /(^|\/)\.storybook\/.*(setup|vitest\.setup)\.(tsx?|jsx?)$/i.test(normalized) ||
    /(^|\/)(vitest|storybook)\.config\.(tsx?|jsx?)$/i.test(normalized)
  );
}

function hasStorybookMeta(tree: Parser.Tree, source: string): boolean {
  const hasDefaultMetaObject = tree.rootNode.namedChildren.some((child) => {
    if (child.type !== 'export_statement') {
      return false;
    }

    const text = getNodeText(child, source);
    return /export\s+default\s+\{/.test(text) && (/\btitle\s*:/.test(text) || /\bcomponent\s*:/.test(text));
  });

  if (hasDefaultMetaObject) {
    return true;
  }

  return /satisfies\s+Meta<|:\s*Meta<|StoryObj<|StoryFn<|ComponentMeta<|ComponentStory</.test(source);
}

function isApiHandlerFile(filePath: string): boolean {
  return /(^|\/)route\.(tsx?|jsx?)$/i.test(filePath) || /^pages\/api\//i.test(filePath);
}

function matchesHttpHandlerName(name: string): boolean {
  return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(name) || /^handler$/i.test(name);
}

function isUtilityPath(filePath: string): boolean {
  return /(^|\/)(utils?|helpers?)\//i.test(filePath);
}

function gatherSymbolNodeMatches(tree: Parser.Tree, source: string, symbols: IndexedSymbol[]): SymbolNodeMatch[] {
  const matches: SymbolNodeMatch[] = [];
  const symbolLookup = new Map<string, IndexedSymbol[]>();

  for (const symbol of symbols) {
    const key = `${symbol.kind}:${symbol.name}:${symbol.startLine}:${symbol.endLine}`;
    const existing = symbolLookup.get(key) ?? [];
    existing.push(symbol);
    symbolLookup.set(key, existing);
  }

  function visit(node: Parser.SyntaxNode): void {
    let candidateKind: SymbolKind | null = null;
    let candidateName: string | null = null;

    switch (node.type) {
      case 'function_declaration':
        candidateKind = 'function';
        candidateName = getNameNode(node) ? getNodeText(getNameNode(node) as Parser.SyntaxNode, source) : null;
        break;
      case 'class_declaration':
        candidateKind = 'class';
        candidateName = getNameNode(node) ? getNodeText(getNameNode(node) as Parser.SyntaxNode, source) : null;
        break;
      case 'interface_declaration':
        candidateKind = 'interface';
        candidateName = getNameNode(node) ? getNodeText(getNameNode(node) as Parser.SyntaxNode, source) : null;
        break;
      case 'type_alias_declaration':
        candidateKind = 'typeAlias';
        candidateName = getNameNode(node) ? getNodeText(getNameNode(node) as Parser.SyntaxNode, source) : null;
        break;
      case 'method_definition':
        candidateKind = 'method';
        candidateName = getNameNode(node) ? getNodeText(getNameNode(node) as Parser.SyntaxNode, source) : null;
        break;
      case 'variable_declarator': {
        const nameNode = getNameNode(node);

        if (nameNode?.type === 'identifier') {
          candidateKind = 'variable';
          candidateName = getNodeText(nameNode, source);
        }
        break;
      }
      default:
        break;
    }

    if (candidateKind && candidateName) {
      const key = `${candidateKind}:${candidateName}:${node.startPosition.row + 1}:${node.endPosition.row + 1}`;
      const candidates = symbolLookup.get(key) ?? [];

      for (const symbol of candidates) {
        matches.push({ symbol, node });
      }
    }

    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(tree.rootNode);
  return matches;
}

function detectReactComponent(
  relation: FileRelation,
  match: SymbolNodeMatch,
  source: string,
): PatternCandidate | null {
  if (!isLikelyComponentSymbol(relation, match, source)) {
    return null;
  }

  const functionLike = getFunctionLikeValueNode(match.node, source) as Parser.SyntaxNode;

  const signals: PatternSignal[] = [
    { type: 'react-function-component', strength: 'strong', note: 'component-like function or wrapped function returns JSX in a TSX file' },
    { type: 'jsx-return', strength: 'strong', note: 'function body contains JSX output' },
  ];

  if (hasHookCalls(functionLike, source)) {
    signals.push({ type: 'uses-hooks', strength: 'moderate', note: 'component body contains hook calls' });
  }

  const responsibilitySignals = collectComponentResponsibilitySignals(relation, match, source);

  return createPatternCandidate({
    kind: 'component',
    repoId: relation.repo,
    fileId: relation.fileId,
    symbolId: match.symbol.symbolId,
    name: match.symbol.name,
    language: getLanguage(relation.filePath),
    startLine: match.symbol.startLine,
    endLine: match.symbol.endLine,
    signals,
    fingerprint: makeFingerprint('component', signals, relation, match.symbol, {
      uiSignals: ['jsx-return', ...(signals.some((entry) => entry.type === 'uses-hooks') ? ['uses-hooks'] : [])],
      responsibilitySignals,
    }),
    supportingImports: getSupportingImports(relation),
    relatedSymbolIds: [],
    confidence: isExportedSymbol(match.symbol, relation) ? 'high' : 'medium',
  });
}

function detectCustomHook(
  relation: FileRelation,
  match: SymbolNodeMatch,
  source: string,
): PatternCandidate | null {
  if (!isHookName(match.symbol.name)) {
    return null;
  }

  const functionLike = getFunctionLikeValueNode(match.node, source);

  if (!functionLike || !hasHookCalls(functionLike, source)) {
    return null;
  }

  const signals: PatternSignal[] = [
    { type: 'custom-hook', strength: 'strong', note: 'function-like symbol follows the custom hook naming convention' },
    { type: 'uses-hooks', strength: 'strong', note: 'hook body contains hook calls' },
  ];
  const responsibilitySignals = collectHookResponsibilitySignals(relation, match);

  return createPatternCandidate({
    kind: 'hook',
    repoId: relation.repo,
    fileId: relation.fileId,
    symbolId: match.symbol.symbolId,
    name: match.symbol.name,
    language: getLanguage(relation.filePath),
    startLine: match.symbol.startLine,
    endLine: match.symbol.endLine,
    signals,
    fingerprint: makeFingerprint('hook', signals, relation, match.symbol, {
      uiSignals: ['uses-hooks'],
      responsibilitySignals,
    }),
    supportingImports: getSupportingImports(relation),
    relatedSymbolIds: [],
    confidence: 'high',
  });
}

function detectAsyncDataFlow(
  relation: FileRelation,
  match: SymbolNodeMatch,
  source: string,
): PatternCandidate | null {
  const functionLike = getFunctionLikeValueNode(match.node, source);

  if (!functionLike || !isAsyncFunctionLike(match.node, source) || !hasAwait(functionLike)) {
    return null;
  }

  const signals: PatternSignal[] = [
    { type: 'async-function', strength: 'strong', note: 'function is async and contains await expressions' },
  ];

  if (hasApiRequest(functionLike, source, relation)) {
    signals.push({ type: 'api-request', strength: 'moderate', note: 'async body appears to await an API or service request' });
  }

  if (hasErrorHandling(functionLike)) {
    signals.push({ type: 'error-handling', strength: 'moderate', note: 'async body includes try/catch style handling' });
  }

  if (!signals.some((entry) => entry.type === 'api-request' || entry.type === 'error-handling')) {
    return null;
  }
  const responsibilitySignals = collectAsyncResponsibilitySignals(match);

  return createPatternCandidate({
    kind: 'async-data-flow',
    repoId: relation.repo,
    fileId: relation.fileId,
    symbolId: match.symbol.symbolId,
    name: match.symbol.name,
    language: getLanguage(relation.filePath),
    startLine: match.symbol.startLine,
    endLine: match.symbol.endLine,
    signals,
    fingerprint: makeFingerprint('async-data-flow', signals, relation, match.symbol, {
      asyncSignals: signals.map((entry) => entry.type),
      responsibilitySignals,
    }),
    supportingImports: getSupportingImports(relation),
    relatedSymbolIds: [],
    confidence: signals.length >= 3 ? 'high' : 'medium',
  });
}

function detectListRendering(
  relation: FileRelation,
  match: SymbolNodeMatch,
  source: string,
): PatternCandidate | null {
  if (!isLikelyComponentSymbol(relation, match, source)) {
    return null;
  }

  const functionLike = getFunctionLikeValueNode(match.node, source);

  if (!functionLike || !hasJsxReturn(functionLike) || !hasMapRendering(functionLike, source)) {
    return null;
  }

  const signals: PatternSignal[] = [
    { type: 'map-rendering', strength: 'strong', note: 'JSX contains array.map rendering' },
  ];

  return createPatternCandidate({
    kind: 'list-rendering',
    repoId: relation.repo,
    fileId: relation.fileId,
    symbolId: match.symbol.symbolId,
    name: match.symbol.name,
    language: getLanguage(relation.filePath),
    startLine: match.symbol.startLine,
    endLine: match.symbol.endLine,
    signals,
    fingerprint: makeFingerprint('list-rendering', signals, relation, match.symbol, {
      uiSignals: ['map-rendering'],
    }),
    supportingImports: getSupportingImports(relation),
    relatedSymbolIds: [],
    confidence: 'high',
  });
}

function detectConditionalRendering(
  relation: FileRelation,
  match: SymbolNodeMatch,
  source: string,
): PatternCandidate | null {
  if (!isLikelyComponentSymbol(relation, match, source)) {
    return null;
  }

  const functionLike = getFunctionLikeValueNode(match.node, source);

  if (!functionLike || !hasJsxReturn(functionLike) || !hasConditionalRendering(functionLike, source)) {
    return null;
  }

  const signals: PatternSignal[] = [
    { type: 'conditional-render', strength: 'strong', note: 'JSX contains ternary or && conditional rendering' },
  ];

  return createPatternCandidate({
    kind: 'conditional-rendering',
    repoId: relation.repo,
    fileId: relation.fileId,
    symbolId: match.symbol.symbolId,
    name: match.symbol.name,
    language: getLanguage(relation.filePath),
    startLine: match.symbol.startLine,
    endLine: match.symbol.endLine,
    signals,
    fingerprint: makeFingerprint('conditional-rendering', signals, relation, match.symbol, {
      uiSignals: ['conditional-render'],
    }),
    supportingImports: getSupportingImports(relation),
    relatedSymbolIds: [],
    confidence: 'high',
  });
}

function detectUtilityExport(
  relation: FileRelation,
  match: SymbolNodeMatch,
): PatternCandidate | null {
  const language = getLanguage(relation.filePath);

  if (
    (language !== 'ts' && language !== 'js') ||
    !isUtilityPath(relation.filePath) ||
    !isExportedSymbol(match.symbol, relation)
  ) {
    return null;
  }

  if (isHookName(match.symbol.name) || isUppercaseName(match.symbol.name)) {
    return null;
  }

  const signals: PatternSignal[] = [
    { type: 'named-export', strength: 'strong', note: 'utility-like symbol is exported from a utility-oriented file' },
  ];

  return createPatternCandidate({
    kind: 'utility-export',
    repoId: relation.repo,
    fileId: relation.fileId,
    symbolId: match.symbol.symbolId,
    name: match.symbol.name,
    language: getLanguage(relation.filePath),
    startLine: match.symbol.startLine,
    endLine: match.symbol.endLine,
    signals,
    fingerprint: makeFingerprint('utility-export', signals, relation, match.symbol, {
      responsibilitySignals: collectAsyncResponsibilitySignals(match),
    }),
    supportingImports: getSupportingImports(relation),
    relatedSymbolIds: [],
    confidence: 'high',
  });
}

function detectApiHandler(
  relation: FileRelation,
  match: SymbolNodeMatch,
  source: string,
): PatternCandidate | null {
  if (!isApiHandlerFile(relation.filePath) || !matchesHttpHandlerName(match.symbol.name)) {
    return null;
  }

  const handlerLike = getHandlerLikeValueNode(match.node, source);

  if (!handlerLike) {
    return null;
  }

  const hasRouteExportContext = /(^|\/)route\.(tsx?|jsx?)$/i.test(relation.filePath) && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(match.symbol.name);
  const hasRequestHandlingBody = hasApiRequest(handlerLike, source, relation);
  const hasRequestResponseParameters = /\((?:[^)]*\b(req|request|res|response)\b[^)]*)\)/i.test(getNodeText(handlerLike, source));

  if (!hasRouteExportContext && !hasRequestHandlingBody && !hasRequestResponseParameters) {
    return null;
  }

  const signals: PatternSignal[] = [
    { type: 'route-handler', strength: 'strong', note: 'symbol name and file path match API handler conventions' },
  ];

  if (isAsyncFunctionLike(match.node, source)) {
    signals.push({ type: 'async-function', strength: 'moderate', note: 'API handler is async' });
  }

  if (hasRequestHandlingBody) {
    signals.push({ type: 'api-request', strength: 'weak', note: 'handler body references request or service-style calls' });
  }

  return createPatternCandidate({
    kind: 'api-handler',
    repoId: relation.repo,
    fileId: relation.fileId,
    symbolId: match.symbol.symbolId,
    name: match.symbol.name,
    language: getLanguage(relation.filePath),
    startLine: match.symbol.startLine,
    endLine: match.symbol.endLine,
    signals,
    fingerprint: makeFingerprint('api-handler', signals, relation, match.symbol, {
      asyncSignals: signals
        .filter((entry) => entry.type === 'async-function' || entry.type === 'api-request')
        .map((entry) => entry.type),
      responsibilitySignals: collectAsyncResponsibilitySignals(match),
    }),
    supportingImports: getSupportingImports(relation),
    relatedSymbolIds: [],
    confidence: 'high',
  });
}

function detectTestSuite(
  relation: FileRelation,
  tree: Parser.Tree,
  source: string,
): PatternCandidate | null {
  const importsTesting = relation.imports.some((entry) => /vitest|jest|testing-library/i.test(entry.source));

  if (!importsTesting || !hasDescribeBlock(tree.rootNode, source)) {
    return null;
  }

  const signals: PatternSignal[] = [
    { type: 'test-describe-block', strength: 'strong', note: 'test framework imports and describe/it usage were found' },
  ];
  const responsibilitySignals = collectTestResponsibilitySignals(relation);

  return createPatternCandidate({
    kind: 'test-suite',
    repoId: relation.repo,
    fileId: relation.fileId,
    name: path.posix.basename(relation.filePath).replace(/\.[^.]+$/g, ''),
    language: getLanguage(relation.filePath),
    startLine: 1,
    endLine: tree.rootNode.endPosition.row + 1,
    signals,
    fingerprint: makeFingerprint('test-suite', signals, relation, undefined, {
      responsibilitySignals,
    }),
    supportingImports: getSupportingImports(relation),
    relatedSymbolIds: relation.symbolIds,
    confidence: 'high',
  });
}

function detectStorybookStory(
  relation: FileRelation,
  tree: Parser.Tree,
  source: string,
): PatternCandidate | null {
  if (isStorybookSupportFile(relation.filePath)) {
    return null;
  }

  const hasExplicitStoryFileName = isStorybookFile(relation.filePath);
  const hasExplicitMeta = hasStorybookMeta(tree, source);

  if (!hasExplicitStoryFileName && !hasExplicitMeta) {
    return null;
  }

  const signals: PatternSignal[] = [
    { type: 'storybook-meta', strength: 'strong', note: 'story file or Storybook meta export was detected' },
  ];

  return createPatternCandidate({
    kind: 'storybook-story',
    repoId: relation.repo,
    fileId: relation.fileId,
    name: path.posix.basename(relation.filePath).replace(/\.[^.]+$/g, ''),
    language: getLanguage(relation.filePath),
    startLine: 1,
    endLine: tree.rootNode.endPosition.row + 1,
    signals,
    fingerprint: makeFingerprint('storybook-story', signals, relation, undefined),
    supportingImports: getSupportingImports(relation),
    relatedSymbolIds: relation.symbolIds,
    confidence: 'high',
  });
}

function collectPatternsForFile(
  relation: FileRelation,
  source: string,
  symbols: IndexedSymbol[],
): PatternCandidate[] {
  const tree = parseTypeScriptSource(relation.filePath, source);
  const matches = gatherSymbolNodeMatches(tree, source, symbols);
  const candidates: PatternCandidate[] = [];
  const seen = new Set<string>();

  function pushCandidate(candidate: PatternCandidate | null): void {
    if (!candidate) {
      return;
    }

    const dedupeKey = `${candidate.symbolId ?? candidate.fileId}:${candidate.kind}:${candidate.fingerprint.structuralSignals.join('|')}`;

    if (seen.has(dedupeKey)) {
      return;
    }

    seen.add(dedupeKey);
    candidates.push(candidate);
  }

  for (const match of matches) {
    pushCandidate(detectReactComponent(relation, match, source));
    pushCandidate(detectCustomHook(relation, match, source));
    pushCandidate(detectAsyncDataFlow(relation, match, source));
    pushCandidate(detectListRendering(relation, match, source));
    pushCandidate(detectConditionalRendering(relation, match, source));
    pushCandidate(detectUtilityExport(relation, match));
    pushCandidate(detectApiHandler(relation, match, source));
  }

  pushCandidate(detectTestSuite(relation, tree, source));
  pushCandidate(detectStorybookStory(relation, tree, source));
  candidates.sort(comparePatterns);

  return candidates;
}

export async function buildPatternIndex(reposRoot: string, index: SymbolIndex): Promise<PatternIndex> {
  const repositories = await listRepositories(reposRoot);
  const repositoryById = new Map(repositories.map((repository) => [repository.id, repository]));
  let patternIndex = createEmptyPatternIndex(index.schemaVersion, new Date().toISOString());

  for (const relation of Object.values(index.byFile)) {
    if (relation.classification !== 'source') {
      continue;
    }

    const language = getLanguage(relation.filePath);

    if (language !== 'js' && language !== 'jsx' && language !== 'ts' && language !== 'tsx') {
      continue;
    }

    const repository = repositoryById.get(relation.repo);

    if (!repository) {
      continue;
    }

    const file = await readRepositoryFile(repository, relation.filePath);
    const symbols = index.symbols.filter((entry) => entry.fileId === relation.fileId);
    const candidates = collectPatternsForFile(relation, file.content, symbols);

    for (const candidate of candidates) {
      patternIndex = registerPatternCandidateInIndex(patternIndex, candidate);
    }
  }

  return patternIndex;
}
