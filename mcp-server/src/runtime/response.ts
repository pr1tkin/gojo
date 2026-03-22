import type {
  RuntimeCapabilityName,
  RuntimeExecutionMode,
  RuntimeFinding,
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
  relatedEntities?: RuntimeRelatedEntity[];
  signals?: RuntimeSignal[];
  warnings?: string[];
  details?: Record<string, unknown>;
  confidence?: RuntimeTrustLevel;
  trust?: RuntimeTrustLevel;
  trustLevel?: RuntimeTrustLevel;
  readinessState?: RuntimeReadinessState;
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
  };
}
