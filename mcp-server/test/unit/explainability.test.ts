import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  loadCurrentGenerationStateMock,
  loadPatternIndexMock,
  buildClustersMock,
} = vi.hoisted(() => ({
  loadCurrentGenerationStateMock: vi.fn(),
  loadPatternIndexMock: vi.fn(),
  buildClustersMock: vi.fn(),
}));

vi.mock('../../src/indexing/generation-store.js', () => ({
  loadCurrentGenerationState: loadCurrentGenerationStateMock,
}));

vi.mock('../../src/patterns/index.js', () => ({
  loadPatternIndex: loadPatternIndexMock,
  createPatternSimilarityService: () => ({
    buildClusters: buildClustersMock,
  }),
}));

import {
  buildPatternMatchExplainability,
  buildSymbolCandidateExplainability,
} from '../../src/tools/explainability.js';

describe('explainability helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCurrentGenerationStateMock.mockResolvedValue({
      generationId: 'test-generation',
    });
    loadPatternIndexMock.mockResolvedValue({
      patterns: [
        {
          patternId: 'pattern:button',
          fileId: 'repo:components/Button.tsx',
          kind: 'component',
          confidence: 'high',
          fingerprint: {
            structuralSignals: ['jsx-component'],
          },
        },
      ],
    });
    buildClustersMock.mockReturnValue([
      {
        clusterId: 'cluster:component:button',
        precedentFamily: 'ui_component',
        memberPatternIds: ['pattern:button'],
        coreMemberPatternIds: ['pattern:button'],
        relatedClusterIds: ['cluster:store:button'],
        cohesion: {
          averageDependencyOverlap: 0.82,
        },
        subclusters: [
          {
            subclusterId: 'cluster:component:button:sub:primary',
            memberPatternIds: ['pattern:button'],
          },
        ],
      },
      {
        clusterId: 'cluster:store:button',
        precedentFamily: 'state_or_store',
        memberPatternIds: [],
        coreMemberPatternIds: [],
        relatedClusterIds: [],
        cohesion: {
          averageDependencyOverlap: 0.61,
        },
        subclusters: [],
      },
    ]);
  });

  it('returns compact symbol explainability in agent mode', async () => {
    const result = await buildSymbolCandidateExplainability(
      {
        symbolId: 'repo:components/Button.tsx:function:Button:1',
        fileId: 'repo:components/Button.tsx',
        repo: 'repo',
        filePath: 'components/Button.tsx',
        name: 'Button',
        kind: 'function',
        exported: true,
        score: 16,
        reasons: [
          { signal: 'exact_name', value: 10 },
          { signal: 'kind_match', value: 5 },
        ],
      },
      'agent',
    );

    expect(result).toEqual(
      expect.objectContaining({
        family: 'ui_component',
        subClusterId: 'cluster:component:button:sub:primary',
        role: 'component',
        confidence: 'high',
        selectionReason: 'exact name + kind match',
        explanationSignals: expect.objectContaining({
          clusterCohesion: 'high',
        }),
        clusterContext: expect.objectContaining({
          parentClusterId: 'cluster:component:button',
          clusterRole: 'ui_component',
          isCoreMember: true,
          relatedClusterIds: ['cluster:store:button'],
        }),
        relatedContext: expect.objectContaining({
          relatedClusterIds: ['cluster:store:button'],
          neighborTypes: ['state_or_store'],
        }),
      }),
    );
    expect(result).not.toHaveProperty('debug');
  });

  it('keeps agent mode smaller than debug mode for the same pattern match', async () => {
    const match = {
      file: {
        fileId: 'repo:components/Button.tsx',
        filePath: 'components/Button.tsx',
      },
      score: 0.91,
      reason: 'peer component precedent with shared dependencies',
      reasons: [
        { signal: 'structural_alignment', value: 0.4, note: 'high' },
        { signal: 'dependency_overlap', value: 0.3 },
        { signal: 'precedent_family_match', value: 0.08, note: 'component' },
      ],
      definedSymbols: [{ name: 'Button', kind: 'function' }],
      exportedSymbols: [{ name: 'Button', kind: 'function' }],
      bundle: {
        familyStem: 'Button',
        siblingFiles: ['components/Button.tsx'],
      },
      structuralAlignment: {
        structurallyIndexed: true,
        graphAnchored: true,
        structuralContextStrength: 'high',
        resolvedLocalDependencies: ['repo:components/Button.styles.ts'],
        relatedLocalFiles: ['repo:components/Icon.tsx'],
      },
    };

    const agentResult = await buildPatternMatchExplainability(match, 'ui_component', 'agent');
    const debugResult = await buildPatternMatchExplainability(match, 'ui_component', 'debug');

    expect(agentResult).toEqual(
      expect.objectContaining({
        family: 'ui_component',
        role: 'component',
        confidence: 'medium',
        selectionReason: 'peer component precedent with shared dependencies',
        explanationSignals: {
          alignment: 'high',
          dependencyOverlap: 'low',
          familyMatch: true,
          clusterCohesion: 'high',
        },
      }),
    );
    expect(debugResult.debug).toEqual(
      expect.objectContaining({
        score: 0.91,
        rawReasons: match.reasons,
      }),
    );
    expect(JSON.stringify(agentResult).length).toBeLessThan(JSON.stringify(debugResult).length);
  });
});
