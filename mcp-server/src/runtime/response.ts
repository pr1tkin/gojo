import type {
  RuntimeCapabilityName,
  RuntimeExecutionMode,
  RuntimeFinding,
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
    confidence: options.confidence ?? 'medium',
    trust: options.trust ?? options.confidence ?? 'medium',
  };
}
