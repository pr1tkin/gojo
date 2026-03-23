import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { getProductEnvironment } from '../product/environment.js';
import type {
  CoordinationMarkerParseResult,
  CurrentGenerationPointer,
  GenerationLifecycleMarker,
  IndexGenerationState,
  RefreshFailureHistoryEntry,
  RefreshFailureRecord,
  SearchFreshnessState,
  SearchRefreshRequest,
  SearchRefreshSnapshot,
} from './types.js';

const INDEX_GENERATION_SCHEMA_VERSION = 1;
const GENERATION_LIFECYCLE_SCHEMA_VERSION = 1;
const REFRESH_FAILURE_SCHEMA_VERSION = 1;

export const REQUIRED_GENERATION_ARTIFACT_FILES = [
  'symbol-index.json',
  'code-graph.json',
  'semantic-graph.json',
  'ui-composition.json',
  'ui-props.json',
  'ui-semantics.json',
  'pattern-candidates.json',
  'change-summary.json',
  'index-generation.json',
] as const;

export function getDataDirectory(): string {
  return getProductEnvironment().paths.dataDir;
}

export function getIndexesDirectory(): string {
  return getProductEnvironment().paths.indexesDir;
}

export function getRuntimeDirectory(): string {
  return getProductEnvironment().paths.runtimeDir;
}

export function getTempDirectory(): string {
  return getProductEnvironment().paths.tempDir;
}

export function getCoordinationDirectory(): string {
  return path.join(getRuntimeDirectory(), 'coordination');
}

function getSearchRefreshRequestFilePath(): string {
  return path.join(getCoordinationDirectory(), 'search-refresh-request.json');
}

function getSearchRefreshSnapshotFilePath(): string {
  return path.join(getCoordinationDirectory(), 'zoekt-refresh-state.json');
}

export function getGenerationsDirectory(): string {
  return path.join(getIndexesDirectory(), 'generations');
}

function getCurrentGenerationPointerFilePath(): string {
  return path.join(getIndexesDirectory(), 'current-generation.json');
}


function getCurrentGenerationPointerTempFilePath(): string {
  return path.join(getTempDirectory(), 'current-generation.tmp.json');
}

export function getGenerationDirectory(generationId: string): string {
  return path.join(getGenerationsDirectory(), generationId);
}


export function getGenerationArtifactFilePath(generationId: string, fileName: string): string {
  return path.join(getGenerationDirectory(generationId), fileName);
}

export function getGenerationStateFilePath(generationId: string): string {
  return getGenerationArtifactFilePath(generationId, 'index-generation.json');
}

export function getGenerationLifecycleFilePath(generationId: string): string {
  return getGenerationArtifactFilePath(generationId, 'generation-lifecycle.json');
}

export function getCurrentHealthSnapshotFilePath(): string {
  return path.join(getDataDirectory(), 'current-health.json');
}

export function getRefreshFailureFilePath(): string {
  return path.join(getDataDirectory(), 'maintenance', 'refresh-failures', 'latest.json');
}

