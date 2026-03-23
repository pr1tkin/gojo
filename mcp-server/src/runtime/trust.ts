import fs from 'node:fs/promises';
import path from 'node:path';

import { inspectRefreshActivity, type RefreshActivityState } from '../indexing/refresh-coordinator.js';
import { collectRepositorySourceFiles } from '../symbol-index/build-index.js';
import type { IndexHealthSummary, IndexHealthTrustState } from '../indexing/types.js';
import type { RuntimeReadinessState, RuntimeTrustLevel } from './types.js';

// Runtime readiness is intentionally small and product-facing:
// - ready: published artifacts exist, search is synchronized, and no known drift exists
// - refreshing: a refresh is actively rebuilding or publishing a new generation
// - stale: artifacts exist, but freshness or synchronization is behind current repo state
// - degraded: required runtime data is partially unavailable or contradictory
// - unknown: Gojo does not have a trustworthy published generation yet
//
// Trust and confidence are derived from the same readiness inputs so that
// index, health, and explore cannot describe different system states.

export interface RuntimeStateAssessment {
  trustLevel: RuntimeTrustLevel;
  confidence: RuntimeTrustLevel;
  readinessState: RuntimeReadinessState;
  stateSummary: string;
  stateExplanation: string;
  recommendedAction?: string;
  warnings: string[];
}

export interface DriftDetectionInput {
  repoPath?: string;
  generationCreatedAt?: string;
}

export interface DriftDetectionResult {
  stale: boolean;
  severity?: 'stale' | 'degraded';
  warning?: string;
}

function mapHealthTrustState(trustState: IndexHealthTrustState): RuntimeStateAssessment {
  switch (trustState) {
    case 'healthy':
      return {
        trustLevel: 'high',
        confidence: 'high',
        readinessState: 'ready',
        stateSummary: 'ready',
        stateExplanation: 'Gojo indexes and search data are synchronized.',
        warnings: [],
      };
    case 'stale-search':
      return {
        trustLevel: 'medium',
        confidence: 'medium',
        readinessState: 'stale',
        stateSummary: 'stale',
        stateExplanation: 'Gojo has index data, but freshness or search synchronization is behind.',
        recommendedAction: 'Run gojo refresh to reconcile stale Gojo data for this repo.',
        warnings: [],
      };
    case 'degraded':
    case 'repair-recommended':
      return {
        trustLevel: 'degraded',
        confidence: 'degraded',
        readinessState: 'degraded',
        stateSummary: 'degraded',
        stateExplanation: 'Gojo can answer requests, but runtime evidence is degraded or requires repair.',
        recommendedAction: 'Run gojo refresh to reconcile stale Gojo data for this repo.',
        warnings: [],
      };
    case 'inconsistent':
      return {
        trustLevel: 'degraded',
        confidence: 'low',
        readinessState: 'degraded',
        stateSummary: 'degraded',
        stateExplanation: 'Gojo runtime artifacts are incomplete or contradictory.',
        recommendedAction: 'Run gojo index to rebuild Gojo artifacts from a clean generation.',
        warnings: [],
      };
    case 'unknown':
    default:
      return {
        trustLevel: 'low',
        confidence: 'low',
        readinessState: 'unknown',
        stateSummary: 'unknown',
        stateExplanation: 'Gojo cannot determine a trustworthy runtime state yet.',
        recommendedAction: 'Run gojo index to create the first published generation.',
        warnings: [],
      };
  }
}

function explanationFromHealth(health: IndexHealthSummary): string {
  switch (health.trustState) {
    case 'healthy':
      return 'Gojo indexes and search data are synchronized.';
    case 'stale-search':
      return 'Gojo has a valid published generation, but search freshness is not yet fully synchronized or confirmed.';
    case 'repair-recommended':
      return 'Gojo data is available, but maintenance recommends rebuilding before relying on it.';
    case 'degraded':
      return 'Gojo can answer requests, but freshness or maintenance signals are degraded.';
    case 'inconsistent':
      return 'Required runtime artifacts are missing or inconsistent.';
    case 'unknown':
    default:
      return 'No trustworthy published Gojo generation is available yet.';
  }
}

function recommendedActionFromHealth(
  health: IndexHealthSummary,
  repoPath?: string,
  driftWarning?: string,
): string | undefined {
  const indexCommand = repoPath ? `gojo index ${repoPath}` : 'gojo index';
  const refreshCommand = repoPath ? `gojo refresh --repo ${repoPath}` : 'gojo refresh';

  if (health.trustState === 'inconsistent') {
    return `Run ${indexCommand} to rebuild Gojo artifacts from a clean generation.`;
  }

  if (health.trustState === 'unknown') {
    return `Run ${indexCommand} to create the first published generation.`;
  }

  if (driftWarning || health.trustState === 'stale-search' || health.trustState === 'degraded' || health.trustState === 'repair-recommended') {
    return `Run ${refreshCommand} to reconcile stale Gojo data for this repo.`;
  }

  return undefined;
}

