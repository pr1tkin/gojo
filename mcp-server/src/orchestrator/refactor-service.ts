import path from 'node:path';

import {
  getDefinedSymbols,
  getExportedSymbols,
  getImportedFiles,
  getImportingFiles,
  getFileNode,
  getNeighboringFiles,
  getReexportedFiles,
  getReexportingFiles,
} from '../graph/query.js';
import { getFileRelation, getFileRelationById, listFileRelations } from '../symbol-index/query.js';
import type { CollectRefactorContextInput, RefactorContextMode } from '../types.js';
import { getFileExplorationContext } from './file-service.js';
import { getSymbolExplorationContext } from './symbol-service.js';
import type { RefactorContext, RefactorNearbyFile, RefactorSymbolCandidate } from './types.js';

const DEFAULT_LIMIT = 10;
const BUNDLE_SUFFIXES = ['test', 'spec', 'stories', 'story', 'styles', 'style', 'css'];

interface RefactorOptions {
  repo?: string;
  limit?: number;
}

function getBaseName(filePath: string): string {
  return path.posix.basename(filePath).replace(/\.[^.]+$/g, '');
}

function getBundleStem(filePath: string): string {
  const baseName = getBaseName(filePath);

  for (const suffix of BUNDLE_SUFFIXES) {
    const marker = `.${suffix}`;

    if (baseName.endsWith(marker)) {
      return baseName.slice(0, -marker.length);
    }
  }

  return baseName;
}

function compareFiles(left: { repoId?: string; filePath: string }, right: { repoId?: string; filePath: string }): number {
  return (left.repoId ?? '').localeCompare(right.repoId ?? '') || left.filePath.localeCompare(right.filePath);
}

function buildSymbolCandidates(
  context: Awaited<ReturnType<typeof getSymbolExplorationContext>>,
  limit: number,
): RefactorSymbolCandidate[] {
  return context.rankedSymbols.slice(0, limit).map((entry) => ({
    symbolId: entry.item.symbolId,
    fileId: entry.item.fileId,
    repo: entry.item.repo,
    filePath: entry.item.filePath,
    name: entry.item.name,
    kind: entry.item.kind,
    exported: Boolean(entry.item.exported),
    score: entry.score,
    reasons: entry.reasons,
  }));
}

async function collectNearbyFiles(
  fileId: string,
  repo: string,
  limit: number,
): Promise<{ items: RefactorNearbyFile[]; totalCount: number }> {
  const targetRelation = await getFileRelationById(fileId);

  if (!targetRelation) {
    return {
      items: [],
      totalCount: 0,
    };
  }

  const relations = await listFileRelations();
  const targetDir = path.posix.dirname(targetRelation.filePath);
  const targetStem = getBundleStem(targetRelation.filePath);
  const nearby = new Map<string, RefactorNearbyFile>();

  for (const relation of relations) {
    if (relation.fileId === fileId || relation.repo !== repo) {
      continue;
    }

    const relationDir = path.posix.dirname(relation.filePath);
    const relationStem = getBundleStem(relation.filePath);
    const sameDirectory = relationDir === targetDir;
    const sameBundleFamily = sameDirectory && relationStem === targetStem;

    if (!sameDirectory && !sameBundleFamily) {
      continue;
    }

    const file = await getFileNode(relation.fileId);

    if (!file) {
      continue;
    }

    nearby.set(relation.fileId, {
      file,
      category: sameBundleFamily ? 'bundle_family' : 'same_directory',
    });
  }

  const items = Array.from(nearby.values())
    .sort((left, right) => {
      if (left.category !== right.category) {
        return left.category === 'bundle_family' ? -1 : 1;
      }

      return compareFiles(left.file, right.file);
    })
    .slice(0, limit);

  return {
    items,
    totalCount: nearby.size,
  };
}

function buildMissingContext(
  name: string,
  mode: RefactorContextMode,
  repo?: string,
  symbolCandidates: RefactorSymbolCandidate[] = [],
  totalSymbolCandidateCount?: number,
): RefactorContext {
  const notes = ['target could not be resolved from the current symbol index and graph'];
  const symbolCandidateCount = totalSymbolCandidateCount ?? symbolCandidates.length;

  if (symbolCandidateCount > 1) {
    notes.push('multiple symbol candidates were found, but no primary file could be resolved safely');
  }

  return {
    target: {
      requestedName: name,
      requestedMode: mode,
      repo,
      file: null,
      symbol: null,
    },
    primaryFile: null,
    exportedSymbols: [],
    importingFiles: [],
    importedFiles: [],
    reexportingFiles: [],
    reexportedFiles: [],
    graphNeighbors: [],
    relatedFiles: [],
    nearbyFiles: [],
    definedSymbols: [],
    symbolCandidates,
    summary: {
      importingFileCount: 0,
      importedFileCount: 0,
      reexportingFileCount: 0,
      reexportedFileCount: 0,
      graphNeighborCount: 0,
      relatedFileCount: 0,
      nearbyFileCount: 0,
      symbolCandidateCount,
      exportedSymbolCount: 0,
      definedSymbolCount: 0,
      ambiguityDetected: symbolCandidateCount > 1,
      notes,
    },
  };
}

