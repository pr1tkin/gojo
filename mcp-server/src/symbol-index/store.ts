import fs from 'node:fs/promises';
import path from 'node:path';

import {
  getIndexesDirectory,
  getTempDirectory,
  getGenerationArtifactFilePath,
  resolveArtifactFilePath,
  resolveArtifactFilePathSync,
} from '../indexing/generation-store.js';
import { createDeclarationFingerprint, createFileId, createSymbolId } from './ids.js';
import type { FileRelation, IndexedSymbol, SymbolFrequencyStats, SymbolIndex } from './types.js';

function getSymbolIndexDirectory(): string {
  return getIndexesDirectory();
}

function getSymbolIndexTempFilePath(): string {
  return path.join(getTempDirectory(), 'symbol-index.tmp.json');
}

function getSymbolIndexFilePathInternal(): string {
  return path.join(getSymbolIndexDirectory(), 'symbol-index.json');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isStringNumberRecord(value: unknown): value is Record<string, number> {
  return isObject(value) && Object.values(value).every((entry) => typeof entry === 'number');
}

function isNestedStringNumberRecord(value: unknown): value is Record<string, Record<string, number>> {
  return isObject(value) && Object.values(value).every((entry) => isStringNumberRecord(entry));
}

function isImportBinding(value: unknown): boolean {
  return (
    isObject(value) &&
    (typeof value.importedName === 'string' || value.importedName === null) &&
    typeof value.localName === 'string' &&
    (value.kind === 'default' || value.kind === 'named' || value.kind === 'namespace') &&
    typeof value.isTypeOnly === 'boolean'
  );
}

function isImportRecord(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.fileId === 'string' &&
    typeof value.source === 'string' &&
    Array.isArray(value.bindings) &&
    value.bindings.every((binding) => isImportBinding(binding)) &&
    (value.resolvedKind === undefined ||
      value.resolvedKind === 'local-file' ||
      value.resolvedKind === 'package' ||
      value.resolvedKind === 'unknown') &&
    (value.resolvedTargetFileId === undefined || typeof value.resolvedTargetFileId === 'string')
  );
}

function isExportRecord(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.fileId === 'string' &&
    (value.kind === 'named' ||
      value.kind === 'default' ||
      value.kind === 'reexport-all' ||
      value.kind === 'reexport-named') &&
    (value.exportedName === undefined || typeof value.exportedName === 'string') &&
    (value.localName === undefined || typeof value.localName === 'string') &&
    (value.source === undefined || typeof value.source === 'string') &&
    (value.isTypeOnly === undefined || typeof value.isTypeOnly === 'boolean') &&
    (value.symbolId === undefined || typeof value.symbolId === 'string')
  );
}

function isFileRelation(value: unknown): value is FileRelation {
  return (
    isObject(value) &&
    typeof value.fileId === 'string' &&
    typeof value.repo === 'string' &&
    typeof value.filePath === 'string' &&
    (value.classification === 'source' ||
      value.classification === 'generated' ||
      value.classification === 'unknown') &&
    (value.coverage === undefined || value.coverage === 'full' || value.coverage === 'partial') &&
    (value.analysisWarnings === undefined || isStringArray(value.analysisWarnings)) &&
    isStringArray(value.symbolIds) &&
    isStringArray(value.symbolNames) &&
    Array.isArray(value.imports) &&
    value.imports.every((entry) => isImportRecord(entry)) &&
    Array.isArray(value.exports) &&
    value.exports.every((entry) => isExportRecord(entry)) &&
    isStringArray(value.importTokens)
  );
}

function createEmptySymbolFrequencyStats(): SymbolFrequencyStats {
  return {
    globalByName: Object.create(null) as SymbolFrequencyStats['globalByName'],
    globalByNameLower: Object.create(null) as SymbolFrequencyStats['globalByNameLower'],
    byRepo: Object.create(null) as SymbolFrequencyStats['byRepo'],
    exportedByName: Object.create(null) as SymbolFrequencyStats['exportedByName'],
    byKind: Object.create(null) as SymbolFrequencyStats['byKind'],
  };
}

