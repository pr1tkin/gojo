import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { listRepositories } from '../repositories.js';
import {
  loadCurrentGenerationState,
  loadSearchRefreshRequest,
  loadSearchRefreshSnapshot,
  updateGenerationState,
} from './generation-store.js';
import type {
  IndexGenerationState,
  SearchFreshnessState,
  SearchRefreshRequest,
  SearchRefreshSnapshot,
  SearchRepoFingerprint,
} from './types.js';

const SEARCH_COORDINATION_SCHEMA_VERSION = 1;
const SEARCH_IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

async function hashFileContent(absolutePath: string): Promise<string> {
  const buffer = await fs.readFile(absolutePath);
  return createHash('sha256').update(buffer).digest('hex');
}

async function collectSearchFingerprintEntries(
  repositoryRoot: string,
  currentDirectory: string = repositoryRoot,
): Promise<Array<{ filePath: string; contentHash: string }>> {
  const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
  const files: Array<{ filePath: string; contentHash: string }> = [];

  for (const entry of entries) {
    const entryPath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      if (SEARCH_IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      files.push(...(await collectSearchFingerprintEntries(repositoryRoot, entryPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    files.push({
      filePath: normalizeRelativePath(path.relative(repositoryRoot, entryPath)),
      contentHash: await hashFileContent(entryPath),
    });
  }

  return files;
}

function createFingerprint(value: string[]): string {
  return createHash('sha256').update(value.join('\n')).digest('hex');
}

export async function buildSearchRepoFingerprints(reposRoot: string): Promise<{
  aggregateFingerprint: string;
  repoFingerprints: SearchRepoFingerprint[];
}> {
  const repositories = await listRepositories(reposRoot);
  const repoFingerprints: SearchRepoFingerprint[] = [];

  for (const repository of repositories) {
    const fileEntries = await collectSearchFingerprintEntries(repository.rootPath);
    fileEntries.sort((left, right) => left.filePath.localeCompare(right.filePath));
    const fingerprint = createFingerprint(
      fileEntries.map((entry) => `${entry.filePath}\t${entry.contentHash}`),
    );
    repoFingerprints.push({
      repoId: repository.id,
      fingerprint,
      fileCount: fileEntries.length,
    });
  }

  repoFingerprints.sort((left, right) => left.repoId.localeCompare(right.repoId));

  return {
    aggregateFingerprint: createFingerprint(
      repoFingerprints.map((entry) => `${entry.repoId}\t${entry.fingerprint}\t${entry.fileCount}`),
    ),
    repoFingerprints,
  };
}

export function createSearchRefreshRequest(
  generationState: Pick<IndexGenerationState, 'generationId' | 'createdAt' | 'search'>,
): SearchRefreshRequest {
  return {
    schemaVersion: SEARCH_COORDINATION_SCHEMA_VERSION,
    generationId: generationState.generationId,
    requestedAt: generationState.createdAt,
    aggregateFingerprint: generationState.search.aggregateFingerprint,
    repoFingerprints: generationState.search.repoFingerprints,
  };
}

export function deriveSearchFreshness(
  generationState: Pick<IndexGenerationState, 'generationId' | 'createdAt' | 'search'>,
  request: SearchRefreshRequest | null,
  snapshot: SearchRefreshSnapshot | null,
): SearchFreshnessState {
  const relevantRequest =
    request && request.generationId === generationState.generationId ? request : null;
  const base: SearchFreshnessState = {
    status: 'unknown',
    requestedAt: relevantRequest?.requestedAt ?? generationState.search.requestedAt,
    refreshedAt: snapshot?.refreshedAt,
    aggregateFingerprint: generationState.search.aggregateFingerprint,
    repoFingerprints: generationState.search.repoFingerprints,
    coordinationMode: 'shared-marker',
    details: generationState.search.details,
    error: generationState.search.error,
    snapshotId: snapshot?.snapshotId,
  };

  if (!relevantRequest && !snapshot) {
    return {
      ...base,
      status: 'unknown',
      details: 'no Zoekt coordination state is available yet',
    };
  }

  if (snapshot?.status === 'ready' && snapshot.aggregateFingerprint === base.aggregateFingerprint) {
    return {
      ...base,
      status: 'ready',
      details: 'Zoekt snapshot fingerprint matches the current MCP generation',
      error: undefined,
    };
  }

  if (
    snapshot?.status === 'failed' &&
    relevantRequest?.requestedAt &&
    snapshot.refreshedAt >= relevantRequest.requestedAt
  ) {
    return {
      ...base,
      status: 'failed',
      details: snapshot.details ?? 'Zoekt refresh reported a failure after the MCP generation commit',
      error: snapshot.error ?? generationState.search.error,
    };
  }

  if (snapshot?.status === 'ready' && snapshot.aggregateFingerprint && relevantRequest?.requestedAt) {
    return {
      ...base,
      status: 'stale',
      details: 'Zoekt has a known snapshot, but it does not match the current MCP generation fingerprint',
      error: undefined,
    };
  }

  if (relevantRequest?.requestedAt) {
    return {
      ...base,
      status: 'pending',
      details: 'MCP artifacts are newer than the last known Zoekt snapshot',
      error: undefined,
    };
  }

  return base;
}

export async function reconcileCurrentGenerationSearchFreshness(
  logger?: Pick<Console, 'info' | 'warn' | 'error'>,
): Promise<SearchFreshnessState | null> {
  const generationState = await loadCurrentGenerationState();

  if (!generationState) {
    return null;
  }

  const request = await loadSearchRefreshRequest();
  const snapshot = await loadSearchRefreshSnapshot();
  const freshness = deriveSearchFreshness(generationState, request, snapshot);
  const previousSerialized = JSON.stringify(generationState.search);
  const nextSerialized = JSON.stringify(freshness);

  if (previousSerialized !== nextSerialized) {
    const updatedState: IndexGenerationState = {
      ...generationState,
      search: freshness,
    };
    await updateGenerationState(generationState.generationId, updatedState);
    logger?.info(
      `[search-freshness] generation=${generationState.generationId} status=${freshness.status} refreshedAt=${freshness.refreshedAt ?? 'n/a'}`,
    );

    if (freshness.status === 'failed' && freshness.error) {
      logger?.warn(`[search-freshness] error=${freshness.error}`);
    }
  }

  return freshness;
}

export async function getCurrentSearchFreshness(
  logger?: Pick<Console, 'info' | 'warn' | 'error'>,
): Promise<SearchFreshnessState | null> {
  return reconcileCurrentGenerationSearchFreshness(logger);
}
