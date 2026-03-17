import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildCodeGraphFromSymbolIndex } from '../graph/build-graph.js';
import { loadRepoResolutionConfigs } from '../graph/repo-config.js';
import type { CodeGraphSnapshot } from '../graph/types.js';
import { loadPatternIndex } from '../patterns/store.js';
import { runPatternExtractionStage } from '../patterns/stage.js';
import type { PatternIndex } from '../patterns/types.js';
import { listRepositories } from '../repositories.js';
import { buildIndexedSymbols, collectRepositorySourceFiles } from '../symbol-index/build-index.js';
import { createFileId } from '../symbol-index/ids.js';
import { loadSymbolIndex } from '../symbol-index/store.js';
import type { IndexedSymbol, SymbolFrequencyStats, SymbolIndex } from '../symbol-index/types.js';
import { buildUiCompositionIndex } from '../ui-composition/build-index.js';
import type { UiCompositionIndex } from '../ui-composition/types.js';
import { buildUiPropSurfaceIndex } from '../ui-props/build-index.js';
import type { UiPropSurfaceIndex } from '../ui-props/types.js';
import {
  loadCurrentGenerationState,
  publishGeneration,
  saveGenerationArtifacts,
  saveSearchRefreshRequest,
} from './generation-store.js';
import {
  buildSearchRepoFingerprints,
  createSearchRefreshRequest,
  deriveSearchFreshness,
  getCurrentSearchFreshness,
} from './search-freshness.js';
import type {
  FileFingerprintManifestEntry,
  IndexGenerationCleanupSummary,
  IndexGenerationCounts,
  IndexGenerationRebuildSummary,
  IndexGenerationState,
  IndexRefreshDelta,
  IndexRefreshDiagnostics,
  IndexedRepositoryDescriptor,
} from './types.js';

const INDEX_GENERATION_STATE_SCHEMA_VERSION = 1;

export interface RefreshIndexesOptions {
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  failBeforePublish?: boolean;
}

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
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

function createManifestKey(repoId: string, filePath: string): string {
  return `${repoId}/${filePath}`;
}

function createEmptySymbolIndex(schemaVersion: number = 4): SymbolIndex {
  return {
    schemaVersion,
    symbols: [],
    byName: Object.create(null) as SymbolIndex['byName'],
    byNameLower: Object.create(null) as SymbolIndex['byNameLower'],
    byFile: Object.create(null) as SymbolIndex['byFile'],
    stats: createEmptySymbolFrequencyStats(),
  };
}

async function hashFileContent(absolutePath: string): Promise<string> {
  const buffer = await fs.readFile(absolutePath);
  return createHash('sha256').update(buffer).digest('hex');
}

async function scanRepositoryManifest(
  reposRoot: string,
): Promise<{ repositories: IndexedRepositoryDescriptor[]; manifest: FileFingerprintManifestEntry[] }> {
  const repositories = await listRepositories(reposRoot);
  const descriptors = repositories.map((repository) => ({
    repoId: repository.id,
    repoRoot: repository.rootPath,
  }));
  const manifest: FileFingerprintManifestEntry[] = [];

  for (const repository of repositories) {
    const files = await collectRepositorySourceFiles(repository.rootPath, repository.id);

    for (const filePath of files.sort((left, right) => left.localeCompare(right))) {
      const absolutePath = path.join(repository.rootPath, filePath);
      const stat = await fs.stat(absolutePath);
      const normalizedPath = normalizeRelativePath(filePath);
      manifest.push({
        key: createManifestKey(repository.id, normalizedPath),
        repoId: repository.id,
        repoRoot: repository.rootPath,
        filePath: normalizedPath,
        normalizedPath,
        fileSizeBytes: stat.size,
        modifiedTimeMs: Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : undefined,
        contentHash: await hashFileContent(absolutePath),
      });
    }
  }

  manifest.sort((left, right) => left.key.localeCompare(right.key));

  return {
    repositories: descriptors,
    manifest,
  };
}

function diffManifest(
  previousManifest: FileFingerprintManifestEntry[],
  currentManifest: FileFingerprintManifestEntry[],
): IndexRefreshDelta {
  const previousByKey = new Map(previousManifest.map((entry) => [entry.key, entry]));
  const currentByKey = new Map(currentManifest.map((entry) => [entry.key, entry]));
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [key, entry] of currentByKey) {
    const previousEntry = previousByKey.get(key);

    if (!previousEntry) {
      added.push(entry.key);
      continue;
    }

    if (
      previousEntry.contentHash !== entry.contentHash ||
      previousEntry.fileSizeBytes !== entry.fileSizeBytes ||
      previousEntry.modifiedTimeMs !== entry.modifiedTimeMs
    ) {
      modified.push(entry.key);
    }
  }

  for (const key of previousByKey.keys()) {
    if (!currentByKey.has(key)) {
      deleted.push(key);
    }
  }

  added.sort((left, right) => left.localeCompare(right));
  modified.sort((left, right) => left.localeCompare(right));
  deleted.sort((left, right) => left.localeCompare(right));

  return { added, modified, deleted };
}

