import { describe, expect, it, vi } from 'vitest';

const {
  loadCurrentGenerationStateMock,
  loadPatternIndexResultMock,
} = vi.hoisted(() => ({
  loadCurrentGenerationStateMock: vi.fn(),
  loadPatternIndexResultMock: vi.fn(),
}));

vi.mock('../../src/indexing/generation-store.js', () => ({
  loadCurrentGenerationState: loadCurrentGenerationStateMock,
}));

vi.mock('../../src/patterns/store.js', () => ({
  loadPatternIndexResult: loadPatternIndexResultMock,
}));

import {
  buildExploreComponentTrustMetadata,
  buildPatternTrustMetadata,
  buildStructuralTrustMetadata,
} from '../../src/tools/trust-metadata.js';

describe('trust metadata', () => {
  it('classifies high-confidence structural metadata when coverage and completeness are strong', async () => {
    loadCurrentGenerationStateMock.mockResolvedValue({
      counts: { files: 95 },
      search: {
        status: 'ready',
        repoFingerprints: [{
          repoId: 'repo-a',
          fileCount: 100,
          scope: {
            rawSearchVisibleCount: 100,
            relevantSourceCount: 100,
            excludedVisibleCount: 0,
            excludedByCategory: {},
          },
        }],
      },
    });

    const metadata = await buildExploreComponentTrustMetadata({
      renderTree: [
        {
          name: 'Header',
          filePath: 'src/components/Header.tsx',
          symbolId: 'repo-a:src/components/Header.tsx:function:Header:1',
          resolved: true,
          resolution: 'resolved_local',
          children: [],
        },
      ],
      completeness: 0.92,
    });

    expect(metadata).toEqual({
      coverage: {
        filesAnalyzed: 95,
        filesTotal: 100,
        ratio: 0.95,
        scope: 'relevant_source',
        raw: {
          filesAnalyzed: 95,
          filesTotal: 100,
          ratio: 0.95,
        },
        relevant: {
          filesAnalyzed: 95,
          filesTotal: 100,
          ratio: 0.95,
        },
      },
      completeness: 0.92,
      confidence: 'high',
    });
  });

  it('uses relevant-source coverage for confidence while preserving raw searchable coverage', async () => {
    loadCurrentGenerationStateMock.mockResolvedValue({
      counts: { files: 75 },
      search: {
        status: 'ready',
        repoFingerprints: [{
          repoId: 'repo-a',
          fileCount: 500,
          scope: {
            rawSearchVisibleCount: 500,
            relevantSourceCount: 100,
            excludedVisibleCount: 400,
            excludedByCategory: {
              data_or_config: 250,
              style_or_asset: 100,
              documentation: 50,
            },
          },
        }],
      },
    });

    const metadata = await buildStructuralTrustMetadata({
      completeness: 0.85,
    });

    expect(metadata).toEqual({
      coverage: {
        filesAnalyzed: 75,
        filesTotal: 100,
        ratio: 0.75,
        scope: 'relevant_source',
        raw: {
          filesAnalyzed: 75,
          filesTotal: 500,
          ratio: 0.15,
        },
        relevant: {
          filesAnalyzed: 75,
          filesTotal: 100,
          ratio: 0.75,
        },
      },
      completeness: 0.85,
      confidence: 'medium',
      warnings: [
        'Raw searchable coverage is low (15%), but relevant source coverage is substantially higher (75%) after excluding non-structural files.',
        'Large portion of relevant source scope not structurally analyzed (75% coverage)',
      ],
    });
  });

  it('classifies low-confidence metadata and emits warnings for weak UI completeness', async () => {
    loadCurrentGenerationStateMock.mockResolvedValue({
      counts: { files: 98 },
      search: {
        status: 'ready',
        repoFingerprints: [{
          repoId: 'repo-a',
          fileCount: 100,
          scope: {
            rawSearchVisibleCount: 100,
            relevantSourceCount: 100,
            excludedVisibleCount: 0,
            excludedByCategory: {},
          },
        }],
      },
    });

    const metadata = await buildExploreComponentTrustMetadata({
      renderTree: [
        {
          name: 'ButtonChrome',
          resolved: false,
          resolution: 'alias_not_resolved',
          hint: '@/components/ButtonChrome',
          children: [],
        },
      ],
      completeness: 0.23,
    });

    expect(metadata).toEqual({
      coverage: {
        filesAnalyzed: 98,
        filesTotal: 100,
        ratio: 0.98,
        scope: 'relevant_source',
        raw: {
          filesAnalyzed: 98,
          filesTotal: 100,
          ratio: 0.98,
        },
        relevant: {
          filesAnalyzed: 98,
          filesTotal: 100,
          ratio: 0.98,
        },
      },
      completeness: 0.23,
      confidence: 'low',
      warnings: ['UI tree is only partially resolved (23% completeness)'],
    });
  });

  it('falls back to raw searchable coverage when relevant-source scope is unavailable', async () => {
    loadCurrentGenerationStateMock.mockResolvedValue({
      counts: { files: 84 },
      search: {
        status: 'ready',
        repoFingerprints: [{ repoId: 'repo-a', fileCount: 100 }],
      },
    });

    const metadata = await buildStructuralTrustMetadata();

    expect(metadata).toEqual({
      coverage: {
        filesAnalyzed: 84,
        filesTotal: 100,
        ratio: 0.84,
        scope: 'raw_search_visible',
        raw: {
          filesAnalyzed: 84,
          filesTotal: 100,
          ratio: 0.84,
        },
      },
      confidence: 'medium',
      warnings: [
        'Relevant source coverage scope is unavailable; falling back to raw searchable coverage',
        'Large portion of searchable repository not structurally analyzed (84% coverage)',
      ],
    });
  });

  it('builds low-confidence pattern metadata when pattern participation and matches are weak', async () => {
    loadCurrentGenerationStateMock.mockResolvedValue({
      counts: { files: 100 },
      search: {
        status: 'ready',
        repoFingerprints: [{
          repoId: 'repo-a',
          fileCount: 100,
          scope: {
            rawSearchVisibleCount: 100,
            relevantSourceCount: 100,
            excludedVisibleCount: 0,
            excludedByCategory: {},
          },
        }],
      },
    });
    loadPatternIndexResultMock.mockResolvedValue({
      status: 'ok',
      reason: 'pattern artifact loaded successfully',
      value: {
        patterns: [{ fileId: 'repo-a:src/a.ts' }],
      },
    });

    const metadata = await buildPatternTrustMetadata({
      query: 'MissingWidget',
      mode: 'component',
      repo: 'repo-a',
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

    expect(metadata).toEqual({
      coverage: {
        filesTotal: 100,
        filesAnalyzed: 100,
        ratio: 1,
        scope: 'relevant_source',
        raw: {
          filesAnalyzed: 100,
          filesTotal: 100,
          ratio: 1,
        },
        relevant: {
          filesAnalyzed: 100,
          filesTotal: 100,
          ratio: 1,
        },
      },
      completeness: 0,
      confidence: 'low',
      patternCoverage: {
        filesAnalyzed: 1,
        filesTotal: 100,
        ratio: 0.01,
      },
      structuralAlignment: null,
      warnings: [
        'Pattern coverage is partial (1% of structurally analyzed files)',
        'No structurally matched pattern target was resolved',
        'No similar pattern matches were found',
      ],
    });
  });

  it('keeps high-confidence pattern metadata for strongly grounded targets', async () => {
    loadCurrentGenerationStateMock.mockResolvedValue({
      counts: { files: 100 },
      search: {
        status: 'ready',
        repoFingerprints: [{
          repoId: 'repo-a',
          fileCount: 100,
          scope: {
            rawSearchVisibleCount: 100,
            relevantSourceCount: 100,
            excludedVisibleCount: 0,
            excludedByCategory: {},
          },
        }],
      },
    });
    loadPatternIndexResultMock.mockResolvedValue({
      status: 'ok',
      reason: 'pattern artifact loaded successfully',
      value: {
        patterns: new Array(90).fill(null).map((_, index) => ({ fileId: `repo-a:src/pattern-${index}.tsx` })),
      },
    });

    const metadata = await buildPatternTrustMetadata({
      query: 'ContractDetailPage',
      mode: 'file',
      repo: 'repo-a',
      primaryTarget: {
        file: { fileId: 'repo-a:src/ContractDetailPage.tsx', filePath: 'src/ContractDetailPage.tsx' },
        symbol: null,
        definedSymbols: [],
        exportedSymbols: [],
        structuralAlignment: {
          structurallyIndexed: true,
          graphAnchored: true,
          structuralContextStrength: 'high',
          resolvedLocalDependencies: ['repo-a:src/components/Button.tsx'],
          relatedLocalFiles: ['repo-a:src/components/Button.tsx'],
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
        matchCount: 1,
        strongMatchCount: 1,
        graphAnchoredMatchCount: 1,
      },
    });

    expect(metadata.confidence).toBe('high');
    expect(metadata.structuralAlignment).toEqual({
      graphAnchored: true,
      structuralContextStrength: 'high',
    });
  });

  it('caps medium-strength targets at medium confidence', async () => {
    loadCurrentGenerationStateMock.mockResolvedValue({
      counts: { files: 100 },
      search: {
        status: 'ready',
        repoFingerprints: [{
          repoId: 'repo-a',
          fileCount: 100,
          scope: {
            rawSearchVisibleCount: 100,
            relevantSourceCount: 100,
            excludedVisibleCount: 0,
            excludedByCategory: {},
          },
        }],
      },
    });
    loadPatternIndexResultMock.mockResolvedValue({
      status: 'ok',
      reason: 'pattern artifact loaded successfully',
      value: {
        patterns: new Array(90).fill(null).map((_, index) => ({ fileId: `repo-a:src/pattern-${index}.tsx` })),
      },
    });

    const metadata = await buildPatternTrustMetadata({
      query: 'Button',
      mode: 'file',
      repo: 'repo-a',
      primaryTarget: {
        file: { fileId: 'repo-a:src/Button.tsx', filePath: 'src/Button.tsx' },
        symbol: null,
        definedSymbols: [],
        exportedSymbols: [],
        structuralAlignment: {
          structurallyIndexed: true,
          graphAnchored: true,
          structuralContextStrength: 'medium',
          resolvedLocalDependencies: ['repo-a:src/components/Button.styles.ts'],
          relatedLocalFiles: [],
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
        matchCount: 1,
        strongMatchCount: 1,
        graphAnchoredMatchCount: 1,
      },
    });

    expect(metadata.confidence).toBe('medium');
    expect(metadata.warnings).toContain(
      'Target has partial structural grounding (limited resolved local dependencies)',
    );
    expect(metadata.structuralAlignment).toEqual({
      graphAnchored: true,
      structuralContextStrength: 'medium',
    });
  });

  it('downgrades weakly grounded targets and explains the downgrade', async () => {
    loadCurrentGenerationStateMock.mockResolvedValue({
      counts: { files: 100 },
      search: {
        status: 'ready',
        repoFingerprints: [{
          repoId: 'repo-a',
          fileCount: 100,
          scope: {
            rawSearchVisibleCount: 100,
            relevantSourceCount: 100,
            excludedVisibleCount: 0,
            excludedByCategory: {},
          },
        }],
      },
    });
    loadPatternIndexResultMock.mockResolvedValue({
      status: 'ok',
      reason: 'pattern artifact loaded successfully',
      value: {
        patterns: new Array(90).fill(null).map((_, index) => ({ fileId: `repo-a:src/pattern-${index}.tsx` })),
      },
    });

    const metadata = await buildPatternTrustMetadata({
      query: 'ModalStateManager',
      mode: 'file',
      repo: 'repo-a',
      primaryTarget: {
        file: { fileId: 'repo-a:src/modal-state-manager.tsx', filePath: 'src/modal-state-manager.tsx' },
        symbol: null,
        definedSymbols: [],
        exportedSymbols: [],
        structuralAlignment: {
          structurallyIndexed: true,
          graphAnchored: false,
          structuralContextStrength: 'low',
          resolvedLocalDependencies: [],
          relatedLocalFiles: [],
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
        matchCount: 1,
        strongMatchCount: 1,
        graphAnchoredMatchCount: 1,
      },
    });

    expect(metadata.confidence).toBe('medium');
    expect(metadata.confidence).not.toBe('high');
    expect(metadata.warnings).toEqual(
      expect.arrayContaining([
        'Target has weak structural grounding (no resolved local dependencies)',
        'Pattern matches are based on heuristic similarity, not graph-backed structure',
      ]),
    );
    expect(metadata.structuralAlignment).toEqual({
      graphAnchored: false,
      structuralContextStrength: 'low',
    });
  });
});
