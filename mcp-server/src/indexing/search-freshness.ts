import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { listRepositories } from '../repositories.js';
import {
  loadCurrentGenerationState,
  loadSearchRefreshRequestResult,
  loadSearchRefreshSnapshotResult,
  updateGenerationState,
} from './generation-store.js';
import type {
  CoordinationMarkerParseResult,
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

function summarizeCoordinationMarkerResult(
  label: string,
  result: CoordinationMarkerParseResult<unknown>,
): string | null {
  if (result.status === 'ok') {
    return null;
  }

  return `${label} marker ${result.status} at ${result.path}: ${result.reason}`;
}

function getConservativeFreshnessForMarkerState(
  generationState: Pick<IndexGenerationState, 'generationId' | 'createdAt' | 'search'>,
  base: SearchFreshnessState,
  requestResult: CoordinationMarkerParseResult<SearchRefreshRequest>,
  snapshotResult: CoordinationMarkerParseResult<SearchRefreshSnapshot>,
): SearchFreshnessState | null {
  if (requestResult.status === 'ok' && snapshotResult.status === 'ok') {
    return null;
  }

  const issues = [
    summarizeCoordinationMarkerResult('search refresh request', requestResult),
    summarizeCoordinationMarkerResult('Zoekt refresh snapshot', snapshotResult),
  ].filter((value): value is string => value !== null);
  const hasUsableRequest = requestResult.status === 'ok';
  const hasUsableSnapshot = snapshotResult.status === 'ok';
  const hasHistoricalRequest = Boolean(
    requestResult.value?.requestedAt ?? generationState.search.requestedAt,
  );
  let status: SearchFreshnessState['status'] = 'unknown';

  if (hasUsableSnapshot && snapshotResult.value?.status === 'failed') {
    status = 'failed';
  } else if (hasUsableRequest || hasHistoricalRequest) {
    status = 'pending';
  } else if (hasUsableSnapshot) {
    status = 'stale';
  }

  return {
    ...base,
    status,
    details: `search freshness downgraded because coordination markers are not trustworthy: ${issues.join('; ')}`,
    error:
      status === 'failed'
        ? snapshotResult.value?.error ?? generationState.search.error
        : undefined,
  };
}

export function deriveSearchFreshness(
  generationState: Pick<IndexGenerationState, 'generationId' | 'createdAt' | 'search'>,
  request: SearchRefreshRequest | null,
  snapshot: SearchRefreshSnapshot | null,
  markerState: {
    requestResult?: CoordinationMarkerParseResult<SearchRefreshRequest>;
    snapshotResult?: CoordinationMarkerParseResult<SearchRefreshSnapshot>;
  } = {},
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
  const conservativeMarkerState = getConservativeFreshnessForMarkerState(
    generationState,
    base,
    markerState.requestResult ?? {
      status: request ? 'ok' : 'missing',
      path: 'coordination/search-refresh-request.json',
      value: request,
      reason: request ? 'marker loaded successfully' : 'marker file does not exist',
      trustDegraded: !request,
    },
    markerState.snapshotResult ?? {
      status: snapshot ? 'ok' : 'missing',
      path: 'coordination/zoekt-refresh-state.json',
      value: snapshot,
      reason: snapshot ? 'marker loaded successfully' : 'marker file does not exist',
      trustDegraded: !snapshot,
    },
  );

  if (conservativeMarkerState) {
    return conservativeMarkerState;
  }

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

  const requestResult = await loadSearchRefreshRequestResult();
  const snapshotResult = await loadSearchRefreshSnapshotResult();
  const request = requestResult.status === 'ok' ? requestResult.value : null;
  const snapshot = snapshotResult.status === 'ok' ? snapshotResult.value : null;
  const freshness = deriveSearchFreshness(generationState, request, snapshot, {
    requestResult,
    snapshotResult,
  });
  const previousSerialized = JSON.stringify(generationState.search);
  const nextSerialized = JSON.stringify(freshness);

  for (const result of [requestResult, snapshotResult]) {
    if (result.status !== 'ok') {
      logger?.warn(
        `[search-freshness] coordination-marker status=${result.status} path=${result.path} reason=${result.reason} consequence=${freshness.status}`,
      );
    }
  }

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
