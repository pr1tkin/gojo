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

export const exploreComponentInputSchema = {
  name: z.string().min(1),
  repo: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(10).optional(),
  relatedLimit: z.number().int().min(1).max(20).optional(),
  detail: z.enum(['agent', 'debug']).optional(),
  expandClusters: z.boolean().optional(),
  expandDebug: z.boolean().optional(),
  expandRelated: z.boolean().optional(),
};

export const searchPatternsInputSchema = {
  name: z.string().min(1),
  repo: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(10).optional(),
  mode: z.enum(['component', 'symbol', 'file']).optional(),
  detail: z.enum(['agent', 'debug']).optional(),
  expandClusters: z.boolean().optional(),
  expandDebug: z.boolean().optional(),
  expandRelated: z.boolean().optional(),
};

export const findPrecedentsInputSchema = {
  name: z.string().min(1),
  repo: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(5).optional(),
  mode: z.enum(['component', 'symbol', 'file']).optional(),
  detail: z.enum(['agent', 'debug']).optional(),
  includeFamilyContext: z.boolean().optional(),
  expandClusters: z.boolean().optional(),
  expandDebug: z.boolean().optional(),
  expandRelated: z.boolean().optional(),
};

export const collectRefactorContextInputSchema = {
  name: z.string().min(1),
  repo: z.string().min(1).optional(),
  mode: z.enum(['component', 'symbol', 'file']).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  detail: z.enum(['agent', 'debug']).optional(),
  expandClusters: z.boolean().optional(),
  expandDebug: z.boolean().optional(),
  expandRelated: z.boolean().optional(),
};

export const analyzeSymbolInputSchema = {
  name: z.string().min(1),
  repo: z.string().min(1).optional(),
  file: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(20).optional(),
};

export const planChangeInputSchema = {
  symbol: z.string().min(1),
  filePath: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  mode: z.enum(['safe', 'exploratory']).optional(),
};

export const buildChangeContextInputSchema = {
  symbolName: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  intent: z.enum(['refactor', 'feature', 'fix']).optional(),
  detail: z.enum(['agent', 'debug']).optional(),
};
