import type { ExecutionContext, RuntimeCapabilityName, RuntimeResponse } from '../runtime/index.js';

export interface CliGlobalOptions {
  repo?: string;
  json: boolean;
  debug: boolean;
}

export interface CliCommand {
  capability: RuntimeCapabilityName;
  request: Record<string, unknown>;
  executionContext: Partial<ExecutionContext>;
  renderResult: boolean;
}

export interface ParsedCliResult {
  command: CliCommand;
}

export type RenderableRuntimeResponse = RuntimeResponse<unknown>;
