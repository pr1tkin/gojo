import { z } from 'zod';

export const openFileInputSchema = {
  filePath: z.string().min(1),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
};

export const searchCodeInputSchema = {
  query: z.string().min(1),
  repoName: z.string().min(1).optional(),
  pathPrefix: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
};

export const listSymbolsInputSchema = {
  filePath: z.string().min(1),
};

export const findSymbolInputSchema = {
  name: z.string().min(1),
  kind: z.enum(['function', 'class', 'interface', 'typeAlias', 'variable', 'method']).optional(),
  repo: z.string().min(1).optional(),
};

export const findReferencesInputSchema = {
  symbol: z.string().min(1),
  repo: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
};

export const findRelatedFilesInputSchema = {
  filePath: z.string().min(1),
  repo: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
};
