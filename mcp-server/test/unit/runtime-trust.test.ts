import { beforeEach, describe, expect, it, vi } from 'vitest';

const { collectRepositorySourceFilesMock } = vi.hoisted(() => ({
  collectRepositorySourceFilesMock: vi.fn(),
}));

vi.mock('../../src/symbol-index/build-index.js', () => ({
  collectRepositorySourceFiles: collectRepositorySourceFilesMock,
}));

import { assessRuntimeStateFromHealth, detectRepositoryDrift } from '../../src/runtime/trust.js';
import type { IndexHealthSummary } from '../../src/indexing/types.js';

function createHealthSummary(
  overrides: Partial<IndexHealthSummary> = {},
): IndexHealthSummary {
  return {
    schemaVersion: 1,
    generatedAt: '2026-03-23T10:00:00.000Z',
    generationId: 'gen-1',
    generationStatus: 'ready',
    publishedAt: '2026-03-23T09:59:00.000Z',
    repositories: [{ repoId: 'repo-a', repoRoot: '/repos/repo-a' }],
    reposRoot: '/repos',
    search: null,
    changeSummary: null,
    consistency: null,
    recentActivity: {
      lastRefreshStatus: 'committed',
      delta: { added: 0, modified: 0, deleted: 0 },
      maintenanceRan: false,
      repairsApplied: 0,
      repairsRecommended: 0,
      riskyChangeCount: 0,
      unknownStructuralChangeCount: 0,
      recentChangedFiles: [],
    },
    lastRefreshFailure: null,
    trustState: 'healthy',
    suitableForAgentWorkflows: true,
    reasons: [],
    warnings: [],
    errors: [],
    ...overrides,
  };
}

describe('runtime trust', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps degraded health to degraded readiness instead of unknown', () => {
    const result = assessRuntimeStateFromHealth(
      createHealthSummary({
        trustState: 'degraded',
        warnings: ['pattern artifact is missing'],
        suitableForAgentWorkflows: false,
      }),
      {
        repoPath: '/repos/repo-a',
      },
    );

    expect(result.readinessState).toBe('degraded');
    expect(result.trustLevel).toBe('degraded');
    expect(result.stateSummary).toBe('degraded');
    expect(result.stateExplanation).not.toContain('unknown');
  });

  it('reports refreshing when an active refresh exists over a trustworthy generation', () => {
    const result = assessRuntimeStateFromHealth(createHealthSummary(), {
      refreshActivity: {
        status: 'active',
        reposRoot: '/repos',
        phase: 'primary',
      },
      repoPath: '/repos/repo-a',
    });

    expect(result.readinessState).toBe('refreshing');
    expect(result.stateSummary).toBe('refreshing');
    expect(result.recommendedAction).toContain('Wait for the active refresh');
  });

  it('does not mask degraded health as refreshing', () => {
    const result = assessRuntimeStateFromHealth(
      createHealthSummary({
        trustState: 'inconsistent',
        errors: ['semantic-graph.json is missing'],
        suitableForAgentWorkflows: false,
      }),
      {
        refreshActivity: {
          status: 'active',
          reposRoot: '/repos',
          phase: 'primary',
        },
        repoPath: '/repos/repo-a',
      },
    );

    expect(result.readinessState).toBe('degraded');
    expect(result.stateExplanation).toContain('missing or inconsistent');
  });

  it('treats unreadable repo drift inspection as degraded instead of throwing', async () => {
    collectRepositorySourceFilesMock.mockRejectedValue(new Error('EACCES: permission denied, scandir'));

    await expect(
      detectRepositoryDrift({
        repoPath: '/repos/repo-a',
        generationCreatedAt: '2026-03-23T09:59:00.000Z',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        stale: false,
        severity: 'degraded',
        warning: expect.stringContaining('could not inspect the repo for drift'),
      }),
    );
  });
});
