import type { AppConfig } from '../types.js';

// The runtime layer sits between engine services and public surfaces.
// It owns capability contracts, execution context, handler wiring, and
// the shared response envelope used by future CLI and MCP adapters.

export type RuntimeOutputMode = 'human' | 'json';

export type RuntimeTrustLevel = 'high' | 'medium' | 'low' | 'degraded';

export type RuntimeReadinessState = 'ready' | 'stale' | 'inconsistent' | 'unknown';

export type RuntimeExecutionMode = 'one_shot' | 'long_running';

export interface RepoTarget {
  repoId?: string;
  repoPath?: string;
}

export interface ExecutionContext {
  repoTarget?: RepoTarget;
  debug: boolean;
  outputMode: RuntimeOutputMode;
  correlationId?: string;
}

export interface RuntimeSummary {
  title: string;
  text: string;
}

export interface RuntimeFinding {
  id: string;
  title: string;
  summary: string;
  severity?: 'info' | 'warning' | 'error';
}

export interface RuntimeRelatedEntity {
  kind: 'repo' | 'file' | 'symbol' | 'service' | 'artifact' | 'process';
  id?: string;
  name: string;
  path?: string;
}

export interface RuntimeSignal {
  name: string;
  value: string | number | boolean | null;
  importance?: 'high' | 'medium' | 'low';
}

export interface RuntimeResponse<TMachinePayload = unknown> {
  capability: RuntimeCapabilityName;
  executionMode: RuntimeExecutionMode;
  summary: RuntimeSummary;
  findings: RuntimeFinding[];
  related_entities: RuntimeRelatedEntity[];
  signals: RuntimeSignal[];
  warnings: string[];
  details?: Record<string, unknown>;
  machine_payload: TMachinePayload;
  trust_level: RuntimeTrustLevel;
  readiness_state: RuntimeReadinessState;
  confidence: RuntimeTrustLevel;
  trust: RuntimeTrustLevel;
}

export interface RuntimeLogger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export interface RuntimeDependencies {
  config: AppConfig;
  logger?: RuntimeLogger;
}

export interface RuntimeHandlerContext {
  executionContext: ExecutionContext;
  dependencies: RuntimeDependencies;
}

export interface RuntimeCapabilityHandler<TRequest, TResponse extends RuntimeResponse<unknown>> {
  readonly capability: RuntimeCapabilityName;
  readonly executionMode: RuntimeExecutionMode;
  execute: (request: TRequest, context: RuntimeHandlerContext) => Promise<TResponse>;
}

export type RuntimeCapabilityName =
  | 'GetProductVersion'
  | 'UpgradeProduct'
  | 'IndexRepo'
  | 'RefreshRepo'
  | 'ExploreComponent'
  | 'ServeMCP'
  | 'RunHealthChecks'
  | 'BuildChangeContext'
  | 'FindPrecedents'
  | 'ComputeImpact'
  | 'RunDoctor'
  | 'TraceFlow';

export interface GetProductVersionRequest {
  checkLatest?: boolean;
}

export interface GetProductVersionMachinePayload {
  product: string;
  version: string;
  git_sha: string;
  build_timestamp: string;
  platform: string;
  arch: string;
  packaging_mode: string;
  helper: {
    mode: string;
    paths: string[];
    detected: boolean;
  };
  is_dev: boolean;
  latest_version?: string;
  update_available?: boolean;
}

export type GetProductVersionResponse = RuntimeResponse<GetProductVersionMachinePayload>;

export interface UpgradeProductRequest {}

export interface UpgradeProductMachinePayload {
  current_version: string;
  latest_version: string;
  install_dir: string;
  updated: boolean;
}

export type UpgradeProductResponse = RuntimeResponse<UpgradeProductMachinePayload>;

export interface IndexRepoRequest {
  repo?: RepoTarget;
}

export interface IndexRepoMachinePayload {
  reposRoot: string;
  generationId: string;
  readinessState?: RuntimeReadinessState;
  stateExplanation?: string;
  recommendedAction?: string;
  counts: {
    symbols: number;
    patterns: number;
    graphEdges: number;
    uiCompositionEdges: number;
    uiPropUsages: number;
  };
}

