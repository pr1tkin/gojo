import fs from 'node:fs/promises';

import type { PatternIndexLoadResult } from '../patterns/store.js';
import type { CoordinationMarkerParseResult, IndexGenerationState, IndexHealthTrustState } from './types.js';
import { getGenerationArtifactFilePath } from './generation-store.js';

export interface CriticalDataIssue {
  code: string;
  severity: 'warning' | 'error';
  summary: string;
  details: string;
  recommendedAction: string;
  targetArtifacts: string[];
  trustImpact: Extract<IndexHealthTrustState, 'degraded' | 'inconsistent'>;
}

export interface CriticalDataAssessment {
  issues: CriticalDataIssue[];
  strongestTrustImpact: 'none' | 'degraded' | 'inconsistent';
}

interface JsonFileStatus<T> {
  path: string;
  exists: boolean;
  malformed: boolean;
  value: T | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readJsonFileStatus<T>(filePath: string): Promise<JsonFileStatus<T>> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return {
      path: filePath,
      exists: true,
      malformed: false,
      value: JSON.parse(content) as T,
    };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    if (code === 'ENOENT') {
      return { path: filePath, exists: false, malformed: false, value: null };
    }

    return { path: filePath, exists: true, malformed: true, value: null };
  }
}

function buildArtifactIssue(
  code: string,
  fileName: string,
  status: JsonFileStatus<unknown>,
): CriticalDataIssue | null {
  if (!status.exists) {
    return {
      code,
      severity: 'error',
      summary: `${fileName} is missing from the published generation`,
      details: `the published artifact ${status.path} does not exist`,
      recommendedAction: `rebuild the published generation to restore ${fileName}`,
      targetArtifacts: [fileName],
      trustImpact: 'inconsistent',
    };
  }

  if (status.malformed) {
    return {
      code,
      severity: 'error',
      summary: `${fileName} is unreadable or malformed`,
      details: `the published artifact ${status.path} could not be parsed as valid JSON`,
      recommendedAction: `rebuild the published generation to restore a valid ${fileName}`,
      targetArtifacts: [fileName],
      trustImpact: 'inconsistent',
    };
  }

  return null;
}

function buildCoordinationIssue(
  label: string,
  fileName: string,
  result: CoordinationMarkerParseResult<unknown>,
): CriticalDataIssue | null {
  if (
    result.status === 'ok' ||
    result.status === 'missing'
  ) {
    return null;
  }

  return {
    code: `${fileName}-suspicious`,
    severity: 'warning',
    summary: `${label} coordination marker is ${result.status}`,
    details: `${result.path}: ${result.reason}`,
    recommendedAction: `rewrite ${fileName} by running a fresh search coordination cycle`,
    targetArtifacts: [fileName],
    trustImpact: 'degraded',
  };
}

function buildGenerationMetadataIssues(state: IndexGenerationState): CriticalDataIssue[] {
  const issues: CriticalDataIssue[] = [];

  if (!Array.isArray(state.repositories) || state.repositories.length === 0) {
    issues.push({
      code: 'generation-metadata-missing-repositories',
      severity: 'error',
      summary: 'generation metadata is incomplete',
      details: 'index-generation.json does not contain a non-empty repositories list',
      recommendedAction: 'rebuild and republish the generation metadata',
      targetArtifacts: ['index-generation.json'],
      trustImpact: 'inconsistent',
    });
  }

  if (!Array.isArray(state.manifest)) {
    issues.push({
      code: 'generation-metadata-missing-manifest',
      severity: 'error',
      summary: 'generation metadata is incomplete',
      details: 'index-generation.json does not contain a manifest array',
      recommendedAction: 'rebuild and republish the generation metadata',
      targetArtifacts: ['index-generation.json'],
      trustImpact: 'inconsistent',
    });
  }

  const counts = state.counts as unknown as Record<string, unknown> | undefined;
  const requiredCounts = ['files', 'symbols', 'graphFiles', 'graphEdges', 'patterns'];
  const missingCounts = requiredCounts.filter((key) => typeof counts?.[key] !== 'number');

  if (missingCounts.length > 0) {
    issues.push({
      code: 'generation-metadata-missing-counts',
      severity: 'error',
      summary: 'generation metadata is incomplete',
      details: `index-generation.json is missing required count fields: ${missingCounts.join(', ')}`,
      recommendedAction: 'rebuild and republish the generation metadata',
      targetArtifacts: ['index-generation.json'],
      trustImpact: 'inconsistent',
    });
  }

  if (!isObject(state.search) || typeof state.search.status !== 'string') {
    issues.push({
      code: 'generation-metadata-missing-search-state',
      severity: 'error',
      summary: 'generation metadata is incomplete',
      details: 'index-generation.json does not contain a usable search freshness state',
      recommendedAction: 'rebuild and republish the generation metadata',
      targetArtifacts: ['index-generation.json'],
      trustImpact: 'inconsistent',
    });
  }

  return issues;
}

function buildPatternIssue(result: PatternIndexLoadResult): CriticalDataIssue | null {
  if (result.status === 'ok') {
    return null;
  }

  return {
    code: 'pattern-artifact-untrustworthy',
    severity: result.status === 'missing' ? 'warning' : 'error',
    summary: `pattern artifact is ${result.status}`,
    details: `${result.path}: ${result.reason}`,
    recommendedAction: 'rebuild the published generation or pattern artifact before trusting pattern-derived workflows',
    targetArtifacts: ['pattern-candidates.json'],
    trustImpact: result.status === 'missing' ? 'degraded' : 'inconsistent',
  };
}

export async function assessCriticalDataDependencies(input: {
  state: IndexGenerationState;
  generationId: string;
  requestResult: CoordinationMarkerParseResult<unknown>;
  snapshotResult: CoordinationMarkerParseResult<unknown>;
  patternIndexResult: PatternIndexLoadResult;
}): Promise<CriticalDataAssessment> {
  const [symbolStatus, graphStatus, metadataStatus] = await Promise.all([
    readJsonFileStatus<Record<string, unknown>>(
      getGenerationArtifactFilePath(input.generationId, 'symbol-index.json'),
    ),
    readJsonFileStatus<Record<string, unknown>>(
      getGenerationArtifactFilePath(input.generationId, 'code-graph.json'),
    ),
    readJsonFileStatus<Record<string, unknown>>(
      getGenerationArtifactFilePath(input.generationId, 'index-generation.json'),
    ),
  ]);

  const issues = [
    buildArtifactIssue('symbol-index-missing-or-malformed', 'symbol-index.json', symbolStatus),
    buildArtifactIssue('code-graph-missing-or-malformed', 'code-graph.json', graphStatus),
    buildArtifactIssue('generation-metadata-missing-or-malformed', 'index-generation.json', metadataStatus),
    buildPatternIssue(input.patternIndexResult),
    buildCoordinationIssue(
      'search refresh request',
      'coordination/search-refresh-request.json',
      input.requestResult,
    ),
    buildCoordinationIssue(
      'Zoekt refresh snapshot',
      'coordination/zoekt-refresh-state.json',
      input.snapshotResult,
    ),
    ...buildGenerationMetadataIssues(input.state),
  ].filter((issue): issue is CriticalDataIssue => issue !== null);

  const strongestTrustImpact = issues.some((issue) => issue.trustImpact === 'inconsistent')
    ? 'inconsistent'
    : issues.some((issue) => issue.trustImpact === 'degraded')
      ? 'degraded'
      : 'none';

  return {
    issues,
    strongestTrustImpact,
  };
}
