import type { RuntimeCapabilityDefinition } from './types.js';

export const runtimeCapabilityDefinitions: RuntimeCapabilityDefinition[] = [
  {
    name: 'IndexRepo',
    executionMode: 'one_shot',
    description: 'Build or refresh repository index artifacts required for Gojo runtime flows.',
    implemented: true,
  },
  {
    name: 'RefreshRepo',
    executionMode: 'one_shot',
    description: 'Reconcile repository state into fresh structural and coordinated search metadata.',
    implemented: true,
  },
  {
    name: 'ExploreComponent',
    executionMode: 'one_shot',
    description: 'Inspect a target symbol or component and summarize grounded context.',
    implemented: true,
  },
  {
    name: 'ServeMCP',
    executionMode: 'long_running',
    description: 'Start the MCP surface on top of the runtime core.',
    implemented: true,
  },
  {
    name: 'RunHealthChecks',
    executionMode: 'one_shot',
    description: 'Evaluate current runtime, artifact, and search trust state.',
    implemented: true,
  },
  {
    name: 'BuildChangeContext',
    executionMode: 'one_shot',
    description: 'Planned bundled context capability built on top of explore, precedents, and planning.',
    implemented: false,
  },
  {
    name: 'FindPrecedents',
    executionMode: 'one_shot',
    description: 'Planned precedent-discovery runtime capability.',
    implemented: false,
  },
  {
    name: 'ComputeImpact',
    executionMode: 'one_shot',
    description: 'Planned impact-analysis runtime capability.',
    implemented: false,
  },
  {
    name: 'RunDoctor',
    executionMode: 'one_shot',
    description: 'Planned diagnostics and remediation capability.',
    implemented: false,
  },
  {
    name: 'TraceFlow',
    executionMode: 'one_shot',
    description: 'Planned graph/path tracing runtime capability.',
    implemented: false,
  },
];
