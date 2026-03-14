import fs from 'node:fs/promises';
import path from 'node:path';

import type { FileRelation, SymbolIndex } from './types.js';

const SYMBOL_INDEX_DIRECTORY = path.resolve(process.cwd(), '.data');
const SYMBOL_INDEX_TEMP_FILE_PATH = path.join(SYMBOL_INDEX_DIRECTORY, 'symbol-index.tmp.json');
const SYMBOL_INDEX_FILE_PATH = path.join(SYMBOL_INDEX_DIRECTORY, 'symbol-index.json');

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isFileRelation(value: unknown): value is FileRelation {
  return (
    isObject(value) &&
    typeof value.repo === 'string' &&
    typeof value.filePath === 'string' &&
    isStringArray(value.symbols) &&
    isStringArray(value.imports)
  );
}

function normalizeLookupTable(value: unknown): Record<string, SymbolIndex['symbols']> {
  const lookup = Object.create(null) as Record<string, SymbolIndex['symbols']>;

  if (!isObject(value)) {
    return lookup;
  }

  for (const [key, bucket] of Object.entries(value)) {
    if (Array.isArray(bucket)) {
      lookup[key] = bucket as SymbolIndex['symbols'];
    }
  }

  return lookup;
}

function normalizeFileRelationTable(value: unknown): Record<string, FileRelation> {
  const lookup = Object.create(null) as Record<string, FileRelation>;

  if (!isObject(value)) {
    return lookup;
  }

  for (const [key, relation] of Object.entries(value)) {
    if (isFileRelation(relation)) {
      lookup[key] = relation;
    }
  }

  return lookup;
}

function normalizeLoadedIndex(value: unknown): SymbolIndex {
  if (!isObject(value)) {
    return {
      symbols: [],
      byName: Object.create(null) as SymbolIndex['byName'],
      byNameLower: Object.create(null) as SymbolIndex['byNameLower'],
      byFile: Object.create(null) as SymbolIndex['byFile'],
    };
  }

  const symbols = Array.isArray(value.symbols) ? value.symbols : [];
  const byName = normalizeLookupTable(value.byName);
  const byNameLower = normalizeLookupTable(value.byNameLower);
  const byFile = normalizeFileRelationTable(value.byFile);

  return {
    symbols,
    byName,
    byNameLower,
    byFile,
  };
}

export async function loadSymbolIndex(): Promise<SymbolIndex> {
  try {
    const content = await fs.readFile(SYMBOL_INDEX_FILE_PATH, 'utf8');
    const parsed = JSON.parse(content) as unknown;

    return normalizeLoadedIndex(parsed);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return {
        symbols: [],
        byName: Object.create(null) as SymbolIndex['byName'],
        byNameLower: Object.create(null) as SymbolIndex['byNameLower'],
        byFile: Object.create(null) as SymbolIndex['byFile'],
      };
    }

    throw error;
  }
}

export async function loadRequiredSymbolIndex(): Promise<SymbolIndex> {
  try {
    await fs.access(SYMBOL_INDEX_FILE_PATH);
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

export async function saveSymbolIndex(index: SymbolIndex): Promise<string> {
  await fs.mkdir(SYMBOL_INDEX_DIRECTORY, { recursive: true });
  await fs.writeFile(SYMBOL_INDEX_TEMP_FILE_PATH, JSON.stringify(index, null, 2), 'utf8');
  await fs.rename(SYMBOL_INDEX_TEMP_FILE_PATH, SYMBOL_INDEX_FILE_PATH);
  return SYMBOL_INDEX_FILE_PATH;
}

export function getSymbolIndexFilePath(): string {
  return SYMBOL_INDEX_FILE_PATH;
}
