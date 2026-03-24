import {
  compareSearchFingerprintSets,
  SEARCH_FINGERPRINT_CONTRACT_VERSION,
} from './search-fingerprint.js';
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
} from './types.js';

const SEARCH_COORDINATION_SCHEMA_VERSION = 1;

export function createSearchRefreshRequest(
  generationState: Pick<IndexGenerationState, 'generationId' | 'createdAt' | 'search'>,
): SearchRefreshRequest {
  return {
    schemaVersion: SEARCH_COORDINATION_SCHEMA_VERSION,
    fingerprintContractVersion: SEARCH_FINGERPRINT_CONTRACT_VERSION,
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

  if (snapshot?.status === 'ready') {
    const comparison = compareSearchFingerprintSets(
      base.repoFingerprints,
      snapshot.repoFingerprints,
      base.aggregateFingerprint,
      snapshot.aggregateFingerprint,
    );

    if (comparison.equivalent) {
      return {
        ...base,
        status: 'ready',
        details:
          comparison.issues.length === 0
            ? 'Zoekt snapshot fingerprint matches the current MCP generation'
            : `Zoekt snapshot fingerprint matches the current MCP generation after normalization. ${comparison.summary}`,
        error: undefined,
        comparison,
      };
    }

    return {
      ...base,
      status: 'stale',
      details: `Zoekt has a known snapshot, but it does not match the current MCP generation fingerprint. ${comparison.summary}`,
      error: undefined,
      comparison,
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

  if (freshness.comparison && !freshness.comparison.equivalent) {
    logger?.warn(
      `[search-freshness] fingerprint-mismatch generation=${generationState.generationId} summary=${freshness.comparison.summary}`,
    );
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
