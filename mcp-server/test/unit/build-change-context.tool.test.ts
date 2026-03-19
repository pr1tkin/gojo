import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const {
  runExploreComponentToolMock,
  runFindPrecedentsToolMock,
  runCollectRefactorContextToolMock,
  runPlanChangeToolMock,
} = vi.hoisted(() => ({
  runExploreComponentToolMock: vi.fn(),
  runFindPrecedentsToolMock: vi.fn(),
  runCollectRefactorContextToolMock: vi.fn(),
  runPlanChangeToolMock: vi.fn(),
}));

vi.mock('../../src/tools/explore-component.js', () => ({
  runExploreComponentTool: runExploreComponentToolMock,
}));

vi.mock('../../src/tools/find-precedents.js', () => ({
  runFindPrecedentsTool: runFindPrecedentsToolMock,
}));

vi.mock('../../src/tools/collect-refactor-context.js', () => ({
  runCollectRefactorContextTool: runCollectRefactorContextToolMock,
}));

vi.mock('../../src/tools/plan-change.js', () => ({
  runPlanChangeTool: runPlanChangeToolMock,
}));

import {
  buildChangeContextToolDefinition,
  runBuildChangeContextTool,
} from '../../src/tools/build-change-context.js';

function toolResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

function makeExploreResponse(overrides: Record<string, any> = {}) {
  return {
    tool: 'explore_component',
    version: '1',
    mode: 'agent',
    query: { target: 'Widget', repo: 'repo-a' },
    summary: { resultCount: 2, primaryCount: 2, confidence: 'high' },
    results: {
      primary: [
        {
          id: 'related:1',
          kind: 'related_file',
          title: 'WidgetCard.tsx',
          confidence: 'high',
          explanation: { short: 'strong neighboring implementation' },
          references: { filePaths: ['src/components/WidgetCard.tsx'] },
          filePath: 'src/components/WidgetCard.tsx',
          relationshipKinds: ['file_imports_file'],
        },
      ],
    },
    evidence: [{ kind: 'target_role', label: 'target role', value: 'component' }],
    nextActions: [{ tool: 'find_precedents', reason: 'inspect peers', query: { name: 'Widget', repo: 'repo-a' } }],
    diagnostics: { warnings: [] },
    expansions: {
      'cluster:widget': {
        id: 'cluster:widget',
        kind: 'cluster-context',
        title: 'Widget cluster',
        status: 'available',
      },
    },
    debug: null,
    target: {
      status: 'resolved',
      requestedName: 'Widget',
      requestedRepo: 'repo-a',
      symbolName: 'Widget',
      filePath: 'src/components/Widget.tsx',
      repoId: 'repo-a',
      role: 'component',
      family: 'ui_component',
      confidence: 'high',
      resolution: { candidateCount: 1, ambiguityDetected: false },
      symbolSurface: { defined: ['Widget'], exported: ['Widget'] },
      expansionId: 'cluster:widget',
    },
    ...overrides,
  };
}

function makePrecedentsResponse(overrides: Record<string, any> = {}) {
  return {
    tool: 'find_precedents',
    version: '1',
    mode: 'agent',
    query: { target: 'Widget', repo: 'repo-a', mode: 'component' },
    summary: { resultCount: 2, primaryCount: 2, confidence: 'high' },
    results: {
      primary: [
        {
          id: 'precedent:1',
          kind: 'precedent',
          title: 'WidgetTile',
          confidence: 'high',
          explanation: { short: 'same family + strong dependency overlap' },
          references: {
            filePaths: ['src/components/WidgetTile.tsx'],
            symbolNames: ['WidgetTile'],
          },
          filePath: 'src/components/WidgetTile.tsx',
          symbolName: 'WidgetTile',
          role: 'component',
          family: 'ui_component',
          matchStrength: 'high',
          relationship: 'peer_family',
          expansionId: 'cluster:widget',
        },
      ],
    },
    evidence: [{ kind: 'target_family', label: 'target family', value: 'ui_component' }],
    nextActions: [{ tool: 'explore_component', reason: 'inspect best precedent', query: { name: 'src/components/WidgetTile.tsx', repo: 'repo-a' } }],
    diagnostics: { warnings: [] },
    expansions: {
      'cluster:widget': {
        id: 'cluster:widget',
        kind: 'cluster-context',
        title: 'Widget cluster',
        status: 'available',
      },
    },
    debug: null,
    target: {
      status: 'resolved',
      filePath: 'src/components/Widget.tsx',
      repoId: 'repo-a',
      symbolName: 'Widget',
      role: 'component',
      family: 'ui_component',
      confidence: 'high',
      grounding: 'strong',
      resolution: { candidateCount: 1, ambiguityDetected: false },
      expansionId: 'cluster:widget',
    },
    ...overrides,
  };
}