function normalizeStringNumberRecord(value: unknown): Record<string, number> {
  const normalized = Object.create(null) as Record<string, number>;

  if (!isObject(value)) {
    return normalized;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number') {
      normalized[key] = entry;
    }
  }

  return normalized;
}

function normalizeNestedStringNumberRecord(value: unknown): Record<string, Record<string, number>> {
  const normalized = Object.create(null) as Record<string, Record<string, number>>;

  if (!isObject(value)) {
    return normalized;
  }

  for (const [key, entry] of Object.entries(value)) {
    normalized[key] = normalizeStringNumberRecord(entry);
  }

  return normalized;
}

function normalizeSymbolFrequencyStats(value: unknown): SymbolFrequencyStats {
  if (
    isObject(value) &&
    isStringNumberRecord(value.globalByName) &&
    isStringNumberRecord(value.globalByNameLower) &&
    isNestedStringNumberRecord(value.byRepo) &&
    isStringNumberRecord(value.exportedByName) &&
    isNestedStringNumberRecord(value.byKind)
  ) {
    return {
      globalByName: normalizeStringNumberRecord(value.globalByName),
      globalByNameLower: normalizeStringNumberRecord(value.globalByNameLower),
      byRepo: normalizeNestedStringNumberRecord(value.byRepo),
      exportedByName: normalizeStringNumberRecord(value.exportedByName),
      byKind: normalizeNestedStringNumberRecord(value.byKind),
    };
  }

  return createEmptySymbolFrequencyStats();
}

function createEmptyIndex(): SymbolIndex {
  return {
    schemaVersion: 4,
    symbols: [],
    byName: Object.create(null) as SymbolIndex['byName'],
    byNameLower: Object.create(null) as SymbolIndex['byNameLower'],
    byFile: Object.create(null) as SymbolIndex['byFile'],
    stats: createEmptySymbolFrequencyStats(),
  };
}

function normalizeSymbols(value: unknown): SymbolIndex['symbols'] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ordinalsByFile = new Map<string, Map<string, number>>();

  return value
    .filter((entry): entry is Record<string, unknown> => isObject(entry))
    .filter(
      (entry) =>
        typeof entry.name === 'string' &&
        typeof entry.kind === 'string' &&
        typeof entry.repo === 'string' &&
        typeof entry.filePath === 'string' &&
        typeof entry.startLine === 'number' &&
        typeof entry.endLine === 'number',
    )
    .map((entry) => {
      const repo = entry.repo as string;
      const filePath = entry.filePath as string;
      const kind = entry.kind as SymbolIndex['symbols'][number]['kind'];
      const name = entry.name as string;
      const fileId =
        typeof entry.fileId === 'string' ? entry.fileId : createFileId(repo, filePath);

      if (!ordinalsByFile.has(fileId)) {
        ordinalsByFile.set(fileId, new Map<string, number>());
      }

      const fileOrdinals = ordinalsByFile.get(fileId) as Map<string, number>;
      const ordinalKey = `${kind}:${name}`;
      const fallbackOrdinal = (fileOrdinals.get(ordinalKey) ?? 0) + 1;
      fileOrdinals.set(ordinalKey, fallbackOrdinal);

      const declarationFingerprint =
        typeof entry.declarationFingerprint === 'string'
          ? entry.declarationFingerprint
          : createDeclarationFingerprint(kind, name, fallbackOrdinal);
      const symbolId =
        typeof entry.symbolId === 'string'
          ? entry.symbolId
          : createSymbolId(fileId, kind, name, fallbackOrdinal);

      return {
        symbolId,
        fileId,
        name,
        kind,
        repo,
        filePath,
        startLine: entry.startLine as number,
        endLine: entry.endLine as number,
        exported: typeof entry.exported === 'boolean' ? entry.exported : undefined,
        declarationFingerprint,
      };
    });
}

