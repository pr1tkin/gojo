import { formatOpenFileResult } from '../formatters.js';
import { readRepositoryFile } from '../files.js';
import { getRepositoryById } from '../repositories.js';
import { openFileInputSchema } from '../schemas.js';
import type { OpenFileInput } from '../types.js';

function normalizeRequestedFilePath(filePath: string): string {
  const trimmed = filePath.trim();

  if (!trimmed) {
    throw new Error('filePath must not be empty.');
  }

  return trimmed.replace(/\\/g, '/');
}

function splitRepositoryFilePath(filePath: string): { repositoryId: string; repositoryFilePath: string } {
  const normalizedPath = normalizeRequestedFilePath(filePath);
  const segments = normalizedPath.split('/').filter(Boolean);

  if (segments.length < 2) {
    throw new Error('filePath must include the repository directory and an in-repository file path.');
  }

  return {
    repositoryId: segments[0],
    repositoryFilePath: segments.slice(1).join('/'),
  };
}

export const openFileToolDefinition = {
  name: 'open_file',
  title: 'Open File',
  description: 'Reads a UTF-8 file from the mounted repositories root with optional line slicing.',
  inputSchema: openFileInputSchema,
};

export async function runOpenFileTool(
  reposRoot: string,
  input: OpenFileInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const normalizedFilePath = normalizeRequestedFilePath(input.filePath);
  const { repositoryId, repositoryFilePath } = splitRepositoryFilePath(normalizedFilePath);
  const repository = await getRepositoryById(reposRoot, repositoryId);

  if (!repository) {
    throw new Error(`Repository not found: ${repositoryId}`);
  }

  const file = await readRepositoryFile(repository, repositoryFilePath, {
    startLine: input.startLine,
    endLine: input.endLine,
  });

  return {
    content: [
      {
        type: 'text',
        text: formatOpenFileResult({
          filePath: normalizedFilePath,
          startLine: file.startLine,
          endLine: file.endLine,
          totalLines: file.totalLines,
          content: file.content,
        }),
      },
    ],
  };
}
