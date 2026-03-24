import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const {
  runExploreComponentToolMock,
  runFindPrecedentsToolMock,
  runCollectRefactorContextToolMock,
  runPlanChangeToolMock,
  loadRequiredSymbolIndexMock,
  getFileNodeMock,
  getImportingFilesMock,
  getRelatedFilesMock,
  getSemanticConsumersForSymbolMock,
} = vi.hoisted(() => ({
  runExploreComponentToolMock: vi.fn(),
  runFindPrecedentsToolMock: vi.fn(),
  runCollectRefactorContextToolMock: vi.fn(),
  runPlanChangeToolMock: vi.fn(),
  loadRequiredSymbolIndexMock: vi.fn(),
  getFileNodeMock: vi.fn(),
  getImportingFilesMock: vi.fn(),
  getRelatedFilesMock: vi.fn(),
  getSemanticConsumersForSymbolMock: vi.fn(),
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

vi.mock('../../src/symbol-index/store.js', () => ({
  loadRequiredSymbolIndex: loadRequiredSymbolIndexMock,
}));

vi.mock('../../src/graph/query.js', () => ({
  getFileNode: getFileNodeMock,
  getImportingFiles: getImportingFilesMock,
  getRelatedFiles: getRelatedFilesMock,
  getSemanticConsumersForSymbol: getSemanticConsumersForSymbolMock,
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
    direct_consumers: {
      entries: [
        {
          filePath: 'src/components/WidgetCard.tsx',
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      confidence: 'high',
      coverage: 'exact',
    },
    indirect_consumers: {
      entries: [
        {
          filePath: 'src/hooks/useWidget.ts',
          symbolName: 'useWidget',
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      confidence: 'medium',
      coverage: 'inferred',
    },
    related_context: {
      entries: [
        {
          filePath: 'src/components/Widget.stories.tsx',
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      confidence: 'low',
      coverage: 'exploratory',
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
    direct_consumers: {
      entries: [
        {
          filePath: 'src/components/Widget.tsx',
          symbolName: 'Widget',
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      confidence: 'high',
      coverage: 'exact',
    },
    indirect_consumers: {
      entries: [
        {
          filePath: 'src/components/index.ts',
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      confidence: 'medium',
      coverage: 'inferred',
    },
    related_context: {
      entries: [
        {
          filePath: 'src/pages/Dashboard.tsx',
        },
      ],
      total: 1,
      shown: 1,
      truncated: false,
      confidence: 'low',
      coverage: 'exploratory',
    },
    ...overrides,
  };
}

describe('build_change_context tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadRequiredSymbolIndexMock.mockResolvedValue({
      byName: {
        Widget: [
          {
            symbolId: 'widget-symbol',
            fileId: 'widget-file',
            repo: 'repo-a',
            filePath: 'src/components/Widget.tsx',
            name: 'Widget',
            kind: 'function',
            exported: true,
          },
        ],
      },
      byNameLower: {
        widget: [
          {
            symbolId: 'widget-symbol',
            fileId: 'widget-file',
            repo: 'repo-a',
            filePath: 'src/components/Widget.tsx',
            name: 'Widget',
            kind: 'function',
            exported: true,
          },
        ],
      },
      byFile: {
        'repo-a:src/components/Widget.tsx': { repo: 'repo-a' },
      },
    });
    runExploreComponentToolMock.mockResolvedValue(toolResult(makeExploreResponse()));
    runFindPrecedentsToolMock.mockResolvedValue(toolResult(makePrecedentsResponse()));
    runCollectRefactorContextToolMock.mockResolvedValue(toolResult(makeRefactorResponse()));
    runPlanChangeToolMock.mockResolvedValue(toolResult(makePlanResponse()));
    getFileNodeMock.mockResolvedValue({
      fileId: 'widget-file',
      repoId: 'repo-a',
      filePath: 'src/components/Widget.tsx',
    });
    getImportingFilesMock.mockResolvedValue([]);
    getRelatedFilesMock.mockResolvedValue([]);
    getSemanticConsumersForSymbolMock.mockResolvedValue([]);
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
    }, {
      maxDepth: 2,
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
    expect(parsed.direct_consumers).toEqual(expect.objectContaining({
      entries: [
        expect.objectContaining({
          filePath: 'src/components/Widget.tsx',
          symbolName: 'Widget',
        }),
      ],
      total: 1,
      shown: 1,
      truncated: false,
      confidence: 'high',
      coverage: 'exact',
    }));
    expect(parsed.indirect_consumers).toEqual(expect.objectContaining({
      entries: [
        expect.objectContaining({
          filePath: 'src/components/index.ts',
        }),
      ],
      total: 1,
      shown: 1,
      truncated: false,
      confidence: 'medium',
      coverage: 'inferred',
    }));
    expect(parsed.related_context).toEqual(expect.objectContaining({
      entries: [
        expect.objectContaining({
          filePath: 'src/pages/Dashboard.tsx',
        }),
      ],
      total: 1,
      shown: 1,
      truncated: false,
      confidence: 'low',
      coverage: 'exploratory',
    }));
    expect(parsed).not.toHaveProperty('related_entities');
    expect(parsed).not.toHaveProperty('impact');
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
    expect(parsed.direct_consumers).toEqual(expect.objectContaining({
      entries: [
        expect.objectContaining({
          filePath: 'src/components/WidgetCard.tsx',
        }),
      ],
      total: 1,
      shown: 1,
      truncated: false,
      confidence: 'high',
      coverage: 'exact',
    }));
    expect(parsed.indirect_consumers).toEqual(expect.objectContaining({
      entries: [
        expect.objectContaining({
          filePath: 'src/hooks/useWidget.ts',
          symbolName: 'useWidget',
        }),
      ],
      total: 1,
      shown: 1,
      truncated: false,
      confidence: 'medium',
      coverage: 'inferred',
    }));
    expect(parsed.related_context).toEqual(expect.objectContaining({
      entries: [
        expect.objectContaining({
          filePath: 'src/components/Widget.stories.tsx',
        }),
      ],
      total: 1,
      shown: 1,
      truncated: false,
      confidence: 'low',
      coverage: 'exploratory',
    }));
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

  it('switches to a focused large-repo bundle and skips broad weak stages after strong evidence is available', async () => {
    loadRequiredSymbolIndexMock.mockResolvedValue({
      byName: {
        Widget: [
          {
            symbolId: 'widget-symbol',
            fileId: 'widget-file',
            repo: 'repo-large',
            filePath: 'src/components/Widget.tsx',
            name: 'Widget',
            kind: 'function',
            exported: true,
          },
        ],
      },
      byNameLower: {},
      byFile: Object.fromEntries(
        Array.from({ length: 6000 }, (_, index) => [`repo-large:file-${index}.ts`, { repo: 'repo-large' }]),
      ),
    });
    runExploreComponentToolMock.mockResolvedValue(toolResult(makeExploreResponse({
      query: { target: 'Widget', repo: 'repo-large' },
      target: {
        ...makeExploreResponse().target,
        repoId: 'repo-large',
      },
      direct_consumers: {
        entries: [
          { filePath: 'src/routes/a.ts' },
          { filePath: 'src/routes/b.ts' },
          { filePath: 'src/routes/c.ts' },
        ],
        total: 3,
        shown: 3,
        truncated: false,
        confidence: 'high',
        coverage: 'exact',
      },
      indirect_consumers: {
        entries: [],
        total: 0,
        shown: 0,
        truncated: false,
        confidence: 'medium',
        coverage: 'inferred',
      },
      related_context: {
        entries: [],
        total: 0,
        shown: 0,
        truncated: false,
        confidence: 'low',
        coverage: 'exploratory',
      },
    })));
    getImportingFilesMock.mockResolvedValue([
      {
        fileId: 'route-a',
        repoId: 'repo-large',
        filePath: 'src/routes/a.ts',
      },
    ]);

    const result = await runBuildChangeContextTool({
      symbolName: 'Widget',
      repo: 'repo-large',
      detail: 'agent',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(runFindPrecedentsToolMock).not.toHaveBeenCalled();
    expect(runCollectRefactorContextToolMock).not.toHaveBeenCalled();
    expect(runPlanChangeToolMock).not.toHaveBeenCalled();
    expect(parsed.diagnostics.notes).toEqual(expect.arrayContaining([
      'large-repo focused mode activated',
      'enough-context stop condition hit after strong consumer recovery',
      'precedent breadth capped in large-repo focused mode',
      'related-context expansion capped in large-repo focused mode',
      'weak exploratory bundle expansion skipped after strong evidence was collected',
      'change planning skipped to keep the bundled workflow within large-repo execution budget',
    ]));
    expect(parsed.results.primary).toEqual(expect.arrayContaining([
      expect.objectContaining({
        section: 'precedent_cluster',
        status: 'skipped',
      }),
      expect.objectContaining({
        section: 'refactor_context',
        status: 'skipped',
      }),
      expect.objectContaining({
        section: 'change_plan',
        status: 'skipped',
        explanation: expect.objectContaining({
          short: 'change plan skipped in large-repo focused mode after strong evidence was collected',
        }),
      }),
    ]));
  });

  it('enters focused large-repo mode when the CLI repo input is a path but the index uses a repo id', async () => {
    loadRequiredSymbolIndexMock.mockResolvedValue({
      byName: {
        Widget: [
          {
            symbolId: 'widget-symbol',
            fileId: 'widget-file',
            repo: 'repo-large',
            filePath: 'src/components/Widget.tsx',
            name: 'Widget',
            kind: 'function',
            exported: true,
          },
        ],
      },
      byNameLower: {},
      byFile: Object.fromEntries(
        Array.from({ length: 6000 }, (_, index) => [`repo-large:file-${index}.ts`, { repo: 'repo-large' }]),
      ),
    });
    runExploreComponentToolMock.mockResolvedValue(toolResult(makeExploreResponse({
      query: { target: 'Widget', repo: '/tmp/repos/repo-large' },
      target: {
        ...makeExploreResponse().target,
        repoId: 'repo-large',
      },
      direct_consumers: {
        entries: [{ filePath: 'src/routes/a.ts' }],
        total: 1,
        shown: 1,
        truncated: false,
        confidence: 'high',
        coverage: 'exact',
      },
      indirect_consumers: {
        entries: [{ filePath: 'src/routes/b.ts' }],
        total: 1,
        shown: 1,
        truncated: false,
        confidence: 'medium',
        coverage: 'inferred',
      },
    })));
    getImportingFilesMock.mockResolvedValue([
      {
        fileId: 'route-a',
        repoId: 'repo-large',
        filePath: 'src/routes/a.ts',
      },
    ]);
    getSemanticConsumersForSymbolMock.mockResolvedValue([
      {
        edge: {
          kind: 'api_propagation',
          strength: 'medium',
        },
        fromFile: {
          fileId: 'route-b',
          repoId: 'repo-large',
          filePath: 'src/routes/b.ts',
        },
      },
    ]);

    const result = await runBuildChangeContextTool({
      symbolName: 'Widget',
      repo: '/tmp/repos/repo-large',
      detail: 'agent',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(runFindPrecedentsToolMock).not.toHaveBeenCalled();
    expect(runCollectRefactorContextToolMock).not.toHaveBeenCalled();
    expect(runPlanChangeToolMock).not.toHaveBeenCalled();
    expect(parsed.diagnostics.notes).toEqual(expect.arrayContaining([
      'large-repo focused mode activated',
      'enough-context stop condition hit after strong consumer recovery',
    ]));
  });

  it('dedupes canonical bucket entries by file and symbol before returning the final bundle', async () => {
    runPlanChangeToolMock.mockResolvedValue(toolResult(makePlanResponse({
      direct_consumers: {
        entries: [
          { filePath: 'src/components/Widget.tsx', symbolName: 'Widget' },
          { filePath: 'src/components/Widget.tsx', symbolName: 'Widget' },
        ],
        total: 2,
        shown: 2,
        truncated: false,
        confidence: 'high',
        coverage: 'exact',
      },
      indirect_consumers: {
        entries: [
          { filePath: 'src/components/index.ts' },
          { filePath: 'src/components/index.ts' },
        ],
        total: 2,
        shown: 2,
        truncated: false,
        confidence: 'medium',
        coverage: 'inferred',
      },
      related_context: {
        entries: [
          { filePath: 'src/pages/Dashboard.tsx' },
          { filePath: 'src/pages/Dashboard.tsx' },
        ],
        total: 2,
        shown: 2,
        truncated: false,
        confidence: 'low',
        coverage: 'exploratory',
      },
    })));

    const result = await runBuildChangeContextTool({
      symbolName: 'Widget',
      repo: 'repo-a',
      intent: 'refactor',
      detail: 'agent',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(parsed.direct_consumers).toEqual(expect.objectContaining({
      total: 1,
      shown: 1,
      entries: [{ filePath: 'src/components/Widget.tsx', symbolName: 'Widget' }],
    }));
    expect(parsed.indirect_consumers).toEqual(expect.objectContaining({
      total: 1,
      shown: 1,
      entries: [{ filePath: 'src/components/index.ts' }],
    }));
    expect(parsed.related_context).toEqual(expect.objectContaining({
      total: 1,
      shown: 1,
      entries: [{ filePath: 'src/pages/Dashboard.tsx' }],
    }));
  });
});
