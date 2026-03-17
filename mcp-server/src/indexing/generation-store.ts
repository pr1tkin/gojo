import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import type { CurrentGenerationPointer, IndexGenerationState } from './types.js';

const INDEX_GENERATION_SCHEMA_VERSION = 1;

function getDataDirectory(): string {
  return path.resolve(process.cwd(), '.data');
}

function getLegacyArtifactFilePath(fileName: string): string {
  return path.join(getDataDirectory(), fileName);
}

function getGenerationsDirectory(): string {
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
    return JSON.parse(content) as IndexGenerationState;
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

