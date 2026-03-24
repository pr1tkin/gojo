import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getCurrentIndexHealthMock,
  loadCurrentGenerationStateMock,
  inspectRuntimeRefreshActivityMock,
  detectRepositoryDriftMock,
  assessRuntimeStateFromHealthMock,
  runPlanChangeToolMock,
  runBuildChangeContextToolMock,
} = vi.hoisted(() => ({
  getCurrentIndexHealthMock: vi.fn(),
  loadCurrentGenerationStateMock: vi.fn(),
  inspectRuntimeRefreshActivityMock: vi.fn(),
  detectRepositoryDriftMock: vi.fn(),
  assessRuntimeStateFromHealthMock: vi.fn(),
  runPlanChangeToolMock: vi.fn(),
  runBuildChangeContextToolMock: vi.fn(),
}));

vi.mock('../../src/indexing/health.js', () => ({
  getCurrentIndexHealth: getCurrentIndexHealthMock,
}));

vi.mock('../../src/indexing/generation-store.js', () => ({
  loadCurrentGenerationState: loadCurrentGenerationStateMock,
}));

vi.mock('../../src/runtime/trust.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/runtime/trust.js')>('../../src/runtime/trust.js');

  return {
    ...actual,
    detectRepositoryDrift: detectRepositoryDriftMock,
    assessRuntimeStateFromHealth: assessRuntimeStateFromHealthMock,
    inspectRuntimeRefreshActivity: inspectRuntimeRefreshActivityMock,
  };
});

vi.mock('../../src/tools/plan-change.js', () => ({
  runPlanChangeTool: runPlanChangeToolMock,
}));

vi.mock('../../src/tools/build-change-context.js', () => ({
  runBuildChangeContextTool: runBuildChangeContextToolMock,
}));

import { parseCliArgs } from '../../src/cli/parse.js';
import { buildChangeContextHandler, planChangeHandler } from '../../src/runtime/handlers.js';

function toolResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

describe('cli command surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getCurrentIndexHealthMock.mockResolvedValue({
      trustState: 'trusted',
      suitableForAgentWorkflows: true,
      generationId: 'gen-1',
      generationStatus: 'ready',
      warnings: [],
      errors: [],
      reasons: [],
      recentActivity: null,
      search: {},
    });
    loadCurrentGenerationStateMock.mockResolvedValue({
      createdAt: '2026-03-24T00:00:00.000Z',
    });
    inspectRuntimeRefreshActivityMock.mockResolvedValue(undefined);
    detectRepositoryDriftMock.mockResolvedValue(null);
    assessRuntimeStateFromHealthMock.mockReturnValue({
      readinessState: 'ready',
      trustLevel: 'high',
      confidence: 'high',
      stateSummary: 'Ready',
      stateExplanation: 'artifacts are current',
      warnings: [],
    });
  });

  it('parses plan_change and build_change_context as first-class CLI commands', () => {
    expect(parseCliArgs(['plan_change', 'Widget'])).toEqual({
      command: expect.objectContaining({
        name: 'plan_change',
        capability: 'PlanChange',
        request: { symbol: 'Widget' },
      }),
    });

    expect(parseCliArgs(['build_change_context', 'Widget', '--json'])).toEqual({
      command: expect.objectContaining({
        name: 'build_change_context',
        capability: 'BuildChangeContext',
        request: { target: 'Widget' },
        executionContext: expect.objectContaining({ outputMode: 'json' }),
      }),
    });
  });

  it('passes through normalized plan_change JSON without legacy fields', async () => {
    runPlanChangeToolMock.mockResolvedValue(toolResult({
      tool: 'plan_change',
      direct_consumers: {
        entries: [{ filePath: 'src/components/Widget.tsx' }],
        total: 1,
        shown: 1,
        truncated: false,
      },
      indirect_consumers: {
        entries: [{ filePath: 'src/components/index.ts' }],
        total: 1,
        shown: 1,
        truncated: false,
      },
      related_context: {
        entries: [{ filePath: 'src/pages/Dashboard.tsx' }],
        total: 1,
        shown: 1,
        truncated: false,
      },
    }));

    const response = await planChangeHandler.execute(
      { symbol: 'Widget', repo: { repoId: 'repo-a' } },
      {
        executionContext: { debug: false, outputMode: 'json' },
        dependencies: {
          config: {
            reposRoot: '/repos',
          } as never,
          logger: undefined,
        },
      },
    );

    expect(runPlanChangeToolMock).toHaveBeenCalledWith({
      symbol: 'Widget',
      repo: 'repo-a',
    });
    expect(response.machine_payload).toEqual(expect.objectContaining({
      direct_consumers: expect.objectContaining({
        entries: [{ filePath: 'src/components/Widget.tsx' }],
      }),
      indirect_consumers: expect.objectContaining({
        entries: [{ filePath: 'src/components/index.ts' }],
      }),
      related_context: expect.objectContaining({
        entries: [{ filePath: 'src/pages/Dashboard.tsx' }],
      }),
    }));
    expect(response.machine_payload).not.toHaveProperty('impact');
    expect(response.machine_payload).not.toHaveProperty('related_entities');
  });

  it('passes through normalized build_change_context JSON without legacy fields', async () => {
    runBuildChangeContextToolMock.mockResolvedValue(toolResult({
      tool: 'build_change_context',
      target: {
        symbolName: 'Widget',
        filePath: 'src/components/Widget.tsx',
      },
      direct_consumers: {
        entries: [{ filePath: 'src/components/Widget.tsx', symbolName: 'Widget' }],
        total: 1,
        shown: 1,
        truncated: false,
      },
      indirect_consumers: {
        entries: [{ filePath: 'src/components/index.ts' }],
        total: 1,
        shown: 1,
        truncated: false,
      },
      related_context: {
        entries: [{ filePath: 'src/pages/Dashboard.tsx' }],
        total: 1,
        shown: 1,
        truncated: false,
      },
    }));

    const response = await buildChangeContextHandler.execute(
      { target: 'Widget', repo: { repoId: 'repo-a' } },
      {
        executionContext: { debug: false, outputMode: 'json' },
        dependencies: {
          config: {
            reposRoot: '/repos',
          } as never,
          logger: undefined,
        },
      },
    );

    expect(runBuildChangeContextToolMock).toHaveBeenCalledWith({
      symbolName: 'Widget',
      repo: 'repo-a',
    });
    expect(response.machine_payload).toEqual(expect.objectContaining({
      direct_consumers: expect.objectContaining({
        entries: [{ filePath: 'src/components/Widget.tsx', symbolName: 'Widget' }],
      }),
      indirect_consumers: expect.objectContaining({
        entries: [{ filePath: 'src/components/index.ts' }],
      }),
      related_context: expect.objectContaining({
        entries: [{ filePath: 'src/pages/Dashboard.tsx' }],
      }),
    }));
    expect(response.machine_payload).not.toHaveProperty('impact');
    expect(response.machine_payload).not.toHaveProperty('related_entities');
  });
});
