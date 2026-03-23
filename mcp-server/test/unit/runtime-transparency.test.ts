import { describe, expect, it } from 'vitest';

import {
  assessExploreTransparency,
  assessHealthTransparency,
  assessIndexTransparency,
} from '../../src/runtime/transparency.js';

describe('runtime transparency', () => {
  it('marks ambiguous explore results as inferred with name-collision risk', () => {
    const result = assessExploreTransparency({
      readinessState: 'ready',
      primarySymbolResolved: true,
      ambiguityDetected: true,
      candidateCount: 2,
      relatedFileCount: 3,
      health: {
        suitableForAgentWorkflows: true,
      },
    });

    expect(result.resultKind).toBe('inferred');
    expect(result.coverage).toBe('partial');
    expect(result.coverageSignals).toEqual(
      expect.arrayContaining(['ambiguous_match', 'name_collision_risk', 'partial']),
    );
    expect(result.note).toContain('Same-name candidates remain');
  });

  it('marks exact explore results with related files as partial exploratory context', () => {
    const result = assessExploreTransparency({
      readinessState: 'ready',
      primarySymbolResolved: true,
      ambiguityDetected: false,
      candidateCount: 1,
      relatedFileCount: 4,
      health: {
        suitableForAgentWorkflows: true,
      },
    });

    expect(result.resultKind).toBe('exact');
    expect(result.coverage).toBe('partial');
    expect(result.note).toContain('nearby context');
    expect(result.evidenceTypes).toEqual(expect.arrayContaining(['symbol_index', 'related_files']));
  });

  it('marks stale health as exact state with stale coverage', () => {
    const result = assessHealthTransparency({
      readinessState: 'stale',
      suitableForAgentWorkflows: true,
      searchHelpersAvailable: true,
    });

    expect(result.resultKind).toBe('exact');
    expect(result.coverage).toBe('stale');
    expect(result.coverageSignals).toContain('stale');
  });

  it('marks refreshing health as partial coverage instead of complete', () => {
    const result = assessHealthTransparency({
      readinessState: 'refreshing',
      suitableForAgentWorkflows: true,
      searchHelpersAvailable: true,
    });

    expect(result.coverage).toBe('partial');
    expect(result.coverageSignals).toContain('partial');
  });

  it('marks degraded index results as partial with a degradation note', () => {
    const result = assessIndexTransparency({
      readinessState: 'degraded',
      hasWarnings: false,
    });

    expect(result.coverage).toBe('partial');
    expect(result.note).toContain('degraded');
  });

  it('marks ready index results with warnings as partial rather than exact complete coverage', () => {
    const result = assessIndexTransparency({
      readinessState: 'ready',
      hasWarnings: true,
    });

    expect(result.resultKind).toBe('exact');
    expect(result.coverage).toBe('partial');
    expect(result.coverageSignals).toContain('partial');
  });
});
