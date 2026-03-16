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

function getFunctionLikeValueNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  if (node.type === 'variable_declarator') {
    const valueNode = node.childForFieldName('value');

    if (
      valueNode &&
      (valueNode.type === 'arrow_function' ||
        valueNode.type === 'function' ||
        valueNode.type === 'function_expression')
    ) {
      return valueNode;
    }

    return null;
  }

  if (node.type === 'function_declaration' || node.type === 'method_definition') {
    return node;
  }

  return null;
}

function isAsyncFunctionLike(node: Parser.SyntaxNode, source: string): boolean {
  const valueNode = getFunctionLikeValueNode(node);

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
  };
}

function isHookName(name: string): boolean {
  return /^use[A-Z0-9_]/.test(name);
}

function isUppercaseName(name: string): boolean {
  return /^[A-Z]/.test(name);
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

function hasStorybookMeta(tree: Parser.Tree, source: string, relation: FileRelation): boolean {
  if (isStorybookFile(relation.filePath)) {
    return true;
  }

  if (relation.imports.some((entry) => /@storybook\//.test(entry.source))) {
    return true;
  }

  return tree.rootNode.namedChildren.some((child) => {
    if (child.type !== 'export_statement') {
      return false;
    }

    const text = getNodeText(child, source);
    return /export\s+default\s+\{/.test(text) && /\btitle\s*:/.test(text);
  });
}

function isApiHandlerFile(filePath: string): boolean {
  return /(^|\/)route\.(tsx?|jsx?)$/i.test(filePath) || /(^|\/)api\//i.test(filePath) || /^pages\/api\//i.test(filePath);
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
  if (getLanguage(relation.filePath) !== 'tsx') {
    return null;
  }

  if (!isUppercaseName(match.symbol.name)) {
    return null;
  }

  const functionLike = getFunctionLikeValueNode(match.node);

  if (!functionLike || !hasJsxReturn(functionLike)) {
    return null;
  }

  const signals: PatternSignal[] = [
    { type: 'react-function-component', strength: 'strong', note: 'uppercase function-like symbol returns JSX in a TSX file' },
    { type: 'jsx-return', strength: 'strong', note: 'function body contains JSX output' },
  ];

  if (hasHookCalls(functionLike, source)) {
    signals.push({ type: 'uses-hooks', strength: 'moderate', note: 'component body contains hook calls' });
  }

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

  const functionLike = getFunctionLikeValueNode(match.node);

  if (!functionLike || !hasHookCalls(functionLike, source)) {
    return null;
  }

  const signals: PatternSignal[] = [
    { type: 'custom-hook', strength: 'strong', note: 'function-like symbol follows the custom hook naming convention' },
    { type: 'uses-hooks', strength: 'strong', note: 'hook body contains hook calls' },
  ];

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
  const functionLike = getFunctionLikeValueNode(match.node);

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
  const functionLike = getFunctionLikeValueNode(match.node);

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
  const functionLike = getFunctionLikeValueNode(match.node);

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
  if (getLanguage(relation.filePath) !== 'ts' || !isUtilityPath(relation.filePath) || !isExportedSymbol(match.symbol, relation)) {
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
    fingerprint: makeFingerprint('utility-export', signals, relation, match.symbol),
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

  const signals: PatternSignal[] = [
    { type: 'route-handler', strength: 'strong', note: 'symbol name and file path match API handler conventions' },
  ];

  if (isAsyncFunctionLike(match.node, source)) {
    signals.push({ type: 'async-function', strength: 'moderate', note: 'API handler is async' });
  }

  if (hasApiRequest(getFunctionLikeValueNode(match.node) ?? match.node, source, relation)) {
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

  return createPatternCandidate({
    kind: 'test-suite',
    repoId: relation.repo,
    fileId: relation.fileId,
    name: path.posix.basename(relation.filePath).replace(/\.[^.]+$/g, ''),
    language: getLanguage(relation.filePath),
    startLine: 1,
    endLine: tree.rootNode.endPosition.row + 1,
    signals,
    fingerprint: makeFingerprint('test-suite', signals, relation, undefined),
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
  if (!hasStorybookMeta(tree, source, relation)) {
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

  if (candidates.length > 0) {
    console.log(`[PatternExtraction] ${candidates.length} patterns detected in ${relation.filePath}`);
    for (const candidate of candidates) {
      console.log(`  - ${candidate.kind}`);
    }
  }

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

    if (language !== 'ts' && language !== 'tsx') {
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
