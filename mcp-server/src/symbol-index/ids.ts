import type { SymbolKind } from '../types.js';

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function createFileId(repo: string, filePath: string): string {
  return `${repo}:${normalizeFilePath(filePath)}`;
}

export function createDeclarationFingerprint(
  kind: SymbolKind,
  name: string,
  ordinal: number,
): string {
  return `${kind}:${name}:${ordinal}`;
}

export function createSymbolId(
  fileId: string,
  kind: SymbolKind,
  name: string,
  ordinal: number,
): string {
  return `${fileId}:${kind}:${name}:${ordinal}`;
}
