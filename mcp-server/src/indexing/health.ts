import fs from 'node:fs/promises';
import path from 'node:path';

import {
  getCoordinationDirectory,
  getCurrentHealthSnapshotFilePath,
  getGenerationArtifactFilePath,
  loadCurrentGenerationPointer,
  loadCurrentGenerationState,
  loadSearchRefreshRequestResult,
  loadSearchRefreshSnapshotResult,
} from './generation-store.js';
import { deriveSearchFreshness } from './search-freshness.js';
import type {
  CoordinationMarkerParseResult,
  ConsistencyRunReport,
  GenerationChangeSummary,
  IndexHealthSummary,
  IndexHealthTrustState,
  SearchFreshnessState,
} from './types.js';

const INDEX_HEALTH_SCHEMA_VERSION = 1;

interface JsonFileStatus<T> {
  exists: boolean;
  malformed: boolean;
  value: T | null;
}

async function readJsonFileStatus<T>(filePath: string): Promise<JsonFileStatus<T>> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return {
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
      return { exists: false, malformed: false, value: null };
    }

    return { exists: true, malformed: true, value: null };
  }
}

function describeCoordinationMarkerIssue(
  label: string,
  result: CoordinationMarkerParseResult<unknown>,
): string | null {
  if (result.status === 'ok') {
    return null;
  }

  return `${label} coordination marker is ${result.status}: ${result.reason}`;
}

function sortStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function determineTrustState(input: {
  hasGeneration: boolean;
  search: SearchFreshnessState | null;
  consistency: ConsistencyRunReport | null;
  changeSummary: GenerationChangeSummary | null;
  warnings: string[];
  errors: string[];
  reasons: string[];
}): IndexHealthTrustState {
  if (!input.hasGeneration) {
    return 'unknown';
  }

  if (input.errors.length > 0 || (input.consistency?.overview.failed ?? 0) > 0) {
    return 'inconsistent';
  }

  if ((input.consistency?.overview.repairsRecommended ?? 0) > 0) {
    return 'repair-recommended';
  }

  if (input.search && input.search.status !== 'ready') {
    if (
      input.search.status === 'pending' ||
      input.search.status === 'stale' ||
      input.search.status === 'failed'
    ) {
      return 'stale-search';
    }

    return 'unknown';
  }

  if (
    (input.consistency?.overview.repaired ?? 0) > 0 ||
    (input.changeSummary?.overview.highRiskFiles ?? 0) > 0 ||
    (input.changeSummary?.overview.signalCounts.unknownStructuralChange ?? 0) > 0 ||
    input.reasons.length > 0
  ) {
    return 'degraded';
  }

  return 'healthy';
}

export async function saveCurrentIndexHealthSnapshot(summary: IndexHealthSummary): Promise<string> {
  const filePath = getCurrentHealthSnapshotFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(summary, null, 2), 'utf8');
  return filePath;
}

export async function loadCurrentIndexHealthSnapshot(): Promise<IndexHealthSummary | null> {
  const status = await readJsonFileStatus<IndexHealthSummary>(getCurrentHealthSnapshotFilePath());
  return status.exists && !status.malformed ? status.value : null;
}

