import fs from 'node:fs/promises';
import path from 'node:path';

import type { FileReadResult, FileSliceOptions, RepositoryInfo } from './types.js';

function assertPositiveLineNumber(value: number | undefined, label: string): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

export function resolveRepositoryFilePath(repository: RepositoryInfo, filePath: string): string {
  const normalizedFilePath = filePath.trim();

  if (!normalizedFilePath) {
    throw new Error('filePath must not be empty.');
  }

  const absoluteRepositoryRoot = path.resolve(repository.rootPath);
  const absoluteFilePath = path.resolve(absoluteRepositoryRoot, normalizedFilePath);
  const relativePath = path.relative(absoluteRepositoryRoot, absoluteFilePath);

  if (relativePath === '' || relativePath === '.') {
    throw new Error('filePath must point to a file inside the repository.');
  }

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('filePath escapes the repository root.');
  }

  return absoluteFilePath;
}

async function assertResolvedPathWithinRepository(
  repository: RepositoryInfo,
  absoluteFilePath: string,
): Promise<void> {
  const absoluteRepositoryRoot = await fs.realpath(repository.rootPath);
  const absoluteResolvedFilePath = await fs.realpath(absoluteFilePath);
  const relativePath = path.relative(absoluteRepositoryRoot, absoluteResolvedFilePath);

  if (relativePath === '' || relativePath === '.') {
    throw new Error('filePath must point to a file inside the repository.');
  }

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('filePath escapes the repository root.');
  }
}

function sliceLines(content: string, options: FileSliceOptions): Pick<FileReadResult, 'content' | 'startLine' | 'endLine' | 'totalLines'> {
  assertPositiveLineNumber(options.startLine, 'startLine');
  assertPositiveLineNumber(options.endLine, 'endLine');

  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const startLine = options.startLine ?? 1;
  const endLine = options.endLine ?? totalLines;

  if (endLine < startLine) {
    throw new Error('endLine must be greater than or equal to startLine.');
  }

  const slicedContent = lines.slice(startLine - 1, endLine).join('\n');

  return {
    content: slicedContent,
    startLine,
    endLine: Math.min(endLine, totalLines),
    totalLines,
  };
}

export async function readRepositoryFile(
  repository: RepositoryInfo,
  filePath: string,
  options: FileSliceOptions = {},
): Promise<FileReadResult> {
  const absolutePath = resolveRepositoryFilePath(repository, filePath);
  const stat = await fs.stat(absolutePath);

  if (!stat.isFile()) {
    throw new Error('filePath must point to a regular file.');
  }

  await assertResolvedPathWithinRepository(repository, absolutePath);

  const rawContent = await fs.readFile(absolutePath, 'utf8');
  const sliced = sliceLines(rawContent, options);

  return {
    repositoryId: repository.id,
    filePath,
    absolutePath,
    content: sliced.content,
    startLine: sliced.startLine,
    endLine: sliced.endLine,
    totalLines: sliced.totalLines,
  };
}
