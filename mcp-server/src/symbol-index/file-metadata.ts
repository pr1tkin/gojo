import type Parser from 'tree-sitter';

import { createSyntheticDefaultExportName } from './ids.js';
import { parseTypeScriptSource } from '../tree-sitter.js';
import type { IndexedSymbol } from './types.js';
import type {
  ExportRecord,
  FileClassification,
  FileRelation,
  ImportBinding,
  ImportRecord,
} from './types.js';

function getNodeText(node: Parser.SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function normalizeStatementText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function inferResolvedKind(source: string): ImportRecord['resolvedKind'] {
  if (source.startsWith('.') || source.startsWith('/')) {
    return 'local-file';
  }

  if (source) {
    return 'package';
  }

  return 'unknown';
}

function parseNamedBinding(bindingText: string, statementTypeOnly: boolean): ImportBinding | null {
  const trimmed = bindingText.trim();

  if (!trimmed) {
    return null;
  }

  const bindingTypeOnly = trimmed.startsWith('type ');
  const rawBinding = bindingTypeOnly ? trimmed.slice(5).trim() : trimmed;
  const aliasParts = rawBinding.split(/\s+as\s+/i).map((part) => part.trim()).filter(Boolean);
  const importedName = aliasParts[0] ?? '';
  const localName = aliasParts[1] ?? importedName;

  if (!importedName || !localName) {
    return null;
  }

  return {
    importedName,
    localName,
    kind: 'named',
    isTypeOnly: statementTypeOnly || bindingTypeOnly,
  };
}

function parseImportBindings(clause: string, statementTypeOnly: boolean): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  const trimmedClause = clause.trim();

  if (!trimmedClause) {
    return bindings;
  }

  if (trimmedClause.startsWith('{') && trimmedClause.endsWith('}')) {
    const namedBindings = trimmedClause
      .slice(1, -1)
      .split(',')
      .map((binding) => parseNamedBinding(binding, statementTypeOnly))
      .filter((binding): binding is ImportBinding => binding !== null);

    bindings.push(...namedBindings);
    return bindings;
  }

  const namespaceMatch = trimmedClause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);

  if (namespaceMatch?.[1]) {
    bindings.push({
      importedName: null,
      localName: namespaceMatch[1],
      kind: 'namespace',
      isTypeOnly: statementTypeOnly,
    });
    return bindings;
  }

  const braceIndex = trimmedClause.indexOf('{');

  if (braceIndex >= 0) {
    const defaultPart = trimmedClause.slice(0, braceIndex).replace(/,$/, '').trim();
    const namedPart = trimmedClause.slice(braceIndex).trim();

    if (defaultPart) {
      bindings.push({
        importedName: 'default',
        localName: defaultPart,
        kind: 'default',
        isTypeOnly: statementTypeOnly,
      });
    }

    bindings.push(...parseImportBindings(namedPart, statementTypeOnly));
    return bindings;
  }

  bindings.push({
    importedName: 'default',
    localName: trimmedClause,
    kind: 'default',
    isTypeOnly: statementTypeOnly,
  });

  return bindings;
}

function parseImportRecord(statementText: string, fileId: string): ImportRecord | null {
  const normalized = normalizeStatementText(statementText);

  if (!normalized.startsWith('import ')) {
    return null;
  }

  const statementTypeOnly = /^import\s+type\b/.test(normalized);
  const sourceMatch = normalized.match(/\bfrom\s+['"]([^'"]+)['"]\s*;?$/) ??
    normalized.match(/^import\s+['"]([^'"]+)['"]\s*;?$/);
  const source = sourceMatch?.[1];

  if (!source) {
    return null;
  }

  const clauseMatch = normalized.match(/^import\s+(type\s+)?(.+?)\s+from\s+['"][^'"]+['"]\s*;?$/);
  const clause = clauseMatch?.[2]?.trim() ?? '';

  return {
    fileId,
    source,
    bindings: parseImportBindings(clause, statementTypeOnly),
    resolvedKind: inferResolvedKind(source),
  };
}

function parseExportSpecifier(
  specifierText: string,
): { exportedName: string; localName: string; isTypeOnly: boolean } | null {
  const trimmed = specifierText.trim();

  if (!trimmed) {
    return null;
  }

  const typeOnly = trimmed.startsWith('type ');
  const rawSpecifier = typeOnly ? trimmed.slice(5).trim() : trimmed;
  const aliasParts = rawSpecifier.split(/\s+as\s+/i).map((part) => part.trim()).filter(Boolean);
  const localName = aliasParts[0] ?? '';
  const exportedName = aliasParts[1] ?? localName;

  if (!localName || !exportedName) {
    return null;
  }

  return {
    exportedName,
    localName,
    isTypeOnly: typeOnly,
  };
}

function resolveSymbolId(
  symbolsByName: Map<string, IndexedSymbol[]>,
  localName: string | undefined,
): string | undefined {
  if (!localName) {
    return undefined;
  }

  const matches = symbolsByName.get(localName) ?? [];
  return matches.length === 1 ? matches[0].symbolId : undefined;
}

function resolveDefaultExportSymbolId(
  symbolsByName: Map<string, IndexedSymbol[]>,
  filePath: string,
  localName?: string,
): { localName?: string; symbolId?: string } {
  const namedSymbolId = resolveSymbolId(symbolsByName, localName);

  if (namedSymbolId) {
    return {
      localName,
      symbolId: namedSymbolId,
    };
  }

  const syntheticName = createSyntheticDefaultExportName(filePath);
  const syntheticSymbolId = resolveSymbolId(symbolsByName, syntheticName);

  if (!syntheticSymbolId) {
    return {
      localName,
      symbolId: undefined,
    };
  }

  return {
    localName: localName ?? syntheticName,
    symbolId: syntheticSymbolId,
  };
}

