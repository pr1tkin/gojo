import type { ExecutionContext, RuntimeCapabilityName, RuntimeResponse } from '../runtime/index.js';

export interface CliGlobalOptions {
  repo?: string;
  json: boolean;
  debug: boolean;
}

export interface CliCommand {
  name: string;
  capability: RuntimeCapabilityName;
  request: Record<string, unknown>;
  executionContext: Partial<ExecutionContext>;
  renderResult: boolean;
}

export interface ParsedCliResult {
  command: CliCommand;
}

export type RenderableRuntimeResponse = RuntimeResponse<unknown>;

export type CliErrorCode =
  | 'invalid_usage'
  | 'missing_index'
  | 'runtime_failure'
  | 'health_recovery';

export interface CliStructuredError {
  ok: false;
  error: {
    code: CliErrorCode;
    title: string;
    reason: string;
    how_to_fix: string[];
    suggested_commands: string[];
    details?: Record<string, unknown>;
  };
}
