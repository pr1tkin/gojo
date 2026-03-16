import type Parser from 'tree-sitter';

import { resolveLocalFileTarget } from '../graph/local-resolution.js';
import type { RepoResolutionConfig } from '../graph/repo-config.js';
import type { IndexedSymbol, ImportBinding, ImportRecord, SymbolIndex } from '../symbol-index/types.js';

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
  confidence: 'high' | 'medium';
  note?: string;
}

export function isTsxFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.tsx');
}

export function getNodeText(node: Parser.SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

export function isPascalCaseComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_$]*$/.test(name);
}

export function extractChildComponentCandidate(
  node: Parser.SyntaxNode,
  source: string,
): UiComponentCandidate | null {
  const nameNode = node.childForFieldName('name');

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

function resolveTargetFileId(
  relation: SymbolIndex['byFile'][string],
  importRecord: ImportRecord,
  filesById: SymbolIndex['byFile'],
  repoConfigById: Record<string, RepoResolutionConfig>,
): string | null {
  const resolution = resolveLocalFileTarget(
    relation,
    importRecord.source,
    filesById,
    repoConfigById[relation.repo],
  );

  return resolution.status === 'resolved' ? resolution.targetFileId ?? null : null;
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
): ResolvedChildComponent | null {
  const sameFileSymbol = resolveSameFileChildSymbol(fileSymbols, childComponentName);

  if (sameFileSymbol) {
    return {
      childFilePath: sameFileSymbol.filePath,
      childSymbolId: sameFileSymbol.symbolId,
      confidence: candidateNote ? 'medium' : 'high',
      note: candidateNote ?? 'resolved to same-file symbol',
    };
  }

  for (const importRecord of relation.imports) {
    const binding = importRecord.bindings.find(
      (candidate) => candidate.localName === childComponentName,
    );

    if (!binding || binding.kind === 'namespace' || binding.isTypeOnly) {
      continue;
    }

    const targetFileId = resolveTargetFileId(relation, importRecord, index.byFile, repoConfigById);

    if (!targetFileId) {
      continue;
    }

    const targetRelation = index.byFile[targetFileId];

    if (!targetRelation) {
      continue;
    }

    const resolved = resolveImportedBinding(targetRelation, binding);

    return {
      childFilePath: targetRelation.filePath,
      childSymbolId: resolved?.symbolId,
      confidence: candidateNote ? 'medium' : resolved?.symbolId ? 'high' : 'medium',
      note: candidateNote ?? resolved?.note ?? `resolved from import ${importRecord.source}`,
    };
  }

  return null;
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
