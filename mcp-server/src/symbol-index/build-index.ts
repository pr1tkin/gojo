import fs from 'node:fs/promises';
import path from 'node:path';

import { listRepositories } from '../repositories.js';
import { extractSymbolsFromSource } from '../symbols.js';
import { isSupportedSymbolFile } from '../tree-sitter.js';
import { classifyFile } from './file-classification.js';
import { extractFileMetadata } from './file-metadata.js';
import { createDeclarationFingerprint, createFileId, createSymbolId } from './ids.js';
import type { FileRelation, IndexedSymbol, SymbolIndex } from './types.js';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
]);

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

async function collectRepositorySourceFiles(
  repositoryRoot: string,
  repositoryId: string,
  currentDirectory: string = repositoryRoot,
): Promise<string[]> {
  const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      files.push(...(await collectRepositorySourceFiles(repositoryRoot, repositoryId, entryPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = normalizeRelativePath(path.relative(repositoryRoot, entryPath));
    const classification = classifyFile(repositoryId, relativePath);

    if (classification.classification !== 'source') {
      continue;
    }

    if (isSupportedSymbolFile(relativePath)) {
      files.push(relativePath);
    }
  }

  return files;
}

function mapIndexedSymbols(
  repositoryId: string,
  filePath: string,
  source: string,
  symbols: ReturnType<typeof extractSymbolsFromSource>,
): IndexedSymbol[] {
  const lines = source.split(/\r?\n/);
  const fileId = createFileId(repositoryId, filePath);
  const symbolOrdinals = new Map<string, number>();

  return symbols.map((symbol) => {
    const ordinalKey = `${symbol.kind}:${symbol.name}`;
    const ordinal = (symbolOrdinals.get(ordinalKey) ?? 0) + 1;
    symbolOrdinals.set(ordinalKey, ordinal);

    return {
      symbolId: createSymbolId(fileId, symbol.kind, symbol.name, ordinal),
      fileId,
      name: symbol.name,
      kind: symbol.kind,
      repo: repositoryId,
      filePath,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      exported: /\bexport\b/.test(lines[symbol.startLine - 1] ?? ''),
      declarationFingerprint: createDeclarationFingerprint(symbol.kind, symbol.name, ordinal),
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

function createEmptySymbolIndex(): SymbolIndex {
  return {
    schemaVersion: 3,
    symbols: [],
    byName: Object.create(null) as Record<string, IndexedSymbol[]>,
    byNameLower: Object.create(null) as Record<string, IndexedSymbol[]>,
    byFile: Object.create(null) as Record<string, FileRelation>,
  };
}

function createFileRelationKey(repo: string, filePath: string): string {
  return createFileId(repo, filePath);
}

function createFileRelation(
  fileId: string,
  repo: string,
  filePath: string,
  classification: ReturnType<typeof classifyFile>['classification'],
  source: string,
  symbols: IndexedSymbol[],
): FileRelation {
  return extractFileMetadata(fileId, repo, filePath, classification, source, symbols);
}

export async function buildIndexedSymbols(reposRoot: string): Promise<SymbolIndex> {
  const repositories = await listRepositories(reposRoot);
  const index = createEmptySymbolIndex();

  for (const repository of repositories) {
    const files = await collectRepositorySourceFiles(repository.rootPath, repository.id);

    for (const filePath of files) {
      const absolutePath = path.join(repository.rootPath, filePath);
      const source = await fs.readFile(absolutePath, 'utf8');
      const fileId = createFileId(repository.id, filePath);
      const classification = classifyFile(repository.id, filePath);
      const repoScopedFilePath = `${repository.id}/${filePath}`;
      const symbols = extractSymbolsFromSource(source, repoScopedFilePath);
      const indexedSymbols = mapIndexedSymbols(repository.id, filePath, source, symbols);

      for (const symbol of indexedSymbols) {
        index.symbols.push(symbol);
        appendLookupEntry(index.byName, symbol.name, symbol);
        appendLookupEntry(index.byNameLower, symbol.name.toLowerCase(), symbol);
      }

      index.byFile[createFileRelationKey(repository.id, filePath)] = createFileRelation(
        fileId,
        repository.id,
        filePath,
        classification.classification,
        source,
        indexedSymbols,
      );
    }
  }

  return index;
}
