import type Parser from 'tree-sitter';

import { resolveLocalFileTarget, type LocalResolutionResult } from '../graph/local-resolution.js';
import {
  getNearestRepoConfigEntry,
  type RepoResolutionConfig,
  type SimplePathMapping,
} from '../graph/repo-config.js';
import type { IndexedSymbol, ImportBinding, ImportRecord, SymbolIndex } from '../symbol-index/types.js';
import type { UiComponentResolution } from './types.js';

export interface UiComponentCandidate {
  name: string;
  note?: string;
}

export interface ResolvedParentSymbol {
  parentSymbolId?: string;
  parentSymbolName?: string;
}

export interface ResolvedChildComponent {
  childFilePath?: string;
  childSymbolId?: string;
  resolution: UiComponentResolution;
  confidence: 'high' | 'medium';
  note?: string;
  hint?: string;
  dependencySource?: string;
}

export function isJsxLikeFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return normalized.endsWith('.tsx') || normalized.endsWith('.jsx');
}

export function getNodeText(node: Parser.SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

export function getJsxOpeningNode(node: Parser.SyntaxNode): Parser.SyntaxNode {
  if (node.type === 'jsx_self_closing_element') {
    return node;
  }

  return node.namedChildren.find((child) => child.type === 'jsx_opening_element') ?? node;
}

export function isPascalCaseComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_$]*$/.test(name);
}

export function extractChildComponentCandidate(
  node: Parser.SyntaxNode,
  source: string,
): UiComponentCandidate | null {
  const nameNode = getJsxOpeningNode(node).childForFieldName('name') ?? node.childForFieldName('name');

  if (!nameNode) {
    return null;
  }

  if (nameNode.type === 'identifier') {
    const name = getNodeText(nameNode, source);
    return isPascalCaseComponentName(name) ? { name } : null;
  }

  if (nameNode.type === 'member_expression') {
    const propertyNode = nameNode.namedChildren[nameNode.namedChildren.length - 1];

    if (!propertyNode) {
      return null;
    }

    const propertyName = getNodeText(propertyNode, source);

    if (!isPascalCaseComponentName(propertyName)) {
      return null;
    }

    return {
      name: propertyName,
      note: `jsx member expression ${getNodeText(nameNode, source)}`,
    };
  }

  return null;
}

export function resolveParentSymbol(
  fileSymbols: IndexedSymbol[],
  line: number,
): ResolvedParentSymbol {
  const containingSymbols = fileSymbols
    .filter((symbol) => symbol.startLine <= line && symbol.endLine >= line)
    .sort((left, right) => {
      const leftSpan = left.endLine - left.startLine;
      const rightSpan = right.endLine - right.startLine;

      if (leftSpan !== rightSpan) {
        return leftSpan - rightSpan;
      }

      return left.startLine - right.startLine;
    });

  const symbol = containingSymbols[0];

  if (!symbol) {
    return {};
  }

  return {
    parentSymbolId: symbol.symbolId,
    parentSymbolName: symbol.name,
  };
}

export function resolveSameFileChildSymbol(
  fileSymbols: IndexedSymbol[],
  childComponentName: string,
): IndexedSymbol | null {
  const matches = fileSymbols.filter((symbol) => symbol.name === childComponentName);
  return matches.length === 1 ? matches[0] : null;
}

function resolveTargetFile(
  relation: SymbolIndex['byFile'][string],
  importRecord: ImportRecord,
  filesById: SymbolIndex['byFile'],
  repoConfigById: Record<string, RepoResolutionConfig>,
): {
  relation?: SymbolIndex['byFile'][string];
  resolution: LocalResolutionResult;
} {
  const resolution = resolveLocalFileTarget(
    relation,
    importRecord.source,
    filesById,
    repoConfigById[relation.repo],
  );

  if (resolution.status !== 'resolved' || !resolution.targetFileId) {
    return { resolution };
  }

  return {
    relation: filesById[resolution.targetFileId],
    resolution,
  };
}

function matchesConfiguredAlias(mapping: SimplePathMapping, source: string): boolean {
  if (!mapping.wildcard) {
    return source === mapping.aliasPattern;
  }

  return source.startsWith(mapping.aliasPrefix) && source.endsWith(mapping.aliasSuffix);
}

function isAliasLikeImportSource(
  relation: SymbolIndex['byFile'][string],
  source: string,
  repoConfigById: Record<string, RepoResolutionConfig>,
): boolean {
  if (source.startsWith('@/') || source.startsWith('~/') || source.startsWith('#/')) {
    return true;
  }

  const repoConfig = repoConfigById[relation.repo];
  const configEntry = getNearestRepoConfigEntry(repoConfig, relation.filePath);

  if (!configEntry) {
    return false;
  }

  return configEntry.pathMappings.some((mapping) => matchesConfiguredAlias(mapping, source));
}