async function buildResolvedContext(
  name: string,
  mode: RefactorContextMode,
  fileId: string,
  repo: string,
  symbol: RefactorContext['target']['symbol'],
  symbolCandidates: RefactorSymbolCandidate[],
  totalSymbolCandidateCount: number,
  limit: number,
): Promise<RefactorContext> {
  const [
    primaryFile,
    exportedSymbols,
    importingFiles,
    importedFiles,
    reexportingFiles,
    reexportedFiles,
    graphNeighbors,
    definedSymbols,
    fileContext,
    nearbyFiles,
  ] = await Promise.all([
    getFileNode(fileId),
    getExportedSymbols(fileId),
    getImportingFiles(fileId),
    getImportedFiles(fileId),
    getReexportingFiles(fileId),
    getReexportedFiles(fileId),
    getNeighboringFiles(fileId),
    getDefinedSymbols(fileId),
    getFileExplorationContext(fileId, { relatedLimit: limit }),
    collectNearbyFiles(fileId, repo, limit),
  ]);

  if (!primaryFile) {
    return buildMissingContext(name, mode, repo, symbolCandidates);
  }

  const notes: string[] = [];

  if (totalSymbolCandidateCount > 1) {
    notes.push('multiple symbol candidates matched; the strongest ranked candidate was selected');
  }

  if (importingFiles.length > 0) {
    notes.push('direct importers are likely to be the highest-impact change surface');
  }

  if (nearbyFiles.items.some((entry) => entry.category === 'bundle_family')) {
    notes.push('bundle-family files were included to capture tests, stories, or style companions');
  }

  return {
    target: {
      requestedName: name,
      requestedMode: mode,
      repo,
      file: primaryFile,
      symbol,
    },
    primaryFile,
    exportedSymbols,
    importingFiles: importingFiles.sort(compareFiles),
    importedFiles: importedFiles.sort(compareFiles),
    reexportingFiles: reexportingFiles.sort(compareFiles),
    reexportedFiles: reexportedFiles.sort(compareFiles),
    graphNeighbors: graphNeighbors.sort(compareFiles),
    relatedFiles: fileContext.relatedFiles.slice(0, limit),
    nearbyFiles: nearbyFiles.items,
    definedSymbols,
    symbolCandidates,
    summary: {
      importingFileCount: importingFiles.length,
      importedFileCount: importedFiles.length,
      reexportingFileCount: reexportingFiles.length,
      reexportedFileCount: reexportedFiles.length,
      graphNeighborCount: graphNeighbors.length,
      relatedFileCount: fileContext.summary.totalRelatedFileCount,
      nearbyFileCount: nearbyFiles.totalCount,
      symbolCandidateCount: totalSymbolCandidateCount,
      exportedSymbolCount: exportedSymbols.length,
      definedSymbolCount: definedSymbols.length,
      ambiguityDetected: totalSymbolCandidateCount > 1,
      notes,
    },
  };
}

export async function getRefactorContextForFile(
  filePath: string,
  options: RefactorOptions = {},
): Promise<RefactorContext> {
  try {
    const relation = await getFileRelation(filePath, options.repo);
    return buildResolvedContext(
      filePath,
      'file',
      relation.fileId,
      relation.repo,
      null,
      [],
      0,
      options.limit ?? DEFAULT_LIMIT,
    );
  } catch {
    return buildMissingContext(filePath, 'file', options.repo);
  }
}

export async function getRefactorContextForSymbol(
  name: string,
  options: RefactorOptions = {},
): Promise<RefactorContext> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const symbolContext = await getSymbolExplorationContext(name, {
    repo: options.repo,
    limit,
    relatedLimit: limit,
  });
  const symbolCandidates = buildSymbolCandidates(symbolContext, limit);
  const primaryFileId = symbolContext.primaryFile?.fileId ?? symbolContext.primarySymbol?.fileId;
  const repo = symbolContext.primarySymbol?.repo ?? symbolContext.primaryFile?.repoId ?? options.repo;

  if (!primaryFileId || !repo) {
    return buildMissingContext(name, 'symbol', options.repo, symbolCandidates, symbolContext.summary.totalCandidateCount);
  }

  return buildResolvedContext(
    name,
    'symbol',
    primaryFileId,
    repo,
    symbolContext.primarySymbol,
    symbolCandidates,
    symbolContext.summary.totalCandidateCount,
    limit,
  );
}

export async function getRefactorContextForComponent(
  name: string,
  options: RefactorOptions = {},
): Promise<RefactorContext> {
  const context = await getRefactorContextForSymbol(name, options);

  return {
    ...context,
    target: {
      ...context.target,
      requestedMode: 'component',
    },
  };
}

export async function getCollectRefactorContext(
  input: CollectRefactorContextInput,
): Promise<RefactorContext> {
  const mode = input.mode ?? 'component';

  if (mode === 'file') {
    return getRefactorContextForFile(input.name, {
      repo: input.repo,
      limit: input.limit,
    });
  }

  if (mode === 'symbol') {
    return getRefactorContextForSymbol(input.name, {
      repo: input.repo,
      limit: input.limit,
    });
  }

  return getRefactorContextForComponent(input.name, {
    repo: input.repo,
    limit: input.limit,
  });
}
