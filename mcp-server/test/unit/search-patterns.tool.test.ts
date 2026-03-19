import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const {
  getPatternMatchesForComponentMock,
  getPatternMatchesForFileMock,
  getPatternMatchesForSymbolMock,
  buildPatternTrustMetadataMock,
  buildPatternMatchExplainabilityMock,
  buildPatternResolutionExplainabilityMock,
  buildPatternTargetExplainabilityMock,
} = vi.hoisted(() => ({
  getPatternMatchesForComponentMock: vi.fn(),
  getPatternMatchesForFileMock: vi.fn(),
  getPatternMatchesForSymbolMock: vi.fn(),
  buildPatternTrustMetadataMock: vi.fn(),
  buildPatternMatchExplainabilityMock: vi.fn(),
  buildPatternResolutionExplainabilityMock: vi.fn(),
  buildPatternTargetExplainabilityMock: vi.fn(),
}));

vi.mock('../../src/orchestrator/index.js', () => ({
  getPatternMatchesForComponent: getPatternMatchesForComponentMock,
  getPatternMatchesForFile: getPatternMatchesForFileMock,
  getPatternMatchesForSymbol: getPatternMatchesForSymbolMock,
}));

vi.mock('../../src/tools/trust-metadata.js', () => ({
  buildPatternTrustMetadata: buildPatternTrustMetadataMock,
}));

vi.mock('../../src/tools/explainability.js', () => ({
  buildPatternMatchExplainability: buildPatternMatchExplainabilityMock,
  buildPatternResolutionExplainability: buildPatternResolutionExplainabilityMock,
  buildPatternTargetExplainability: buildPatternTargetExplainabilityMock,
}));

import { runSearchPatternsTool, searchPatternsToolDefinition } from '../../src/tools/search-patterns.js';

