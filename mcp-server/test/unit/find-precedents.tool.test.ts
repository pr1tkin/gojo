import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const {
  getPatternMatchesForComponentMock,
  getPatternMatchesForFileMock,
  getPatternMatchesForSymbolMock,
  createPrecedentDiscoveryServiceMock,
  findPrecedentsForSymbolMock,
  findPrecedentsForFileMock,
  buildPatternTrustMetadataMock,
  buildPatternTargetExplainabilityMock,
  buildPrecedentCandidateExplainabilityMock,
} = vi.hoisted(() => ({
  getPatternMatchesForComponentMock: vi.fn(),
  getPatternMatchesForFileMock: vi.fn(),
  getPatternMatchesForSymbolMock: vi.fn(),
  createPrecedentDiscoveryServiceMock: vi.fn(),
  findPrecedentsForSymbolMock: vi.fn(),
  findPrecedentsForFileMock: vi.fn(),
  buildPatternTrustMetadataMock: vi.fn(),
  buildPatternTargetExplainabilityMock: vi.fn(),
  buildPrecedentCandidateExplainabilityMock: vi.fn(),
}));

vi.mock('../../src/orchestrator/index.js', () => ({
  getPatternMatchesForComponent: getPatternMatchesForComponentMock,
  getPatternMatchesForFile: getPatternMatchesForFileMock,
  getPatternMatchesForSymbol: getPatternMatchesForSymbolMock,
  createPrecedentDiscoveryService: createPrecedentDiscoveryServiceMock,
}));

vi.mock('../../src/tools/trust-metadata.js', () => ({
  buildPatternTrustMetadata: buildPatternTrustMetadataMock,
}));

vi.mock('../../src/tools/explainability.js', () => ({
  buildPatternTargetExplainability: buildPatternTargetExplainabilityMock,
  buildPrecedentCandidateExplainability: buildPrecedentCandidateExplainabilityMock,
}));

import { findPrecedentsToolDefinition, runFindPrecedentsTool } from '../../src/tools/find-precedents.js';

