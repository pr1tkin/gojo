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
      repo: 'web-app',
      mode: 'component',
      limit: 3,
      detail: 'agent',
      includeFamilyContext: true,
      expandClusters: true,
      expandRelated: true,
    });

    expect(parsed).toEqual({
      name: 'ContractDetailPage',
      repo: 'web-app',
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
      repo: 'web-app',
      primaryTarget: {
        file: {
          fileId: 'web-app:app/contracts/[contractId]/ContractDetailPage.tsx',
          repoId: 'web-app',
          filePath: 'app/contracts/[contractId]/ContractDetailPage.tsx',
        },
        symbol: {
          symbolId: 'contract-detail-symbol',
          fileId: 'web-app:app/contracts/[contractId]/ContractDetailPage.tsx',
          repo: 'web-app',
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
          fileId: 'web-app:app/contracts/[contractId]/ContractDetailPage.tsx',
          repo: 'web-app',
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
        fileId: 'web-app:app/contracts/[contractId]/ContractDetailPage.tsx',
        filePath: 'app/contracts/[contractId]/ContractDetailPage.tsx',
        repoId: 'web-app',
        symbolName: 'ContractDetailPage',
        patternKind: 'component',
      },
      candidates: [
        {
          symbolId: 'contract-edit-symbol',
          patternId: 'pattern:contract-edit',
          fileId: 'web-app:app/contracts/[contractId]/edit/ContractEditPage.tsx',
          filePath: 'app/contracts/[contractId]/edit/ContractEditPage.tsx',
          repoId: 'web-app',
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
      totalCandidateCount: 1,
    });

    const result = await runFindPrecedentsTool({
      name: 'ContractDetailPage',
      repo: 'web-app',
      includeFamilyContext: true,
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(getPatternMatchesForComponentMock).toHaveBeenCalledWith('ContractDetailPage', {
      repo: 'web-app',
      limit: 3,
    });
    expect(findPrecedentsForSymbolMock).toHaveBeenCalledWith('contract-detail-symbol', 3, 'web-app');
    expect(parsed).toEqual(
      expect.objectContaining({
        tool: 'find_precedents',
        version: '1',
        mode: 'agent',
        query: expect.objectContaining({
          target: 'ContractDetailPage',
          repo: 'web-app',
          mode: 'component',
          filePath: 'app/contracts/[contractId]/ContractDetailPage.tsx',
          symbolName: 'ContractDetailPage',
        }),
      }),
    );
    expect(parsed.target).toEqual(
      expect.objectContaining({
        status: 'resolved',
        role: 'page',
        family: 'routed_page_or_screen',
        grounding: 'strong',
        confidence: 'medium',
      }),
    );
    expect(parsed.results.primary).toEqual([
        expect.objectContaining({
          id: 'web-app:app/contracts/[contractId]/edit/ContractEditPage.tsx:ContractEditPage',
          kind: 'precedent',
          title: 'ContractEditPage',
          filePath: 'app/contracts/[contractId]/edit/ContractEditPage.tsx',
          symbolName: 'ContractEditPage',
          role: 'page',
          confidence: 'high',
          rank: 1,
          matchStrength: 'high',
          grounding: 'strong',
          relationship: 'peer_family',
          family: 'routed_page_or_screen',
          expansionId: 'cluster:page:edit:sub:contracts',
          explanation: expect.objectContaining({
            short: 'same family + strong dependency overlap',
          }),
          references: {
            filePaths: ['app/contracts/[contractId]/edit/ContractEditPage.tsx'],
            symbolNames: ['ContractEditPage'],
          },
        }),
      ]);
    expect(parsed.results).not.toHaveProperty('secondary');
    expect(parsed.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'target_family',
          value: 'routed_page_or_screen',
        }),
        expect.objectContaining({
          kind: 'target_role',
          value: 'page',
        }),
      ]),
    );
    expect(parsed.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: 'explore_component',
          reason: 'inspect the strongest precedent',
          query: expect.objectContaining({
            name: 'app/contracts/[contractId]/edit/ContractEditPage.tsx',
            repo: 'web-app',
          }),
        }),
        expect.objectContaining({
          tool: 'collect_refactor_context',
          query: expect.objectContaining({
            name: 'app/contracts/[contractId]/ContractDetailPage.tsx',
            repo: 'web-app',
          }),
        }),
      ]),
    );
    expect(parsed.summary).toEqual(
      expect.objectContaining({
        resultCount: 1,
        primaryCount: 1,
        strongMatchCount: 1,
        confidence: 'medium',
      }),
    );
    expect(parsed.diagnostics).toEqual(
      expect.objectContaining({
        warnings: [],
        limits: expect.objectContaining({
          resultLimit: 3,
          navigationHintLimit: 3,
        }),
        truncation: expect.objectContaining({
          truncated: false,
          limitApplied: 3,
        }),
      }),
    );
    expect(parsed.results.primary[0].debug).toBeNull();
    expect(parsed.debug).toBeNull();
    expect(parsed.expansions).toEqual({});
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
    expect(parsed).toEqual(
      expect.objectContaining({
        tool: 'find_precedents',
        mode: 'agent',
        query: expect.objectContaining({
          target: 'MissingThing',
          mode: 'component',
        }),
      }),
    );
    expect(parsed.target).toEqual(
      expect.objectContaining({
        status: 'missing',
        grounding: 'unknown',
      }),
    );
    expect(parsed.results).toEqual({
      primary: [],
    });
    expect(parsed.diagnostics.warnings).toContain('No reusable precedents were found for the resolved target');
    expect(parsed.summary).toEqual(
      expect.objectContaining({
        resultCount: 0,
        primaryCount: 0,
        confidence: 'medium',
      }),
    );
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
      totalCandidateCount: 1,
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
    expect(findPrecedentsForFileMock).toHaveBeenCalledWith('repo-a:src/hooks/useGetJobs.ts', 1, 'repo-a');
    expect(parsed).toEqual(
      expect.objectContaining({
        tool: 'find_precedents',
        mode: 'debug',
        query: expect.objectContaining({
          target: 'src/hooks/useGetJobs.ts',
          repo: 'repo-a',
          mode: 'file',
        }),
      }),
    );
    expect(parsed.results.primary[0].debug).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          precedentScore: 0.83,
          similarityScore: 0.77,
          reasonSignals: ['responsibility-match', 'graph-anchored'],
        }),
      }),
    );
    expect(parsed.debug).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          serviceSummary: 'Found 1 precedents for file target.',
        }),
      }),
    );
    expect(parsed.results.primary[0].score).toBeNull();
  });

  it('scopes precedents to the resolved target repository by default', async () => {
    getPatternMatchesForFileMock.mockResolvedValue({
      query: 'components/common/modal-state-manager.tsx',
      mode: 'file',
      repo: 'translation-system',
      primaryTarget: {
        file: {
          fileId: 'translation-system:components/common/modal-state-manager.tsx',
          repoId: 'translation-system',
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
        fileId: 'translation-system:components/common/modal-state-manager.tsx',
        filePath: 'components/common/modal-state-manager.tsx',
        repoId: 'translation-system',
        patternKind: 'component',
      },
      candidates: [
        {
          patternId: 'pattern:error-state',
          fileId: 'translation-system:components/common/error-state.tsx',
          filePath: 'components/common/error-state.tsx',
          repoId: 'translation-system',
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
      summary: 'Found 1 structurally similar precedents.',
      totalCandidateCount: 1,
    });

    const result = await runFindPrecedentsTool({
      name: 'components/common/modal-state-manager.tsx',
      repo: 'translation-system',
      mode: 'file',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(parsed.results.primary).toHaveLength(1);
    expect(parsed.results.primary[0].repoId).toBe('translation-system');
    expect(parsed.results).not.toHaveProperty('secondary');
    expect(parsed.nextActions).toEqual([
      expect.objectContaining({
        tool: 'explore_component',
        query: expect.objectContaining({
          name: 'components/common/error-state.tsx',
        }),
      }),
      expect.objectContaining({
        tool: 'collect_refactor_context',
      }),
    ]);
    expect(parsed.summary).toEqual(
      expect.objectContaining({
        resultCount: 1,
        primaryCount: 1,
      }),
    );
    expect(parsed.target.grounding).toBe('weak');
  });

  it('keeps strong multi-result responses on the regular shaped path', async () => {
    getPatternMatchesForComponentMock.mockResolvedValue({
      query: 'ContractDetailPage',
      mode: 'component',
      repo: 'web-app',
      primaryTarget: {
        file: {
          fileId: 'web-app:app/contracts/[contractId]/ContractDetailPage.tsx',
          repoId: 'web-app',
          filePath: 'app/contracts/[contractId]/ContractDetailPage.tsx',
        },
        symbol: {
          symbolId: 'contract-detail-symbol',
          fileId: 'web-app:app/contracts/[contractId]/ContractDetailPage.tsx',
          repo: 'web-app',
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
          fileId: 'web-app:app/contracts/[contractId]/ContractDetailPage.tsx',
          repo: 'web-app',
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
        fileId: 'web-app:app/contracts/[contractId]/ContractDetailPage.tsx',
        filePath: 'app/contracts/[contractId]/ContractDetailPage.tsx',
        repoId: 'web-app',
        symbolName: 'ContractDetailPage',
        patternKind: 'component',
      },
      candidates: [
        {
          symbolId: 'contract-edit-symbol',
          patternId: 'pattern:contract-edit',
          fileId: 'web-app:app/contracts/[contractId]/edit/ContractEditPage.tsx',
          filePath: 'app/contracts/[contractId]/edit/ContractEditPage.tsx',
          repoId: 'web-app',
          symbolName: 'ContractEditPage',
          patternKind: 'component',
          similarityScore: 0.91,
          precedentScore: 0.96,
          reasonSignals: ['shared-local-dependencies'],
          structuralAlignment: {
            graphAnchored: true,
            structuralContextStrength: 'high',
          },
        },
        {
          symbolId: 'customer-detail-symbol',
          patternId: 'pattern:customer-detail',
          fileId: 'web-app:app/customers/[id]/CustomerDetailPage.tsx',
          filePath: 'app/customers/[id]/CustomerDetailPage.tsx',
          repoId: 'web-app',
          symbolName: 'CustomerDetailPage',
          patternKind: 'component',
          similarityScore: 0.9,
          precedentScore: 0.95,
          reasonSignals: ['shared-local-dependencies'],
          structuralAlignment: {
            graphAnchored: true,
            structuralContextStrength: 'high',
          },
        },
        {
          symbolId: 'case-detail-symbol',
          patternId: 'pattern:case-detail',
          fileId: 'web-app:app/cases/[id]/CaseDetailPage.tsx',
          filePath: 'app/cases/[id]/CaseDetailPage.tsx',
          repoId: 'web-app',
          symbolName: 'CaseDetailPage',
          patternKind: 'component',
          similarityScore: 0.89,
          precedentScore: 0.92,
          reasonSignals: ['shared-local-dependencies'],
          structuralAlignment: {
            graphAnchored: true,
            structuralContextStrength: 'high',
          },
        },
      ],
      summary: 'Found 3 precedents for ContractDetailPage.',
      totalCandidateCount: 3,
    });

    const result = await runFindPrecedentsTool({
      name: 'ContractDetailPage',
      repo: 'web-app',
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, any>;

    expect(parsed.results.secondary).toHaveLength(1);
    expect(Object.keys(parsed.expansions).length).toBeGreaterThan(0);
    expect(parsed.summary).toEqual(
      expect.objectContaining({
        resultCount: 3,
        primaryCount: 2,
        secondaryCount: 1,
        strongMatchCount: 3,
      }),
    );
  });
});
