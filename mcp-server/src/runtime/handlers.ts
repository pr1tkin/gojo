import { getCurrentIndexHealth } from '../indexing/health.js';
import { loadCurrentGenerationState } from '../indexing/generation-store.js';
import { refreshIndexes } from '../indexing/refresh.js';
import { getSymbolExplorationContext } from '../orchestrator/index.js';
import type { RuntimeCapabilityHandler } from './types.js';
import {
  type ExploreComponentRequest,
  type ExploreComponentResponse,
  type GetProductVersionRequest,
  type GetProductVersionResponse,
  type IndexRepoRequest,
  type IndexRepoResponse,
  type RefreshRepoRequest,
  type RefreshRepoResponse,
  type RunHealthChecksRequest,
  type RunHealthChecksResponse,
  type ServeMCPRequest,
  type ServeMCPResponse,
} from './types.js';
import { createRuntimeResponse } from './response.js';
import { assessRuntimeStateFromHealth, detectRepositoryDrift } from './trust.js';
import { serveMcpRuntime } from './mcp-service.js';
import { inspectSearchRuntime } from './search-service.js';

export const getProductVersionHandler: RuntimeCapabilityHandler<
  GetProductVersionRequest,
  GetProductVersionResponse
> = {
  capability: 'GetProductVersion',
  executionMode: 'one_shot',
  async execute(_request, context) {
    const identity = context.dependencies.config.product.identity;

    return createRuntimeResponse({
      capability: 'GetProductVersion',
      executionMode: 'one_shot',
      summary: {
        title: identity.name,
        text: `${identity.name} v${identity.version}`,
      },
      findings: [
        {
          id: 'product-version',
          title: 'Product version',
          summary: `${identity.name} ${identity.version} using packaging model ${identity.packagingModel}.`,
        },
      ],
      relatedEntities: [
        {
          kind: 'artifact',
          name: 'package-root',
          path: context.dependencies.config.product.paths.packageRoot,
        },
      ],
      signals: [
        { name: 'version', value: identity.version, importance: 'high' },
        { name: 'packaging_model', value: identity.packagingModel, importance: 'medium' },
      ],
      machinePayload: {
        name: identity.name,
        version: identity.version,
      },
      trustLevel: 'high',
      readinessState: 'ready',
      confidence: 'high',
      trust: 'high',
    });
  },
};

function resolveRepoId(
  requestRepoId: string | undefined,
  contextRepoId: string | undefined,
): string | undefined {
  return requestRepoId ?? contextRepoId;
}

function resolveReposRoot(repoPath: string | undefined, defaultReposRoot: string): string {
  return repoPath ?? defaultReposRoot;
}

function buildStateSummaryText(title: string, explanation: string): string {
  return `State: ${title} - ${explanation}`;
}

function dedupeWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)];
}

function prepareWarnings(warnings: string[]): string[] {
  return dedupeWarnings(warnings.map(toProductWarning));
}

function toProductWarning(warning: string): string {
  if (warning.startsWith('Zoekt refresh snapshot coordination marker is missing')) {
    return 'Search index has not synchronized with the latest Gojo generation yet.';
  }

  if (warning.startsWith('Search helper not found')) {
    return 'Bundled search helpers are missing from this Gojo installation.';
  }

  if (warning === 'consistency report is unavailable for the current generation') {
    return 'Consistency maintenance has not produced a report for the current generation yet.';
  }

  if (
    warning ===
    'code graph and UI artifacts rebuild globally on changed generations to keep cross-file resolution deterministic'
  ) {
    return 'Cross-file graph data was rebuilt conservatively for this generation.';
  }

  return warning;
}

function scopeHealthWarnings(warnings: string[], repoPath: string | undefined): string[] {
  const normalizedWarnings = prepareWarnings(warnings);

  if (!repoPath) {
    return normalizedWarnings;
  }

  const repoName = repoPath.split(/[/\\]/).filter(Boolean).at(-1) ?? repoPath;
  const scopedWarnings = normalizedWarnings.filter(
    (warning) =>
      warning.includes(repoName) ||
      warning.includes(repoPath) ||
      warning.startsWith('State is stale because') ||
      warning.includes('Bundled search helpers') ||
      warning.includes('Search index has not synchronized') ||
      warning.includes('Consistency maintenance') ||
      warning.includes('Required runtime artifacts'),
  );

  return dedupeWarnings(scopedWarnings.length > 0 ? scopedWarnings : normalizedWarnings);
}

