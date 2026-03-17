import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import type {
  CurrentGenerationPointer,
  IndexGenerationState,
  SearchFreshnessState,
  SearchRefreshRequest,
  SearchRefreshSnapshot,
} from './types.js';

const INDEX_GENERATION_SCHEMA_VERSION = 1;

export function getDataDirectory(): string {
  return path.resolve(process.cwd(), '.data');
}

export function getCoordinationDirectory(): string {
  return path.join(getDataDirectory(), 'coordination');
}

function getSearchRefreshRequestFilePath(): string {
  return path.join(getCoordinationDirectory(), 'search-refresh-request.json');
}

function getSearchRefreshSnapshotFilePath(): string {
  return path.join(getCoordinationDirectory(), 'zoekt-refresh-state.json');
}

function getLegacyArtifactFilePath(fileName: string): string {
  return path.join(getDataDirectory(), fileName);
}

export function getGenerationsDirectory(): string {
  return path.join(getDataDirectory(), 'generations');
}

function getCurrentGenerationPointerFilePath(): string {
  return path.join(getDataDirectory(), 'current-generation.json');
}

function getCurrentGenerationPointerTempFilePath(): string {
  return path.join(getDataDirectory(), 'current-generation.tmp.json');
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

export function getCurrentHealthSnapshotFilePath(): string {
  return path.join(getDataDirectory(), 'current-health.json');
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

  await fsPromises.mkdir(getDataDirectory(), { recursive: true });
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
    return getLegacyArtifactFilePath(fileName);
  }

  return getGenerationArtifactFilePath(pointer.generationId, fileName);
}

export function resolveArtifactFilePathSync(fileName: string): string {
  const pointer = loadCurrentGenerationPointerSync();

  if (!pointer) {
    return getLegacyArtifactFilePath(fileName);
  }

  return getGenerationArtifactFilePath(pointer.generationId, fileName);
}

function normalizeSearchRefreshRequest(value: unknown): SearchRefreshRequest | null {
  if (
    !isObject(value) ||
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

export async function loadSearchRefreshRequest(): Promise<SearchRefreshRequest | null> {
  try {
    const content = await fsPromises.readFile(getSearchRefreshRequestFilePath(), 'utf8');
    return normalizeSearchRefreshRequest(JSON.parse(content) as unknown);
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

export async function loadSearchRefreshSnapshot(): Promise<SearchRefreshSnapshot | null> {
  try {
    const content = await fsPromises.readFile(getSearchRefreshSnapshotFilePath(), 'utf8');
    return normalizeSearchRefreshSnapshot(JSON.parse(content) as unknown);
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
