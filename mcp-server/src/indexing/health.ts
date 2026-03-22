import fs from 'node:fs/promises';
import path from 'node:path';

import {
  evaluateCatastrophicCountRegressions,
  findPriorTrustedGenerationBaseline,
} from './count-regressions.js';
import { assessCriticalDataDependencies } from './critical-data.js';
import { loadPatternIndexResult } from '../patterns/store.js';
import {
  archiveRefreshFailure,
  clearRefreshFailure,
  getCoordinationDirectory,
  getCurrentHealthSnapshotFilePath,
  getGenerationArtifactFilePath,
  loadCurrentGenerationPointer,
  loadCurrentGenerationState,
  loadRefreshFailure,
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
  RefreshFailureRecord,
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

function dedupeStringsPreserveOrder(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    ordered.push(value);
  }

  return ordered;
}

function isValidRecoverySearchState(search: SearchFreshnessState | null): boolean {
  if (!search) {
    return false;
  }

  return search.status === 'ready' || search.status === 'pending';
}

function hasUnresolvedHighRiskValidation(state: {
  highRiskRefreshValidation?: { status: 'not-applicable' | 'passed' | 'degraded' | 'failed' };
}): boolean {
  return (
    state.highRiskRefreshValidation?.status === 'degraded' ||
    state.highRiskRefreshValidation?.status === 'failed'
  );
}

function hasBlockingConsistencyIssues(consistency: ConsistencyRunReport | null): boolean {
  if (!consistency) {
    return false;
  }

  return consistency.overview.failed > 0 || consistency.overview.repairsRecommended > 0;
}

export function hasSuccessfulRecoveryFromRefreshFailure(input: {
  refreshFailure: RefreshFailureRecord | null;
  state: {
    generationId: string;
    createdAt: string;
    errors: string[];
    patternIntegrity?: { status: 'trusted' | 'degraded' | 'failed' };
    highRiskRefreshValidation?: { status: 'not-applicable' | 'passed' | 'degraded' | 'failed' };
  };
  search: SearchFreshnessState | null;
  consistency: ConsistencyRunReport | null;
  criticalDataTrustImpact: 'none' | 'degraded' | 'inconsistent';
  catastrophicCountRegressionCount: number;
}): boolean {
  const { refreshFailure, state, search, consistency, criticalDataTrustImpact, catastrophicCountRegressionCount } =
    input;

  if (!refreshFailure) {
    return false;
  }

  if (Date.parse(state.createdAt) <= Date.parse(refreshFailure.failedAt)) {
    return false;
  }

  if (state.errors.length > 0) {
    return false;
  }

  if (state.patternIntegrity?.status === 'failed') {
    return false;
  }

  if (hasUnresolvedHighRiskValidation(state)) {
    return false;
  }

  if (criticalDataTrustImpact !== 'none') {
    return false;
  }

  if (catastrophicCountRegressionCount > 0) {
    return false;
  }

  if (hasBlockingConsistencyIssues(consistency)) {
    return false;
  }

  if (!isValidRecoverySearchState(search)) {
    return false;
  }

  return true;
}