export const indexRepoHandler: RuntimeCapabilityHandler<IndexRepoRequest, IndexRepoResponse> = {
  capability: 'IndexRepo',
  executionMode: 'one_shot',
  async execute(request, context) {
    const repoPath = request.repo?.repoPath ?? context.executionContext.repoTarget?.repoPath;
    const reposRoot = resolveReposRoot(
      repoPath,
      context.dependencies.config.reposRoot,
    );
    const result = await refreshIndexes(reposRoot, {
      logger: context.dependencies.logger,
    });
    const [health, generationState] = await Promise.all([
      getCurrentIndexHealth(),
      loadCurrentGenerationState().catch(() => null),
    ]);
    const drift = await detectRepositoryDrift({
      repoPath,
      generationCreatedAt: generationState?.createdAt,
    });
    const runtimeState = assessRuntimeStateFromHealth(health, {
      additionalWarnings: drift.warning ? [drift.warning] : [],
      repoPath,
    });

    return createRuntimeResponse({
      capability: 'IndexRepo',
      executionMode: 'one_shot',
      summary: {
        title: 'Index completed',
        text: `${buildStateSummaryText(runtimeState.stateSummary, runtimeState.stateExplanation)} Indexed generation ${result.diagnostics.generationId} for ${reposRoot}.`,
      },
      findings: [
        {
          id: 'generation',
          title: 'Published generation',
          summary: `Generation ${result.diagnostics.generationId} is available for runtime consumers.`,
        },
        {
          id: 'readiness-state',
          title: `State: ${runtimeState.stateSummary}`,
          summary: runtimeState.stateExplanation,
          severity:
            runtimeState.readinessState === 'ready'
              ? 'info'
              : runtimeState.readinessState === 'inconsistent'
                ? 'error'
                : 'warning',
        },
      ],
      relatedEntities: [
        ...(request.repo?.repoId || repoPath
          ? [
              {
                kind: 'repo' as const,
                id: request.repo?.repoId ?? context.executionContext.repoTarget?.repoId,
                name:
                  request.repo?.repoId ??
                  context.executionContext.repoTarget?.repoId ??
                  reposRoot.split(/[/\\]/).filter(Boolean).at(-1) ??
                  reposRoot,
                ...(repoPath ? { path: repoPath } : {}),
              },
            ]
          : []),
        {
          kind: 'artifact',
          name: 'repos-root',
          path: reposRoot,
        },
      ],
      signals: [
        { name: 'symbols', value: result.diagnostics.counts.symbols, importance: 'high' },
        { name: 'patterns', value: result.diagnostics.counts.patterns, importance: 'medium' },
        { name: 'graph_edges', value: result.diagnostics.counts.graphEdges, importance: 'medium' },
        { name: 'state', value: runtimeState.stateSummary, importance: 'high' },
      ],
      warnings: prepareWarnings([...result.diagnostics.warnings, ...runtimeState.warnings]),
      details: {
        status: result.diagnostics.status,
        search: result.diagnostics.search,
        stateExplanation: runtimeState.stateExplanation,
        ...(runtimeState.recommendedAction ? { recommendedAction: runtimeState.recommendedAction } : {}),
        // TODO(phase9): split pure index bootstrap from refresh semantics once the runtime owns both flows.
      },
      machinePayload: {
        reposRoot,
        generationId: result.diagnostics.generationId,
        readinessState: runtimeState.readinessState,
        stateExplanation: runtimeState.stateExplanation,
        ...(runtimeState.recommendedAction ? { recommendedAction: runtimeState.recommendedAction } : {}),
        counts: {
          symbols: result.diagnostics.counts.symbols,
          patterns: result.diagnostics.counts.patterns,
          graphEdges: result.diagnostics.counts.graphEdges,
          uiCompositionEdges: result.diagnostics.counts.uiCompositionEdges,
          uiPropUsages: result.diagnostics.counts.uiPropUsages,
        },
      },
      trustLevel: runtimeState.trustLevel,
      readinessState: runtimeState.readinessState,
      confidence: runtimeState.confidence,
      trust: runtimeState.trustLevel,
    });
  },
};

