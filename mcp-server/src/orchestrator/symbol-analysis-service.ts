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
import { rankSymbolCandidates } from '../ranking/index.js';
import { loadRequiredSymbolIndex } from '../symbol-index/store.js';
import type { IndexedSymbol } from '../symbol-index/types.js';
import type { AnalyzeSymbolInput, SymbolKind } from '../types.js';
import { getFileExplorationContext } from './file-service.js';
import type { NearbySymbolSummary, SymbolAnalysis, SymbolAnalysisCandidate } from './types.js';
import { getRefactorContextForFile } from './refactor-service.js';

const DEFAULT_LIMIT = 8;
const BUNDLE_SUFFIXES = ['test', 'spec', 'stories', 'story', 'styles', 'style', 'css'];

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
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

function compareNearbySymbols(left: NearbySymbolSummary, right: NearbySymbolSummary): number {
  return left.startLine - right.startLine || left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind);
}

function toNearbySymbolSummary(symbol: { symbolId: string; name: string; kind: SymbolKind; exported: boolean; startLine: number; endLine: number }): NearbySymbolSummary {
  return {
    symbolId: symbol.symbolId,
    name: symbol.name,
    kind: symbol.kind,
    exported: Boolean(symbol.exported),
    startLine: symbol.startLine,
    endLine: symbol.endLine,
  };
}

function buildCandidate(entry: ReturnType<typeof rankSymbolCandidates>[number]): SymbolAnalysisCandidate {
  return {
    symbolId: entry.item.symbolId,
    fileId: entry.item.fileId,
    repo: entry.item.repo,
    filePath: entry.item.filePath,
    name: entry.item.name,
    kind: entry.item.kind,
    exported: Boolean(entry.item.exported),
    score: entry.score,
    reasons: entry.reasons,
  };
}

function collectCandidates(
  symbols: IndexedSymbol[],
  queryName: string,
  repo?: string,
  filePath?: string,
): IndexedSymbol[] {
  const normalizedQuery = queryName.trim();
  const normalizedFilePath = filePath ? normalizePath(filePath) : undefined;

  return symbols.filter((symbol) => {
    const exactNameMatch = symbol.name === normalizedQuery;
    const caseInsensitiveNameMatch = symbol.name.toLowerCase() === normalizedQuery.toLowerCase();

    if (!exactNameMatch && !caseInsensitiveNameMatch) {
      return false;
    }

    if (repo && symbol.repo !== repo) {
      return false;
    }

    if (normalizedFilePath && normalizePath(symbol.filePath) !== normalizedFilePath) {
      return false;
    }

    return true;
  });
}

function classifyArea(filePath: string): string {
  const normalized = normalizePath(filePath);

  if (normalized.startsWith('app/api/') || normalized.includes('/app/api/')) {
    return 'route';
  }

  if (normalized.startsWith('components/ui/') || normalized.includes('/components/ui/')) {
    return 'shared UI';
  }

  if (normalized.startsWith('components/') || normalized.includes('/components/')) {
    return 'component';
  }

  if (normalized.startsWith('lib/contexts/') || normalized.includes('/lib/contexts/')) {
    return 'shared context';
  }

  if (normalized.startsWith('lib/') || normalized.includes('/lib/')) {
    return 'shared helper';
  }

  if (
    normalized.startsWith('pages/') ||
    normalized.includes('/pages/') ||
    normalized.startsWith('app/') ||
    normalized.includes('/app/')
  ) {
    return 'feature';
  }

  return 'repo-local';
}

function summarizeRole(
  symbol: IndexedSymbol,
  fileImporterCount: number,
  nearbyFileCount: number,
  exportedStatus: 'exported' | 'local',
): string {
  const area = classifyArea(symbol.filePath);
  const normalizedPath = normalizePath(symbol.filePath);
  const stem = getBundleStem(normalizedPath);
  const noun = `${area} ${symbol.kind}`.replace('repo-local ', '');

  if (
    (normalizedPath.startsWith('app/api/') || normalizedPath.includes('/app/api/')) &&
    (symbol.name === 'GET' || symbol.name === 'POST' || symbol.name === 'PUT' || symbol.name === 'PATCH' || symbol.name === 'DELETE')
  ) {
    return exportedStatus === 'exported'
      ? `exported route handler symbol in ${stem}; defining file has ${fileImporterCount} importing files`
      : `local route handler helper in ${stem}; defining file has ${fileImporterCount} importing files`;
  }

  if (exportedStatus === 'local') {
    if (nearbyFileCount > 0) {
      return `local ${noun} inside ${stem} implementation with ${nearbyFileCount} nearby file signals`;
    }

    return `local ${noun} inside ${stem} implementation`;
  }

  return `exported ${noun} in ${stem}; defining file imported in ${fileImporterCount} locations`;
}

function buildMissingAnalysis(input: AnalyzeSymbolInput, candidates: SymbolAnalysisCandidate[] = []): SymbolAnalysis {
  const notes = ['symbol could not be resolved from the current symbol index'];

  if (candidates.length > 1) {
    notes.push('multiple symbol candidates were found, but no single candidate was selected safely');
  }

  return {
    target: {
      requestedName: input.name,
      requestedRepo: input.repo,
      requestedFile: input.file,
      symbol: null,
      symbolId: null,
      repo: input.repo ?? null,
      file: null,
    },
    primarySymbol: null,
    primaryFile: null,
    kind: null,
    exported: false,
    roleSummary: 'symbol could not be resolved from the current symbol index',
    definedInFile: null,
    exportedFromFile: null,
    importingFiles: [],
    importedFiles: [],
    reexportingFiles: [],
    reexportedFiles: [],
    graphNeighbors: [],
    relatedFiles: [],
    nearbyFiles: [],
    nearbySymbols: [],
    siblingSymbols: [],
    exportedSymbols: [],
    symbolCandidates: candidates,
    usageSummary: {
      importerCount: 0,
      fileImporters: 0,
      importCount: 0,
      relatedFileCount: 0,
      symbolReferences: null,
      usageScope: 'unknown',
      exportedStatus: 'local',
      ambiguityDetected: candidates.length > 1,
      notes,
    },
  };
}