function appendLookupEntry(
  lookup: Record<string, IndexedSymbol[]>,
  key: string,
  symbol: IndexedSymbol,
): void {
  const existingEntry = lookup[key];

  if (!Array.isArray(existingEntry)) {
    lookup[key] = [];
  }

  lookup[key].push(symbol);
}

function buildLookupTable(
  symbols: IndexedSymbol[],
  keySelector: (symbol: IndexedSymbol) => string,
): Record<string, IndexedSymbol[]> {
  const lookup = Object.create(null) as Record<string, IndexedSymbol[]>;

  for (const symbol of symbols) {
    appendLookupEntry(lookup, keySelector(symbol), symbol);
  }

  return lookup;
}

function normalizeFileRelationTable(value: unknown): Record<string, FileRelation> {
  const lookup = Object.create(null) as Record<string, FileRelation>;

  if (!isObject(value)) {
    return lookup;
  }

  for (const relation of Object.values(value)) {
    if (isFileRelation(relation)) {
      lookup[relation.fileId] = relation;
      continue;
    }

    if (
      isObject(relation) &&
      typeof relation.repo === 'string' &&
      typeof relation.filePath === 'string' &&
      isStringArray(relation.symbols) &&
      isStringArray(relation.imports)
    ) {
      const fileId = createFileId(relation.repo, relation.filePath);
      lookup[fileId] = {
        fileId,
        repo: relation.repo,
        filePath: relation.filePath,
        classification: 'source',
        coverage: 'partial',
        analysisWarnings: ['legacy file relation normalized without parser-backed metadata'],
        symbolIds: [],
        symbolNames: relation.symbols,
        imports: [],
        exports: [],
        importTokens: relation.imports,
      };
    }
  }

  return lookup;
}

function normalizeLoadedIndex(value: unknown): SymbolIndex {
  if (!isObject(value)) {
    return createEmptyIndex();
  }

  const symbols = normalizeSymbols(value.symbols);
  const byName = buildLookupTable(symbols, (symbol) => symbol.name);
  const byNameLower = buildLookupTable(symbols, (symbol) => symbol.name.toLowerCase());
  const byFile = normalizeFileRelationTable(value.byFile);

  return {
    schemaVersion:
      typeof value.schemaVersion === 'number' && Number.isInteger(value.schemaVersion)
        ? value.schemaVersion
        : 4,
    symbols,
    byName,
    byNameLower,
    byFile,
    stats: normalizeSymbolFrequencyStats(value.stats),
  };
}

export async function loadSymbolIndex(): Promise<SymbolIndex> {
  try {
    const content = await fs.readFile(await resolveArtifactFilePath('symbol-index.json'), 'utf8');
    const parsed = JSON.parse(content) as unknown;

    return normalizeLoadedIndex(parsed);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return createEmptyIndex();
    }

    throw error;
  }
}

export async function loadRequiredSymbolIndex(): Promise<SymbolIndex> {
  try {
    await fs.access(await resolveArtifactFilePath('symbol-index.json'));
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      throw new Error('Symbol index not found. Build the symbol index first.');
    }

    throw error;
  }

  return loadSymbolIndex();
}

export async function saveSymbolIndex(
  index: SymbolIndex,
  options: { generationId?: string } = {},
): Promise<string> {
  const symbolIndexDirectory = getSymbolIndexDirectory();
  const tempFilePath = getSymbolIndexTempFilePath();
  const filePath = options.generationId
    ? getGenerationArtifactFilePath(options.generationId, 'symbol-index.json')
    : getSymbolIndexFilePathInternal();

  if (options.generationId) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(index, null, 2), 'utf8');
  } else {
    await fs.mkdir(symbolIndexDirectory, { recursive: true });
    await fs.writeFile(tempFilePath, JSON.stringify(index, null, 2), 'utf8');
    await fs.rename(tempFilePath, filePath);
  }

  return filePath;
}

export function getSymbolIndexFilePath(): string {
  return resolveArtifactFilePathSync('symbol-index.json');
}
