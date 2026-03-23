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
    expect(response.machine_payload.direct_consumers).toEqual(
      expect.objectContaining({
        total: 0,
        shown: 0,
        truncated: false,
        confidence: 'high',
        coverage: 'exact',
      }),
    );
  });

  it('flattens shown direct and indirect buckets into legacy related_entities before related context', async () => {
    getCurrentIndexHealthMock.mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-03-22T09:30:00.000Z',
      generationId: 'gen-1',
      generationStatus: 'ready',
      publishedAt: '2026-03-22T09:29:00.000Z',
      repositories: [{ repoId: 'repo-a', repoRoot: '/repos/repo-a' }],
      reposRoot: '/repos/repo-a',
      search: {
        status: 'ready',
        aggregateFingerprint: 'abc',
        repoFingerprints: [],
        coordinationMode: 'shared-marker',
        details: 'ready',
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
      trustState: 'healthy',
      suitableForAgentWorkflows: true,
      reasons: [],
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
      relatedFileBuckets: {
        directConsumers: {
          kind: 'direct_consumers',
          label: 'Direct consumers (exact)',
          explanation: 'confirmed symbol-level usage',
          confidence: 'high',
          coverage: 'exact',
          entries: [
            {
              file: {
                fileId: 'repo-a:src/direct-a.ts',
                repoId: 'repo-a',
                filePath: 'src/direct-a.ts',
              },
            },
          ],
          total: 3,
          shown: 1,
          truncated: true,
        },
        indirectConsumers: {
          kind: 'indirect_consumers',
          label: 'Indirect consumers (inferred)',
          explanation: 'likely usage via wrappers or re-exports',
          confidence: 'medium',
          coverage: 'inferred',
          entries: [
            {
              file: {
                fileId: 'repo-a:src/indirect-a.ts',
                repoId: 'repo-a',
                filePath: 'src/indirect-a.ts',
              },
            },
          ],
          total: 2,
          shown: 1,
          truncated: true,
        },
        relatedContext: {
          kind: 'related_context',
          label: 'Related context (exploratory)',
          explanation: 'nearby or dependent files, not guaranteed direct usage',
          confidence: 'low',
          coverage: 'exploratory',
          entries: [
            {
              file: {
                fileId: 'repo-a:src/context-a.ts',
                repoId: 'repo-a',
                filePath: 'src/context-a.ts',
              },
            },
          ],
          total: 5,
          shown: 1,
          truncated: true,
        },
      },
      summary: {
        candidateCount: 1,
        totalCandidateCount: 1,
        relatedFileCount: 3,
        totalRelatedFileCount: 10,
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

    expect(response.related_entities).toEqual([
      expect.objectContaining({ path: 'src/direct-a.ts' }),
      expect.objectContaining({ path: 'src/indirect-a.ts' }),
    ]);
    expect(response.related_entities).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'src/context-a.ts' })]),
    );
    expect(response.machine_payload.direct_consumers).toEqual(
      expect.objectContaining({ total: 3, shown: 1, truncated: true, coverage: 'exact' }),
    );
    expect(response.machine_payload.indirect_consumers).toEqual(
      expect.objectContaining({ total: 2, shown: 1, truncated: true, coverage: 'inferred' }),
    );
    expect(response.machine_payload.related_context).toEqual(
      expect.objectContaining({ total: 5, shown: 1, truncated: true, coverage: 'exploratory' }),
    );
  });

  it('falls back to related context in legacy related_entities when no direct or indirect buckets are shown', async () => {
    getCurrentIndexHealthMock.mockResolvedValue({
      schemaVersion: 1,
      generatedAt: '2026-03-22T09:30:00.000Z',
      generationId: 'gen-1',
      generationStatus: 'ready',
      publishedAt: '2026-03-22T09:29:00.000Z',
      repositories: [{ repoId: 'repo-a', repoRoot: '/repos/repo-a' }],
      reposRoot: '/repos/repo-a',
      search: {
        status: 'ready',
        aggregateFingerprint: 'abc',
        repoFingerprints: [],
        coordinationMode: 'shared-marker',
        details: 'ready',
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
      trustState: 'healthy',
      suitableForAgentWorkflows: true,
      reasons: [],
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
      relatedFileBuckets: {
        directConsumers: {
          kind: 'direct_consumers',
          label: 'Direct consumers (exact)',
          explanation: 'confirmed symbol-level usage',
          confidence: 'high',
          coverage: 'exact',
          entries: [],
          total: 0,
          shown: 0,
          truncated: false,
        },
        indirectConsumers: {
          kind: 'indirect_consumers',
          label: 'Indirect consumers (inferred)',
          explanation: 'likely usage via wrappers or re-exports',
          confidence: 'medium',
          coverage: 'inferred',
          entries: [],
          total: 0,
          shown: 0,
          truncated: false,
        },
        relatedContext: {
          kind: 'related_context',
          label: 'Related context (exploratory)',
          explanation: 'nearby or dependent files, not guaranteed direct usage',
          confidence: 'low',
          coverage: 'exploratory',
          entries: [
            {
              file: {
                fileId: 'repo-a:src/context-a.ts',
                repoId: 'repo-a',
                filePath: 'src/context-a.ts',
              },
            },
          ],
          total: 1,
          shown: 1,
          truncated: false,
        },
      },
      summary: {
        candidateCount: 1,
        totalCandidateCount: 1,
        relatedFileCount: 1,
        totalRelatedFileCount: 1,
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

    expect(response.related_entities).toEqual([
      expect.objectContaining({ path: 'src/context-a.ts' }),
    ]);
  });
});
