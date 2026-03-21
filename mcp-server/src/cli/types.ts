import type { ExecutionContext, RuntimeCapabilityName, RuntimeResponse } from '../runtime/index.js';
import type { AppConfig } from '../types.js';

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
  repoInput?: string;
  indexPathInput?: string;
}

export interface ParsedCliResult {
  command?: CliCommand;
  helpText?: string;
}

export type RenderableRuntimeResponse = RuntimeResponse<unknown>;

export interface RepoResolutionContext {
  config: AppConfig;
  cwd: string;
}

export interface ResolvedRepoTarget {
  repoId?: string;
  repoPath?: string;
}

export type CliErrorCode =
  | 'invalid_usage'
  | 'invalid_repo_target'
  | 'missing_index'
  | 'missing_search_helper'
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
