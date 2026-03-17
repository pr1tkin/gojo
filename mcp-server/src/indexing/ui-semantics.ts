import fs from 'node:fs/promises';
import path from 'node:path';
import type Parser from 'tree-sitter';

import { listRepositories } from '../repositories.js';
import { collectRepositorySourceFiles } from '../symbol-index/build-index.js';
import { parseTypeScriptSource } from '../tree-sitter.js';
import { getNodeText } from '../ui-composition/shared.js';
import { getGenerationArtifactFilePath } from './generation-store.js';

const UI_SEMANTICS_SCHEMA_VERSION = 1;
const UI_SEMANTICS_ARTIFACT_FILE = 'ui-semantics.json';

export interface UiSemanticFileSummary {
  repoId: string;
  filePath: string;
  wrapperElements: string[];
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

  const expressionNode = valueNode.namedChildren[0];

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

function walk(node: Parser.SyntaxNode, visit: (node: Parser.SyntaxNode) => void): void {
  visit(node);

  for (const child of node.namedChildren) {
    walk(child, visit);
  }
}

function getJsxOpeningNode(node: Parser.SyntaxNode): Parser.SyntaxNode {
  if (node.type === 'jsx_self_closing_element') {
    return node;
  }

  return node.namedChildren.find((child) => child.type === 'jsx_opening_element') ?? node;
}

function buildUiSemanticFileSummary(
  repoId: string,
  filePath: string,
  tree: Parser.Tree,
  source: string,
): UiSemanticFileSummary {
  const wrapperElements = new Set<string>();
  const stylingSignals = new Set<string>();

  walk(tree.rootNode, (node) => {
    if (node.type === 'jsx_fragment') {
      wrapperElements.add('fragment');
      return;
    }

    if (node.type !== 'jsx_element' && node.type !== 'jsx_self_closing_element') {
      return;
    }

    const openingNode = getJsxOpeningNode(node);
    const nameNode = openingNode.childForFieldName('name') ?? node.childForFieldName('name');

    if (nameNode) {
      const rawName = getNodeText(nameNode, source).trim();

      if (rawName.length > 0) {
        wrapperElements.add(rawName);
      }
    }

    for (const child of openingNode.namedChildren.filter((entry) => entry.type === 'jsx_attribute')) {
      const propNameNode = child.childForFieldName('name') ?? child.namedChildren[0];

      if (!propNameNode) {
        continue;
      }

      const propName = getNodeText(propNameNode, source).trim();

      if (!['className', 'style', 'css', 'sx'].includes(propName)) {
        continue;
      }

      stylingSignals.add(`${propName}:${getAttributeValueKind(child, source)}`);
    }
  });

  return {
    repoId,
    filePath,
    wrapperElements: sortStrings(wrapperElements),
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
      wrapperElements: entry.wrapperElements.filter((item): item is string => typeof item === 'string'),
      stylingSignals: entry.stylingSignals.filter((item): item is string => typeof item === 'string'),
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
