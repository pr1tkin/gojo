import fs from 'node:fs/promises';
import path from 'node:path';
import type Parser from 'tree-sitter';

import { listRepositories } from '../repositories.js';
import { collectRepositorySourceFiles } from '../symbol-index/build-index.js';
import { parseTypeScriptSource } from '../tree-sitter.js';
import { getJsxOpeningNode, getNodeText, isPascalCaseComponentName } from '../ui-composition/shared.js';
import { getGenerationArtifactFilePath } from './generation-store.js';

const UI_SEMANTICS_SCHEMA_VERSION = 2;
const UI_SEMANTICS_ARTIFACT_FILE = 'ui-semantics.json';

export interface UiSemanticFileSummary {
  repoId: string;
  filePath: string;
  wrapperElements: string[];
  structureSequence: string[];
  renderingSignals: string[];
  stylingSignals: string[];
}

export interface UiSemanticsIndex {
  schemaVersion: number;
  generatedAt: string;
  files: Record<string, UiSemanticFileSummary>;
}

function isUiSourceFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.tsx');
}

function sortStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeStringLiteral(value: string): string {
  return normalizeWhitespace(value.replace(/^['"`]|['"`]$/g, ''));
}

function normalizeClassTokens(value: string): string {
  return Array.from(new Set(normalizeWhitespace(value).split(' ').filter((token) => token.length > 0)))
    .sort((left, right) => left.localeCompare(right))
    .join(',');
}

function getExpressionNode(attribute: Parser.SyntaxNode): Parser.SyntaxNode | null {
  const valueNode = attribute.namedChildren.find((child) => child.type !== 'property_identifier');

  if (!valueNode || valueNode.type !== 'jsx_expression') {
    return null;
  }

  return valueNode.namedChildren[0] ?? null;
}

function getAttributeValueKind(attribute: Parser.SyntaxNode, source: string): string {
  const valueNode = attribute.namedChildren.find((child) => child.type !== 'property_identifier');

  if (!valueNode) {
    return 'boolean';
  }

  if (valueNode.type === 'string') {
    return 'string';
  }

  if (valueNode.type !== 'jsx_expression') {
    return valueNode.type;
  }

  const expressionNode = getExpressionNode(attribute);

  if (!expressionNode) {
    return 'unknown';
  }

  if (
    expressionNode.type === 'string' ||
    expressionNode.type === 'number' ||
    expressionNode.type === 'identifier' ||
    expressionNode.type === 'object' ||
    expressionNode.type === 'array'
  ) {
    return expressionNode.type;
  }

  const rawExpression = getNodeText(expressionNode, source).trim();

  if (rawExpression === 'true' || rawExpression === 'false') {
    return 'boolean';
  }

  return 'expression';
}

function getStyleObjectKeys(expressionNode: Parser.SyntaxNode, source: string): string[] {
  if (expressionNode.type !== 'object') {
    return [];
  }

  const keys: string[] = [];

  for (const child of expressionNode.namedChildren) {
    if (child.type !== 'pair') {
      continue;
    }

    const keyNode = child.childForFieldName('key') ?? child.namedChildren[0];

    if (!keyNode) {
      continue;
    }

    keys.push(normalizeWhitespace(getNodeText(keyNode, source)));
  }

  return sortStrings(keys);
}

function getStylingFingerprint(propName: string, attribute: Parser.SyntaxNode, source: string): string {
  const valueNode = attribute.namedChildren.find((child) => child.type !== 'property_identifier');

  if (!valueNode) {
    return `${propName}:boolean`;
  }

  if (valueNode.type === 'string') {
    const rawValue = normalizeStringLiteral(getNodeText(valueNode, source));

    if (propName === 'className') {
      return `${propName}:tokens:${normalizeClassTokens(rawValue)}`;
    }

    return `${propName}:string:${rawValue}`;
  }

  const expressionNode = getExpressionNode(attribute);

  if (!expressionNode) {
    return `${propName}:${valueNode.type}`;
  }

  if (expressionNode.type === 'string') {
    const rawValue = normalizeStringLiteral(getNodeText(expressionNode, source));

    if (propName === 'className') {
      return `${propName}:tokens:${normalizeClassTokens(rawValue)}`;
    }

    return `${propName}:string:${rawValue}`;
  }

  if (propName === 'style' && expressionNode.type === 'object') {
    return `${propName}:object-keys:${getStyleObjectKeys(expressionNode, source).join(',')}`;
  }

  if (propName === 'className' && expressionNode.type === 'template_string') {
    return `${propName}:template:${normalizeClassTokens(getNodeText(expressionNode, source))}`;
  }

  return `${propName}:${getAttributeValueKind(attribute, source)}:${normalizeWhitespace(getNodeText(expressionNode, source))}`;
}

function getJsxElementName(node: Parser.SyntaxNode, source: string): string | null {
  if (node.type === 'jsx_fragment') {
    return 'fragment';
  }

  if (node.type !== 'jsx_element' && node.type !== 'jsx_self_closing_element') {
    return null;
  }

  const openingNode = getJsxOpeningNode(node);
  const nameNode = openingNode.childForFieldName('name') ?? node.childForFieldName('name');

  if (!nameNode) {
    return null;
  }

  const rawName = getNodeText(nameNode, source).trim();
  return rawName.length > 0 ? rawName : null;
}

function hasJsxDescendant(node: Parser.SyntaxNode): boolean {
  if (
    node.type === 'jsx_element' ||
    node.type === 'jsx_self_closing_element' ||
    node.type === 'jsx_fragment'
  ) {
    return true;
  }

  return node.namedChildren.some((child) => hasJsxDescendant(child));
}

function collectRenderingSignals(node: Parser.SyntaxNode, source: string, target: Set<string>): void {
  if (node.type === 'jsx_expression') {
    const expressionNode = node.namedChildren[0];

    if (expressionNode) {
      if (expressionNode.type === 'ternary_expression' && hasJsxDescendant(expressionNode)) {
        target.add('conditional:ternary');
      }

      if (
        expressionNode.type === 'binary_expression' &&
        hasJsxDescendant(expressionNode)
      ) {
        const rawExpression = normalizeWhitespace(getNodeText(expressionNode, source));

        if (rawExpression.includes('&&')) {
          target.add('conditional:logical-and');
        }

        if (rawExpression.includes('||')) {
          target.add('conditional:logical-or');
        }
      }

      if (expressionNode.type === 'call_expression' && hasJsxDescendant(expressionNode)) {
        const rawExpression = normalizeWhitespace(getNodeText(expressionNode, source));

        if (rawExpression.includes('.map(')) {
          target.add('list:map');
        }
      }
    }
  }

  for (const child of node.namedChildren) {
    collectRenderingSignals(child, source, target);
  }
}

function collectStructureSequence(node: Parser.SyntaxNode, source: string, target: string[]): void {
  const elementName = getJsxElementName(node, source);

  if (elementName) {
    target.push(`${isPascalCaseComponentName(elementName) ? 'component' : 'element'}:${elementName}`);
  }

  for (const child of node.namedChildren) {
    collectStructureSequence(child, source, target);
  }
}

function buildUiSemanticFileSummary(
  repoId: string,
  filePath: string,
  tree: Parser.Tree,
  source: string,
): UiSemanticFileSummary {
  const wrapperElements = new Set<string>();
  const structureSequence: string[] = [];
  const renderingSignals = new Set<string>();
  const stylingSignals = new Set<string>();

  collectStructureSequence(tree.rootNode, source, structureSequence);
  collectRenderingSignals(tree.rootNode, source, renderingSignals);

  for (const sequenceEntry of structureSequence) {
    wrapperElements.add(sequenceEntry.replace(/^(component|element):/, ''));
  }

  const visitStyling = (node: Parser.SyntaxNode): void => {
    if (node.type !== 'jsx_element' && node.type !== 'jsx_self_closing_element') {
      for (const child of node.namedChildren) {
        visitStyling(child);
      }
      return;
    }

    const openingNode = getJsxOpeningNode(node);

    for (const child of openingNode.namedChildren.filter((entry) => entry.type === 'jsx_attribute')) {
      const propNameNode = child.childForFieldName('name') ?? child.namedChildren[0];

      if (!propNameNode) {
        continue;
      }

      const propName = getNodeText(propNameNode, source).trim();

      if (!['className', 'style', 'css', 'sx'].includes(propName)) {
        continue;
      }

      stylingSignals.add(getStylingFingerprint(propName, child, source));
    }

    for (const child of node.namedChildren) {
      visitStyling(child);
    }
  };

  visitStyling(tree.rootNode);

  return {
    repoId,
    filePath,
    wrapperElements: sortStrings(wrapperElements),
    structureSequence,
    renderingSignals: sortStrings(renderingSignals),
    stylingSignals: sortStrings(stylingSignals),
  };
}

export async function buildUiSemanticsIndex(reposRoot: string): Promise<UiSemanticsIndex> {
  const repositories = await listRepositories(reposRoot);
  const files: Record<string, UiSemanticFileSummary> = {};

  for (const repository of repositories) {
    const repoId = repository.id;
    const repoRoot = repository.rootPath;
    const sourceFiles = (await collectRepositorySourceFiles(repoRoot, repoId)).filter(isUiSourceFile);

    for (const filePath of sourceFiles) {
      const absolutePath = path.join(repoRoot, filePath);
      const source = await fs.readFile(absolutePath, 'utf8');
      const tree = parseTypeScriptSource(filePath, source);
      files[`${repoId}/${filePath}`] = buildUiSemanticFileSummary(repoId, filePath, tree, source);
    }
  }

  return {
    schemaVersion: UI_SEMANTICS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    files,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeUiSemanticsIndex(value: unknown): UiSemanticsIndex | null {
  if (!isObject(value) || typeof value.schemaVersion !== 'number' || !isObject(value.files)) {
    return null;
  }

  const files: Record<string, UiSemanticFileSummary> = {};

  for (const [key, entry] of Object.entries(value.files)) {
    if (
      !isObject(entry) ||
      typeof entry.repoId !== 'string' ||
      typeof entry.filePath !== 'string' ||
      !Array.isArray(entry.wrapperElements) ||
      !Array.isArray(entry.stylingSignals)
    ) {
      return null;
    }

    files[key] = {
      repoId: entry.repoId,
      filePath: entry.filePath,
      wrapperElements: normalizeStringArray(entry.wrapperElements),
      structureSequence: normalizeStringArray(entry.structureSequence),
      renderingSignals: normalizeStringArray(entry.renderingSignals),
      stylingSignals: normalizeStringArray(entry.stylingSignals),
    };
  }

  return {
    schemaVersion: value.schemaVersion,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
    files,
  };
}

export async function loadUiSemanticsIndexForGeneration(generationId: string): Promise<UiSemanticsIndex | null> {
  try {
    const content = await fs.readFile(getGenerationArtifactFilePath(generationId, UI_SEMANTICS_ARTIFACT_FILE), 'utf8');
    return normalizeUiSemanticsIndex(JSON.parse(content) as unknown);
  } catch {
    return null;
  }
}

export function createEmptyUiSemanticsIndex(): UiSemanticsIndex {
  return {
    schemaVersion: UI_SEMANTICS_SCHEMA_VERSION,
    generatedAt: '',
    files: {},
  };
}

export function getUiSemanticsArtifactFileName(): string {
  return UI_SEMANTICS_ARTIFACT_FILE;
}
