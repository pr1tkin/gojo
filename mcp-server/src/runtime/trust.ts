import fs from 'node:fs/promises';
import path from 'node:path';

import { collectRepositorySourceFiles } from '../symbol-index/build-index.js';
import type { IndexHealthSummary, IndexHealthTrustState } from '../indexing/types.js';
import type { RuntimeReadinessState, RuntimeTrustLevel } from './types.js';

// Runtime readiness is intentionally small and product-facing:
// - ready: published artifacts exist, search is synchronized, and no known drift exists
// - stale: artifacts exist, but freshness or synchronization is behind current repo state
// - inconsistent: required runtime data is missing or contradictory
// - unknown: Gojo cannot determine a trustworthy state yet
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
    case 'degraded':
    case 'repair-recommended':
    case 'stale-search':
      return {
        trustLevel: 'medium',
        confidence: 'medium',
        readinessState: 'stale',
        stateSummary: 'stale',
        stateExplanation: 'Gojo has index data, but freshness or search synchronization is behind.',
        recommendedAction: 'Run gojo index to rebuild and republish current repo data.',
        warnings: [],
      };
    case 'inconsistent':
      return {
        trustLevel: 'degraded',
        confidence: 'low',
        readinessState: 'inconsistent',
        stateSummary: 'inconsistent',
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
      return 'Search index is not yet synchronized with the latest Gojo generation.';
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
  options?: { additionalWarnings?: string[]; repoPath?: string },
): RuntimeStateAssessment {
  const base = mapHealthTrustState(health.trustState);
  const warnings = [...base.warnings, ...(options?.additionalWarnings ?? [])];
  const hasAdditionalWarnings = warnings.length > base.warnings.length;
  const driftWarning = formatRepoDriftWarning(options?.additionalWarnings?.[0]);
  const stateExplanation = driftWarning ?? explanationFromHealth(health);
  const recommendedAction =
    recommendedActionFromHealth(health, options?.repoPath, driftWarning) ?? base.recommendedAction;

  if (hasAdditionalWarnings && base.readinessState === 'ready') {
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
  const sourceFiles = await collectRepositorySourceFiles(input.repoPath, repositoryId);

  for (const relativePath of sourceFiles) {
    const absolutePath = path.join(input.repoPath, relativePath);
    const stat = await fs.stat(absolutePath).catch(() => null);

    if (stat && stat.mtimeMs > generationCreatedAtMs) {
      return {
        stale: true,
        warning: `Results may be based on stale index data. ${relativePath} changed after the last index build.`,
      };
    }
  }

  return { stale: false };
}
