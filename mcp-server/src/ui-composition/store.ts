import fs from 'node:fs/promises';
import path from 'node:path';

import {
  getIndexesDirectory,
  getTempDirectory,
  getGenerationArtifactFilePath,
  resolveArtifactFilePath,
  resolveArtifactFilePathSync,
} from '../indexing/generation-store.js';
import {
  UI_COMPOSITION_SCHEMA_VERSION,
  type UiComponentResolution,
  type UiCompositionEdge,
  type UiCompositionIndex,
  type UiMemberExpressionMetadata,
} from './types.js';

function getUiCompositionDirectory(): string {
  return getIndexesDirectory();
}

function getUiCompositionTempFilePath(): string {
  return path.join(getTempDirectory(), 'ui-composition.tmp.json');
}

function getUiCompositionFilePathInternal(): string {
  return path.join(getUiCompositionDirectory(), 'ui-composition.json');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUiResolution(value: unknown): value is UiComponentResolution {
  return (
    value === 'resolved_local' ||
    value === 'external_dependency' ||
    value === 'alias_not_resolved' ||
    value === 'missing_symbol' ||
    value === 'unresolved'
  );
}

function isUiMemberExpressionMetadata(value: unknown): value is UiMemberExpressionMetadata {
  return (
    isObject(value) &&
    typeof value.expression === 'string' &&
    typeof value.baseName === 'string' &&
    Array.isArray(value.members) &&
    value.members.every((member) => typeof member === 'string') &&
    (
      value.resolutionKind === 'resolved_local_member' ||
      value.resolutionKind === 'external_dependency_member' ||
      value.resolutionKind === 'framework_member' ||
      value.resolutionKind === 'unresolved_member'
    )
  );
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
    isUiResolution(value.resolution) &&
    value.source === 'jsx' &&
    (value.confidence === 'high' || value.confidence === 'medium') &&
    (value.note === undefined || typeof value.note === 'string') &&
    (value.hint === undefined || typeof value.hint === 'string') &&
    (value.dependencySource === undefined || typeof value.dependencySource === 'string') &&
    (value.memberExpression === undefined || isUiMemberExpressionMetadata(value.memberExpression))
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
      ? value.edges
          .filter((entry): entry is Record<string, unknown> => isObject(entry))
          .map((entry): UiCompositionEdge | null => {
            if (isUiCompositionEdge(entry)) {
              return entry;
            }

            if (
              typeof entry.parentFilePath === 'string' &&
              typeof entry.childComponentName === 'string' &&
              entry.source === 'jsx' &&
              (entry.confidence === 'high' || entry.confidence === 'medium')
            ) {
              return {
                parentFilePath: entry.parentFilePath,
                parentSymbolId: typeof entry.parentSymbolId === 'string' ? entry.parentSymbolId : undefined,
                parentSymbolName: typeof entry.parentSymbolName === 'string' ? entry.parentSymbolName : undefined,
                childComponentName: entry.childComponentName,
                childFilePath: typeof entry.childFilePath === 'string' ? entry.childFilePath : undefined,
                childSymbolId: typeof entry.childSymbolId === 'string' ? entry.childSymbolId : undefined,
                resolution:
                  typeof entry.childFilePath === 'string' || typeof entry.childSymbolId === 'string'
                    ? 'resolved_local'
                    : 'unresolved',
                source: 'jsx',
                confidence: entry.confidence,
                note: typeof entry.note === 'string' ? entry.note : undefined,
                hint: undefined,
                dependencySource: undefined,
                memberExpression: undefined,
              };
            }

            return null;
          })
          .filter((entry): entry is UiCompositionEdge => entry !== null)
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