export async function getAnalyzeSymbolContext(input: AnalyzeSymbolInput): Promise<SymbolAnalysis> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const index = await loadRequiredSymbolIndex();
  const candidates = collectCandidates(index.symbols, input.name, input.repo, input.file);
  const rankedCandidates = rankSymbolCandidates(
    candidates,
    {
      queryName: input.name,
      repo: input.repo,
    },
    {
      stats: index.stats,
    },
  )
    .slice(0, limit)
    .map(buildCandidate);
  const primaryCandidate = rankedCandidates[0] ?? null;

  if (!primaryCandidate) {
    return buildMissingAnalysis(input, rankedCandidates);
  }

  const primarySymbol = candidates.find((symbol) => symbol.symbolId === primaryCandidate.symbolId) ?? null;

  if (!primarySymbol) {
    return buildMissingAnalysis(input, rankedCandidates);
  }

  const primaryFile = await getFileNode(primarySymbol.fileId);

  if (!primaryFile) {
    return buildMissingAnalysis(input, rankedCandidates);
  }

  const [
    definedSymbols,
    exportedSymbols,
    importingFiles,
    importedFiles,
    reexportingFiles,
    reexportedFiles,
    graphNeighbors,
    fileContext,
    refactorContext,
  ] = await Promise.all([
    getDefinedSymbols(primarySymbol.fileId),
    getExportedSymbols(primarySymbol.fileId),
    getImportingFiles(primarySymbol.fileId),
    getImportedFiles(primarySymbol.fileId),
    getReexportingFiles(primarySymbol.fileId),
    getReexportedFiles(primarySymbol.fileId),
    getNeighboringFiles(primarySymbol.fileId),
    getFileExplorationContext(primarySymbol.fileId, { relatedLimit: limit }),
    getRefactorContextForFile(primarySymbol.filePath, { repo: primarySymbol.repo, limit }),
  ]);

  const siblingSymbols = definedSymbols
    .filter((symbolNode) => symbolNode.symbolId !== primarySymbol.symbolId)
    .map(toNearbySymbolSummary)
    .sort(compareNearbySymbols);
  const nearbySymbols = siblingSymbols
    .slice()
    .sort((left, right) => {
      const leftDistance = Math.min(
        Math.abs(left.startLine - primarySymbol.startLine),
        Math.abs(left.endLine - primarySymbol.endLine),
      );
      const rightDistance = Math.min(
        Math.abs(right.startLine - primarySymbol.startLine),
        Math.abs(right.endLine - primarySymbol.endLine),
      );

      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      return compareNearbySymbols(left, right);
    })
    .slice(0, limit);
  const exportedStatus = primarySymbol.exported ? 'exported' : 'local';
  const usageScope: 'symbol-level' | 'file-level proxy' | 'unknown' = 'file-level proxy';
  const roleSummary = summarizeRole(primarySymbol, importingFiles.length, refactorContext.nearbyFiles.length, exportedStatus);
  const notes: string[] = [];

  if (rankedCandidates.length > 1) {
    notes.push('multiple symbol candidates matched; the strongest ranked candidate was selected');
  }

  if (primarySymbol.exported) {
    notes.push('symbol is exported from its defining file');
  } else {
    notes.push('symbol is not exported from its defining file');
  }

  if (importingFiles.length > 0) {
    notes.push('importer counts reflect file-level usage, not verified symbol-level references');
  }

  if (refactorContext.nearbyFiles.some((entry) => entry.category === 'bundle_family')) {
    notes.push('bundle-family files were included to capture nearby tests, stories, or style companions');
  }

  return {
    target: {
      requestedName: input.name,
      requestedRepo: input.repo,
      requestedFile: input.file,
      symbol: primarySymbol,
      symbolId: primarySymbol.symbolId,
      repo: primarySymbol.repo,
      file: primaryFile,
    },
    primarySymbol,
    primaryFile,
    kind: primarySymbol.kind,
    exported: Boolean(primarySymbol.exported),
    roleSummary,
    definedInFile: primaryFile,
    exportedFromFile: primarySymbol.exported ? primaryFile : null,
    importingFiles: importingFiles.sort(compareFiles),
    importedFiles: importedFiles.sort(compareFiles),
    reexportingFiles: reexportingFiles.sort(compareFiles),
    reexportedFiles: reexportedFiles.sort(compareFiles),
    graphNeighbors: graphNeighbors.sort(compareFiles),
    relatedFiles: fileContext.relatedFiles.slice(0, limit),
    nearbyFiles: refactorContext.nearbyFiles,
    nearbySymbols,
    siblingSymbols,
    exportedSymbols,
    symbolCandidates: rankedCandidates,
    usageSummary: {
      importerCount: importingFiles.length,
      fileImporters: importingFiles.length,
      importCount: importedFiles.length,
      relatedFileCount: fileContext.relatedFiles.length,
      symbolReferences: null,
      usageScope,
      exportedStatus,
      ambiguityDetected: rankedCandidates.length > 1,
      notes,
    },
  };
}