export const refreshRepoHandler: RuntimeCapabilityHandler<RefreshRepoRequest, RefreshRepoResponse> = {
  capability: 'RefreshRepo',
  executionMode: 'one_shot',
  async execute(request, context) {
    const repoPath = request.repo?.repoPath ?? context.executionContext.repoTarget?.repoPath;
    const reposRoot = resolveReposRoot(
      repoPath,
      context.dependencies.config.reposRoot,
    );
    const result = await refreshIndexes(reposRoot, {
      logger: context.dependencies.logger,
    });
    const [health, generationState] = await Promise.all([
      getCurrentIndexHealth(),
      loadCurrentGenerationState().catch(() => null),
    ]);
    const drift = await detectRepositoryDrift({
      repoPath,
      generationCreatedAt: generationState?.createdAt,
    });
    const runtimeState = assessRuntimeStateFromHealth(health, {
      additionalWarnings: drift.warning ? [drift.warning] : [],
      repoPath,
    });

    return createRuntimeResponse({
      capability: 'RefreshRepo',
      executionMode: 'one_shot',
      summary: {
        title: 'Refresh completed',
        text: `${buildStateSummaryText(runtimeState.stateSummary, runtimeState.stateExplanation)} Refreshed ${reposRoot} with generation ${result.diagnostics.generationId}.`,
      },
      findings: [
        {
          id: 'delta',
          title: 'Refresh delta',
          summary: `${result.diagnostics.delta.added.length} added, ${result.diagnostics.delta.modified.length} modified, ${result.diagnostics.delta.deleted.length} deleted.`,
        },
        {
          id: 'readiness-state',
          title: `State: ${runtimeState.stateSummary}`,
          summary: runtimeState.stateExplanation,
          severity:
            runtimeState.readinessState === 'ready'
              ? 'info'
              : runtimeState.readinessState === 'inconsistent'
                ? 'error'
                : 'warning',
        },
      ],
      relatedEntities: [
        {
          kind: 'artifact',
          name: 'repos-root',
          path: reposRoot,
        },
      ],
      signals: [
        { name: 'added', value: result.diagnostics.delta.added.length, importance: 'medium' },
        { name: 'modified', value: result.diagnostics.delta.modified.length, importance: 'high' },
        { name: 'deleted', value: result.diagnostics.delta.deleted.length, importance: 'medium' },
        { name: 'search_status', value: result.diagnostics.search.status, importance: 'high' },
        { name: 'state', value: runtimeState.stateSummary, importance: 'high' },
      ],
      warnings: prepareWarnings([...result.diagnostics.warnings, ...runtimeState.warnings]),
      details: {
        search: result.diagnostics.search,
        rebuild: result.diagnostics.rebuild,
        cleanup: result.diagnostics.cleanup,
        stateExplanation: runtimeState.stateExplanation,
        ...(runtimeState.recommendedAction ? { recommendedAction: runtimeState.recommendedAction } : {}),
      },
      machinePayload: {
        reposRoot,
        generationId: result.diagnostics.generationId,
        status: result.diagnostics.status,
        readinessState: runtimeState.readinessState,
        stateExplanation: runtimeState.stateExplanation,
        ...(runtimeState.recommendedAction ? { recommendedAction: runtimeState.recommendedAction } : {}),
        delta: {
          added: result.diagnostics.delta.added.length,
          modified: result.diagnostics.delta.modified.length,
          deleted: result.diagnostics.delta.deleted.length,
        },
        warnings: result.diagnostics.warnings,
      },
      trustLevel: runtimeState.trustLevel,
      readinessState: runtimeState.readinessState,
      confidence: runtimeState.confidence,
      trust: runtimeState.trustLevel,
    });
  },
};

export const exploreComponentHandler: RuntimeCapabilityHandler<
  ExploreComponentRequest,
  ExploreComponentResponse