function determineTrustState(input: {
  hasGeneration: boolean;
  criticalDataTrustImpact: 'none' | 'degraded' | 'inconsistent';
  search: SearchFreshnessState | null;
  consistency: ConsistencyRunReport | null;
  changeSummary: GenerationChangeSummary | null;
  refreshFailure: RefreshFailureRecord | null;
  warnings: string[];
  errors: string[];
  reasons: string[];
}): IndexHealthTrustState {
  // Canonical contract:
  // - unknown: no trustworthy published generation exists yet, or generation metadata is absent
  // - inconsistent: published generation exists, but required facts/artifacts are broken
  // - stale-search/degraded/repair-recommended: published generation exists, but freshness or maintenance is behind
  if (!input.hasGeneration) {
    return 'unknown';
  }

  if (input.criticalDataTrustImpact === 'inconsistent') {
    return 'inconsistent';
  }

  if (input.errors.length > 0 || (input.consistency?.overview.failed ?? 0) > 0) {
    return 'inconsistent';
  }

  if (input.criticalDataTrustImpact === 'degraded') {
    return 'degraded';
  }

  if (input.refreshFailure?.trustImpact === 'inconsistent') {
    return 'inconsistent';
  }

  if (input.refreshFailure?.trustImpact === 'degraded') {
    return 'degraded';
  }

  if ((input.consistency?.overview.repairsRecommended ?? 0) > 0) {
    return 'repair-recommended';
  }

  if (input.search && input.search.status !== 'ready') {
    // Search freshness is advisory about synchronization, not existence. Once a
    // published generation exists, non-ready search must degrade to stale rather
    // than erasing that ground truth.
    return 'stale-search';
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
  let pointer = null;
  let state = null;
  let metadataLoadError: string | null = null;

  try {
    pointer = await loadCurrentGenerationPointer();
  } catch (error) {
    metadataLoadError = error instanceof Error ? error.message : 'unknown current generation pointer load failure';
  }

  if (pointer) {
    try {
      state = await loadCurrentGenerationState();
    } catch (error) {
      metadataLoadError = error instanceof Error ? error.message : 'unknown generation metadata load failure';
    }
  }

  let refreshFailure = await loadRefreshFailure().catch(() => null);

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
      lastRefreshFailure: refreshFailure,
      trustState: 'unknown',
      suitableForAgentWorkflows: false,
      reasons: [
        'no published generation is available',
        ...(refreshFailure ? [`last refresh failed at ${refreshFailure.failedAt}: ${refreshFailure.reason}`] : []),
      ],
      warnings: [],
      errors: [
        metadataLoadError
          ? `current generation metadata is unavailable or unreadable: ${metadataLoadError}`
          : 'current generation pointer or generation state is missing',
        ...(refreshFailure
          ? [`last refresh failed at ${refreshFailure.failedAt}: ${refreshFailure.reason}`]
          : []),
      ],
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
  const patternIndexResult = await loadPatternIndexResult();
  const criticalData = await assessCriticalDataDependencies({
    state,
    generationId: state.generationId,
    requestResult,
    snapshotResult,
    patternIndexResult,
  });
  const search = deriveSearchFreshness(state, requestResult.value, snapshotResult.value, {
    requestResult,
    snapshotResult,
  });
  const priorTrustedBaseline = await findPriorTrustedGenerationBaseline(state.generationId);
  const countRegressionIssues = evaluateCatastrophicCountRegressions({
    current: state,
    baseline: priorTrustedBaseline,
    changeSummary: changeSummaryStatus.value,
  });
  const recoveredRefreshFailure = hasSuccessfulRecoveryFromRefreshFailure({
    refreshFailure,
    state,
    search,
    consistency: consistencyStatus.value,
    criticalDataTrustImpact: criticalData.strongestTrustImpact,
    catastrophicCountRegressionCount: countRegressionIssues.length,
  })
    ? refreshFailure
    : null;

  if (recoveredRefreshFailure) {
    await archiveRefreshFailure(recoveredRefreshFailure, {
      archivedAt: new Date().toISOString(),
      recoveredAt: state.createdAt,
      recoveryGenerationId: state.generationId,
      resolution: 'recovered',
    }).catch(() => undefined);
    await clearRefreshFailure().catch(() => undefined);
    refreshFailure = null;
  }

  const activeRefreshFailure = refreshFailure;
  const reasons: string[] = [];
  const warnings: string[] = [...state.warnings];
  const errors: string[] = [...state.errors];

  for (const issue of criticalData.issues) {
    const message = `${issue.summary}: ${issue.details}`;

    if (issue.severity === 'error') {
      errors.push(message);
    } else {
      warnings.push(message);
    }

    reasons.push(`${issue.summary}; remediation: ${issue.recommendedAction}`);
  }

  for (const issue of state.patternIntegrity?.issues ?? []) {
    const message = `${issue.summary}: ${issue.details}`;

    if (issue.severity === 'error') {
      errors.push(message);
    } else {
      warnings.push(message);
    }

    reasons.push(`${issue.summary}; remediation: ${issue.recommendedAction}`);
  }

  if (state.highRiskRefreshValidation?.isHighRiskRefresh) {
    if (state.highRiskRefreshValidation.status !== 'passed') {
      reasons.push(
        `high-risk refresh validation was triggered by ${state.highRiskRefreshValidation.triggers.join('; ')}`,
      );
    }

    for (const issue of state.highRiskRefreshValidation.issues) {
      const message = `${issue.summary}: ${issue.details}`;

      if (issue.severity === 'error') {
        errors.push(message);
      } else {
        warnings.push(message);
      }

      reasons.push(`${issue.summary}; remediation: ${issue.recommendedAction}`);
    }
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

  for (const issue of countRegressionIssues) {
    const message = `${issue.summary}: ${issue.details}`;
    errors.push(message);
    reasons.push(`${issue.summary}; remediation: ${issue.recommendedAction}`);
  }

  if (search.status !== 'ready') {
    reasons.push(search.details ?? `search freshness is ${search.status}`);
  }

  if (activeRefreshFailure) {
    const failureMessage = `last refresh failed at ${activeRefreshFailure.failedAt}: ${activeRefreshFailure.reason}`;

    if (activeRefreshFailure.trustImpact === 'inconsistent') {
      errors.push(failureMessage);
    } else {
      warnings.push(failureMessage);
    }

    reasons.push(failureMessage);
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
    criticalDataTrustImpact: criticalData.strongestTrustImpact,
    search,
    consistency,
    changeSummary,
    refreshFailure: activeRefreshFailure,
    warnings,
    errors,
    reasons,
  });
  const recentChangedFiles = dedupeStringsPreserveOrder(
    (changeSummary?.files ?? []).map((file) => file.key),
  ).slice(0, 10);
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
    lastRefreshFailure: activeRefreshFailure,
    trustState,
    suitableForAgentWorkflows:
      trustState !== 'unknown' &&
      trustState !== 'inconsistent' &&
      criticalData.strongestTrustImpact === 'none' &&
      !(
        state.highRiskRefreshValidation?.status === 'degraded' ||
        state.highRiskRefreshValidation?.status === 'failed'
      ),
    reasons: dedupeStringsPreserveOrder(reasons),
    warnings: dedupeStringsPreserveOrder(warnings),
    errors: dedupeStringsPreserveOrder(errors),
  };

  await saveCurrentIndexHealthSnapshot(summary);
  return summary;
}
