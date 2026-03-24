import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveLocalFileTarget } from '../graph/local-resolution.js';
import { loadRepoResolutionConfigs } from '../graph/repo-config.js';
import { listRepositories } from '../repositories.js';
import { extractSymbolsFromSource } from '../symbols.js';
import { isSupportedSymbolFile } from '../tree-sitter.js';
import { classifyFile } from './file-classification.js';
import { extractFileMetadata, extractFileMetadataFallback } from './file-metadata.js';
import {
  createDeclarationFingerprint,
  createFileId,
  createSymbolId,
  createSyntheticDefaultExportDeclarationFingerprint,
  createSyntheticDefaultExportSymbolId,
} from './ids.js';
import type {
  FileRelation,
  IndexedSymbol,
  SymbolFrequencyStats,
  SymbolIndex,
  SymbolIndexBuildResult,
  SymbolIndexCoverageIssue,
  SymbolIndexCoverageSummary,
} from './types.js';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
]);

const MAX_RECORDED_COVERAGE_ISSUES = 200;

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

export async function collectRepositorySourceFiles(
  repositoryRoot: string,
  repositoryId: string,
  currentDirectory: string = repositoryRoot,
): Promise<string[]> {
  const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      files.push(...(await collectRepositorySourceFiles(repositoryRoot, repositoryId, entryPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = normalizeRelativePath(path.relative(repositoryRoot, entryPath));
    const classification = classifyFile(repositoryId, relativePath);

    if (classification.classification !== 'source') {
      continue;
    }

    if (isSupportedSymbolFile(relativePath)) {
      files.push(relativePath);
    }
  }

  return files;
}

function mapIndexedSymbols(
  repositoryId: string,
  filePath: string,
  source: string,
  symbols: ReturnType<typeof extractSymbolsFromSource>,
): IndexedSymbol[] {
  const lines = source.split(/\r?\n/);
  const fileId = createFileId(repositoryId, filePath);
  const symbolOrdinals = new Map<string, number>();

  return symbols.map((symbol) => {
    const ordinalKey = `${symbol.kind}:${symbol.name}`;
    const ordinal = (symbolOrdinals.get(ordinalKey) ?? 0) + 1;
    symbolOrdinals.set(ordinalKey, ordinal);
    const isSyntheticDefaultExport = symbol.identityDiscriminator === 'default';

    return {
      symbolId: isSyntheticDefaultExport
        ? createSyntheticDefaultExportSymbolId(fileId)
        : createSymbolId(fileId, symbol.kind, symbol.name, ordinal),
      fileId,
      name: symbol.name,
      kind: symbol.kind,
      repo: repositoryId,
      filePath,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      exported: /\bexport\b/.test(lines[symbol.startLine - 1] ?? ''),
      declarationFingerprint: isSyntheticDefaultExport
        ? createSyntheticDefaultExportDeclarationFingerprint(filePath)
        : createDeclarationFingerprint(symbol.kind, symbol.name, ordinal),
    };
  });
}

function appendLookupEntry(
  lookup: Record<string, IndexedSymbol[]>,
  key: string,
  symbol: IndexedSymbol,
): void {
  const existingEntry = lookup[key];

  if (!Array.isArray(existingEntry)) {
    lookup[key] = [];
  }

  lookup[key].push(symbol);
}

function createEmptySymbolIndex(): SymbolIndex {
  return {
    schemaVersion: 4,
    symbols: [],
    byName: Object.create(null) as Record<string, IndexedSymbol[]>,
    byNameLower: Object.create(null) as Record<string, IndexedSymbol[]>,
    byFile: Object.create(null) as Record<string, FileRelation>,
    stats: createEmptySymbolFrequencyStats(),
  };
}

function createEmptyCoverageSummary(): SymbolIndexCoverageSummary {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    totalSourceFiles: 0,
    fullyIndexedFiles: 0,
    partialFiles: 0,
    skippedFiles: 0,
    trustImpact: 'none',
    issueCounts: {
      parserFailures: 0,
      readFailures: 0,
      metadataFallbacks: 0,
      policySkipped: 0,
    },
    issues: [],
    omittedIssueCount: 0,
  };
}

function normalizeIssueReason(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return 'unknown indexing failure';
}

function recordCoverageIssue(
  coverage: SymbolIndexCoverageSummary,
  issue: SymbolIndexCoverageIssue,
): void {
  if (coverage.issues.length < MAX_RECORDED_COVERAGE_ISSUES) {
    coverage.issues.push(issue);
  } else {
    coverage.omittedIssueCount += 1;
  }

  if (issue.disposition === 'skipped') {
    coverage.skippedFiles += 1;
  } else {
    coverage.partialFiles += 1;
    coverage.trustImpact = 'degraded';
  }

  if (issue.source === 'parser' && issue.stage === 'file_metadata') {
    coverage.issueCounts.metadataFallbacks += 1;
  } else if (issue.source === 'parser') {
    coverage.issueCounts.parserFailures += 1;
  } else if (issue.source === 'io') {
    coverage.issueCounts.readFailures += 1;
    coverage.trustImpact = 'degraded';
  } else if (issue.source === 'policy') {
    coverage.issueCounts.policySkipped += 1;
  }
}

export function getSymbolIndexSkipReason(filePath: string): string | null {
  const normalizedPath = normalizeRelativePath(filePath);

  if (normalizedPath.startsWith('.github/')) {
    return 'skipped repository automation/tooling source outside the main application surface';
  }

  if (normalizedPath.startsWith('bench/')) {
    return 'skipped benchmark harness source outside the main application surface';
  }

  if (normalizedPath.includes('/src/compiled/')) {
    return 'skipped compiled vendor/runtime artifact under src/compiled';
  }

  return null;
}

function createEmptySymbolFrequencyStats(): SymbolFrequencyStats {
  return {
    globalByName: Object.create(null) as SymbolFrequencyStats['globalByName'],
    globalByNameLower: Object.create(null) as SymbolFrequencyStats['globalByNameLower'],
    byRepo: Object.create(null) as SymbolFrequencyStats['byRepo'],
    exportedByName: Object.create(null) as SymbolFrequencyStats['exportedByName'],
    byKind: Object.create(null) as SymbolFrequencyStats['byKind'],
  };
}

function incrementCounter(table: Record<string, number>, key: string): void {
  table[key] = (table[key] ?? 0) + 1;
}

function incrementNestedCounter(
  table: Record<string, Record<string, number>>,
  outerKey: string,
  innerKey: string,
): void {
  if (!table[outerKey]) {
    table[outerKey] = Object.create(null) as Record<string, number>;
  }

  incrementCounter(table[outerKey], innerKey);
}

function updateSymbolFrequencyStats(stats: SymbolFrequencyStats, symbol: IndexedSymbol): void {
  incrementCounter(stats.globalByName, symbol.name);
  incrementCounter(stats.globalByNameLower, symbol.name.toLowerCase());
  incrementNestedCounter(stats.byRepo, symbol.repo, symbol.name);
  incrementNestedCounter(stats.byKind, symbol.kind, symbol.name);

  if (symbol.exported) {
    incrementCounter(stats.exportedByName, symbol.name);
  }
}

function createFileRelationKey(repo: string, filePath: string): string {
  return createFileId(repo, filePath);
}

function createFileRelation(
  fileId: string,
  repo: string,
  filePath: string,
  classification: ReturnType<typeof classifyFile>['classification'],
  source: string,
  symbols: IndexedSymbol[],
): FileRelation {
  return extractFileMetadata(fileId, repo, filePath, classification, source, symbols);
}

function enrichResolvedImports(
  index: SymbolIndex,
  repoResolutionConfigsById: Awaited<ReturnType<typeof loadRepoResolutionConfigs>>,
): void {
  for (const relation of Object.values(index.byFile)) {
    for (const importRecord of relation.imports) {
      const resolution = resolveLocalFileTarget(
        relation,
        importRecord.source,
        index.byFile,
        repoResolutionConfigsById[relation.repo],
      );

      if (resolution.status === 'resolved' && resolution.targetFileId) {
        importRecord.resolvedKind = 'local-file';
        importRecord.resolvedTargetFileId = resolution.targetFileId;
        continue;
      }

      delete importRecord.resolvedTargetFileId;

      if (
        resolution.attemptedKind === 'relative' ||
        resolution.attemptedKind === 'baseUrl' ||
        resolution.matchedAlias
      ) {
        importRecord.resolvedKind = 'local-file';
        continue;
      }

      importRecord.resolvedKind = resolution.status === 'non_local' ? 'package' : 'unknown';
    }
  }
}

export async function buildIndexedSymbols(reposRoot: string): Promise<SymbolIndex> {
  const result = await buildIndexedSymbolsWithCoverage(reposRoot);
  return result.index;
}

export async function buildIndexedSymbolsWithCoverage(reposRoot: string): Promise<SymbolIndexBuildResult> {
  const repositories = await listRepositories(reposRoot);
  const index = createEmptySymbolIndex();
  const coverage = createEmptyCoverageSummary();
  const repoResolutionConfigsById = await loadRepoResolutionConfigs(
    Object.fromEntries(repositories.map((repository) => [repository.id, repository.rootPath])),
  );

  for (const repository of repositories) {
    const files = await collectRepositorySourceFiles(repository.rootPath, repository.id);
    coverage.totalSourceFiles += files.length;

    for (const filePath of files) {
      const classification = classifyFile(repository.id, filePath);
      const fileId = createFileId(repository.id, filePath);
      const skipReason = getSymbolIndexSkipReason(filePath);

      if (skipReason) {
        recordCoverageIssue(coverage, {
          repoId: repository.id,
          filePath,
          fileId,
          classification: classification.classification,
          language: classification.language,
          stage: 'symbol_extraction',
          disposition: 'skipped',
          source: 'policy',
          reason: skipReason,
        });
        continue;
      }

      const absolutePath = path.join(repository.rootPath, filePath);
      let source: string;

      try {
        source = await fs.readFile(absolutePath, 'utf8');
      } catch (error) {
        recordCoverageIssue(coverage, {
          repoId: repository.id,
          filePath,
          fileId,
          classification: classification.classification,
          language: classification.language,
          stage: 'read',
          disposition: 'skipped',
          source: 'io',
          reason: normalizeIssueReason(error),
        });
        continue;
      }

      const repoScopedFilePath = `${repository.id}/${filePath}`;
      let indexedSymbols: IndexedSymbol[] = [];
      let fileRelation: FileRelation;
      let usedPartialFallback = false;

      try {
        const symbols = extractSymbolsFromSource(source, repoScopedFilePath, filePath);
        indexedSymbols = mapIndexedSymbols(repository.id, filePath, source, symbols);

        try {
          fileRelation = createFileRelation(
            fileId,
            repository.id,
            filePath,
            classification.classification,
            source,
            indexedSymbols,
          );
        } catch (error) {
          usedPartialFallback = true;
          const reason = normalizeIssueReason(error);
          recordCoverageIssue(coverage, {
            repoId: repository.id,
            filePath,
            fileId,
            classification: classification.classification,
            language: classification.language,
            stage: 'file_metadata',
            disposition: 'partial',
            source: 'parser',
            reason,
          });
          fileRelation = extractFileMetadataFallback(
            fileId,
            repository.id,
            filePath,
            classification.classification,
            source,
            indexedSymbols,
            `metadata fallback used after parser failure: ${reason}`,
          );
        }
      } catch (error) {
        usedPartialFallback = true;
        const reason = normalizeIssueReason(error);
        recordCoverageIssue(coverage, {
          repoId: repository.id,
          filePath,
          fileId,
          classification: classification.classification,
          language: classification.language,
          stage: 'symbol_extraction',
          disposition: 'partial',
          source: 'parser',
          reason,
        });
        fileRelation = extractFileMetadataFallback(
          fileId,
          repository.id,
          filePath,
          classification.classification,
          source,
          indexedSymbols,
          `symbol extraction fallback used after parser failure: ${reason}`,
        );
      }

      for (const symbol of indexedSymbols) {
        index.symbols.push(symbol);
        appendLookupEntry(index.byName, symbol.name, symbol);
        appendLookupEntry(index.byNameLower, symbol.name.toLowerCase(), symbol);
        updateSymbolFrequencyStats(index.stats, symbol);
      }

      if (!usedPartialFallback) {
        coverage.fullyIndexedFiles += 1;
      }

      index.byFile[createFileRelationKey(repository.id, filePath)] = fileRelation;
    }
  }

  enrichResolvedImports(index, repoResolutionConfigsById);

  return { index, coverage };
}
