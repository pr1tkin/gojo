import fs from 'node:fs/promises';

import { getGenerationsDirectory, getGenerationStateFilePath } from './generation-store.js';
import type { GenerationChangeSummary, IndexGenerationState } from './types.js';

export interface CountRegressionIssue {
  metric: 'patterns' | 'symbols' | 'graphEdges' | 'uiCompositionEdges' | 'uiPropUsages';
  baselineGenerationId: string;
  baselineCount: number;
  currentCount: number;
  severity: 'error' | 'warning';
  summary: string;
  details: string;
  recommendedAction: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeGenerationState(value: unknown): IndexGenerationState | null {
  if (!isObject(value)) {
    return null;
  }

  if (
    typeof value.generationId !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !isObject(value.counts)
  ) {
    return null;
  }

  return value as unknown as IndexGenerationState;
}

async function loadGenerationStateFromDisk(generationId: string): Promise<IndexGenerationState | null> {
  try {
    const content = await fs.readFile(getGenerationStateFilePath(generationId), 'utf8');
    return normalizeGenerationState(JSON.parse(content) as unknown);
  } catch {
    return null;
  }
}

function isTrustedBaselineCandidate(state: IndexGenerationState): boolean {
  return (
    state.status === 'ready' &&
    state.errors.length === 0 &&
    (state.patternIntegrity?.status ?? 'trusted') !== 'failed'
  );
}

export async function findPriorTrustedGenerationBaseline(
  currentGenerationId: string,
): Promise<IndexGenerationState | null> {
  let generationIds: string[] = [];

  try {
    const entries = await fs.readdir(getGenerationsDirectory(), { withFileTypes: true });
    generationIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return null;
  }

  const priorStates = (
    await Promise.all(
      generationIds
        .filter((generationId) => generationId !== currentGenerationId)
        .map(async (generationId) => loadGenerationStateFromDisk(generationId)),
    )
  )
    .filter((state): state is IndexGenerationState => state !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return priorStates.find((state) => isTrustedBaselineCandidate(state)) ?? null;
}

function isNarrowChangeScope(current: IndexGenerationState, changeSummary: GenerationChangeSummary | null): boolean {
  const filesChanged = changeSummary?.overview.filesChanged ?? current.changeSummary.filesChanged ?? 0;
  const baselineFiles = current.counts.files;

  return filesChanged <= Math.max(5, Math.floor(Math.max(baselineFiles, 1) * 0.2));
}

function createIssue(
  metric: CountRegressionIssue['metric'],
  baseline: IndexGenerationState,
  current: IndexGenerationState,
  currentCount: number,
  baselineCount: number,
  details: string,
): CountRegressionIssue {
  const metricLabel =
    metric === 'graphEdges'
      ? 'graph edge'
      : metric === 'uiCompositionEdges'
        ? 'UI composition edge'
        : metric === 'uiPropUsages'
          ? 'UI prop usage'
          : metric.slice(0, -1);

  return {
    metric,
    baselineGenerationId: baseline.generationId,
    baselineCount,
    currentCount,
    severity: 'error',
    summary: `${metricLabel} count collapsed from ${baselineCount} to ${currentCount} relative to prior trusted generation`,
    details,
    recommendedAction: 'rebuild the current generation and verify artifact integrity before using it for agent workflows',
  };
}

export function evaluateCatastrophicCountRegressions(options: {
  current: IndexGenerationState;
  baseline: IndexGenerationState | null;
  changeSummary: GenerationChangeSummary | null;
}): CountRegressionIssue[] {
  const { current, baseline, changeSummary } = options;

  if (!baseline || !isNarrowChangeScope(current, changeSummary) || baseline.counts.files < 10) {
    return [];
  }

  const issues: CountRegressionIssue[] = [];
  const filesChanged = changeSummary?.overview.filesChanged ?? current.changeSummary.filesChanged ?? 0;
  const metricChecks: Array<{
    metric: CountRegressionIssue['metric'];
    baselineCount: number;
    currentCount: number;
    minBaseline: number;
    maxRatio: number;
    absoluteFloor: number;
  }> = [
    {
      metric: 'patterns',
      baselineCount: baseline.counts.patterns,
      currentCount: current.counts.patterns,
      minBaseline: 20,
      maxRatio: 0.15,
      absoluteFloor: 2,
    },
    {
      metric: 'symbols',
      baselineCount: baseline.counts.symbols,
      currentCount: current.counts.symbols,
      minBaseline: 20,
      maxRatio: 0.25,
      absoluteFloor: 5,
    },
    {
      metric: 'graphEdges',
      baselineCount: baseline.counts.graphEdges,
      currentCount: current.counts.graphEdges,
      minBaseline: 20,
      maxRatio: 0.2,
      absoluteFloor: 5,
    },
    {
      metric: 'uiCompositionEdges',
      baselineCount: baseline.counts.uiCompositionEdges,
      currentCount: current.counts.uiCompositionEdges,
      minBaseline: 20,
      maxRatio: 0.2,
      absoluteFloor: 0,
    },
    {
      metric: 'uiPropUsages',
      baselineCount: baseline.counts.uiPropUsages,
      currentCount: current.counts.uiPropUsages,
      minBaseline: 20,
      maxRatio: 0.2,
      absoluteFloor: 0,
    },
  ];

  for (const check of metricChecks) {
    if (check.baselineCount < check.minBaseline) {
      continue;
    }

    const ratio = check.baselineCount === 0 ? 1 : check.currentCount / check.baselineCount;

    if (ratio > check.maxRatio || check.currentCount > check.absoluteFloor) {
      continue;
    }

    issues.push(
      createIssue(
        check.metric,
        baseline,
        current,
        check.currentCount,
        check.baselineCount,
        `count regression was observed after only ${filesChanged} changed file(s), which is inconsistent with a narrow-scope refresh for a repository with ${baseline.counts.files} indexed files`,
      ),
    );
  }

  return issues;
}