describe('search_patterns tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildPatternTrustMetadataMock.mockResolvedValue({
      coverage: {
        filesAnalyzed: 80,
        filesTotal: 100,
        ratio: 0.8,
        scope: 'relevant_source',
        raw: {
          filesAnalyzed: 80,
          filesTotal: 400,
          ratio: 0.2,
        },
        relevant: {
          filesAnalyzed: 80,
          filesTotal: 100,
          ratio: 0.8,
        },
      },
      confidence: 'medium',
      patternCoverage: {
        filesAnalyzed: 60,
        filesTotal: 80,
        ratio: 0.75,
      },
      structuralAlignment: {
        graphAnchored: true,
        structuralContextStrength: 'medium',
      },
    });
    buildPatternTargetExplainabilityMock.mockResolvedValue({
      family: 'ui_component',
      role: 'component',
      confidence: 'medium',
      selectionReason: 'resolved primary target',
      explanationSignals: {
        alignment: 'medium',
      },
    });
    buildPatternResolutionExplainabilityMock.mockImplementation(async (resolution: Record<string, unknown>) => resolution);
    buildPatternMatchExplainabilityMock.mockResolvedValue({
      family: 'ui_component',
      subClusterId: 'cluster:component:sub:button',
      role: 'component',
      confidence: 'medium',
      selectionReason: 'same component family + local neighborhood match',
      explanationSignals: {
        alignment: 'medium',
        dependencyOverlap: 'medium',
        familyMatch: true,
      },
      clusterContext: {
        parentClusterId: 'cluster:component:button',
        subClusterId: 'cluster:component:sub:button',
        clusterRole: 'ui_component',
        isCoreMember: true,
        relatedClusterIds: ['cluster:store:button'],
      },
      relatedContext: {
        relatedClusterIds: ['cluster:store:button'],
        neighborTypes: ['state_or_store'],
      },
    });
  });

  it('accepts the narrow public input shape', () => {
    const parsed = z.object(searchPatternsToolDefinition.inputSchema).parse({
      name: 'Button',
      repo: 'example-saas-dashboard',
      limit: 4,
      mode: 'component',
    });

    expect(parsed).toEqual({
      name: 'Button',
      repo: 'example-saas-dashboard',
      limit: 4,
      mode: 'component',
    });
  });

  it('uses component mode by default and returns structured results', async () => {
    getPatternMatchesForComponentMock.mockResolvedValue({
      query: 'Button',
      mode: 'component',
      repo: 'example-saas-dashboard',
      primaryTarget: {
        file: { fileId: 'example-saas-dashboard:components/Button.tsx', filePath: 'components/Button.tsx' },
        symbol: null,
        definedSymbols: [{ name: 'Button', kind: 'function' }],
        exportedSymbols: [{ name: 'Button', kind: 'function' }],
        structuralAlignment: {
          structurallyIndexed: true,
          graphAnchored: true,
          structuralContextStrength: 'medium',
          resolvedLocalDependencies: ['components/Button.styles.ts'],
          relatedLocalFiles: [],
        },
      },
      patternMatches: [
        {
          file: { fileId: 'example-saas-dashboard:components/IconButton.tsx', filePath: 'components/IconButton.tsx' },
          score: 18,
          reason: 'similar export surface',
          reasons: [{ signal: 'shared_export_names', value: 4 }],
          definedSymbols: [{ name: 'IconButton', kind: 'function' }],
          exportedSymbols: [{ name: 'Button', kind: 'function' }],
          bundle: { familyStem: 'IconButton', siblingFiles: ['components/IconButton.tsx'] },
          structuralAlignment: {
            structurallyIndexed: true,
            graphAnchored: true,
            structuralContextStrength: 'medium',
            resolvedLocalDependencies: ['components/Button.styles.ts'],
            relatedLocalFiles: [],
          },
        },
      ],
      resolution: {
        status: 'resolved',
        mode: 'component',
        candidateCount: 1,
        ambiguityDetected: false,
        selectedCandidate: null,
        alternativeCandidates: [],
      },
      summary: {
        matchCount: 1,
        strongMatchCount: 1,
        graphAnchoredMatchCount: 1,
      },
    });

    const result = await runSearchPatternsTool({
      name: 'Button',
      repo: 'example-saas-dashboard',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(getPatternMatchesForComponentMock).toHaveBeenCalledWith('Button', {
      repo: 'example-saas-dashboard',
      limit: 6,
    });
    expect(parsed).toEqual(
      expect.objectContaining({
        requestedName: 'Button',
        requestedRepo: 'example-saas-dashboard',
        requestedMode: 'component',
        explainabilityMode: 'agent',
        metadata: {
          coverage: {
            filesAnalyzed: 80,
            filesTotal: 100,
            ratio: 0.8,
            scope: 'relevant_source',
            raw: {
              filesAnalyzed: 80,
              filesTotal: 400,
              ratio: 0.2,
            },
            relevant: {
              filesAnalyzed: 80,
              filesTotal: 100,
              ratio: 0.8,
            },
          },
          confidence: 'medium',
          patternCoverage: {
            filesAnalyzed: 60,
            filesTotal: 80,
            ratio: 0.75,
          },
          structuralAlignment: {
            graphAnchored: true,
            structuralContextStrength: 'medium',
          },
        },
        summary: {
          matchCount: 1,
          strongMatchCount: 1,
          graphAnchoredMatchCount: 1,
        },
      }),
    );
    expect(parsed.primaryTarget.explanation).toEqual(
      expect.objectContaining({
        family: 'ui_component',
        role: 'component',
      }),
    );
    expect(parsed.patternMatches[0].explanation).toEqual(
      expect.objectContaining({
        subClusterId: 'cluster:component:sub:button',
        confidence: 'medium',
      }),
    );
  });

  it('passes debug explainability mode through the helper layer', async () => {
    getPatternMatchesForComponentMock.mockResolvedValue({
      query: 'Button',
      mode: 'component',
      repo: 'example-saas-dashboard',
      primaryTarget: {
        file: { fileId: 'example-saas-dashboard:components/Button.tsx', filePath: 'components/Button.tsx' },
        symbol: null,
        definedSymbols: [],
        exportedSymbols: [],
        structuralAlignment: null,
      },
      patternMatches: [],
      resolution: {
        status: 'resolved',
        mode: 'component',
        candidateCount: 0,
        ambiguityDetected: false,
        selectedCandidate: null,
        alternativeCandidates: [],
      },
      summary: {
        matchCount: 0,
        strongMatchCount: 0,
        graphAnchoredMatchCount: 0,
      },
    });

    await runSearchPatternsTool({
      name: 'Button',
      detail: 'debug',
    });

    expect(buildPatternTargetExplainabilityMock).toHaveBeenCalledWith(
      expect.any(Object),
      'debug',
    );
    expect(buildPatternResolutionExplainabilityMock).toHaveBeenCalledWith(
      expect.any(Object),
      'debug',
    );
  });

  it('dispatches to symbol mode when requested', async () => {
    getPatternMatchesForSymbolMock.mockResolvedValue({
      query: 'Layout',
      mode: 'symbol',
      repo: undefined,
      primaryTarget: {
        file: null,
        symbol: null,
        definedSymbols: [],
        exportedSymbols: [],
        structuralAlignment: null,
      },
      patternMatches: [],
      resolution: {
        status: 'missing',
        mode: 'symbol',
        candidateCount: 0,
        ambiguityDetected: false,
        selectedCandidate: null,
        alternativeCandidates: [],
      },
      summary: {
        matchCount: 0,
        strongMatchCount: 0,
        graphAnchoredMatchCount: 0,
      },
    });

    await runSearchPatternsTool({
      name: 'Layout',
      mode: 'symbol',
      limit: 3,
    });

    expect(getPatternMatchesForSymbolMock).toHaveBeenCalledWith('Layout', {
      repo: undefined,
      limit: 3,
    });
  });

  it('dispatches to file mode and preserves safe missing results', async () => {
    getPatternMatchesForFileMock.mockResolvedValue({
      query: 'src/app/page.tsx',
      mode: 'file',
      repo: 'example-news-app',
      primaryTarget: {
        file: null,
        symbol: null,
        definedSymbols: [],
        exportedSymbols: [],
        structuralAlignment: null,
      },
      patternMatches: [],
      resolution: {
        status: 'missing',
        mode: 'file',
        candidateCount: 0,
        ambiguityDetected: false,
        selectedCandidate: null,
        alternativeCandidates: [],
      },
      summary: {
        matchCount: 0,
        strongMatchCount: 0,
        graphAnchoredMatchCount: 0,
      },
    });

    const result = await runSearchPatternsTool({
      name: 'src/app/page.tsx',
      mode: 'file',
      repo: 'example-news-app',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(getPatternMatchesForFileMock).toHaveBeenCalledWith('src/app/page.tsx', {
      repo: 'example-news-app',
      limit: 6,
    });
    expect(parsed.resolution).toEqual({
      status: 'missing',
      mode: 'file',
      candidateCount: 0,
      ambiguityDetected: false,
      selectedCandidate: null,
      alternativeCandidates: [],
    });
    expect(parsed.metadata).toEqual({
      coverage: {
        filesAnalyzed: 80,
        filesTotal: 100,
        ratio: 0.8,
        scope: 'relevant_source',
        raw: {
          filesAnalyzed: 80,
          filesTotal: 400,
          ratio: 0.2,
        },
        relevant: {
          filesAnalyzed: 80,
          filesTotal: 100,
          ratio: 0.8,
        },
      },
      confidence: 'medium',
      patternCoverage: {
        filesAnalyzed: 60,
        filesTotal: 80,
        ratio: 0.75,
      },
      structuralAlignment: {
        graphAnchored: true,
        structuralContextStrength: 'medium',
      },
    });
  });
});
