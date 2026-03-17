import fs from 'node:fs/promises';
import path from 'node:path';

import {
  getGenerationArtifactFilePath,
  resolveArtifactFilePath,
  resolveArtifactFilePathSync,
} from '../indexing/generation-store.js';
import {
  UI_COMPOSITION_SCHEMA_VERSION,
  type UiCompositionEdge,
  type UiCompositionIndex,
} from './types.js';

function getUiCompositionDirectory(): string {
  return path.resolve(process.cwd(), '.data');
}

function getUiCompositionTempFilePath(): string {
  return path.join(getUiCompositionDirectory(), 'ui-composition.tmp.json');
}

function getUiCompositionFilePathInternal(): string {
  return path.join(getUiCompositionDirectory(), 'ui-composition.json');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUiCompositionEdge(value: unknown): value is UiCompositionEdge {
  return (
    isObject(value) &&
    typeof value.parentFilePath === 'string' &&
    (value.parentSymbolId === undefined || typeof value.parentSymbolId === 'string') &&
    (value.parentSymbolName === undefined || typeof value.parentSymbolName === 'string') &&
    typeof value.childComponentName === 'string' &&
    (value.childFilePath === undefined || typeof value.childFilePath === 'string') &&
    (value.childSymbolId === undefined || typeof value.childSymbolId === 'string') &&
    value.source === 'jsx' &&
    (value.confidence === 'high' || value.confidence === 'medium') &&
    (value.note === undefined || typeof value.note === 'string')
  );
}

function createEmptyUiCompositionIndex(): UiCompositionIndex {
  return {
    schemaVersion: UI_COMPOSITION_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion: 0,
    generatedAt: '',
    edges: [],
  };
}

function normalizeLoadedIndex(value: unknown): UiCompositionIndex {
  if (!isObject(value)) {
    return createEmptyUiCompositionIndex();
  }

  return {
    schemaVersion:
      typeof value.schemaVersion === 'number' && Number.isInteger(value.schemaVersion)
        ? value.schemaVersion
        : UI_COMPOSITION_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion:
      typeof value.sourceSymbolIndexSchemaVersion === 'number' &&
      Number.isInteger(value.sourceSymbolIndexSchemaVersion)
        ? value.sourceSymbolIndexSchemaVersion
        : 0,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
    edges: Array.isArray(value.edges)
      ? value.edges.filter((entry): entry is UiCompositionEdge => isUiCompositionEdge(entry))
      : [],
  };
}

export async function loadUiCompositionIndex(): Promise<UiCompositionIndex> {
  try {
    const content = await fs.readFile(await resolveArtifactFilePath('ui-composition.json'), 'utf8');
    return normalizeLoadedIndex(JSON.parse(content) as unknown);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return createEmptyUiCompositionIndex();
    }

    throw error;
  }
}

export async function saveUiCompositionIndex(
  index: UiCompositionIndex,
  options: { generationId?: string } = {},
): Promise<string> {
  const directory = getUiCompositionDirectory();
  const tempFilePath = getUiCompositionTempFilePath();
  const filePath = options.generationId
    ? getGenerationArtifactFilePath(options.generationId, 'ui-composition.json')
    : getUiCompositionFilePathInternal();

  if (options.generationId) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(index, null, 2), 'utf8');
  } else {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(tempFilePath, JSON.stringify(index, null, 2), 'utf8');
    await fs.rename(tempFilePath, filePath);
  }

  return filePath;
}

export function getUiCompositionFilePath(): string {
  return resolveArtifactFilePathSync('ui-composition.json');
}
