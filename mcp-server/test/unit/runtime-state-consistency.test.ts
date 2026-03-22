import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCurrentIndexHealthMock,
  loadCurrentGenerationStateMock,
  getSymbolExplorationContextMock,
} = vi.hoisted(() => ({
  getCurrentIndexHealthMock: vi.fn(),
  loadCurrentGenerationStateMock: vi.fn(),
  getSymbolExplorationContextMock: vi.fn(),
}));

vi.mock('../../src/indexing/health.js', () => ({
  getCurrentIndexHealth: getCurrentIndexHealthMock,
}));

vi.mock('../../src/indexing/generation-store.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/indexing/generation-store.js')>(
    '../../src/indexing/generation-store.js',
  );

  return {
    ...actual,
    loadCurrentGenerationState: loadCurrentGenerationStateMock,
  };
});

vi.mock('../../src/orchestrator/index.js', () => ({
  getSymbolExplorationContext: getSymbolExplorationContextMock,
}));

import { exploreComponentHandler } from '../../src/runtime/handlers.js';

describe('runtime state consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not let explore report unknown when a valid generation and symbol result exist', async () => {
    getCurrentIndexHealthMock.mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-03-22T09:30:00.000Z',
      generationId: 'gen-1',
      generationStatus: 'ready',
      publishedAt: '2026-03-22T09:29:00.000Z',
      repositories: [{ repoId: 'repo-a', repoRoot: '/repos/repo-a' }],
      reposRoot: '/repos/repo-a',
      search: {
        status: 'unknown',
        aggregateFingerprint: 'abc',
        repoFingerprints: [],
        coordinationMode: 'shared-marker',
        details: 'search freshness metadata not available in this generation',
      },
      changeSummary: null,
      consistency: null,
      recentActivity: {
        lastRefreshAt: '2026-03-22T09:29:00.000Z',
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
      trustState: 'stale-search',
      suitableForAgentWorkflows: true,
      reasons: ['search freshness metadata not available in this generation'],
      warnings: [],
      errors: [],
    });

    loadCurrentGenerationStateMock.mockResolvedValue({
      generationId: 'gen-1',
      createdAt: '2026-03-22T09:29:00.000Z',
    });

    getSymbolExplorationContextMock.mockResolvedValue({
      query: 'Alpha',
      repo: 'repo-a',
      primarySymbol: {
        symbolId: 'repo-a:src/a.ts:function:Alpha:1',
        fileId: 'repo-a:src/a.ts',
        name: 'Alpha',
        kind: 'function',
        repo: 'repo-a',
        filePath: 'src/a.ts',
        startLine: 1,
        endLine: 3,
        exported: true,
      },
      primaryFile: {
        fileId: 'repo-a:src/a.ts',
        repoId: 'repo-a',
        filePath: 'src/a.ts',
      },
      relatedFiles: [],
      summary: {
        candidateCount: 1,
        totalCandidateCount: 1,
        relatedFileCount: 0,
        totalRelatedFileCount: 0,
        exportedSymbolCount: 1,
      },
    });

    const response = await exploreComponentHandler.execute(
      {
        target: 'Alpha',
        repo: {
          repoId: 'repo-a',
        },
      },
      {
        executionContext: {
          debug: false,
          outputMode: 'json',
          repoTarget: {
            repoId: 'repo-a',
          },
        },
        dependencies: {
          config: {
            reposRoot: '/repos',
          } as never,
        },
      },
    );

    expect(response.readiness_state).toBe('stale');
    expect(response.trust_level).toBe('medium');
    expect(response.summary.text).toContain('State: stale');
    expect(response.summary.text).not.toContain('State: unknown');
    expect(response.summary.text).not.toContain('No trustworthy published Gojo generation is available yet.');
    expect(response.machine_payload.readinessState).toBe('stale');
  });
});
