import fs from 'node:fs/promises';
import path from 'node:path';

import { collectRepositorySourceFiles } from '../symbol-index/build-index.js';
import type { IndexHealthSummary, IndexHealthTrustState } from '../indexing/types.js';
import type { RuntimeReadinessState, RuntimeTrustLevel } from './types.js';

export interface RuntimeTrustAssessment {
  trustLevel: RuntimeTrustLevel;
  confidence: RuntimeTrustLevel;
  readinessState: RuntimeReadinessState;
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

function mapHealthTrustState(trustState: IndexHealthTrustState): RuntimeTrustAssessment {
  switch (trustState) {
    case 'healthy':
      return {
        trustLevel: 'high',
        confidence: 'high',
        readinessState: 'ready',
        warnings: [],
      };
    case 'degraded':
    case 'repair-recommended':
    case 'stale-search':
      return {
        trustLevel: 'medium',
        confidence: 'medium',
        readinessState: 'stale',
        warnings: [],
      };
    case 'inconsistent':
      return {
        trustLevel: 'degraded',
        confidence: 'low',
        readinessState: 'inconsistent',
        warnings: [],
      };
    case 'unknown':
    default:
      return {
        trustLevel: 'low',
        confidence: 'low',
        readinessState: 'unknown',
        warnings: [],
      };
  }
}

export function assessTrustFromHealth(
  health: IndexHealthSummary,
  options?: { additionalWarnings?: string[] },
): RuntimeTrustAssessment {
  const base = mapHealthTrustState(health.trustState);
  const warnings = [...base.warnings, ...(options?.additionalWarnings ?? [])];
  const hasAdditionalWarnings = warnings.length > base.warnings.length;

  if (hasAdditionalWarnings && base.readinessState === 'ready') {
    return {
      trustLevel: 'medium',
      confidence: 'medium',
      readinessState: 'stale',
      warnings,
    };
  }

  if (!health.suitableForAgentWorkflows && base.trustLevel === 'high') {
    return {
      trustLevel: 'medium',
      confidence: 'medium',
      readinessState: base.readinessState,
      warnings,
    };
  }

  return {
    ...base,
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