export function getRefreshFailureHistoryFilePath(): string {
  return path.join(getDataDirectory(), 'maintenance', 'refresh-failures', 'history.json');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeCurrentGenerationPointer(value: unknown): CurrentGenerationPointer | null {
  if (
    !isObject(value) ||
    typeof value.generationId !== 'string' ||
    typeof value.publishedAt !== 'string'
  ) {
    return null;
  }

  return {
    schemaVersion:
      typeof value.schemaVersion === 'number' && Number.isInteger(value.schemaVersion)
        ? value.schemaVersion
        : INDEX_GENERATION_SCHEMA_VERSION,
    generationId: value.generationId,
    publishedAt: value.publishedAt,
  };
}

function createDefaultSearchFreshnessState(): SearchFreshnessState {
  return {
    status: 'unknown',
    aggregateFingerprint: '',
    repoFingerprints: [],
    coordinationMode: 'shared-marker',
    details: 'search freshness metadata not available in this generation',
  };
}

function normalizeGenerationState(value: unknown): IndexGenerationState | null {
  if (!isObject(value)) {
    return null;
  }

  return {
    ...((value as unknown) as IndexGenerationState),
    search: isObject(value.search)
      ? ((value.search as unknown) as SearchFreshnessState)
      : createDefaultSearchFreshnessState(),
  };
}

function normalizeGenerationLifecycleMarker(value: unknown): GenerationLifecycleMarker | null {
  if (
    !isObject(value) ||
    typeof value.schemaVersion !== 'number' ||
    typeof value.generationId !== 'string' ||
    (value.status !== 'staged' && value.status !== 'committed' && value.status !== 'abandoned') ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    schemaVersion: value.schemaVersion,
    generationId: value.generationId,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : undefined,
    abandonedAt: typeof value.abandonedAt === 'string' ? value.abandonedAt : undefined,
    reason: typeof value.reason === 'string' ? value.reason : undefined,
  };
}

function normalizeRefreshFailureRecord(value: unknown): RefreshFailureRecord | null {
  if (
    !isObject(value) ||
    typeof value.schemaVersion !== 'number' ||
    typeof value.failedAt !== 'string' ||
    typeof value.reason !== 'string' ||
    typeof value.cleanupRequired !== 'boolean' ||
    (value.trustImpact !== 'degraded' && value.trustImpact !== 'inconsistent')
  ) {
    return null;
  }

  return {
    schemaVersion: value.schemaVersion,
    failedAt: value.failedAt,
    generationId: typeof value.generationId === 'string' ? value.generationId : undefined,
    stage: typeof value.stage === 'string' ? (value.stage as RefreshFailureRecord['stage']) : undefined,
    mode: typeof value.mode === 'string' ? (value.mode as RefreshFailureRecord['mode']) : undefined,
    reason: value.reason,
    cleanupRequired: value.cleanupRequired,
    trustImpact: value.trustImpact,
  };
}

export async function loadCurrentGenerationPointer(): Promise<CurrentGenerationPointer | null> {
  try {
    const content = await fsPromises.readFile(getCurrentGenerationPointerFilePath(), 'utf8');
    return normalizeCurrentGenerationPointer(JSON.parse(content) as unknown);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export function loadCurrentGenerationPointerSync(): CurrentGenerationPointer | null {
  try {
    const content = fs.readFileSync(getCurrentGenerationPointerFilePath(), 'utf8');
    return normalizeCurrentGenerationPointer(JSON.parse(content) as unknown);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function loadCurrentGenerationState(): Promise<IndexGenerationState | null> {
  const pointer = await loadCurrentGenerationPointer();

  if (!pointer) {
    return null;
  }

  try {
    const content = await fsPromises.readFile(getGenerationStateFilePath(pointer.generationId), 'utf8');
    return normalizeGenerationState(JSON.parse(content) as unknown);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function saveGenerationArtifacts(
  generationId: string,
  artifacts: Record<string, unknown>,
  generationState: IndexGenerationState,
): Promise<string> {
  const generationDirectory = getGenerationDirectory(generationId);

  await fsPromises.mkdir(generationDirectory, { recursive: true });

  for (const [fileName, artifact] of Object.entries(artifacts)) {
    await fsPromises.writeFile(
      getGenerationArtifactFilePath(generationId, fileName),
      JSON.stringify(artifact, null, 2),
      'utf8',
    );
  }

  await fsPromises.writeFile(
    getGenerationStateFilePath(generationId),
    JSON.stringify(generationState, null, 2),
    'utf8',
  );

  return generationDirectory;
}

async function saveGenerationLifecycleMarker(marker: GenerationLifecycleMarker): Promise<string> {
  const filePath = getGenerationLifecycleFilePath(marker.generationId);
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, JSON.stringify(marker, null, 2), 'utf8');
  return filePath;
}

export async function loadGenerationLifecycleMarker(
  generationId: string,
): Promise<GenerationLifecycleMarker | null> {
  try {
    const content = await fsPromises.readFile(getGenerationLifecycleFilePath(generationId), 'utf8');
    return normalizeGenerationLifecycleMarker(JSON.parse(content) as unknown);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function initializeStagedGeneration(
  generationId: string,
  createdAt: string,
): Promise<string> {
  await fsPromises.mkdir(getGenerationDirectory(generationId), { recursive: true });
  return saveGenerationLifecycleMarker({
    schemaVersion: GENERATION_LIFECYCLE_SCHEMA_VERSION,
    generationId,
    status: 'staged',
    createdAt,
    updatedAt: createdAt,
  });
}

export async function markGenerationCommitted(
  generationId: string,
  publishedAt: string,
): Promise<string> {
  const existing =
    (await loadGenerationLifecycleMarker(generationId)) ?? {
      schemaVersion: GENERATION_LIFECYCLE_SCHEMA_VERSION,
      generationId,
      status: 'staged' as const,
      createdAt: publishedAt,
      updatedAt: publishedAt,
    };

  return saveGenerationLifecycleMarker({
    ...existing,
    schemaVersion: GENERATION_LIFECYCLE_SCHEMA_VERSION,
    status: 'committed',
    updatedAt: publishedAt,
    publishedAt,
    reason: undefined,
    abandonedAt: undefined,
  });
}

export async function markGenerationAbandoned(
  generationId: string,
  abandonedAt: string,
  reason: string,
): Promise<string> {
  const existing =
    (await loadGenerationLifecycleMarker(generationId)) ?? {
      schemaVersion: GENERATION_LIFECYCLE_SCHEMA_VERSION,
      generationId,
      status: 'staged' as const,
      createdAt: abandonedAt,
      updatedAt: abandonedAt,
    };

  return saveGenerationLifecycleMarker({
    ...existing,
    schemaVersion: GENERATION_LIFECYCLE_SCHEMA_VERSION,
    status: 'abandoned',
    updatedAt: abandonedAt,
    abandonedAt,
    reason,
  });
}

export async function updateGenerationState(
  generationId: string,
  generationState: IndexGenerationState,
): Promise<string> {
  const filePath = getGenerationStateFilePath(generationId);
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, JSON.stringify(generationState, null, 2), 'utf8');
  return filePath;
}

export async function publishGeneration(generationId: string, publishedAt: string): Promise<void> {
  const pointer: CurrentGenerationPointer = {
    schemaVersion: INDEX_GENERATION_SCHEMA_VERSION,
    generationId,
    publishedAt,
  };

  await fsPromises.mkdir(path.dirname(getCurrentGenerationPointerFilePath()), { recursive: true });
  await fsPromises.writeFile(
    getCurrentGenerationPointerTempFilePath(),
    JSON.stringify(pointer, null, 2),
    'utf8',
  );
  await fsPromises.rename(
    getCurrentGenerationPointerTempFilePath(),
    getCurrentGenerationPointerFilePath(),
  );
}

export async function resolveArtifactFilePath(fileName: string): Promise<string> {
  const pointer = await loadCurrentGenerationPointer();

  if (!pointer) {
    return path.join(getIndexesDirectory(), fileName);
  }

  return getGenerationArtifactFilePath(pointer.generationId, fileName);
}

export function resolveArtifactFilePathSync(fileName: string): string {
  const pointer = loadCurrentGenerationPointerSync();

  if (!pointer) {
    return path.join(getIndexesDirectory(), fileName);
  }

  return getGenerationArtifactFilePath(pointer.generationId, fileName);
}

function normalizeSearchRefreshRequest(value: unknown): SearchRefreshRequest | null {
  if (
    !isObject(value) ||
    typeof value.schemaVersion !== 'number' ||
    typeof value.generationId !== 'string' ||
    typeof value.requestedAt !== 'string' ||
    typeof value.aggregateFingerprint !== 'string' ||
    !Array.isArray(value.repoFingerprints)
  ) {
    return null;
  }

  return (value as unknown) as SearchRefreshRequest;
}

function normalizeSearchRefreshSnapshot(value: unknown): SearchRefreshSnapshot | null {
  if (
    !isObject(value) ||
    typeof value.schemaVersion !== 'number' ||
    typeof value.snapshotId !== 'string' ||
    (value.status !== 'ready' && value.status !== 'failed') ||
    typeof value.refreshedAt !== 'string' ||
    !Array.isArray(value.repoFingerprints)
  ) {
    return null;
  }

  return (value as unknown) as SearchRefreshSnapshot;
}

export async function saveSearchRefreshRequest(request: SearchRefreshRequest): Promise<string> {
  const filePath = getSearchRefreshRequestFilePath();
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, JSON.stringify(request, null, 2), 'utf8');
  return filePath;
}

export async function saveSearchRefreshSnapshot(snapshot: SearchRefreshSnapshot): Promise<string> {
  const filePath = getSearchRefreshSnapshotFilePath();
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  return filePath;
}

export async function saveRefreshFailure(record: Omit<RefreshFailureRecord, 'schemaVersion'>): Promise<string> {
  const filePath = getRefreshFailureFilePath();
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(
    filePath,
    JSON.stringify(
      {
        schemaVersion: REFRESH_FAILURE_SCHEMA_VERSION,
        ...record,
      },
      null,
      2,
    ),
    'utf8',
  );
  return filePath;
}

export async function clearRefreshFailure(): Promise<void> {
  await fsPromises.rm(getRefreshFailureFilePath(), { force: true });
}

export async function archiveRefreshFailure(
  record: RefreshFailureRecord,
  options: {
    archivedAt: string;
    resolution: RefreshFailureHistoryEntry['resolution'];
    recoveryGenerationId?: string;
    recoveredAt?: string;
  },
): Promise<string> {
  const filePath = getRefreshFailureHistoryFilePath();
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });

  let history: RefreshFailureHistoryEntry[] = [];

  try {
    const content = await fsPromises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as unknown;

    if (Array.isArray(parsed)) {
      history = parsed.filter(isObject).map((entry) => ({
        schemaVersion:
          typeof entry.schemaVersion === 'number' && Number.isInteger(entry.schemaVersion)
            ? entry.schemaVersion
            : REFRESH_FAILURE_SCHEMA_VERSION,
        failedAt: typeof entry.failedAt === 'string' ? entry.failedAt : '',
        generationId: typeof entry.generationId === 'string' ? entry.generationId : undefined,
        stage: typeof entry.stage === 'string' ? (entry.stage as RefreshFailureRecord['stage']) : undefined,
        mode: typeof entry.mode === 'string' ? (entry.mode as RefreshFailureRecord['mode']) : undefined,
        reason: typeof entry.reason === 'string' ? entry.reason : '',
        cleanupRequired: entry.cleanupRequired === true,
        trustImpact:
          entry.trustImpact === 'inconsistent' ? 'inconsistent' : 'degraded',
        archivedAt: typeof entry.archivedAt === 'string' ? entry.archivedAt : options.archivedAt,
        recoveryGenerationId:
          typeof entry.recoveryGenerationId === 'string' ? entry.recoveryGenerationId : undefined,
        recoveredAt: typeof entry.recoveredAt === 'string' ? entry.recoveredAt : undefined,
        resolution: entry.resolution === 'superseded' ? 'superseded' : 'recovered',
      }));
    }
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code !== 'ENOENT') {
      throw error;
    }
  }

  history.push({
    ...record,
    archivedAt: options.archivedAt,
    recoveryGenerationId: options.recoveryGenerationId,
    recoveredAt: options.recoveredAt,
    resolution: options.resolution,
  });
  await fsPromises.writeFile(filePath, JSON.stringify(history, null, 2), 'utf8');
  return filePath;
}

export async function loadRefreshFailure(): Promise<RefreshFailureRecord | null> {
  try {
    const content = await fsPromises.readFile(getRefreshFailureFilePath(), 'utf8');
    return normalizeRefreshFailureRecord(JSON.parse(content) as unknown);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return 'unknown coordination marker read failure';
}

function summarizeRawMarkerValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return `json-array(length=${value.length})`;
  }

  if (isObject(value)) {
    const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
    return `json-object(keys=${keys.slice(0, 8).join(',')}${keys.length > 8 ? ',â€¦' : ''})`;
  }

  if (value === null) {
    return 'json-null';
  }

  return `json-${typeof value}`;
}

async function loadCoordinationMarker<T>(
  filePath: string,
  normalizer: (value: unknown) => T | null,
  expectedSchemaVersion: number,
): Promise<CoordinationMarkerParseResult<T>> {
  try {
    const content = await fsPromises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    const normalized = normalizer(parsed);
    const rawSummary = summarizeRawMarkerValue(parsed);

    if (!normalized) {
      return {
        status: 'malformed',
        path: filePath,
        value: null,
        reason: 'marker JSON does not match the required structure',
        rawSummary,
        trustDegraded: true,
      };
    }

    const normalizedWithVersion = normalized as T & { schemaVersion: number };

    if (normalizedWithVersion.schemaVersion !== expectedSchemaVersion) {
      return {
        status: 'incompatible-version',
        path: filePath,
        value: null,
        reason: `unsupported schemaVersion ${normalizedWithVersion.schemaVersion}; expected ${expectedSchemaVersion}`,
        rawSummary,
        trustDegraded: true,
      };
    }

    return {
      status: 'ok',
      path: filePath,
      value: normalized,
      reason: 'marker loaded successfully',
      rawSummary,
      trustDegraded: false,
    };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return {
        status: 'missing',
        path: filePath,
        value: null,
        reason: 'marker file does not exist',
        trustDegraded: true,
      };
    }

    if (error instanceof SyntaxError) {
      return {
        status: 'malformed',
        path: filePath,
        value: null,
        reason: error.message,
        trustDegraded: true,
      };
    }

    if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY' || code === 'EISDIR') {
      return {
        status: 'unreadable',
        path: filePath,
        value: null,
        reason: code || describeUnknownError(error),
        trustDegraded: true,
      };
    }

    return {
      status: 'unknown',
      path: filePath,
      value: null,
      reason: code || describeUnknownError(error),
      trustDegraded: true,
    };
  }
}

export async function loadSearchRefreshRequestResult(): Promise<CoordinationMarkerParseResult<SearchRefreshRequest>> {
  return loadCoordinationMarker(
    getSearchRefreshRequestFilePath(),
    normalizeSearchRefreshRequest,
    1,
  );
}

export async function loadSearchRefreshRequest(): Promise<SearchRefreshRequest | null> {
  const result = await loadSearchRefreshRequestResult();
  return result.status === 'ok' ? result.value : null;
}

export async function loadSearchRefreshSnapshotResult(): Promise<CoordinationMarkerParseResult<SearchRefreshSnapshot>> {
  return loadCoordinationMarker(
    getSearchRefreshSnapshotFilePath(),
    normalizeSearchRefreshSnapshot,
    1,
  );
}

export async function loadSearchRefreshSnapshot(): Promise<SearchRefreshSnapshot | null> {
  const result = await loadSearchRefreshSnapshotResult();
  return result.status === 'ok' ? result.value : null;
}