function hasManifestChanges(delta: IndexRefreshDelta): boolean {
  return delta.added.length > 0 || delta.modified.length > 0 || delta.deleted.length > 0;
}

function rebuildLookups(symbols: IndexedSymbol[]): Pick<SymbolIndex, 'byName' | 'byNameLower' | 'stats'> {
  const byName = Object.create(null) as SymbolIndex['byName'];
  const byNameLower = Object.create(null) as SymbolIndex['byNameLower'];
  const stats = createEmptySymbolFrequencyStats();

  for (const symbol of symbols) {
    if (!Array.isArray(byName[symbol.name])) {
      byName[symbol.name] = [];
    }

    if (!Array.isArray(byNameLower[symbol.name.toLowerCase()])) {
      byNameLower[symbol.name.toLowerCase()] = [];
    }

    byName[symbol.name].push(symbol);
    byNameLower[symbol.name.toLowerCase()].push(symbol);
    incrementCounter(stats.globalByName, symbol.name);
    incrementCounter(stats.globalByNameLower, symbol.name.toLowerCase());
    incrementNestedCounter(stats.byRepo, symbol.repo, symbol.name);
    incrementNestedCounter(stats.byKind, symbol.kind, symbol.name);

    if (symbol.exported) {
      incrementCounter(stats.exportedByName, symbol.name);
    }
  }

  return { byName, byNameLower, stats };
}

function mergeSymbolIndexes(
  previousIndex: SymbolIndex,
  freshIndex: SymbolIndex,
  changedOrAddedKeys: Set<string>,
  deletedKeys: Set<string>,
): { index: SymbolIndex; cleanup: IndexGenerationCleanupSummary } {
  const retainedByFile = Object.create(null) as SymbolIndex['byFile'];

  for (const relation of Object.values(previousIndex.byFile)) {
    const key = createManifestKey(relation.repo, relation.filePath);

    if (changedOrAddedKeys.has(key) || deletedKeys.has(key)) {
      continue;
    }

    retainedByFile[relation.fileId] = relation;
  }

  for (const relation of Object.values(freshIndex.byFile)) {
    const key = createManifestKey(relation.repo, relation.filePath);

    if (changedOrAddedKeys.has(key)) {
      retainedByFile[relation.fileId] = relation;
    }
  }

  const symbols = [
    ...previousIndex.symbols.filter((symbol) => {
      const key = createManifestKey(symbol.repo, symbol.filePath);
      return !changedOrAddedKeys.has(key) && !deletedKeys.has(key);
    }),
    ...freshIndex.symbols.filter((symbol) => changedOrAddedKeys.has(createManifestKey(symbol.repo, symbol.filePath))),
  ].sort((left, right) => left.symbolId.localeCompare(right.symbolId));

  const lookups = rebuildLookups(symbols);
  const deletedRelations = Object.values(previousIndex.byFile).filter((relation) =>
    deletedKeys.has(createManifestKey(relation.repo, relation.filePath)),
  );
  const deletedSymbols = previousIndex.symbols.filter((symbol) =>
    deletedKeys.has(createManifestKey(symbol.repo, symbol.filePath)),
  );

  return {
    index: {
      schemaVersion: freshIndex.schemaVersion,
      symbols,
      byName: lookups.byName,
      byNameLower: lookups.byNameLower,
      byFile: retainedByFile,
      stats: lookups.stats,
    },
    cleanup: {
      deletedFileRecordsRemoved: deletedRelations.length,
      deletedSymbolsRemoved: deletedSymbols.length,
      deletedPatternEntriesRemoved: 0,
    },
  };
}

function mergePatternIndexes(
  previousIndex: PatternIndex,
  freshIndex: PatternIndex,
  changedOrAddedFileIds: Set<string>,
  deletedFileIds: Set<string>,
): { index: PatternIndex; deletedPatternEntriesRemoved: number } {
  const retainedPatterns = previousIndex.patterns.filter(
    (pattern) => !changedOrAddedFileIds.has(pattern.fileId) && !deletedFileIds.has(pattern.fileId),
  );
  const deletedPatternEntriesRemoved = previousIndex.patterns.filter((pattern) =>
    deletedFileIds.has(pattern.fileId),
  ).length;

  return {
    index: {
      schemaVersion: freshIndex.schemaVersion,
      sourceSymbolIndexSchemaVersion: freshIndex.sourceSymbolIndexSchemaVersion,
      generatedAt: freshIndex.generatedAt,
      patterns: [
        ...retainedPatterns,
        ...freshIndex.patterns.filter((pattern) => changedOrAddedFileIds.has(pattern.fileId)),
      ].sort((left, right) => left.patternId.localeCompare(right.patternId)),
    },
    deletedPatternEntriesRemoved,
  };
}

