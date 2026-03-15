import fs from 'node:fs/promises';
import path from 'node:path';

import { listRepositories } from '../repositories.js';
import { extractSymbolsFromSource } from '../symbols.js';
import { isSupportedSymbolFile } from '../tree-sitter.js';
import { classifyFile } from './file-classification.js';
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

  return symbols.map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    repo: repositoryId,
    filePath,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    exported: /\bexport\b/.test(lines[symbol.startLine - 1] ?? ''),
  }));
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
    symbols: [],
    byName: Object.create(null) as Record<string, IndexedSymbol[]>,
    byNameLower: Object.create(null) as Record<string, IndexedSymbol[]>,
    byFile: Object.create(null) as Record<string, FileRelation>,
  };
}

function createFileRelationKey(repo: string, filePath: string): string {
  return `${repo}/${filePath}`;
}

function extractImportedSymbolNames(source: string): string[] {
  const importedSymbols = new Set<string>();
  const namedImportPattern = /\bimport\s+([^'";]+?)\s+from\s+['"][^'"]+['"]/g;

  for (const match of source.matchAll(namedImportPattern)) {
    const clause = match[1]?.trim() ?? '';

    if (!clause) {
      continue;
    }

    if (clause.startsWith('{') && clause.endsWith('}')) {
      const names = clause
        .slice(1, -1)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => name.split(/\s+as\s+/i)[0]?.trim())
        .filter(Boolean) as string[];

      for (const name of names) {
        importedSymbols.add(name);
      }

      continue;
    }

    if (clause.includes('{')) {
      const [defaultImport, namedImports] = clause.split('{', 2);
      const defaultName = defaultImport.replace(/,$/, '').trim();

      if (defaultName) {
        importedSymbols.add(defaultName);
      }

      const namedSection = namedImports.replace('}', '');
      const names = namedSection
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => name.split(/\s+as\s+/i)[0]?.trim())
        .filter(Boolean) as string[];

      for (const name of names) {
        importedSymbols.add(name);
      }

      continue;
    }

    const namespaceMatch = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);

    if (namespaceMatch?.[1]) {
      importedSymbols.add(namespaceMatch[1]);
      continue;
    }

    if (/^[A-Za-z_$][\w$]*$/.test(clause)) {
      importedSymbols.add(clause);
    }
  }

  return Array.from(importedSymbols).sort((left, right) => left.localeCompare(right));
}

function extractImportedModulePaths(source: string): string[] {
  const modulePaths = new Set<string>();
  const modulePathPattern = /\b(?:import|export)\b(?:[\s\S]*?\bfrom\b\s+)?['"]([^'"]+)['"]/g;

  for (const match of source.matchAll(modulePathPattern)) {
    const modulePath = match[1]?.trim();

    if (modulePath) {
      modulePaths.add(modulePath);
    }
  }

  return Array.from(modulePaths).sort((left, right) => left.localeCompare(right));
}

function createFileRelation(
  repo: string,
  filePath: string,
  source: string,
  symbols: IndexedSymbol[],
): FileRelation {
  return {
    repo,
    filePath,
    symbols: Array.from(new Set(symbols.map((symbol) => symbol.name))).sort((left, right) =>
      left.localeCompare(right),
    ),
    imports: Array.from(
      new Set([...extractImportedSymbolNames(source), ...extractImportedModulePaths(source)]),
    ).sort((left, right) => left.localeCompare(right)),
  };
}

export async function buildIndexedSymbols(reposRoot: string): Promise<SymbolIndex> {
  const repositories = await listRepositories(reposRoot);
  const index = createEmptySymbolIndex();

  for (const repository of repositories) {
    const files = await collectRepositorySourceFiles(repository.rootPath, repository.id);

    for (const filePath of files) {
      const absolutePath = path.join(repository.rootPath, filePath);
      const source = await fs.readFile(absolutePath, 'utf8');
      const repoScopedFilePath = `${repository.id}/${filePath}`;
      const symbols = extractSymbolsFromSource(source, repoScopedFilePath);
      const indexedSymbols = mapIndexedSymbols(repository.id, filePath, source, symbols);

      for (const symbol of indexedSymbols) {
        index.symbols.push(symbol);
        appendLookupEntry(index.byName, symbol.name, symbol);
        appendLookupEntry(index.byNameLower, symbol.name.toLowerCase(), symbol);
      }

      index.byFile[createFileRelationKey(repository.id, filePath)] = createFileRelation(
        repository.id,
        filePath,
        source,
        indexedSymbols,
      );
    }
  }

  return index;
}