> = {
  capability: 'ExploreComponent',
  executionMode: 'one_shot',
  async execute(request, context) {
    const repoId = resolveRepoId(
      request.repo?.repoId,
      context.executionContext.repoTarget?.repoId,
    );
    const repoPath = request.repo?.repoPath ?? context.executionContext.repoTarget?.repoPath;
    const [result, health, generationState] = await Promise.all([
      getSymbolExplorationContext(request.target, {
        repo: repoId,
        limit: request.limit,
        relatedLimit: request.relatedLimit,
      }),
      getCurrentIndexHealth(),
      loadCurrentGenerationState().catch(() => null),
    ]);
    const drift = await detectRepositoryDrift({
      repoPath,
      generationCreatedAt: generationState?.createdAt,
    });
    const runtimeState = assessRuntimeStateFromHealth(health, {
      additionalWarnings: drift.warning ? [drift.warning] : [],
      repoPath,
    });

    const primarySymbol = result.primarySymbol;
    const primaryFile = result.primaryFile;
    const ambiguityDetected = result.summary.totalCandidateCount > 1;
    const warnings = [
      ...(ambiguityDetected
        ? ['Target resolution is ambiguous; runtime result is intentionally compact.']
        : []),
      ...runtimeState.warnings,
    ];
    const finalTrustLevel =
      primarySymbol && !ambiguityDetected && runtimeState.trustLevel === 'high'
        ? 'high'
        : primarySymbol && runtimeState.trustLevel === 'high'
          ? 'medium'
          : runtimeState.trustLevel;
    const finalConfidence =
      primarySymbol && !ambiguityDetected && runtimeState.confidence === 'high'
        ? 'high'
        : primarySymbol && runtimeState.confidence === 'high'
          ? 'medium'
          : primarySymbol
            ? runtimeState.confidence
            : 'low';

    return createRuntimeResponse({
      capability: 'ExploreComponent',
      executionMode: 'one_shot',
      summary: {
        title: primarySymbol?.name ?? request.target,
        text: primarySymbol
          ? `Resolved ${primarySymbol.name} with ${result.summary.relatedFileCount} related files. ${buildStateSummaryText(runtimeState.stateSummary, runtimeState.stateExplanation)}`
          : `No exact symbol resolution was found for ${request.target}. ${buildStateSummaryText(runtimeState.stateSummary, runtimeState.stateExplanation)}`,
      },
      findings: primarySymbol
        ? [
            {
              id: primarySymbol.symbolId,
              title: primarySymbol.name,
              summary: `${primarySymbol.kind} in ${primarySymbol.filePath}`,
            },
          ]
        : [
            {
              id: 'missing-target',
              title: request.target,
              summary: 'The target could not be resolved to a primary symbol.',
              severity: 'warning',
            },
          ],
      relatedEntities: [
        ...(primaryFile
          ? [
              {
                kind: 'file' as const,
                id: primaryFile.fileId,
                name: primaryFile.filePath,
                path: primaryFile.filePath,
              },
            ]
          : []),
        ...result.relatedFiles.slice(0, 3).map((entry) => ({
          kind: 'file' as const,
          id: entry.file.fileId,
          name: entry.file.filePath,
          path: entry.file.filePath,
        })),
      ],
      signals: [
        { name: 'candidate_count', value: result.summary.totalCandidateCount, importance: 'high' },
        { name: 'related_file_count', value: result.summary.totalRelatedFileCount, importance: 'medium' },
        { name: 'ambiguity_detected', value: ambiguityDetected, importance: 'high' },
        { name: 'readiness_state', value: runtimeState.readinessState, importance: 'high' },
        { name: 'agent_workflows_ready', value: health.suitableForAgentWorkflows, importance: 'high' },
        { name: 'state', value: runtimeState.stateSummary, importance: 'high' },
      ],
      warnings,
      details: {
        query: result.query,
        repo: result.repo,
        rawSummary: result.summary,
        healthTrustState: health.trustState,
        suitableForAgentWorkflows: health.suitableForAgentWorkflows,
        stateExplanation: runtimeState.stateExplanation,
        ...(generationState?.createdAt ? { lastIndexedAt: generationState.createdAt } : {}),
        // TODO(phase9): route this capability through runtime-owned response normalization instead of direct summarization.
      },
      machinePayload: {
        query: request.target,
        ...(primaryFile?.repoId ? { repoId: primaryFile.repoId } : {}),
        ...(primaryFile?.filePath ? { filePath: primaryFile.filePath } : {}),
        ...(primarySymbol?.name ? { symbolName: primarySymbol.name } : {}),
        candidateCount: result.summary.totalCandidateCount,
        relatedFileCount: result.summary.totalRelatedFileCount,
        readinessState: runtimeState.readinessState,
        stateExplanation: runtimeState.stateExplanation,
        ...(generationState?.createdAt ? { lastIndexedAt: generationState.createdAt } : {}),
      },
      trustLevel: primarySymbol ? finalTrustLevel : runtimeState.trustLevel,
      readinessState: runtimeState.readinessState,
      confidence: finalConfidence,
      trust: primarySymbol ? finalTrustLevel : runtimeState.trustLevel,
    });
  },
};

export const runHealthChecksHandler: RuntimeCapabilityHandler<
  RunHealthChecksRequest,
  RunHealthChecksResponse
