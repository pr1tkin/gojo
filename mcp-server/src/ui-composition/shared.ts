import type Parser from 'tree-sitter';

import { resolveLocalFileTarget, type LocalResolutionResult } from '../graph/local-resolution.js';
import type { RepoResolutionConfig } from '../graph/repo-config.js';
import type { IndexedSymbol, ImportBinding, ImportRecord, SymbolIndex } from '../symbol-index/types.js';
import type {
  UiComponentResolution,
  UiMemberExpressionMetadata,
  UiMemberExpressionResolution,
} from './types.js';

export interface UiComponentCandidate {
  name: string;
  note?: string;
  memberExpression?: Omit<UiMemberExpressionMetadata, 'resolutionKind'>;
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
  memberExpression?: UiMemberExpressionMetadata;
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

function getMemberExpressionObjectNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  return node.childForFieldName('object') ?? node.namedChildren[0] ?? null;
}

function getMemberExpressionPropertyNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  return node.childForFieldName('property') ?? node.namedChildren[node.namedChildren.length - 1] ?? null;
}

function extractMemberExpressionSegments(
  node: Parser.SyntaxNode,
  source: string,
): string[] {
  if (node.type === 'identifier' || node.type === 'property_identifier') {
    const text = getNodeText(node, source).trim();
    return text ? [text] : [];
  }

  if (node.type === 'member_expression') {
    const objectNode = getMemberExpressionObjectNode(node);
    const propertyNode = getMemberExpressionPropertyNode(node);

    if (!objectNode || !propertyNode) {
      return [];
    }

    const objectSegments = extractMemberExpressionSegments(objectNode, source);
    const propertyText = getNodeText(propertyNode, source).trim();

    if (objectSegments.length === 0 || !propertyText) {
      return [];
    }

    return [...objectSegments, propertyText];
  }

  return [];
}

function isFrameworkMemberName(name: string): boolean {
  return name === 'Provider' || name === 'Consumer';
}

function createMemberExpressionMetadata(
  candidate: UiComponentCandidate,
  resolutionKind: UiMemberExpressionResolution,
): UiMemberExpressionMetadata | undefined {
  if (!candidate.memberExpression) {
    return undefined;
  }

  return {
    ...candidate.memberExpression,
    resolutionKind,
  };
}