function formatRepoDriftWarning(warning: string | undefined): string | undefined {
  if (!warning) {
    return undefined;
  }

  return warning.replace('Results may be based on stale index data.', 'State is stale because');
}

export function assessRuntimeStateFromHealth(
  health: IndexHealthSummary,
  options?: {
    drift?: DriftDetectionResult;
    refreshActivity?: RefreshActivityState;
    repoPath?: string;
  },
): RuntimeStateAssessment {
  const base = mapHealthTrustState(health.trustState);
  const extraWarnings = [
    ...(options?.drift?.warning ? [options.drift.warning] : []),
    ...(options?.refreshActivity?.status === 'stale'
      ? ['Refresh state is degraded because a stale refresh lock was detected.']
      : []),
    ...(options?.refreshActivity?.status === 'active'
      ? ['A refresh is currently in progress; published results may change once it completes.']
      : []),
  ];
  const warnings = [...base.warnings, ...extraWarnings];
  const driftWarning = formatRepoDriftWarning(options?.drift?.warning);
  const stateExplanation = driftWarning ?? explanationFromHealth(health);
  const recommendedAction =
    recommendedActionFromHealth(health, options?.repoPath, driftWarning) ?? base.recommendedAction;

  if (options?.refreshActivity?.status === 'active' && base.readinessState !== 'degraded') {
    return {
      trustLevel: base.trustLevel === 'high' ? 'medium' : base.trustLevel,
      confidence: base.confidence === 'high' ? 'medium' : base.confidence,
      readinessState: 'refreshing',
      stateSummary: 'refreshing',
      stateExplanation:
        'Gojo has a published generation and is actively refreshing runtime artifacts.',
      recommendedAction: 'Wait for the active refresh to complete before treating results as stable.',
      warnings,
    };
  }

  if (
    (options?.refreshActivity?.status === 'stale' || options?.drift?.severity === 'degraded') &&
    base.readinessState !== 'unknown'
  ) {
    return {
      trustLevel: 'degraded',
      confidence: base.confidence === 'high' ? 'medium' : base.confidence,
      readinessState: 'degraded',
      stateSummary: 'degraded',
      stateExplanation:
        options?.refreshActivity?.status === 'stale'
          ? 'Gojo detected evidence of an interrupted or stale refresh lock.'
          : stateExplanation,
      recommendedAction:
        options?.refreshActivity?.status === 'stale'
          ? 'Run gojo refresh to rebuild and clear interrupted refresh state.'
          : recommendedAction,
      warnings,
    };
  }

  if (options?.drift?.severity === 'stale' && base.readinessState === 'ready') {
    return {
      trustLevel: 'medium',
      confidence: 'medium',
      readinessState: 'stale',
      stateSummary: 'stale',
      stateExplanation,
      recommendedAction,
      warnings,
    };
  }

  if (!health.suitableForAgentWorkflows && base.trustLevel === 'high') {
    return {
      trustLevel: 'medium',
      confidence: 'medium',
      readinessState: base.readinessState,
      stateSummary: base.stateSummary,
      stateExplanation,
      recommendedAction,
      warnings,
    };
  }

  return {
    ...base,
    stateExplanation,
    recommendedAction,
    warnings,
  };
}

export async function detectRepositoryDrift(
  input: DriftDetectionInput,
): Promise<DriftDetectionResult> {
  if (!input.repoPath || !input.generationCreatedAt) {
    return { stale: false };
  }

  const generationCreatedAtMs = Date.parse(input.generationCreatedAt);
  if (Number.isNaN(generationCreatedAtMs)) {
    return { stale: false };
  }

  const repositoryId = path.basename(input.repoPath);
  let sourceFiles: string[];

  try {
    sourceFiles = await collectRepositorySourceFiles(input.repoPath, repositoryId);
  } catch (error) {
    return {
      stale: false,
      severity: 'degraded',
      warning: `Results may be incomplete because Gojo could not inspect the repo for drift: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  for (const relativePath of sourceFiles) {
    const absolutePath = path.join(input.repoPath, relativePath);
    const stat = await fs.stat(absolutePath).catch((error) => {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: string }).code)
          : '';

      if (code === 'ENOENT') {
        return null;
      }

      return error;
    });

    if (stat instanceof Error) {
      return {
        stale: false,
        severity: 'degraded',
        warning: `Results may be incomplete because Gojo could not inspect ${relativePath} for drift.`,
      };
    }

    if (stat && stat.mtimeMs > generationCreatedAtMs) {
      return {
        stale: true,
        severity: 'stale',
        warning: `Results may be based on stale index data. ${relativePath} changed after the last index build.`,
      };
    }
  }

  return { stale: false };
}

export async function inspectRuntimeRefreshActivity(
  reposRoot: string | undefined,
): Promise<RefreshActivityState | undefined> {
  if (!reposRoot) {
    return undefined;
  }

  return inspectRefreshActivity(reposRoot);
}