describe('find_precedents tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPrecedentDiscoveryServiceMock.mockResolvedValue({
      findPrecedentsForSymbol: findPrecedentsForSymbolMock,
      findPrecedentsForFile: findPrecedentsForFileMock,
    });
    buildPatternTrustMetadataMock.mockResolvedValue({
      coverage: {
        filesAnalyzed: 90,
        filesTotal: 100,
        ratio: 0.9,
        scope: 'relevant_source',
        raw: {
          filesAnalyzed: 90,
          filesTotal: 500,
          ratio: 0.18,
        },
        relevant: {
          filesAnalyzed: 90,
          filesTotal: 100,
          ratio: 0.9,
        },
      },
      confidence: 'medium',
    });
    buildPatternTargetExplainabilityMock.mockResolvedValue({
      family: 'routed_page_or_screen',
      role: 'page',
      confidence: 'medium',
      selectionReason: 'resolved primary target',
      explanationSignals: {
        alignment: 'high',
      },
      clusterContext: {
        parentClusterId: 'cluster:page:detail',
        clusterRole: 'routed_page_or_screen',
        isCoreMember: true,
        relatedClusterIds: ['cluster:wrapper:layout'],
      },
      relatedContext: {
        relatedClusterIds: ['cluster:wrapper:layout'],
        neighborTypes: ['ui_wrapper_or_shell'],
      },
    });
    buildPrecedentCandidateExplainabilityMock.mockResolvedValue({
      family: 'routed_page_or_screen',
      role: 'page',
      confidence: 'high',
      selectionReason: 'same family + strong dependency overlap',
      explanationSignals: {
        alignment: 'high',
        dependencyOverlap: 'high',
        familyMatch: true,
      },
      clusterContext: {
        parentClusterId: 'cluster:page:edit',
        subClusterId: 'cluster:page:edit:sub:contracts',
        clusterRole: 'routed_page_or_screen',
        isCoreMember: true,
        relatedClusterIds: ['cluster:wrapper:layout'],
      },
      relatedContext: {
        relatedClusterIds: ['cluster:wrapper:layout'],
        neighborTypes: ['ui_wrapper_or_shell'],
      },
    });
  });

  it('accepts the public input shape', () => {
    const parsed = z.object(findPrecedentsToolDefinition.inputSchema).parse({
      name: 'ContractDetailPage',
      repo: 'ifdt-gui',
      mode: 'component',
      limit: 3,
      detail: 'agent',
      includeFamilyContext: true,
      expandClusters: true,
      expandRelated: true,
    });

    expect(parsed).toEqual({
      name: 'ContractDetailPage',
      repo: 'ifdt-gui',
      mode: 'component',
      limit: 3,
      detail: 'agent',
      includeFamilyContext: true,
      expandClusters: true,
      expandRelated: true,
    });
  });

  it('returns shaped precedent tiers with shared context and navigation hints', async () => {
    getPatternMatchesForComponentMock.mockResolvedValue({
      query: 'ContractDetailPage',
      mode: 'component',
      repo: 'ifdt-gui',
      primaryTarget: {
        file: {
          fileId: 'ifdt-gui:app/contracts/[contractId]/ContractDetailPage.tsx',
          repoId: 'ifdt-gui',
          filePath: 'app/contracts/[contractId]/ContractDetailPage.tsx',
        },
        symbol: {
          symbolId: 'contract-detail-symbol',
          fileId: 'ifdt-gui:app/contracts/[contractId]/ContractDetailPage.tsx',
          repo: 'ifdt-gui',
          filePath: 'app/contracts/[contractId]/ContractDetailPage.tsx',
          name: 'ContractDetailPage',
        },
        definedSymbols: [],
        exportedSymbols: [],
        structuralAlignment: {
          graphAnchored: true,
          structuralContextStrength: 'high',
        },
      },
      patternMatches: [],
      resolution: {
        status: 'resolved',
        mode: 'component',
        candidateCount: 1,
        ambiguityDetected: false,
        selectedCandidate: {
          symbolId: 'contract-detail-symbol',
          fileId: 'ifdt-gui:app/contracts/[contractId]/ContractDetailPage.tsx',
          repo: 'ifdt-gui',
          filePath: 'app/contracts/[contractId]/ContractDetailPage.tsx',
          name: 'ContractDetailPage',
          kind: 'function',
          exported: true,
          score: 17,
          reasons: [{ signal: 'exact_name', value: 10 }],
        },
        alternativeCandidates: [],
      },
      summary: {
        matchCount: 0,
        strongMatchCount: 0,
        graphAnchoredMatchCount: 0,
      },
    });
    findPrecedentsForSymbolMock.mockReturnValue({
      target: {
        symbolId: 'contract-detail-symbol',
        fileId: 'ifdt-gui:app/contracts/[contractId]/ContractDetailPage.tsx',
        filePath: 'app/contracts/[contractId]/ContractDetailPage.tsx',
        repoId: 'ifdt-gui',
        symbolName: 'ContractDetailPage',
        patternKind: 'component',
      },
      candidates: [
        {
          symbolId: 'contract-edit-symbol',
          patternId: 'pattern:contract-edit',
          fileId: 'ifdt-gui:app/contracts/[contractId]/edit/ContractEditPage.tsx',
          filePath: 'app/contracts/[contractId]/edit/ContractEditPage.tsx',
          repoId: 'ifdt-gui',
          symbolName: 'ContractEditPage',
          patternKind: 'component',
          similarityScore: 0.91,
          precedentScore: 0.96,
          reasonSignals: ['shared-local-dependencies', 'responsibility-match', 'graph-anchored'],
          structuralAlignment: {
            graphAnchored: true,
            structuralContextStrength: 'high',
          },
        },
      ],
      summary: 'Found 1 precedents for ContractDetailPage.',
    });

    const result = await runFindPrecedentsTool({
      name: 'ContractDetailPage',
      repo: 'ifdt-gui',
      includeFamilyContext: true,
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(getPatternMatchesForComponentMock).toHaveBeenCalledWith('ContractDetailPage', {
      repo: 'ifdt-gui',
      limit: 3,
    });
    expect(findPrecedentsForSymbolMock).toHaveBeenCalledWith('contract-detail-symbol', 3);
    expect(parsed.target).toEqual(
      expect.objectContaining({
        status: 'resolved',
        role: 'page',
        familyRef: 'routed_page_or_screen',
        grounding: 'strong',
      }),
    );
    expect(parsed.results.primary).toEqual([
        expect.objectContaining({
          rank: 1,
          filePath: 'app/contracts/[contractId]/edit/ContractEditPage.tsx',
          symbolName: 'ContractEditPage',
          role: 'page',
          confidence: 'high',
          matchStrength: 'high',
          grounding: 'strong',
          relationship: 'peer_family',
          selectionReason: 'same family + strong dependency overlap',
          familyRef: 'routed_page_or_screen',
          clusterRef: 'cluster:page:edit:sub:contracts',
        }),
      ]);
    expect(parsed.results.secondary).toEqual([]);
    expect(parsed.familyContext).toEqual(
      expect.objectContaining({
        familyRef: 'routed_page_or_screen',
        role: 'page',
        clusterRef: 'cluster:page:detail',
        membership: 'core',
      }),
    );
    expect(parsed.sharedContext).toEqual(
      expect.objectContaining({
        families: expect.objectContaining({
          routed_page_or_screen: expect.objectContaining({ role: 'page' }),
        }),
        clusters: expect.objectContaining({
          'cluster:page:detail': expect.objectContaining({
            role: 'routed_page_or_screen',
            membership: 'core',
          }),
        }),
      }),
    );
    expect(parsed.navigationHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'open_first',
          filePath: 'app/contracts/[contractId]/edit/ContractEditPage.tsx',
        }),
        expect.objectContaining({
          type: 'inspect_related_family',
          familyRef: 'ui_wrapper_or_shell',
        }),
      ]),
    );
    expect(parsed.summary).toEqual(
      expect.objectContaining({
        resultCount: 1,
        strongMatches: 1,
        targetGrounding: 'strong',
      }),
    );
    expect(parsed.summary.tokenEstimate).toBeGreaterThan(0);
    expect(parsed.results.primary[0]).not.toHaveProperty('debug');
  });

  it('returns cautious output for unresolved targets', async () => {
    getPatternMatchesForComponentMock.mockResolvedValue({
      query: 'MissingThing',
      mode: 'component',
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

    const result = await runFindPrecedentsTool({
      name: 'MissingThing',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(findPrecedentsForSymbolMock).not.toHaveBeenCalled();
    expect(findPrecedentsForFileMock).not.toHaveBeenCalled();
    expect(parsed.target).toEqual(
      expect.objectContaining({
        status: 'missing',
        grounding: 'unknown',
      }),
    );
    expect(parsed.results).toEqual({
      primary: [],
      secondary: [],
    });
    expect(parsed.metadata.warnings).toContain('No reusable precedents were found for the resolved target');
  });

  it('supports debug mode and file entrypoint', async () => {
    getPatternMatchesForFileMock.mockResolvedValue({
      query: 'src/hooks/useGetJobs.ts',
      mode: 'file',
      repo: 'repo-a',
      primaryTarget: {
        file: {
          fileId: 'repo-a:src/hooks/useGetJobs.ts',
          repoId: 'repo-a',
          filePath: 'src/hooks/useGetJobs.ts',
        },
        symbol: null,
        definedSymbols: [],
        exportedSymbols: [],
        structuralAlignment: {
          graphAnchored: true,
          structuralContextStrength: 'medium',
        },
      },
      patternMatches: [],
      resolution: {
        status: 'resolved',
        mode: 'file',
        candidateCount: 1,
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
    buildPrecedentCandidateExplainabilityMock.mockResolvedValueOnce({
      family: 'hook_or_context',
      role: 'hook',
      confidence: 'medium',
      selectionReason: 'same responsibility family',
      explanationSignals: {
        alignment: 'medium',
        familyMatch: true,
      },
      debug: {
        score: 0.77,
        reasonSignals: ['responsibility-match', 'graph-anchored'],
      },
    });
    findPrecedentsForFileMock.mockReturnValue({
      target: {
        fileId: 'repo-a:src/hooks/useGetJobs.ts',
        filePath: 'src/hooks/useGetJobs.ts',
        repoId: 'repo-a',
        patternKind: 'hook',
      },
      candidates: [
        {
          symbolId: 'repo-a:src/hooks/useGetNotifications.ts:function:useGetNotifications:1',
          patternId: 'pattern:use-get-notifications',
          fileId: 'repo-a:src/hooks/useGetNotifications.ts',
          filePath: 'src/hooks/useGetNotifications.ts',
          repoId: 'repo-a',
          symbolName: 'useGetNotifications',
          patternKind: 'hook',
          similarityScore: 0.77,
          precedentScore: 0.83,
          reasonSignals: ['responsibility-match', 'graph-anchored'],
          structuralAlignment: {
            graphAnchored: true,
            structuralContextStrength: 'medium',
          },
        },
      ],
      summary: 'Found 1 precedents for file target.',
    });

    const result = await runFindPrecedentsTool({
      name: 'src/hooks/useGetJobs.ts',
      repo: 'repo-a',
      mode: 'file',
      detail: 'debug',
      limit: 1,
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(getPatternMatchesForFileMock).toHaveBeenCalledWith('src/hooks/useGetJobs.ts', {
      repo: 'repo-a',
      limit: 3,
    });
    expect(findPrecedentsForFileMock).toHaveBeenCalledWith('repo-a:src/hooks/useGetJobs.ts', 1);
    expect(parsed).not.toHaveProperty('familyContext');
    expect(parsed.results.primary[0].debug).toEqual(
      expect.objectContaining({
        precedentScore: 0.83,
        similarityScore: 0.77,
        reasonSignals: ['responsibility-match', 'graph-anchored'],
      }),
    );
    expect(parsed.debug).toEqual(
      expect.objectContaining({
        serviceSummary: 'Found 1 precedents for file target.',
      }),
    );
  });

  it('scopes precedents to the resolved target repository by default', async () => {
    getPatternMatchesForFileMock.mockResolvedValue({
      query: 'components/common/modal-state-manager.tsx',
      mode: 'file',
      repo: 'ibm-strings',
      primaryTarget: {
        file: {
          fileId: 'ibm-strings:components/common/modal-state-manager.tsx',
          repoId: 'ibm-strings',
          filePath: 'components/common/modal-state-manager.tsx',
        },
        symbol: null,
        definedSymbols: [],
        exportedSymbols: [],
        structuralAlignment: {
          graphAnchored: false,
          structuralContextStrength: 'low',
        },
      },
      patternMatches: [],
      resolution: {
        status: 'resolved',
        mode: 'file',
        candidateCount: 1,
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
    buildPrecedentCandidateExplainabilityMock.mockResolvedValue({
      family: 'state_or_store',
      role: 'store',
      confidence: 'medium',
      selectionReason: 'graph-anchored precedent',
      explanationSignals: {
        alignment: 'medium',
      },
    });
    findPrecedentsForFileMock.mockReturnValue({
      target: {
        fileId: 'ibm-strings:components/common/modal-state-manager.tsx',
        filePath: 'components/common/modal-state-manager.tsx',
        repoId: 'ibm-strings',
        patternKind: 'component',
      },
      candidates: [
        {
          patternId: 'pattern:toast-provider',
          fileId: 'ifdt-gui:components/ui/ToastProvider.tsx',
          filePath: 'components/ui/ToastProvider.tsx',
          repoId: 'ifdt-gui',
          symbolName: 'ToastProvider',
          patternKind: 'component',
          similarityScore: 0.77,
          precedentScore: 0.81,
          reasonSignals: ['graph-anchored'],
          structuralAlignment: {
            graphAnchored: true,
            structuralContextStrength: 'medium',
          },
        },
        {
          patternId: 'pattern:error-state',
          fileId: 'ibm-strings:components/common/error-state.tsx',
          filePath: 'components/common/error-state.tsx',
          repoId: 'ibm-strings',
          symbolName: 'ErrorState',
          patternKind: 'component',
          similarityScore: 0.72,
          precedentScore: 0.8,
          reasonSignals: ['graph-anchored'],
          structuralAlignment: {
            graphAnchored: true,
            structuralContextStrength: 'medium',
          },
        },
      ],
      summary: 'Found 2 structurally similar precedents.',
    });

    const result = await runFindPrecedentsTool({
      name: 'components/common/modal-state-manager.tsx',
      repo: 'ibm-strings',
      mode: 'file',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(parsed.results.primary).toHaveLength(1);
    expect(parsed.results.primary[0].repoId).toBe('ibm-strings');
  });
});