export async function getCurrentIndexHealth(): Promise<IndexHealthSummary> {
  const pointer = await loadCurrentGenerationPointer();
  const state = await loadCurrentGenerationState();

  if (!pointer || !state) {
    const summary: IndexHealthSummary = {
      schemaVersion: INDEX_HEALTH_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      generationStatus: 'missing',
      repositories: [],
      search: null,
      changeSummary: null,
      consistency: null,
      recentActivity: {
        lastRefreshStatus: 'unknown',
        delta: { added: 0, modified: 0, deleted: 0 },
        maintenanceRan: false,
        repairsApplied: 0,
        repairsRecommended: 0,
        riskyChangeCount: 0,
        unknownStructuralChangeCount: 0,
        recentChangedFiles: [],
      },
      trustState: 'unknown',
      suitableForAgentWorkflows: false,
      reasons: ['no published generation is available'],
      warnings: [],
      errors: ['current generation pointer or generation state is missing'],
    };
    await saveCurrentIndexHealthSnapshot(summary);
    return summary;
  }

  const changeSummaryStatus = await readJsonFileStatus<GenerationChangeSummary>(
    getGenerationArtifactFilePath(state.generationId, 'change-summary.json'),
  );
  const consistencyStatus = await readJsonFileStatus<ConsistencyRunReport>(
    getGenerationArtifactFilePath(state.generationId, 'consistency-report.json'),
  );
  const requestStatus = await readJsonFileStatus<Record<string, unknown>>(
    `${getCoordinationDirectory()}/search-refresh-request.json`,
  );
  const snapshotStatus = await readJsonFileStatus<Record<string, unknown>>(
    `${getCoordinationDirectory()}/zoekt-refresh-state.json`,
  );
  const requestResult = await loadSearchRefreshRequestResult();
  const snapshotResult = await loadSearchRefreshSnapshotResult();
  const search = deriveSearchFreshness(state, requestResult.value, snapshotResult.value, {
    requestResult,
    snapshotResult,
  });
  const reasons: string[] = [];
  const warnings: string[] = [...state.warnings];
  const errors: string[] = [...state.errors];

  if (search.status !== 'ready') {
    reasons.push(search.details ?? `search freshness is ${search.status}`);
  }

  if (!changeSummaryStatus.exists) {
    warnings.push('change summary artifact is unavailable for the current generation');
  }

  if (changeSummaryStatus.malformed) {
    errors.push('change summary artifact is malformed');
  }

  if (!consistencyStatus.exists) {
    warnings.push('consistency report is unavailable for the current generation');
  }

  if (consistencyStatus.malformed) {
    errors.push('consistency report is malformed');
  }

  const requestMarkerIssue = describeCoordinationMarkerIssue(
    'search refresh request',
    requestResult,
  );
  const snapshotMarkerIssue = describeCoordinationMarkerIssue(
    'Zoekt refresh snapshot',
    snapshotResult,
  );

  if (requestStatus.malformed && requestMarkerIssue === null) {
    warnings.push('search refresh request coordination marker is malformed');
  }

  if (snapshotStatus.malformed && snapshotMarkerIssue === null) {
    warnings.push('Zoekt refresh snapshot coordination marker is malformed');
  }

  if (requestMarkerIssue) {
    warnings.push(requestMarkerIssue);
  }

  if (snapshotMarkerIssue) {
    warnings.push(snapshotMarkerIssue);
  }

  const changeSummary = changeSummaryStatus.value;
  const consistency = consistencyStatus.value;

  if ((changeSummary?.overview.highRiskFiles ?? 0) > 0) {
    reasons.push(`${changeSummary?.overview.highRiskFiles ?? 0} recently changed files were classified as high risk`);
  }

  if ((changeSummary?.overview.signalCounts.unknownStructuralChange ?? 0) > 0) {
    reasons.push(
      `${changeSummary?.overview.signalCounts.unknownStructuralChange ?? 0} recent file changes were classified as unknownStructuralChange`,
    );
  }

  if ((consistency?.overview.repaired ?? 0) > 0) {
    reasons.push(
      `consistency maintenance repaired ${consistency?.overview.repairsApplied ?? 0} issue(s) after publication`,
    );
  }

  if ((consistency?.overview.repairsRecommended ?? 0) > 0) {
    reasons.push(
      `consistency maintenance still recommends ${consistency?.overview.repairsRecommended ?? 0} repair action(s)`,
    );
  }

  if ((consistency?.overview.failed ?? 0) > 0) {
    errors.push(`${consistency?.overview.failed ?? 0} consistency check(s) failed`);
  }

  if ((consistency?.overview.warnings ?? 0) > 0) {
    warnings.push(`${consistency?.overview.warnings ?? 0} consistency check(s) produced warnings`);
  }

  const trustState = determineTrustState({
    hasGeneration: true,
    search,
    consistency,
    changeSummary,
    warnings,
    errors,
    reasons,
  });
  const recentChangedFiles = sortStrings((changeSummary?.files ?? []).map((file) => file.key)).slice(0, 10);
  const recentActivity: IndexHealthSummary['recentActivity'] = {
    lastRefreshAt: state.createdAt,
    lastRefreshStatus:
      state.delta.added === 0 && state.delta.modified === 0 && state.delta.deleted === 0 ? 'no-op' : 'committed',
    delta: { ...state.delta },
    maintenanceRan: Boolean(consistency),
    repairsApplied: consistency?.overview.repairsApplied ?? 0,
    repairsRecommended: consistency?.overview.repairsRecommended ?? 0,
    riskyChangeCount: changeSummary?.overview.highRiskFiles ?? 0,
    unknownStructuralChangeCount: changeSummary?.overview.signalCounts.unknownStructuralChange ?? 0,
    recentChangedFiles,
  };

  const summary: IndexHealthSummary = {
    schemaVersion: INDEX_HEALTH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    generationId: state.generationId,
    generationStatus: state.status,
    publishedAt: pointer.publishedAt,
    repositories: state.repositories,
    reposRoot: state.reposRoot,
    search,
    changeSummary,
    consistency,
    recentActivity,
    trustState,
    suitableForAgentWorkflows: trustState === 'healthy' || trustState === 'degraded',
    reasons: sortStrings(reasons),
    warnings: sortStrings(warnings),
    errors: sortStrings(errors),
  };

  await saveCurrentIndexHealthSnapshot(summary);
  return summary;
}