function makeRefactorResponse(overrides: Record<string, any> = {}) {
  return {
    tool: 'collect_refactor_context',
    version: '1',
    mode: 'agent',
    query: { target: 'Widget', repo: 'repo-a', mode: 'component' },
    summary: { resultCount: 3, primaryCount: 2, confidence: 'medium' },
    results: {
      primary: [
        {
          id: 'refactor:1',
          kind: 'related_file',
          title: 'WidgetCard.tsx',
          confidence: 'high',
          explanation: { short: 'high-value neighboring file before refactor' },
          references: { filePaths: ['src/components/WidgetCard.tsx'] },
          filePath: 'src/components/WidgetCard.tsx',
          relationshipKinds: ['file_imports_file'],
        },
      ],
    },
    evidence: [{ kind: 'importing_files', label: 'importing files', value: '3' }],
    nextActions: [{ tool: 'plan_change', reason: 'turn context into a plan', query: { symbol: 'Widget', filePath: 'src/components/Widget.tsx', repo: 'repo-a' } }],
    diagnostics: { warnings: [] },
    expansions: {
      'refactor:graph-neighbors': {
        id: 'refactor:graph-neighbors',
        kind: 'refactor-graph-neighbors',
        title: 'Graph neighbors',
        status: 'deferred',
      },
    },
    debug: null,
    target: {
      status: 'resolved',
      requestedName: 'Widget',
      requestedMode: 'component',
      filePath: 'src/components/Widget.tsx',
      repoId: 'repo-a',
      symbolName: 'Widget',
      role: 'component',
      family: 'ui_component',
      confidence: 'medium',
      resolution: { candidateCount: 1, ambiguityDetected: false },
    },
    contextSummary: {
      importingFileCount: 3,
      importedFileCount: 1,
      reexportingFileCount: 0,
      reexportedFileCount: 0,
      graphNeighborCount: 4,
      nearbyFileCount: 2,
      relatedFileCount: 3,
      definedSymbolCount: 2,
      exportedSymbolCount: 1,
      ambiguityDetected: false,
      graphNeighborsExpansionId: 'refactor:graph-neighbors',
    },
    ...overrides,
  };
}

function makePlanResponse(overrides: Record<string, any> = {}) {
  return {
    tool: 'plan_change',
    version: '1',
    mode: 'agent',
    query: { target: 'Widget', repo: 'repo-a', mode: 'safe', filePath: 'src/components/Widget.tsx', symbolName: 'Widget' },
    summary: { resultCount: 2, primaryCount: 2 },
    results: {
      primary: [
        {
          id: 'step:1',
          kind: 'plan_step',
          title: 'src/components/Widget.tsx',
          confidence: 'high',
          explanation: { short: 'edit the defining file first' },
          references: { filePaths: ['src/components/Widget.tsx'] },
          stepOrder: 1,
          filePath: 'src/components/Widget.tsx',
          role: 'edit-primary',
          rationale: 'edit the defining file first',
        },
      ],
    },
    evidence: [{ kind: 'risk', label: 'change risk', value: 'medium' }],
    nextActions: [{ tool: 'collect_refactor_context', reason: 'review impact files', query: { name: 'src/components/Widget.tsx', repo: 'repo-a', mode: 'file' } }],
    diagnostics: { warnings: [] },
    expansions: {
      'plan:signals': {
        id: 'plan:signals',
        kind: 'plan-signals',
        title: 'Planning signals',
        status: 'deferred',
      },
    },
    debug: null,
    target: {
      filePath: 'src/components/Widget.tsx',
      symbolName: 'Widget',
      symbolId: 'widget-symbol',
      kind: 'function',
    },
    plan: {
      scope: 'feature-bounded',
      risk: 'medium',
      summary: 'update the component and review the nearest consumers',
      agentSummary: 'Widget is planned as feature-bounded with medium risk.',
      fileGroups: {
        primaryEditFiles: ['src/components/Widget.tsx'],
        secondaryEditFiles: ['src/components/index.ts'],
        reviewFiles: ['src/pages/Dashboard.tsx'],
      },
      signalsExpansionId: 'plan:signals',
    },
    ...overrides,
  };
}

