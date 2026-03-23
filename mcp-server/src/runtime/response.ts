import type {
  RuntimeCoverage,
  RuntimeCoverageSignal,
  RuntimeCapabilityName,
  RuntimeExecutionMode,
  RuntimeFinding,
  RuntimeResultKind,
  RuntimeReadinessState,
  RuntimeRelatedEntity,
  RuntimeResponse,
  RuntimeSignal,
  RuntimeSummary,
  RuntimeTrustLevel,
} from './types.js';

export interface CreateRuntimeResponseOptions<TMachinePayload> {
  capability: RuntimeCapabilityName;
  executionMode: RuntimeExecutionMode;
  summary: RuntimeSummary;
  machinePayload: TMachinePayload;
  findings?: RuntimeFinding[];
  // Deprecated compatibility surface. Keep derived from canonical buckets only.
  relatedEntities?: RuntimeRelatedEntity[];
  signals?: RuntimeSignal[];
  warnings?: string[];
  details?: Record<string, unknown>;
  confidence?: RuntimeTrustLevel;
  trust?: RuntimeTrustLevel;
  trustLevel?: RuntimeTrustLevel;
  readinessState?: RuntimeReadinessState;
  resultKind?: RuntimeResultKind;
  coverage?: RuntimeCoverage;
  coverageSignals?: RuntimeCoverageSignal[];
  evidenceTypes?: string[];
  note?: string;
}

export function createRuntimeResponse<TMachinePayload>(
  options: CreateRuntimeResponseOptions<TMachinePayload>,
): RuntimeResponse<TMachinePayload> {
  return {
    capability: options.capability,
    executionMode: options.executionMode,
    summary: options.summary,
    findings: options.findings ?? [],
    related_entities: options.relatedEntities ?? [],
    signals: options.signals ?? [],
    warnings: options.warnings ?? [],
    ...(options.details ? { details: options.details } : {}),
    machine_payload: options.machinePayload,
    trust_level: options.trustLevel ?? options.trust ?? options.confidence ?? 'medium',
    readiness_state: options.readinessState ?? 'unknown',
    confidence: options.confidence ?? 'medium',
    trust: options.trust ?? options.confidence ?? 'medium',
    result_kind: options.resultKind ?? 'exact',
    coverage: options.coverage ?? 'complete',
    coverage_signals: options.coverageSignals ?? ['complete'],
    evidence_types: options.evidenceTypes ?? [],
    ...(options.note ? { note: options.note } : {}),
  };
}