function isFrameworkLikeMemberCandidate(candidate: UiComponentCandidate): boolean {
  const memberExpression = candidate.memberExpression;

  if (!memberExpression) {
    return false;
  }

  const terminalMember = memberExpression.members[memberExpression.members.length - 1];

  return Boolean(
    terminalMember &&
    isFrameworkMemberName(terminalMember) &&
    (
      memberExpression.baseName.endsWith('Context') ||
      /(?:^|[.])[^.]*Context\.(Provider|Consumer)$/.test(memberExpression.expression)
    ),
  );
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
    const segments = extractMemberExpressionSegments(nameNode, source);

    if (segments.length < 2) {
      return null;
    }

    const propertyName = segments[segments.length - 1] ?? '';

    if (!isPascalCaseComponentName(propertyName) && !isFrameworkMemberName(propertyName)) {
      return null;
    }

    const expression = segments.join('.');

    return {
      name: expression,
      note: `jsx member expression ${expression}`,
      memberExpression: {
        expression,
        baseName: segments[0] ?? '',
        members: segments.slice(1),
      },
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

function createSameFileResolution(
  sameFileSymbol: IndexedSymbol,
  candidate: UiComponentCandidate,
): ResolvedChildComponent {
  return {
    childFilePath: sameFileSymbol.filePath,
    childSymbolId: sameFileSymbol.symbolId,
    resolution: 'resolved_local',
    confidence: candidate.note ? 'medium' : 'high',
    note: candidate.note ?? 'resolved to same-file symbol',
    memberExpression: createMemberExpressionMetadata(candidate, 'resolved_local_member'),
  };
}

function createUnresolvedImportResolution(
  importRecord: ImportRecord,
  resolution: LocalResolutionResult,
  candidate: UiComponentCandidate,
): ResolvedChildComponent {
  const memberExpression = candidate.memberExpression
    ? createMemberExpressionMetadata(candidate, 'unresolved_member')
    : undefined;

  if (resolution.matchedAlias) {
    return {
      resolution: 'alias_not_resolved',
      confidence: 'medium',
      note: candidate.note ?? `configured alias did not resolve for ${importRecord.source}`,
      hint: importRecord.source,
      memberExpression,
    };
  }

  if (resolution.status === 'non_local' || importRecord.resolvedKind === 'package') {
    return {
      resolution: 'external_dependency',
      confidence: 'medium',
      note:
        candidate.note ??
        (candidate.memberExpression
          ? `member expression on external dependency ${importRecord.source}`
          : `component imported from external dependency ${importRecord.source}`),
      dependencySource: importRecord.source,
      memberExpression: candidate.memberExpression
        ? createMemberExpressionMetadata(candidate, 'external_dependency_member')
        : undefined,
    };
  }

  return {
    resolution: 'unresolved',
    confidence: 'medium',
    note:
      candidate.note ??
      (resolution.status === 'ambiguous'
        ? `ambiguous local resolution for ${importRecord.source}`
        : `unresolved local component import ${importRecord.source}`),
    hint: importRecord.source,
    memberExpression,
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

function findImportBindingByLocalName(
  relation: SymbolIndex['byFile'][string],
  localName: string,
): { importRecord: ImportRecord; binding: ImportBinding } | null {
  for (const importRecord of relation.imports) {
    const binding = importRecord.bindings.find((candidate) => candidate.localName === localName);

    if (binding && !binding.isTypeOnly) {
      return { importRecord, binding };
    }
  }

  return null;
}

function resolveImportedMemberBinding(
  targetRelation: SymbolIndex['byFile'][string],
  memberName: string,
): { symbolId?: string; note: string } | null {
  const namedExport = targetRelation.exports.find(
    (entry) =>
      entry.kind === 'named' &&
      entry.exportedName === memberName &&
      entry.isTypeOnly !== true,
  );

  if (!namedExport) {
    return null;
  }

  return {
    symbolId: namedExport.symbolId,
    note: namedExport.symbolId
      ? `resolved imported member ${memberName}`
      : `resolved imported member file for ${memberName}`,
  };
}

function createFrameworkMemberResolution(
  candidate: UiComponentCandidate,
  options: {
    dependencySource?: string;
    hint?: string;
  } = {},
): ResolvedChildComponent {
  return {
    resolution: 'external_dependency',
    confidence: 'medium',
    note: `recognized framework-like member expression ${candidate.name}`,
    dependencySource: options.dependencySource,
    hint: options.hint,
    memberExpression: createMemberExpressionMetadata(candidate, 'framework_member'),
  };
}

function createUnresolvedMemberResolution(
  candidate: UiComponentCandidate,
  note: string,
  options: {
    hint?: string;
    dependencySource?: string;
    resolution?: UiComponentResolution;
  } = {},
): ResolvedChildComponent {
  return {
    resolution: options.resolution ?? 'unresolved',
    confidence: 'medium',
    note,
    hint: options.hint,
    dependencySource: options.dependencySource,
    memberExpression: createMemberExpressionMetadata(candidate, 'unresolved_member'),
  };
}

function resolveMemberExpressionCandidate(
  relation: SymbolIndex['byFile'][string],
  candidate: UiComponentCandidate,
  index: SymbolIndex,
  repoConfigById: Record<string, RepoResolutionConfig>,
): ResolvedChildComponent {
  const memberExpression = candidate.memberExpression;

  if (!memberExpression) {
    return createUnresolvedMemberResolution(candidate, 'member expression metadata was not available');
  }

  const terminalMember = memberExpression.members[memberExpression.members.length - 1];

  if (!terminalMember) {
    return createUnresolvedMemberResolution(candidate, `member expression ${candidate.name} has no terminal member`);
  }

  const importedBase = findImportBindingByLocalName(relation, memberExpression.baseName);

  if (!importedBase) {
    if (isFrameworkLikeMemberCandidate(candidate)) {
      return createFrameworkMemberResolution(candidate);
    }

    return createUnresolvedMemberResolution(
      candidate,
      `unresolved JSX member expression base ${memberExpression.baseName}`,
    );
  }

  const target = resolveTargetFile(relation, importedBase.importRecord, index.byFile, repoConfigById);

  if (!target.relation) {
    const unresolvedImport = createUnresolvedImportResolution(
      importedBase.importRecord,
      target.resolution,
      candidate,
    );

    if (
      unresolvedImport.resolution === 'external_dependency' &&
      isFrameworkLikeMemberCandidate(candidate)
    ) {
      return createFrameworkMemberResolution(candidate, {
        dependencySource: unresolvedImport.dependencySource,
        hint: unresolvedImport.hint,
      });
    }

    return unresolvedImport;
  }

  const resolvedMember = resolveImportedMemberBinding(target.relation, terminalMember);

  if (resolvedMember) {
    return {
      childFilePath: target.relation.filePath,
      childSymbolId: resolvedMember.symbolId,
      resolution: resolvedMember.symbolId ? 'resolved_local' : 'missing_symbol',
      confidence: resolvedMember.symbolId ? 'high' : 'medium',
      note: candidate.note ?? resolvedMember.note,
      hint: resolvedMember.symbolId ? undefined : importedBase.importRecord.source,
      memberExpression: createMemberExpressionMetadata(candidate, 'resolved_local_member'),
    };
  }

  if (isFrameworkLikeMemberCandidate(candidate)) {
    return createFrameworkMemberResolution(candidate, {
      hint: importedBase.importRecord.source,
    });
  }

  return createUnresolvedMemberResolution(
    candidate,
    `local member expression ${candidate.name} could not be verified from module exports`,
    {
      hint: importedBase.importRecord.source,
    },
  );
}

export function resolveChildComponent(
  relation: SymbolIndex['byFile'][string],
  candidate: UiComponentCandidate,
  index: SymbolIndex,
  fileSymbols: IndexedSymbol[],
  repoConfigById: Record<string, RepoResolutionConfig>,
): ResolvedChildComponent {
  if (candidate.memberExpression) {
    return resolveMemberExpressionCandidate(relation, candidate, index, repoConfigById);
  }

  const childComponentName = candidate.name;
  const sameFileSymbol = resolveSameFileChildSymbol(fileSymbols, childComponentName);

  if (sameFileSymbol) {
    return createSameFileResolution(sameFileSymbol, candidate);
  }

  if (fileSymbols.filter((symbol) => symbol.name === childComponentName).length > 1) {
    return {
      resolution: 'unresolved',
      confidence: 'medium',
      note: candidate.note ?? `ambiguous same-file symbol match for ${childComponentName}`,
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
        importRecord,
        target.resolution,
        candidate,
      );
    }

    const targetRelation = target.relation;

    const resolved = resolveImportedBinding(targetRelation, binding);

    return {
      childFilePath: targetRelation.filePath,
      childSymbolId: resolved?.symbolId,
      resolution: resolved?.symbolId ? 'resolved_local' : 'missing_symbol',
      confidence: candidate.note ? 'medium' : resolved?.symbolId ? 'high' : 'medium',
      note: candidate.note ?? resolved?.note ?? `resolved from import ${importRecord.source}`,
      hint: resolved?.symbolId ? undefined : importRecord.source,
      dependencySource: importRecord.resolvedKind === 'package' ? importRecord.source : undefined,
    };
  }

  return {
    resolution: 'unresolved',
    confidence: 'medium',
    note: candidate.note ?? 'unresolved JSX component candidate',
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