> = {
  capability: 'RunHealthChecks',
  executionMode: 'one_shot',
  async execute(request, context) {
    const repoPath = request.repo?.repoPath ?? context.executionContext.repoTarget?.repoPath;
    const [result, generationState, searchRuntime] = await Promise.all([
      getCurrentIndexHealth(),
      loadCurrentGenerationState().catch(() => null),
      inspectSearchRuntime(context.dependencies.config),
    ]);
    const drift = await detectRepositoryDrift({
      repoPath,
      generationCreatedAt: generationState?.createdAt,
    });
    const runtimeState = assessRuntimeStateFromHealth(result, {
      additionalWarnings: drift.warning ? [drift.warning] : [],
      repoPath,
    });
    const repoLabel =
      request.repo?.repoId ??
      context.executionContext.repoTarget?.repoId ??
      repoPath?.split(/[/\\]/).filter(Boolean).at(-1);
    const searchWarnings =
      context.dependencies.config.search.mode === 'packaged' &&
      (!searchRuntime.webserverHelperAvailable || !searchRuntime.indexerHelperAvailable)
        ? [
            'Search helper not found. This Gojo installation is incomplete.',
            ...searchRuntime.helperWarnings,
          ]
        : searchRuntime.helperWarnings;
    const scopedWarnings = scopeHealthWarnings(
      [...result.warnings, ...result.errors, ...runtimeState.warnings, ...searchWarnings],
      repoPath,
    );

    return createRuntimeResponse({
      capability: 'RunHealthChecks',
      executionMode: 'one_shot',
      summary: {
        title: repoLabel ? `Health for ${repoLabel}` : 'Runtime health',
        text: buildStateSummaryText(runtimeState.stateSummary, runtimeState.stateExplanation),
      },
      findings: [
        {
          id: 'trust-state',
          title: `State: ${runtimeState.stateSummary}`,
          summary: runtimeState.stateExplanation,
          severity: result.errors.length > 0 ? 'error' : result.warnings.length > 0 ? 'warning' : 'info',
        },
        ...(repoPath
          ? [
              {
                id: 'repo-scope',
                title: 'Repo scope',
                summary: `${repoLabel ?? repoPath} (${repoPath})`,
                severity: 'info' as const,
              },
            ]
          : []),
      ],
      relatedEntities: [
        ...(repoPath
          ? [
              {
                kind: 'repo' as const,
                id: request.repo?.repoId ?? context.executionContext.repoTarget?.repoId,
                name: repoLabel ?? repoPath,
                path: repoPath,
              },
            ]
          : []),
        ...(result.reposRoot
          ? [
              {
                kind: 'artifact' as const,
                name: 'repos-root',
                path: result.reposRoot,
              },
            ]
          : []),
      ],
      signals: [
        { name: 'state', value: runtimeState.stateSummary, importance: 'high' },
        { name: 'trust_state', value: result.trustState, importance: 'high' },
        { name: 'suitable_for_agent_workflows', value: result.suitableForAgentWorkflows, importance: 'high' },
        { name: 'warning_count', value: scopedWarnings.length, importance: 'medium' },
        { name: 'error_count', value: result.errors.length, importance: 'high' },
        { name: 'search_endpoint_reachable', value: searchRuntime.endpointReachable, importance: 'high' },
        { name: 'search_runtime_mode', value: searchRuntime.mode, importance: 'medium' },
      ],
      warnings: scopedWarnings,
      details: {
        reasons: result.reasons,
        recentActivity: result.recentActivity,
        search: result.search,
        searchHelpers: searchRuntime,
        stateExplanation: runtimeState.stateExplanation,
        ...(runtimeState.recommendedAction ? { recommendedAction: runtimeState.recommendedAction } : {}),
      },
      machinePayload: {
        trustState: result.trustState,
        suitableForAgentWorkflows: result.suitableForAgentWorkflows,
        generationId: result.generationId,
        generationStatus: result.generationStatus,
        readinessState: runtimeState.readinessState,
        recommendedAction: runtimeState.recommendedAction,
        searchHelpers: searchRuntime,
      },
      trustLevel: runtimeState.trustLevel,
      readinessState: runtimeState.readinessState,
      confidence: runtimeState.confidence,
      trust: runtimeState.trustLevel,
    });
  },
};

export const serveMcpHandler: RuntimeCapabilityHandler<ServeMCPRequest, ServeMCPResponse> = {
  capability: 'ServeMCP',
  executionMode: 'long_running',
  async execute(request, context) {
    return serveMcpRuntime(context, {
      transport: request.transport ?? 'stdio',
    });
  },
};