export type IndexRepoResponse = RuntimeResponse<IndexRepoMachinePayload>;

export interface RefreshRepoRequest {
  repo?: RepoTarget;
}

export interface RefreshRepoMachinePayload {
  reposRoot: string;
  generationId: string;
  status: string;
  readinessState?: RuntimeReadinessState;
  stateExplanation?: string;
  recommendedAction?: string;
  delta: {
    added: number;
    modified: number;
    deleted: number;
  };
  warnings: string[];
}

export type RefreshRepoResponse = RuntimeResponse<RefreshRepoMachinePayload>;

export interface ExploreComponentRequest {
  target: string;
  repo?: RepoTarget;
  limit?: number;
  relatedLimit?: number;
}

export interface ExploreComponentMachinePayload {
  query: string;
  repoId?: string;
  filePath?: string;
  symbolName?: string;
  candidateCount: number;
  relatedFileCount: number;
  readinessState?: RuntimeReadinessState;
  lastIndexedAt?: string;
  stateExplanation?: string;
}

export type ExploreComponentResponse = RuntimeResponse<ExploreComponentMachinePayload>;

export interface ServeMCPRequest {
  transport?: 'stdio';
}

export interface ServeMCPMachinePayload {
  transport: 'stdio';
  status: 'starting' | 'serving' | 'failed';
  lifecycle: 'startup_complete' | 'serving';
  searchBaseUrl?: string;
  searchReachable?: boolean;
}

export type ServeMCPResponse = RuntimeResponse<ServeMCPMachinePayload>;

export interface RunHealthChecksRequest {
  repo?: RepoTarget;
}

export interface RunHealthChecksMachinePayload {
  trustState: string;
  suitableForAgentWorkflows: boolean;
  generationId?: string;
  generationStatus: string;
  readinessState?: RuntimeReadinessState;
  recommendedAction?: string;
}

export type RunHealthChecksResponse = RuntimeResponse<RunHealthChecksMachinePayload>;

export interface BuildChangeContextRequest {
  target: string;
  repo?: RepoTarget;
}

export type BuildChangeContextResponse = RuntimeResponse;

export interface FindPrecedentsRequest {
  target: string;
  repo?: RepoTarget;
}

export type FindPrecedentsResponse = RuntimeResponse;

export interface ComputeImpactRequest {
  target: string;
  repo?: RepoTarget;
}

export type ComputeImpactResponse = RuntimeResponse;

export interface RunDoctorRequest {
  repo?: RepoTarget;
}

export type RunDoctorResponse = RuntimeResponse;

export interface TraceFlowRequest {
  target: string;
  repo?: RepoTarget;
}

export type TraceFlowResponse = RuntimeResponse;

export interface RuntimeCapabilityRequestMap {
  GetProductVersion: GetProductVersionRequest;
  UpgradeProduct: UpgradeProductRequest;
  IndexRepo: IndexRepoRequest;
  RefreshRepo: RefreshRepoRequest;
  ExploreComponent: ExploreComponentRequest;
  ServeMCP: ServeMCPRequest;
  RunHealthChecks: RunHealthChecksRequest;
  BuildChangeContext: BuildChangeContextRequest;
  FindPrecedents: FindPrecedentsRequest;
  ComputeImpact: ComputeImpactRequest;
  RunDoctor: RunDoctorRequest;
  TraceFlow: TraceFlowRequest;
}

export interface RuntimeCapabilityResponseMap {
  GetProductVersion: GetProductVersionResponse;
  UpgradeProduct: UpgradeProductResponse;
  IndexRepo: IndexRepoResponse;
  RefreshRepo: RefreshRepoResponse;
  ExploreComponent: ExploreComponentResponse;
  ServeMCP: ServeMCPResponse;
  RunHealthChecks: RunHealthChecksResponse;
  BuildChangeContext: BuildChangeContextResponse;
  FindPrecedents: FindPrecedentsResponse;
  ComputeImpact: ComputeImpactResponse;
  RunDoctor: RunDoctorResponse;
  TraceFlow: TraceFlowResponse;
}

export interface RuntimeCapabilityDefinition {
  name: RuntimeCapabilityName;
  executionMode: RuntimeExecutionMode;
  description: string;
  implemented: boolean;
}
