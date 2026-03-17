import fs from 'node:fs/promises';
import path from 'node:path';

import {
  getGenerationArtifactFilePath,
  resolveArtifactFilePath,
  resolveArtifactFilePathSync,
} from '../indexing/generation-store.js';
import type { CoordinationMarkerParseStatus } from '../indexing/types.js';
import {
  PATTERN_INDEX_SCHEMA_VERSION,
  type PatternCandidate,
  type PatternFingerprint,
  type PatternIndex,
  type PatternSignal,
} from './types.js';

export interface PatternIndexLoadResult {
  status: CoordinationMarkerParseStatus;
  path: string;
  value: PatternIndex;
  reason: string;
  trustDegraded: boolean;
}

function getPatternDirectory(): string {
  return path.resolve(process.cwd(), '.data');
}

function getPatternTempFilePath(): string {
  return path.join(getPatternDirectory(), 'pattern-candidates.tmp.json');
}

function getPatternFilePathInternal(): string {
  return path.join(getPatternDirectory(), 'pattern-candidates.json');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isPatternSignal(value: unknown): value is PatternSignal {
  return (
    isObject(value) &&
    typeof value.type === 'string' &&
    (value.strength === 'strong' || value.strength === 'moderate' || value.strength === 'weak') &&
    (value.note === undefined || typeof value.note === 'string')
  );
}

function isPatternFingerprint(value: unknown): value is PatternFingerprint {
  return (
    isObject(value) &&
    typeof value.patternKind === 'string' &&
    isStringArray(value.structuralSignals) &&
    isStringArray(value.importSet) &&
    (
      value.exportShape === 'none' ||
      value.exportShape === 'internal' ||
      value.exportShape === 'named' ||
      value.exportShape === 'default' ||
      value.exportShape === 'mixed' ||
      value.exportShape === 'unknown'
    ) &&
    (
      value.symbolRole === 'module' ||
      value.symbolRole === 'component' ||
      value.symbolRole === 'hook' ||
      value.symbolRole === 'handler' ||
      value.symbolRole === 'utility' ||
      value.symbolRole === 'test' ||
      value.symbolRole === 'story' ||
      value.symbolRole === 'unknown'
    ) &&
    (value.uiSignals === undefined || isStringArray(value.uiSignals)) &&
    (value.asyncSignals === undefined || isStringArray(value.asyncSignals))
  );
}

function isPatternCandidate(value: unknown): value is PatternCandidate {
  return (
    isObject(value) &&
    typeof value.patternId === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.repoId === 'string' &&
    typeof value.fileId === 'string' &&
    (value.symbolId === undefined || typeof value.symbolId === 'string') &&
    typeof value.name === 'string' &&
    (
      value.language === 'ts' ||
      value.language === 'tsx' ||
      value.language === 'js' ||
      value.language === 'jsx' ||
      value.language === 'unknown'
    ) &&
    typeof value.startLine === 'number' &&
    typeof value.endLine === 'number' &&
    Array.isArray(value.signals) &&
    value.signals.every((entry) => isPatternSignal(entry)) &&
    isPatternFingerprint(value.fingerprint) &&
    isStringArray(value.supportingImports) &&
    isStringArray(value.relatedSymbolIds) &&
    (value.confidence === 'high' || value.confidence === 'medium' || value.confidence === 'low') &&
    typeof value.createdAt === 'string'
  );
}

function createEmptyPatternIndex(): PatternIndex {
  return {
    schemaVersion: PATTERN_INDEX_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion: 0,
    generatedAt: '',
    patterns: [],
  };
}

function normalizeLoadedIndex(value: unknown): PatternIndex {
  if (!isObject(value)) {
    return createEmptyPatternIndex();
  }

  return {
    schemaVersion:
      typeof value.schemaVersion === 'number' && Number.isInteger(value.schemaVersion)
        ? value.schemaVersion
        : PATTERN_INDEX_SCHEMA_VERSION,
    sourceSymbolIndexSchemaVersion:
      typeof value.sourceSymbolIndexSchemaVersion === 'number' &&
      Number.isInteger(value.sourceSymbolIndexSchemaVersion)
        ? value.sourceSymbolIndexSchemaVersion
        : 0,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
    patterns: Array.isArray(value.patterns)
      ? value.patterns.filter((entry): entry is PatternCandidate => isPatternCandidate(entry))
      : [],
  };
}

export async function loadPatternIndex(): Promise<PatternIndex> {
  const result = await loadPatternIndexResult();
  return result.value;
}

export async function loadPatternIndexResult(): Promise<PatternIndexLoadResult> {
  const filePath = await resolveArtifactFilePath('pattern-candidates.json');

  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as unknown;

    if (!isObject(parsed) || !Array.isArray(parsed.patterns)) {
      return {
        status: 'malformed',
        path: filePath,
        value: createEmptyPatternIndex(),
        reason: 'pattern artifact JSON does not match the expected top-level structure',
        trustDegraded: true,
      };
    }

    const normalized = normalizeLoadedIndex(parsed);

    if (
      typeof parsed.schemaVersion === 'number' &&
      Number.isInteger(parsed.schemaVersion) &&
      parsed.schemaVersion !== PATTERN_INDEX_SCHEMA_VERSION
    ) {
      return {
        status: 'incompatible-version',
        path: filePath,
        value: createEmptyPatternIndex(),
        reason: `unsupported schemaVersion ${parsed.schemaVersion}; expected ${PATTERN_INDEX_SCHEMA_VERSION}`,
        trustDegraded: true,
      };
    }

    if (normalized.patterns.length !== parsed.patterns.length) {
      return {
        status: 'malformed',
        path: filePath,
        value: normalized,
        reason: 'one or more persisted pattern candidates failed validation',
        trustDegraded: true,
      };
    }

    return {
      status: 'ok',
      path: filePath,
      value: normalized,
      reason: 'pattern artifact loaded successfully',
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
        value: createEmptyPatternIndex(),
        reason: 'pattern artifact file does not exist',
        trustDegraded: true,
      };
    }

    if (error instanceof SyntaxError) {
      return {
        status: 'malformed',
        path: filePath,
        value: createEmptyPatternIndex(),
        reason: error.message,
        trustDegraded: true,
      };
    }

    if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY' || code === 'EISDIR') {
      return {
        status: 'unreadable',
        path: filePath,
        value: createEmptyPatternIndex(),
        reason: code,
        trustDegraded: true,
      };
    }

    return {
      status: 'unknown',
      path: filePath,
      value: createEmptyPatternIndex(),
      reason: code || (error instanceof Error ? error.message : 'unknown pattern artifact load failure'),
      trustDegraded: true,
    };
  }
}

export async function savePatternIndex(
  index: PatternIndex,
  options: { generationId?: string } = {},
): Promise<string> {
  const directory = getPatternDirectory();
  const tempFilePath = getPatternTempFilePath();
  const filePath = options.generationId
    ? getGenerationArtifactFilePath(options.generationId, 'pattern-candidates.json')
    : getPatternFilePathInternal();

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

export function getPatternIndexFilePath(): string {
  return resolveArtifactFilePathSync('pattern-candidates.json');
}