function createCounts(
  symbolIndex: SymbolIndex,
  graph: CodeGraphSnapshot,
  uiComposition: UiCompositionIndex,
  uiProps: UiPropSurfaceIndex,
  patternIndex: PatternIndex,
): IndexGenerationCounts {
  return {
    files: Object.keys(symbolIndex.byFile).length,
    symbols: symbolIndex.symbols.length,
    fileRecords: Object.keys(symbolIndex.byFile).length,
    graphFiles: Object.keys(graph.nodes.files).length,
    graphSymbols: Object.keys(graph.nodes.symbols).length,
    graphEdges: graph.edges.length,
    uiCompositionEdges: uiComposition.edges.length,
    uiPropUsages: uiProps.propUsages.length,
    patterns: patternIndex.patterns.length,
  };
}

function logDiagnostics(
  logger: Pick<Console, 'info' | 'warn' | 'error'>,
  diagnostics: IndexRefreshDiagnostics,
): void {
  logger.info(
    `[index-refresh] generation=${diagnostics.generationId} status=${diagnostics.status} added=${diagnostics.delta.added.length} modified=${diagnostics.delta.modified.length} deleted=${diagnostics.delta.deleted.length}`,
  );

  if (diagnostics.status === 'committed') {
    logger.info(
      `[index-refresh] rebuild symbol-files=${diagnostics.rebuild.symbolFilesRebuilt} pattern-files=${diagnostics.rebuild.patternFilesRebuilt} graph=${diagnostics.rebuild.graphMode} ui-composition=${diagnostics.rebuild.uiCompositionMode} ui-props=${diagnostics.rebuild.uiPropsMode}`,
    );
    logger.info(
      `[index-refresh] cleanup file-records=${diagnostics.cleanup.deletedFileRecordsRemoved} symbols=${diagnostics.cleanup.deletedSymbolsRemoved} patterns=${diagnostics.cleanup.deletedPatternEntriesRemoved}`,
    );
    logger.info(
      `[index-refresh] commit generation=${diagnostics.generationId} files=${diagnostics.counts.files} symbols=${diagnostics.counts.symbols} graphEdges=${diagnostics.counts.graphEdges} uiEdges=${diagnostics.counts.uiCompositionEdges} uiProps=${diagnostics.counts.uiPropUsages} patterns=${diagnostics.counts.patterns}`,
    );
  }

  for (const warning of diagnostics.warnings) {
    logger.warn(`[index-refresh] warning: ${warning}`);
  }
}

