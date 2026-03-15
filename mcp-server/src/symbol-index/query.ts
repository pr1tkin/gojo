import path from 'node:path';

import type { SymbolKind } from '../types.js';
import { createFileId } from './ids.js';
import { loadRequiredSymbolIndex } from './store.js';
import type { FileRelation, IndexedSymbol, SymbolIndex } from './types.js';

export async function findSymbol(
  name: string,
  kind?: SymbolKind,
  repo?: string,
): Promise<IndexedSymbol[]> {
  const normalizedName = name.trim();

  if (!normalizedName) {
    throw new Error('name must not be empty.');
  }

  const index = await loadRequiredSymbolIndex();
  const candidates = index.byName[normalizedName] ?? [];

  return candidates.filter((symbol) => {
    if (kind && symbol.kind !== kind) {
      return false;
    }

    if (repo && symbol.repo !== repo) {
      return false;
    }

    return true;
  });
}

function normalizeFilePath(filePath: string): string {
  const normalized = filePath.trim().replace(/\\/g, '/');

  if (!normalized) {
    throw new Error('filePath must not be empty.');
  }

  return normalized;
}

function resolveFileRelationKey(index: SymbolIndex, filePath: string, repo?: string): string {
  const normalizedPath = normalizeFilePath(filePath);

  if (repo) {
    const repoRelativePath = normalizedPath.replace(/^\/+/, '');
    const directKey = createFileId(repo, repoRelativePath);

    if (index.byFile[directKey]) {
      return directKey;
    }
  }

  const normalizedKey = normalizedPath.replace(/^\/+/, '');

  if (index.byFile[normalizedKey]) {
    return normalizedKey;
  }

  const segments = normalizedKey.split('/').filter(Boolean);

  if (segments.length >= 2) {
    const repoScopedKey = createFileId(segments[0], segments.slice(1).join('/'));

    if (index.byFile[repoScopedKey]) {
      return repoScopedKey;
    }
  }

  throw new Error(`File relation not found: ${normalizedPath}`);
}

export async function getFileRelation(filePath: string, repo?: string): Promise<FileRelation> {
  const index = await loadRequiredSymbolIndex();
  const key = resolveFileRelationKey(index, filePath, repo);
  return index.byFile[key];
}

export async function listFileRelations(): Promise<FileRelation[]> {
  const index = await loadRequiredSymbolIndex();
  return Object.values(index.byFile);
}
