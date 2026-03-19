import { describe, expect, it } from 'vitest';

import {
  buildNormalizedDiagnostics,
  buildNormalizedSummary,
  createNormalizedResponse,
  getNormalizedModeShape,
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
          truncated: true,
          limitApplied: 3,
          omittedCount: 2,
        },
      }),
    ).toEqual({
      warnings: ['partial result'],
      truncation: {
        truncated: true,
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

  it('keeps agent and debug modes on one structural shaping contract', () => {
    expect(getNormalizedModeShape('agent')).toEqual({
      mode: 'agent',
      includeDebugSections: false,
      includeRawSignals: false,
      includeExpansionMetadata: true,
    });

    expect(getNormalizedModeShape('debug')).toEqual({
      mode: 'debug',
      includeDebugSections: true,
      includeRawSignals: true,
      includeExpansionMetadata: true,
    });
  });
});
