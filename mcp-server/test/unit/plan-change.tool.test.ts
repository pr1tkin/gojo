import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { planSymbolChangeMock } = vi.hoisted(() => ({
  planSymbolChangeMock: vi.fn(),
}));

vi.mock('../../src/orchestrator/index.js', () => ({
  planSymbolChange: planSymbolChangeMock,
}));

import { planChangeToolDefinition, runPlanChangeTool } from '../../src/tools/plan-change.js';

describe('plan_change tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts the public input shape', () => {
    const parsed = z.object(planChangeToolDefinition.inputSchema).parse({
      symbol: 'Button',
      filePath: 'src/app/_components/button/Button.tsx',
      repo: 'repo-alpha',
      mode: 'exploratory',
    });

    expect(parsed).toEqual({
      symbol: 'Button',
      filePath: 'src/app/_components/button/Button.tsx',
      repo: 'repo-alpha',
      mode: 'exploratory',
    });
  });

  it('delegates to the internal planning service and returns a normalized planning envelope', async () => {
    planSymbolChangeMock.mockResolvedValue({
      target: {
        filePath: 'src/app/_components/button/Button.tsx',
        symbolId: 'button-symbol',
        symbolName: 'Button',
        kind: 'variable',
      },
      scope: 'shared-surface',
      risk: 'medium',
      summary: 'component surfaced through barrel export; direct consumer and entry-surface review recommended',
      signals: [
        { type: 'ownership', strength: 'strong', note: 'ownership classified as shared-surface' },
        { type: 'barrel-surface', strength: 'strong', note: 'symbol participates in a barrel or entry-style export surface' },
      ],
      primaryEditFiles: ['src/app/_components/button/Button.tsx'],
      secondaryEditFiles: ['src/app/_components/button/index.ts'],
      reviewFiles: ['src/app/_components/metadata/podcast/Podcast.tsx'],
      orderedPlan: [
        {
          order: 1,
          filePath: 'src/app/_components/button/Button.tsx',
          role: 'edit-primary',
          reason: 'defining file should be updated first',
          confidence: 'high',
        },
        {
          order: 2,
          filePath: 'src/app/_components/button/index.ts',
          role: 'entry-surface',
          reason: 'barrel file or export surface should be checked alongside the defining file',
          confidence: 'medium',
        },
      ],
    });

    const result = await runPlanChangeTool({
      symbol: 'Button',
      filePath: 'src/app/_components/button/Button.tsx',
      repo: 'repo-alpha',
      mode: 'exploratory',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(planSymbolChangeMock).toHaveBeenCalledWith({
      symbolName: 'Button',
      filePath: 'src/app/_components/button/Button.tsx',
      repoId: 'repo-alpha',
      impactMode: 'exploratory',
    });
    expect(parsed).toEqual(expect.objectContaining({
      tool: 'plan_change',
      version: '1',
      mode: 'agent',
      query: expect.objectContaining({
        target: 'Button',
        repo: 'repo-alpha',
        mode: 'exploratory',
        filePath: 'src/app/_components/button/Button.tsx',
        symbolName: 'Button',
      }),
      target: expect.objectContaining({
        filePath: 'src/app/_components/button/Button.tsx',
        symbolId: 'button-symbol',
        symbolName: 'Button',
        kind: 'variable',
      }),
      plan: expect.objectContaining({
        scope: 'shared-surface',
        risk: 'medium',
        summary: 'component surfaced through barrel export; direct consumer and entry-surface review recommended',
        agentSummary: expect.stringContaining('Button is planned as shared-surface with medium risk'),
        fileGroups: expect.objectContaining({
          primaryEditFiles: ['src/app/_components/button/Button.tsx'],
          secondaryEditFiles: ['src/app/_components/button/index.ts'],
          reviewFiles: ['src/app/_components/metadata/podcast/Podcast.tsx'],
        }),
      }),
    }));
    expect(parsed.results.primary).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'plan_step',
        stepOrder: 1,
        filePath: 'src/app/_components/button/Button.tsx',
        role: 'edit-primary',
        rationale: 'defining file should be updated first',
        confidence: 'high',
      }),
      expect.objectContaining({
        stepOrder: 2,
        filePath: 'src/app/_components/button/index.ts',
        role: 'entry-surface',
      }),
    ]));
    expect(parsed.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'scope',
        value: 'shared-surface',
      }),
      expect.objectContaining({
        kind: 'risk',
        value: 'medium',
      }),
    ]));
    expect(parsed.nextActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool: 'collect_refactor_context',
        query: expect.objectContaining({
          name: 'src/app/_components/button/Button.tsx',
          repo: 'repo-alpha',
          mode: 'file',
        }),
      }),
      expect.objectContaining({
        tool: 'find_precedents',
        query: expect.objectContaining({
          name: 'src/app/_components/button/Button.tsx',
          repo: 'repo-alpha',
          mode: 'file',
        }),
      }),
    ]));
    expect(parsed.summary).toEqual(expect.objectContaining({
      resultCount: 2,
      primaryCount: 2,
      strongMatchCount: 1,
    }));
  });

  it('supports symbol plus filePath resolution without reimplementing planning', async () => {
    planSymbolChangeMock.mockResolvedValue({
      target: {
        filePath: 'components/admin/cleanup/store/admin-cleanup-context.ts',
        symbolId: 'cleanup-store',
        symbolName: 'useAdminCleanupStore',
        kind: 'variable',
      },
      scope: 'feature-bounded',
      risk: 'medium',
      summary: 'hook change appears feature-bounded; inspect direct consumer files in the same feature area first',
      signals: [],
      primaryEditFiles: ['components/admin/cleanup/store/admin-cleanup-context.ts'],
      secondaryEditFiles: ['components/admin/cleanup/table.tsx'],
      reviewFiles: ['pages/admin/cleanup.tsx'],
      orderedPlan: [],
    });

    await runPlanChangeTool({
      symbol: 'useAdminCleanupStore',
      filePath: 'components/admin/cleanup/store/admin-cleanup-context.ts',
    });

    expect(planSymbolChangeMock).toHaveBeenCalledWith({
      symbolName: 'useAdminCleanupStore',
      filePath: 'components/admin/cleanup/store/admin-cleanup-context.ts',
      repoId: undefined,
      impactMode: undefined,
    });
  });
});
