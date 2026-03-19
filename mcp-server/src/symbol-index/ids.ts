import type { SymbolKind } from '../types.js';

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function normalizeSymbolFilePath(filePath: string): string {
  return normalizeFilePath(filePath);
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

export function createSyntheticDefaultExportName(filePath: string): string {
  return `default@${normalizeSymbolFilePath(filePath)}`;
}

export function createSyntheticDefaultExportSymbolId(fileId: string): string {
  return `${fileId}::default`;
}

export function createSyntheticDefaultExportDeclarationFingerprint(filePath: string): string {
  return `default:${createSyntheticDefaultExportName(filePath)}`;
}
