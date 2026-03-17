import fs from 'node:fs/promises';
import path from 'node:path';

import {
  getGenerationArtifactFilePath,
  resolveArtifactFilePath,
  resolveArtifactFilePathSync,
} from '../indexing/generation-store.js';
import {
  UI_PROP_SURFACE_SCHEMA_VERSION,
  type UiPropSurfaceIndex,
  type UiPropUsage,
} from './types.js';

function getUiPropsDirectory(): string {
  return path.resolve(process.cwd(), '.data');
}

function getUiPropsTempFilePath(): string {
  return path.join(getUiPropsDirectory(), 'ui-props.tmp.json');
}

function getUiPropsFilePathInternal(): string {
  return path.join(getUiPropsDirectory(), 'ui-props.json');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUiPropUsage(value: unknown): value is UiPropUsage {
  return (
    isObject(value) &&
    typeof value.parentFilePath === 'string' &&
    (value.parentSymbolId === undefined || typeof value.parentSymbolId === 'string') &&
    (value.parentSymbolName === undefined || typeof value.parentSymbolName === 'string') &&
    typeof value.childComponentName === 'string' &&
    (value.childFilePath === undefined || typeof value.childFilePath === 'string') &&
    (value.childSymbolId === undefined || typeof value.childSymbolId === 'string') &&
    typeof value.propName === 'string' &&
    (value.valueKind === 'string-literal' ||
      value.valueKind === 'number-literal' ||
      value.valueKind === 'boolean-literal' ||
      value.valueKind === 'identifier' ||
      value.valueKind === 'expression' ||
      value.valueKind === 'object' ||
      value.valueKind === 'array' ||
      value.valueKind === 'unknown') &&
    value.source === 'jsx-attribute' &&
    (value.confidence === 'high' || value.confidence === 'medium') &&
    (value.note === undefined || typeof value.note === 'string')
  );
}

function createEmptyUiPropSurfaceIndex(): UiPropSurfaceIndex {
  return {
    schemaVersion: UI_PROP_SURFACE_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion: 0,
    generatedAt: '',
    propUsages: [],
  };
}

function normalizeLoadedIndex(value: unknown): UiPropSurfaceIndex {
  if (!isObject(value)) {
    return createEmptyUiPropSurfaceIndex();
  }

  return {
    schemaVersion:
      typeof value.schemaVersion === 'number' && Number.isInteger(value.schemaVersion)
        ? value.schemaVersion
        : UI_PROP_SURFACE_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion:
      typeof value.sourceSymbolIndexSchemaVersion === 'number' &&
      Number.isInteger(value.sourceSymbolIndexSchemaVersion)
        ? value.sourceSymbolIndexSchemaVersion
        : 0,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
    propUsages: Array.isArray(value.propUsages)
      ? value.propUsages.filter((entry): entry is UiPropUsage => isUiPropUsage(entry))
      : [],
  };
}

export async function loadUiPropSurfaceIndex(): Promise<UiPropSurfaceIndex> {
  try {
    const content = await fs.readFile(await resolveArtifactFilePath('ui-props.json'), 'utf8');
    return normalizeLoadedIndex(JSON.parse(content) as unknown);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return createEmptyUiPropSurfaceIndex();
    }

    throw error;
  }
}

export async function saveUiPropSurfaceIndex(
  index: UiPropSurfaceIndex,
  options: { generationId?: string } = {},
): Promise<string> {
  const directory = getUiPropsDirectory();
  const tempFilePath = getUiPropsTempFilePath();
  const filePath = options.generationId
    ? getGenerationArtifactFilePath(options.generationId, 'ui-props.json')
    : getUiPropsFilePathInternal();

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

export function getUiPropSurfaceFilePath(): string {
  return resolveArtifactFilePathSync('ui-props.json');
}
