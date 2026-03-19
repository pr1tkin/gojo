import { describe, expect, it } from 'vitest';

import {
  buildNormalizedDiagnostics,
  buildNormalizedEvidence,
  buildNormalizedExplanation,
  buildNormalizedExpansion,
  buildNormalizedExpansionId,
  buildNormalizedNextActions,
  buildNormalizedResultTiers,
  buildNormalizedTruncation,
  buildNormalizedSummary,
  createNormalizedResponse,
  getNormalizedModeShape,
  mergeNormalizedDiagnostics,
  shapeSignalsForMode,
} from '../../src/tool-response/index.js';

describe('tool response normalization foundations', () => {
  it('builds a canonical response envelope with stable defaults', () => {
    const response = createNormalizedResponse({
      tool: 'find_precedents',
      mode: 'agent',
      query: { target: 'Button' },
    });

    expect(response).toEqual({
      tool: 'find_precedents',
      version: '1',
      mode: 'agent',
      query: { target: 'Button' },
      summary: {
        resultCount: 0,
        primaryCount: 0,
      },
      results: {
        primary: [],
      },
      evidence: [],
      nextActions: [],
      diagnostics: {
        warnings: [],
      },
      expansions: {},
    });
  });

  it('normalizes diagnostics defaults and optional truncation metadata', () => {
    expect(
      buildNormalizedDiagnostics({
        warnings: ['partial result'],
        truncation: {
          type: 'results',
          truncated: true,
          totalCount: 5,
          limitApplied: 3,
          omittedCount: 2,
        },
      }),
    ).toEqual({
      warnings: ['partial result'],
      truncation: {
        type: 'results',
        truncated: true,
        totalCount: 5,
        limitApplied: 3,
        omittedCount: 2,
      },
    });
  });

  it('builds summary counts from primary and secondary results', () => {
    const summary = buildNormalizedSummary({
      results: {
        primary: [
          {
            id: 'a',
            kind: 'file',
            title: 'A',
            confidence: 'high',
            explanation: { short: 'same family' },
            references: {},
          },
        ],
        secondary: [
          {
            id: 'b',
            kind: 'file',
            title: 'B',
            confidence: 'low',
            explanation: { short: 'weaker precedent' },
            references: {},
          },
        ],
      },
      confidence: 'medium',
    });

    expect(summary).toEqual({
      resultCount: 2,
      primaryCount: 1,
      secondaryCount: 1,
      strongMatchCount: 1,
      confidence: 'medium',
    });
  });

  it('builds reusable result tiers with mode-aware defaults', () => {
    const tiers = buildNormalizedResultTiers({
      items: ['a', 'b', 'c', 'd'],
      mode: 'agent',
    });

    expect(tiers).toEqual({
      primary: ['a', 'b'],
      secondary: ['c'],
    });
  });

  it('deduplicates evidence and next actions with mode-aware limits', () => {
    expect(
      buildNormalizedEvidence(
        [
          { kind: 'family', label: 'family', value: 'ui_component' },
          { kind: 'family', label: 'family', value: 'ui_component' },
          { kind: 'cluster', label: 'cluster', value: 'cluster:1' },
        ],
        { mode: 'agent' },
      ),
    ).toEqual([
      { kind: 'family', label: 'family', value: 'ui_component' },
      { kind: 'cluster', label: 'cluster', value: 'cluster:1' },
    ]);

    expect(
      buildNormalizedNextActions(
        [
          { tool: 'explore_component', reason: 'inspect target', query: { target: 'Button' } },
          { tool: 'explore_component', reason: 'inspect target', query: { target: 'Button' } },
          { tool: 'find_precedents', reason: 'find peers', query: { target: 'Button' } },
        ],
        { mode: 'agent' },
      ),
    ).toEqual([
      { action: 'explore_component', tool: 'explore_component', reason: 'inspect target', query: { target: 'Button' } },
      { action: 'find_precedents', tool: 'find_precedents', reason: 'find peers', query: { target: 'Button' } },
    ]);
  });

  it('builds truncation, merges diagnostics, and keeps warnings consistent', () => {
    const truncation = buildNormalizedTruncation({
      type: 'results',
      returnedCount: 3,
      totalCount: 7,
      limitApplied: 3,
      reason: 'top-k limit applied',
    });

    expect(truncation).toEqual({
      type: 'results',
      truncated: true,
      totalCount: 7,
      limitApplied: 3,
      omittedCount: 4,
      reason: 'top-k limit applied',
    });

    expect(
      mergeNormalizedDiagnostics(
        {
          warnings: ['partial result', 'partial result'],
          truncation,
        },
        {
          warnings: ['search freshness pending'],
          truncations: [
            buildNormalizedTruncation({
              type: 'candidates',
              returnedCount: 2,
              totalCount: 5,
              limitApplied: 2,
              reason: 'candidate limit applied',
            }),
          ],
          limits: { resultLimit: 3 },
          notes: ['repo-local scope applied'],
        },
      ),
    ).toEqual({
      warnings: ['partial result', 'search freshness pending'],
      truncation,
      truncations: [
        truncation,
        {
          type: 'candidates',
          truncated: true,
          totalCount: 5,
          limitApplied: 2,
          omittedCount: 3,
          reason: 'candidate limit applied',
        },
      ],
      limits: { resultLimit: 3 },
      notes: ['repo-local scope applied'],
    });
  });

  it('builds explanation signals and expansion handles consistently', () => {
    expect(
      buildNormalizedExplanation({
        mode: 'agent',
        short: 'same family + strong overlap',
        signals: {
          alignment: 'high',
          dependencyOverlap: 'high',
          familyMatch: true,
          cluster: 'cluster:1',
          extra: 'trimmed-in-agent',
        },
      }),
    ).toEqual({
      short: 'same family + strong overlap',
      signals: {
        alignment: 'high',
        dependencyOverlap: 'high',
        familyMatch: true,
        cluster: 'cluster:1',
      },
    });

    expect(shapeSignalsForMode({ a: 1, b: 2, c: 3, d: 4, e: 5 }, 'agent', 3)).toEqual({
      a: 1,
      b: 2,
      c: 3,
    });

    expect(buildNormalizedExpansionId({ kind: 'family detail', stableKey: 'Button Cluster' })).toBe(
      'family-detail:button-cluster',
    );
    expect(
      buildNormalizedExpansion({
        kind: 'family detail',
        title: 'Button cluster',
        stableKey: 'Button Cluster',
        status: 'deferred',
      }),
    ).toEqual({
      id: 'family-detail:button-cluster',
      kind: 'family detail',
      title: 'Button cluster',
      status: 'deferred',
    });
  });

  it('keeps agent and debug modes on one structural shaping contract', () => {
    expect(getNormalizedModeShape('agent')).toEqual({
      mode: 'agent',
      includeDebugSections: false,
      includeRawSignals: false,
      includeExpansionMetadata: true,
      defaultPrimaryCount: 2,
      defaultSecondaryCount: 1,
      defaultEvidenceCount: 4,
      defaultNextActionCount: 3,
      defaultSignalCount: 4,
    });

    expect(getNormalizedModeShape('debug')).toEqual({
      mode: 'debug',
      includeDebugSections: true,
      includeRawSignals: true,
      includeExpansionMetadata: true,
      defaultPrimaryCount: 2,
      defaultSecondaryCount: 3,
      defaultEvidenceCount: 6,
      defaultNextActionCount: 4,
      defaultSignalCount: 6,
    });
  });
});