function parseExportRecord(
  statementText: string,
  fileId: string,
  filePath: string,
  symbolsByName: Map<string, IndexedSymbol[]>,
): ExportRecord[] {
  const normalized = normalizeStatementText(statementText);

  if (!normalized.startsWith('export ')) {
    return [];
  }

  const reexportAllMatch = normalized.match(/^export\s+\*\s+from\s+['"]([^'"]+)['"]\s*;?$/);

  if (reexportAllMatch?.[1]) {
    return [
      {
        fileId,
        kind: 'reexport-all',
        source: reexportAllMatch[1],
      },
    ];
  }

  const exportListMatch = normalized.match(/^export\s+(type\s+)?\{(.+)\}(?:\s+from\s+['"]([^'"]+)['"])?\s*;?$/);

  if (exportListMatch) {
    const statementTypeOnly = Boolean(exportListMatch[1]);
    const source = exportListMatch[3];
    const recordKind: ExportRecord['kind'] = source ? 'reexport-named' : 'named';

    return exportListMatch[2]
      .split(',')
      .map((specifier) => parseExportSpecifier(specifier))
      .filter((specifier): specifier is NonNullable<typeof specifier> => specifier !== null)
      .map((specifier) => ({
        fileId,
        kind: recordKind,
        exportedName: specifier.exportedName,
        localName: specifier.localName,
        source,
        isTypeOnly: statementTypeOnly || specifier.isTypeOnly,
        symbolId: source ? undefined : resolveSymbolId(symbolsByName, specifier.localName),
      }));
  }

  const defaultFunctionOrClassMatch = normalized.match(
    /^export\s+default\s+(async\s+)?(function|class)\s+([A-Za-z_$][\w$]*)/,
  );

  if (defaultFunctionOrClassMatch?.[3]) {
    const resolvedDefault = resolveDefaultExportSymbolId(
      symbolsByName,
      filePath,
      defaultFunctionOrClassMatch[3],
    );

    return [
      {
        fileId,
        kind: 'default',
        exportedName: 'default',
        localName: resolvedDefault.localName,
        symbolId: resolvedDefault.symbolId,
      },
    ];
  }

  const defaultIdentifierMatch = normalized.match(/^export\s+default\s+([A-Za-z_$][\w$]*)\s*;?$/);

  if (defaultIdentifierMatch?.[1]) {
    const resolvedDefault = resolveDefaultExportSymbolId(
      symbolsByName,
      filePath,
      defaultIdentifierMatch[1],
    );

    return [
      {
        fileId,
        kind: 'default',
        exportedName: 'default',
        localName: resolvedDefault.localName,
        symbolId: resolvedDefault.symbolId,
      },
    ];
  }

  if (/^export\s+default\b/.test(normalized)) {
    const resolvedDefault = resolveDefaultExportSymbolId(symbolsByName, filePath);

    return [
      {
        fileId,
        kind: 'default',
        exportedName: 'default',
        localName: resolvedDefault.localName,
        symbolId: resolvedDefault.symbolId,
      },
    ];
  }

  const declarationMatch = normalized.match(
    /^export\s+(type\s+)?(?:async\s+)?(function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/,
  );

  if (declarationMatch?.[3]) {
    const localName = declarationMatch[3];

    return [
      {
        fileId,
        kind: 'named',
        exportedName: localName,
        localName,
        isTypeOnly: Boolean(declarationMatch[1]) || declarationMatch[2] === 'interface' || declarationMatch[2] === 'type',
        symbolId: resolveSymbolId(symbolsByName, localName),
      },
    ];
  }

  return [];
}

function buildSymbolLookup(symbols: IndexedSymbol[]): Map<string, IndexedSymbol[]> {
  const lookup = new Map<string, IndexedSymbol[]>();

  for (const symbol of symbols) {
    const existing = lookup.get(symbol.name) ?? [];
    existing.push(symbol);
    lookup.set(symbol.name, existing);
  }

  return lookup;
}

export function collectImportTokens(imports: ImportRecord[]): string[] {
  const tokens = new Set<string>();

  for (const record of imports) {
    if (record.source) {
      tokens.add(record.source);
    }

    for (const binding of record.bindings) {
      tokens.add(binding.localName);

      if (binding.importedName) {
        tokens.add(binding.importedName);
      }
    }
  }

  return Array.from(tokens).sort((left, right) => left.localeCompare(right));
}

export function extractFileMetadata(
  fileId: string,
  repo: string,
  filePath: string,
  classification: FileClassification,
  source: string,
  symbols: IndexedSymbol[],
): FileRelation {
  const tree = parseTypeScriptSource(filePath, source);
  const symbolsByName = buildSymbolLookup(symbols);
  const imports: ImportRecord[] = [];
  const exports: ExportRecord[] = [];

  for (const child of tree.rootNode.namedChildren) {
    const statementText = getNodeText(child, source);

    if (child.type === 'import_statement') {
      const importRecord = parseImportRecord(statementText, fileId);

      if (importRecord) {
        imports.push(importRecord);
      }

      continue;
    }

    if (statementText.trimStart().startsWith('export ')) {
      exports.push(...parseExportRecord(statementText, fileId, filePath, symbolsByName));
    }
  }

  return {
    fileId,
    repo,
    filePath,
    classification,
    symbolIds: symbols.map((symbol) => symbol.symbolId),
    symbolNames: Array.from(new Set(symbols.map((symbol) => symbol.name))).sort((left, right) =>
      left.localeCompare(right),
    ),
    imports,
    exports,
    importTokens: collectImportTokens(imports),
  };
}
