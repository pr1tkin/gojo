import { describe, expect, it } from 'vitest';

import { renderRuntimeResponse } from '../../src/cli/render.js';

describe('cli render transparency', () => {
  it('renders confidence, kind, coverage, and note for human output', () => {
    const output = renderRuntimeResponse({
      capability: 'ExploreComponent',
      executionMode: 'one_shot',
      summary: {
        title: 'createAutomation',
        text: 'Resolved createAutomation with 3 related files.',
      },
      findings: [],
      related_entities: [],
      signals: [],
      warnings: [],
      machine_payload: {},
      trust_level: 'medium',
      readiness_state: 'ready',
      confidence: 'medium',
      trust: 'medium',
      result_kind: 'inferred',
      coverage: 'partial',
      coverage_signals: ['ambiguous_match', 'name_collision_risk', 'partial'],
      evidence_types: ['symbol_index', 'related_files'],
      note: 'Same-name candidates remain; the chosen target is ranked, not guaranteed exact.',
    });

    expect(output).toContain('kind: inferred');
    expect(output).toContain('coverage: partial');
    expect(output).toContain('coverage signals: ambiguous_match, name_collision_risk, partial');
    expect(output).toContain('evidence: symbol_index, related_files');
    expect(output).toContain('note: Same-name candidates remain; the chosen target is ranked, not guaranteed exact.');
  });
});
