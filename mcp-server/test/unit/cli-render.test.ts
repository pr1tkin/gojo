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

  it('renders explicit exact, inferred, and exploratory sections when bucketed impact payload is present', () => {
    const output = renderRuntimeResponse({
      capability: 'ComputeImpact',
      executionMode: 'one_shot',
      summary: {
        title: 'createAutomation',
        text: 'Impact buckets are available.',
      },
      findings: [],
      related_entities: [],
      signals: [],
      warnings: [],
      machine_payload: {
        direct_consumers: {
          label: 'Direct consumers (exact)',
          explanation: 'confirmed symbol-level usage',
          entries: [{ filePath: 'lib/services/automationService.ts', symbolName: 'createAutomation' }],
          total: 1,
          shown: 1,
          truncated: false,
        },
        indirect_consumers: {
          label: 'Indirect consumers (inferred)',
          explanation: 'likely usage via wrappers or re-exports',
          entries: [{ filePath: 'lib/hooks/useAutomationsMutation.ts', symbolName: 'createAutomation' }],
          total: 3,
          shown: 1,
          truncated: true,
        },
        related_context: {
          label: 'Related context (exploratory)',
          explanation: 'nearby or related files, not guaranteed direct usage',
          entries: [{ filePath: 'app/automations/page.tsx' }],
          total: 5,
          shown: 1,
          truncated: true,
        },
      },
      trust_level: 'high',
      readiness_state: 'ready',
      confidence: 'high',
      trust: 'high',
      result_kind: 'exact',
      coverage: 'complete',
      coverage_signals: ['complete'],
      evidence_types: ['graph', 'symbol_index'],
    });

    expect(output).toContain('Direct consumers (exact)');
    expect(output).toContain('confirmed symbol-level usage');
    expect(output).toContain('lib/services/automationService.ts#createAutomation');
    expect(output).toContain('Indirect consumers (inferred)');
    expect(output).toContain('Related context (exploratory)');
    expect(output).toContain('showing 1 of 3');
    expect(output).toContain('showing 1 of 5');
  });
});