describe('build_change_context tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runExploreComponentToolMock.mockResolvedValue(toolResult(makeExploreResponse()));
    runFindPrecedentsToolMock.mockResolvedValue(toolResult(makePrecedentsResponse()));
    runCollectRefactorContextToolMock.mockResolvedValue(toolResult(makeRefactorResponse()));
    runPlanChangeToolMock.mockResolvedValue(toolResult(makePlanResponse()));
  });

  it('accepts the public input shape', () => {
    const parsed = z.object(buildChangeContextToolDefinition.inputSchema).parse({
      symbolName: 'Widget',
      repo: 'repo-a',
      intent: 'refactor',
      detail: 'debug',
    });

    expect(parsed).toEqual({
      symbolName: 'Widget',
      repo: 'repo-a',
      intent: 'refactor',
      detail: 'debug',
    });
  });

  it('bundles the existing public tools into one normalized response', async () => {
    const result = await runBuildChangeContextTool({
      symbolName: 'Widget',
      repo: 'repo-a',
      intent: 'refactor',
      detail: 'agent',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(runExploreComponentToolMock).toHaveBeenCalledWith({
      name: 'Widget',
      repo: 'repo-a',
      detail: 'agent',
      limit: 3,
      relatedLimit: 6,
    });
    expect(runFindPrecedentsToolMock).toHaveBeenCalledWith({
      name: 'Widget',
      repo: 'repo-a',
      mode: 'component',
      detail: 'agent',
      limit: 3,
    });
    expect(runCollectRefactorContextToolMock).toHaveBeenCalledWith({
      name: 'Widget',
      repo: 'repo-a',
      mode: 'component',
      detail: 'agent',
      limit: 3,
    });
    expect(runPlanChangeToolMock).toHaveBeenCalledWith({
      symbol: 'Widget',
      filePath: 'src/components/Widget.tsx',
      repo: 'repo-a',
      mode: 'safe',
    });

    expect(parsed).toEqual(expect.objectContaining({
      tool: 'build_change_context',
      version: '1',
      mode: 'agent',
      query: expect.objectContaining({
        target: 'Widget',
        symbolName: 'Widget',
        repo: 'repo-a',
        intent: 'refactor',
      }),
      target: expect.objectContaining({
        status: 'resolved',
        symbolName: 'Widget',
        filePath: 'src/components/Widget.tsx',
        role: 'component',
        family: 'ui_component',
        planIncluded: true,
      }),
    }));
    expect(parsed.results.primary.map((entry: Record<string, any>) => entry.kind)).toEqual([
      'component_summary',
      'precedent_cluster',
      'refactor_context',
      'change_plan',
    ]);
    expect(parsed.results.primary).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'component_summary',
        sourceTool: 'explore_component',
        status: 'ready',
      }),
      expect.objectContaining({
        kind: 'precedent_cluster',
        sourceTool: 'find_precedents',
      }),
      expect.objectContaining({
        kind: 'refactor_context',
        sourceTool: 'collect_refactor_context',
      }),
      expect.objectContaining({
        kind: 'change_plan',
        sourceTool: 'plan_change',
        status: 'ready',
        planScope: 'feature-bounded',
        planRisk: 'medium',
      }),
    ]));
    expect(parsed.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'intent', value: 'refactor' }),
      expect.objectContaining({ kind: 'target_role', value: 'component' }),
    ]));
    expect(parsed.nextActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'find_precedents' }),
      expect.objectContaining({ tool: 'plan_change' }),
    ]));
    expect(Object.keys(parsed.expansions)).toEqual(expect.arrayContaining([
      'bundle-section:component_summary',
      'bundle:explore_component:cluster:widget',
      'bundle:find_precedents:cluster:widget',
      'bundle:collect_refactor_context:refactor:graph-neighbors',
      'bundle:plan_change:plan:signals',
    ]));
  });

  it('skips plan generation when the target remains weak or ambiguous', async () => {
    runExploreComponentToolMock.mockResolvedValue(
      toolResult(
        makeExploreResponse({
          target: {
            status: 'resolved',
            symbolName: 'Widget',
            filePath: 'src/components/Widget.tsx',
            repoId: 'repo-a',
            role: 'component',
            family: 'ui_component',
            confidence: 'low',
            resolution: { candidateCount: 2, ambiguityDetected: true },
          },
        }),
      ),
    );
    runCollectRefactorContextToolMock.mockResolvedValue(
      toolResult(
        makeRefactorResponse({
          target: {
            status: 'resolved',
            filePath: 'src/components/Widget.tsx',
            repoId: 'repo-a',
            symbolName: 'Widget',
            role: 'component',
            family: 'ui_component',
            confidence: 'low',
            resolution: { candidateCount: 2, ambiguityDetected: true },
          },
          contextSummary: {
            importingFileCount: 1,
            importedFileCount: 1,
            reexportingFileCount: 0,
            reexportedFileCount: 0,
            graphNeighborCount: 2,
            nearbyFileCount: 1,
            relatedFileCount: 1,
            definedSymbolCount: 1,
            exportedSymbolCount: 1,
            ambiguityDetected: true,
          },
        }),
      ),
    );

    const result = await runBuildChangeContextTool({
      symbolName: 'Widget',
      repo: 'repo-a',
      intent: 'fix',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(runPlanChangeToolMock).not.toHaveBeenCalled();
    expect(parsed.target.planIncluded).toBe(false);
    expect(parsed.results.primary).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'change_plan',
        status: 'skipped',
        explanation: expect.objectContaining({
          short: 'change plan skipped because the target remains ambiguous or weakly grounded',
        }),
      }),
    ]));
  });

  it('uses file-oriented orchestration when filePath is provided', async () => {
    await runBuildChangeContextTool({
      filePath: 'src/components/Widget.tsx',
      repo: 'repo-a',
    });

    expect(runFindPrecedentsToolMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'src/components/Widget.tsx',
      mode: 'file',
    }));
    expect(runCollectRefactorContextToolMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'src/components/Widget.tsx',
      mode: 'file',
    }));
  });
});