function createSameFileResolution(
  sameFileSymbol: IndexedSymbol,
  candidateNote?: string,
): ResolvedChildComponent {
  return {
    childFilePath: sameFileSymbol.filePath,
    childSymbolId: sameFileSymbol.symbolId,
    resolution: 'resolved_local',
    confidence: candidateNote ? 'medium' : 'high',
    note: candidateNote ?? 'resolved to same-file symbol',
  };
}

function createUnresolvedImportResolution(
  relation: SymbolIndex['byFile'][string],
  importRecord: ImportRecord,
  resolution: LocalResolutionResult,
  candidateNote: string | undefined,
  repoConfigById: Record<string, RepoResolutionConfig>,
): ResolvedChildComponent {
  const aliasLikeSource = isAliasLikeImportSource(relation, importRecord.source, repoConfigById);

  if (aliasLikeSource) {
    return {
      resolution: 'alias_not_resolved',
      confidence: 'medium',
      note: candidateNote ?? `configured alias did not resolve for ${importRecord.source}`,
      hint: importRecord.source,
    };
  }

  if (resolution.status === 'non_local' || importRecord.resolvedKind === 'package') {
    return {
      resolution: 'external_dependency',
      confidence: 'medium',
      note: candidateNote ?? `component imported from external dependency ${importRecord.source}`,
      dependencySource: importRecord.source,
    };
  }

  return {
    resolution: 'unresolved',
    confidence: 'medium',
    note:
      candidateNote ??
      (resolution.status === 'ambiguous'
        ? `ambiguous local resolution for ${importRecord.source}`
        : `unresolved local component import ${importRecord.source}`),
    hint: importRecord.source,
  };
}

function resolveImportedBinding(
  targetRelation: SymbolIndex['byFile'][string],
  binding: ImportBinding,
): { symbolId?: string; note: string } | null {
  if (binding.kind === 'default') {
    const defaultExport = targetRelation.exports.find((entry) => entry.kind === 'default');

    if (!defaultExport) {
      return {
        note: 'resolved imported default component file',
      };
    }

    return {
      symbolId: defaultExport.symbolId,
      note: defaultExport.symbolId
        ? 'resolved imported default component symbol'
        : 'resolved imported default component file',
    };
  }

  if (binding.kind === 'named' && binding.importedName) {
    const namedExport = targetRelation.exports.find(
      (entry) => entry.exportedName === binding.importedName && entry.kind === 'named',
    );

    if (!namedExport) {
      return {
        note: `resolved imported component file for ${binding.importedName}`,
      };
    }

    return {
      symbolId: namedExport.symbolId,
      note: namedExport.symbolId
        ? `resolved imported symbol ${binding.importedName}`
        : `resolved imported component file for ${binding.importedName}`,
    };
  }

  return null;
}

export function resolveChildComponent(
  relation: SymbolIndex['byFile'][string],
  childComponentName: string,
  index: SymbolIndex,
  fileSymbols: IndexedSymbol[],
  repoConfigById: Record<string, RepoResolutionConfig>,
  candidateNote?: string,
): ResolvedChildComponent {
  const sameFileSymbol = resolveSameFileChildSymbol(fileSymbols, childComponentName);

  if (sameFileSymbol) {
    return createSameFileResolution(sameFileSymbol, candidateNote);
  }

  if (fileSymbols.filter((symbol) => symbol.name === childComponentName).length > 1) {
    return {
      resolution: 'unresolved',
      confidence: 'medium',
      note: candidateNote ?? `ambiguous same-file symbol match for ${childComponentName}`,
    };
  }

  for (const importRecord of relation.imports) {
    const binding = importRecord.bindings.find(
      (candidate) => candidate.localName === childComponentName,
    );

    if (!binding || binding.kind === 'namespace' || binding.isTypeOnly) {
      continue;
    }

    const target = resolveTargetFile(relation, importRecord, index.byFile, repoConfigById);

    if (!target.relation) {
      return createUnresolvedImportResolution(
        relation,
        importRecord,
        target.resolution,
        candidateNote,
        repoConfigById,
      );
    }

    const targetRelation = target.relation;

    const resolved = resolveImportedBinding(targetRelation, binding);

    return {
      childFilePath: targetRelation.filePath,
      childSymbolId: resolved?.symbolId,
      resolution: resolved?.symbolId ? 'resolved_local' : 'missing_symbol',
      confidence: candidateNote ? 'medium' : resolved?.symbolId ? 'high' : 'medium',
      note: candidateNote ?? resolved?.note ?? `resolved from import ${importRecord.source}`,
      hint: resolved?.symbolId ? undefined : importRecord.source,
      dependencySource: importRecord.resolvedKind === 'package' ? importRecord.source : undefined,
    };
  }

  return {
    resolution: 'unresolved',
    confidence: 'medium',
    note: candidateNote ?? 'unresolved JSX component candidate',
  };
}

export function walkJsxNodes(
  node: Parser.SyntaxNode,
  visit: (candidate: Parser.SyntaxNode) => void,
): void {
  if (node.type === 'jsx_element' || node.type === 'jsx_self_closing_element') {
    visit(node);
  }

  for (const child of node.namedChildren) {
    walkJsxNodes(child, visit);
  }
}
