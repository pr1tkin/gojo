import type { IndexHealthSummary } from '../indexing/types.js';
import type {
  RuntimeCoverage,
  RuntimeCoverageSignal,
  RuntimeReadinessState,
  RuntimeResultKind,
} from './types.js';

export interface RuntimeTransparency {
  resultKind: RuntimeResultKind;
  coverage: RuntimeCoverage;
  coverageSignals: RuntimeCoverageSignal[];
  evidenceTypes: string[];
  note?: string;
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function coverageFromReadiness(readinessState: RuntimeReadinessState): RuntimeCoverage {
  if (readinessState === 'stale') {
    return 'stale';
  }

  if (readinessState === 'unknown' || readinessState === 'inconsistent') {
    return 'partial';
  }

  return 'complete';
}

function baseCoverageSignals(readinessState: RuntimeReadinessState): RuntimeCoverageSignal[] {
  if (readinessState === 'stale') {
    return ['stale'];
  }

  if (readinessState === 'unknown' || readinessState === 'inconsistent') {
    return ['partial'];
  }

  return ['complete'];
}

function normalizeCoverageSignals(
  coverage: RuntimeCoverage,
  signals: RuntimeCoverageSignal[],
): RuntimeCoverageSignal[] {
  const filtered = signals.filter((signal) => signal !== 'complete' && signal !== 'partial' && signal !== 'stale') as RuntimeCoverageSignal[];

  if (coverage === 'complete') {
    filtered.unshift('complete');
  } else if (coverage === 'stale') {
    filtered.unshift('stale');
  } else {
    filtered.unshift('partial');
  }

  return dedupe(filtered);
}

export function assessHealthTransparency(input: {
  readinessState: RuntimeReadinessState;
  suitableForAgentWorkflows: boolean;
  searchHelpersAvailable?: boolean;
}): RuntimeTransparency {
  const coverageSignals = [...baseCoverageSignals(input.readinessState)];
  const evidenceTypes = ['published_generation', 'runtime_health'];
  let note: string | undefined;

  if (!input.suitableForAgentWorkflows) {
    coverageSignals.push('missing_graph_evidence');
    note = 'State is grounded, but agent-safe graph coverage is degraded.';
  }

  if (input.searchHelpersAvailable === false) {
    coverageSignals.push('missing_graph_evidence');
    note = 'Search helpers are incomplete, so search-backed coverage is degraded.';
  }

  if (input.readinessState === 'stale' && !note) {
    note = 'Published state exists, but freshness is behind the current repo or search snapshot.';
  }

  const coverage = input.suitableForAgentWorkflows && input.searchHelpersAvailable !== false
    ? coverageFromReadiness(input.readinessState)
    : input.readinessState === 'stale'
      ? 'stale'
      : 'partial';

  return {
    resultKind: 'exact',
    coverage,
    coverageSignals: normalizeCoverageSignals(coverage, coverageSignals),
    evidenceTypes: dedupe(evidenceTypes),
    ...(note ? { note } : {}),
  };
}

export function assessIndexTransparency(input: {
  readinessState: RuntimeReadinessState;
  hasWarnings: boolean;
}): RuntimeTransparency {
  const coverageSignals = [...baseCoverageSignals(input.readinessState)];
  const evidenceTypes = ['published_generation', 'runtime_health', 'search_sync'];
  let note: string | undefined;

  if (input.readinessState === 'stale') {
    note = 'Published generation exists, but freshness or search synchronization is still behind.';
  } else if (input.readinessState === 'inconsistent') {
    note = 'Generation was produced, but runtime coverage is incomplete or contradictory.';
  } else if (input.readinessState === 'unknown') {
    note = 'Indexing did not establish a trustworthy published state yet.';
  } else if (input.hasWarnings) {
    coverageSignals.push('partial');
    note = 'Generation is published, but some supporting evidence was rebuilt conservatively.';
  }

  const coverage =
    input.readinessState === 'ready' && input.hasWarnings ? 'partial' : coverageFromReadiness(input.readinessState);

  return {
    resultKind: 'exact',
    coverage,
    coverageSignals: normalizeCoverageSignals(coverage, coverageSignals),
    evidenceTypes: dedupe(evidenceTypes),
    ...(note ? { note } : {}),
  };
}

export function assessExploreTransparency(input: {
  readinessState: RuntimeReadinessState;
  primarySymbolResolved: boolean;
  ambiguityDetected: boolean;
  candidateCount: number;
  relatedFileCount: number;
  health: Pick<IndexHealthSummary, 'suitableForAgentWorkflows'>;
}): RuntimeTransparency {
  const evidenceTypes: string[] = [];
  const coverageSignals = [...baseCoverageSignals(input.readinessState)];
  let resultKind: RuntimeResultKind;
  let note: string | undefined;

  if (input.primarySymbolResolved) {
    evidenceTypes.push('symbol_index');
    resultKind = input.ambiguityDetected ? 'inferred' : 'exact';
  } else if (input.candidateCount > 0) {
    resultKind = 'heuristic';
    evidenceTypes.push('ranked_candidates');
  } else {
    resultKind = 'heuristic';
    evidenceTypes.push('symbol_index');
  }

  if (input.relatedFileCount > 0) {
    evidenceTypes.push('related_files');
  }

  if (input.ambiguityDetected || input.candidateCount > 1) {
    coverageSignals.push('ambiguous_match', 'name_collision_risk');
    if (!note) {
      note = 'Same-name candidates remain; the chosen target is ranked, not guaranteed exact.';
    }
  }

  if (input.relatedFileCount > 0) {
    coverageSignals.push('partial');
    if (!note && input.primarySymbolResolved) {
      note = 'Related files are nearby context, not guaranteed direct consumers.';
    }
  }

  if (!input.health.suitableForAgentWorkflows) {
    coverageSignals.push('missing_graph_evidence');
    if (!note) {
      note = 'Coverage is degraded because graph evidence is incomplete for agent-safe workflows.';
    }
  }

  if (!input.primarySymbolResolved && !note) {
    note = 'No exact symbol match was confirmed from the current index.';
  }

  const coverage =
    input.readinessState === 'ready' && (input.relatedFileCount > 0 || !input.primarySymbolResolved)
      ? 'partial'
      : coverageFromReadiness(input.readinessState);

  return {
    resultKind,
    coverage,
    coverageSignals: normalizeCoverageSignals(coverage, coverageSignals),
    evidenceTypes: dedupe(evidenceTypes),
    ...(note ? { note } : {}),
  };
}
