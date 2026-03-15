import path from 'node:path';

import type { FileClassification, IndexedFileMetadata } from './types.js';

const GENERATED_DIRECTORIES = new Set([
  '.next',
  '.turbo',
  '.cache',
  'out',
  'storybook-static',
  'generated',
]);

const SOURCE_LANGUAGES = new Map<string, IndexedFileMetadata['language']>([
  ['.ts', 'ts'],
  ['.tsx', 'tsx'],
]);

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function hasGeneratedDirectory(filePath: string): boolean {
  const normalizedPath = normalizeFilePath(filePath);
  const segments = normalizedPath.split('/').filter(Boolean);

  return segments.some((segment) => GENERATED_DIRECTORIES.has(segment));
}

function isGeneratedFileName(filePath: string): boolean {
  const normalizedPath = normalizeFilePath(filePath).toLowerCase();
  return (
    normalizedPath.endsWith('.d.ts') ||
    normalizedPath.endsWith('.generated.ts') ||
    normalizedPath.endsWith('.generated.tsx')
  );
}

function detectLanguage(filePath: string): IndexedFileMetadata['language'] | null {
  const extension = path.extname(filePath).toLowerCase();
  return SOURCE_LANGUAGES.get(extension) ?? null;
}

export function classifyFile(
  repo: string,
  filePath: string,
): IndexedFileMetadata {
  const normalizedFilePath = normalizeFilePath(filePath);
  const language = detectLanguage(normalizedFilePath);
  const classification: FileClassification =
    hasGeneratedDirectory(normalizedFilePath) || isGeneratedFileName(normalizedFilePath)
      ? 'generated'
      : language
        ? 'source'
        : 'unknown';

  return {
    fileId: `${repo}:${normalizedFilePath}`,
    repo,
    filePath: normalizedFilePath,
    classification,
    language: language ?? 'ts',
  };
}