export async function refreshIndexes(
  reposRoot: string,
  options: RefreshIndexesOptions = {},
): Promise<{ symbolIndex: SymbolIndex; diagnostics: IndexRefreshDiagnostics }> {
  const logger = options.logger ?? console;
  const previousGeneration = await loadCurrentGenerationState();
  const previousManifest = previousGeneration?.manifest ?? [];
  const { repositories, manifest } = await scanRepositoryManifest(reposRoot);
  const searchFingerprints = await buildSearchRepoFingerprints(reposRoot);
  const delta = diffManifest(previousManifest, manifest);

  if (!hasManifestChanges(delta) && previousGeneration) {
    const currentSymbolIndex = await loadSymbolIndex();
    const search = (await getCurrentSearchFreshness(logger)) ?? previousGeneration.search;
    const diagnostics: IndexRefreshDiagnostics = {
      generationId: previousGeneration.generationId,
      createdAt: previousGeneration.createdAt,
      delta,
      counts: previousGeneration.counts,
      rebuild: previousGeneration.rebuild,
      cleanup: previousGeneration.cleanup,
      search,
      warnings: previousGeneration.warnings,
      status: 'no-op',
    };
    logDiagnostics(logger, diagnostics);
    return { symbolIndex: currentSymbolIndex, diagnostics };
  }

  const generationId = randomUUID();
  const createdAt = new Date().toISOString();
  const warnings: string[] = [];
  const changedOrAddedKeys = new Set([...delta.added, ...delta.modified]);
  const deletedKeys = new Set(delta.deleted);
  const freshSymbolIndex = await buildIndexedSymbols(reposRoot);
  const previousSymbolIndex = previousGeneration
    ? await loadSymbolIndex()
    : createEmptySymbolIndex(freshSymbolIndex.schemaVersion);
  const { index: mergedSymbolIndex, cleanup } = mergeSymbolIndexes(
    previousSymbolIndex,
    freshSymbolIndex,
    changedOrAddedKeys,
    deletedKeys,
  );
  const freshPatternIndex = await runPatternExtractionStage(reposRoot, mergedSymbolIndex);
  const previousPatternIndex = previousGeneration
    ? await loadPatternIndex()
    : {
        schemaVersion: freshPatternIndex.schemaVersion,
        sourceSymbolIndexSchemaVersion: 0,
        generatedAt: '',
        patterns: [],
      };
  const changedOrAddedFileIds = new Set(
    manifest
      .filter((entry) => changedOrAddedKeys.has(entry.key))
      .map((entry) => createFileId(entry.repoId, entry.filePath)),
  );
  const deletedFileIds = new Set(
    previousManifest
      .filter((entry) => deletedKeys.has(entry.key))
      .map((entry) => createFileId(entry.repoId, entry.filePath)),
  );
  const mergedPatternResult = mergePatternIndexes(
    previousPatternIndex,
    freshPatternIndex,
    changedOrAddedFileIds,
    deletedFileIds,
  );
  cleanup.deletedPatternEntriesRemoved = mergedPatternResult.deletedPatternEntriesRemoved;

  warnings.push(
    'code graph and UI artifacts rebuild globally on changed generations to keep cross-file resolution deterministic',
  );

  const repoConfigById = await loadRepoResolutionConfigs(
    Object.fromEntries(repositories.map((repository) => [repository.repoId, repository.repoRoot])),
  );
  const graph = buildCodeGraphFromSymbolIndex(mergedSymbolIndex, {
    repoResolutionConfigsById: repoConfigById,
  });
  const uiComposition = await buildUiCompositionIndex(reposRoot, mergedSymbolIndex);
  const uiProps = await buildUiPropSurfaceIndex(reposRoot, mergedSymbolIndex);
  const counts = createCounts(
    mergedSymbolIndex,
    graph,
    uiComposition,
    uiProps,
    mergedPatternResult.index,
  );
  const rebuild: IndexGenerationRebuildSummary = {
    symbolFilesRebuilt: changedOrAddedKeys.size,
    patternFilesRebuilt: changedOrAddedFileIds.size,
    graphMode: 'full',
    uiCompositionMode: 'full',
    uiPropsMode: 'full',
  };
  const searchRequest = createSearchRefreshRequest({
    generationId,
    createdAt,
    search: {
      status: 'pending',
      requestedAt: createdAt,
      aggregateFingerprint: searchFingerprints.aggregateFingerprint,
      repoFingerprints: searchFingerprints.repoFingerprints,
      coordinationMode: 'shared-marker',
    },
  });
  const search = deriveSearchFreshness(
    {
      generationId,
      createdAt,
      search: {
        status: 'pending',
        requestedAt: createdAt,
        aggregateFingerprint: searchFingerprints.aggregateFingerprint,
        repoFingerprints: searchFingerprints.repoFingerprints,
        coordinationMode: 'shared-marker',
      },
    },
    searchRequest,
    null,
  );
  const generationState: IndexGenerationState = {
    schemaVersion: INDEX_GENERATION_STATE_SCHEMA_VERSION,
    generationId,
    reposRoot,
    repositories,
    createdAt,
    status: 'ready',
    manifest,
    delta: {
      added: delta.added.length,
      modified: delta.modified.length,
      deleted: delta.deleted.length,
    },
    counts,
    rebuild,
    cleanup,
    search,
    warnings,
    errors: [],
  };

  await saveGenerationArtifacts(
    generationId,
    {
      'symbol-index.json': mergedSymbolIndex,
      'code-graph.json': graph,
      'ui-composition.json': uiComposition,
      'ui-props.json': uiProps,
      'pattern-candidates.json': mergedPatternResult.index,
    },
    generationState,
  );

  if (options.failBeforePublish) {
    throw new Error('Simulated refresh failure before publish.');
  }

  await saveSearchRefreshRequest(searchRequest);
  logger.info(
    `[search-freshness] request generation=${generationId} status=${generationState.search.status} fingerprint=${generationState.search.aggregateFingerprint}`,
  );
  await publishGeneration(generationId, createdAt);

  const diagnostics: IndexRefreshDiagnostics = {
    generationId,
    createdAt,
    delta,
    counts,
    rebuild,
    cleanup,
    search: generationState.search,
    warnings,
    status: 'committed',
  };
  logDiagnostics(logger, diagnostics);

  return {
    symbolIndex: mergedSymbolIndex,
    diagnostics,
  };
}
