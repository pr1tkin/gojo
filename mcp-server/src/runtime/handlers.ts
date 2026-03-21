import { getCurrentIndexHealth } from '../indexing/health.js';
import { loadCurrentGenerationState } from '../indexing/generation-store.js';
import { refreshIndexes } from '../indexing/refresh.js';
import { getSymbolExplorationContext } from '../orchestrator/index.js';
import type { RuntimeCapabilityHandler } from './types.js';
import {
  type ExploreComponentRequest,
  type ExploreComponentResponse,
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
import { assessTrustFromHealth, detectRepositoryDrift } from './trust.js';

function resolveRepoId(
  requestRepoId: string | undefined,
  contextRepoId: string | undefined,
): string | undefined {
  return requestRepoId ?? contextRepoId;
}

function resolveReposRoot(repoPath: string | undefined, defaultReposRoot: string): string {
  return repoPath ?? defaultReposRoot;
}

export const indexRepoHandler: RuntimeCapabilityHandler<IndexRepoRequest, IndexRepoResponse> = {
  capability: 'IndexRepo',
  executionMode: 'one_shot',
  async execute(request, context) {
    const reposRoot = resolveReposRoot(
      request.repo?.repoPath ?? context.executionContext.repoTarget?.repoPath,
      context.dependencies.config.reposRoot,
    );
    const result = await refreshIndexes(reposRoot, {
      logger: context.dependencies.logger,
    });

    return createRuntimeResponse({
      capability: 'IndexRepo',
      executionMode: 'one_shot',
      summary: {
        title: 'Repository indexed',
        text: `Indexed generation ${result.diagnostics.generationId} for repos root ${reposRoot}.`,
      },
      findings: [
        {
          id: 'generation',
          title: 'Published generation',
          summary: `Generation ${result.diagnostics.generationId} is available for runtime consumers.`,
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
        { name: 'symbols', value: result.diagnostics.counts.symbols, importance: 'high' },
        { name: 'patterns', value: result.diagnostics.counts.patterns, importance: 'medium' },
        { name: 'graph_edges', value: result.diagnostics.counts.graphEdges, importance: 'medium' },
      ],
      warnings: result.diagnostics.warnings,
      details: {
        status: result.diagnostics.status,
        search: result.diagnostics.search,
        // TODO(phase9): split pure index bootstrap from refresh semantics once the runtime owns both flows.
      },
      machinePayload: {
        reposRoot,
        generationId: result.diagnostics.generationId,
        counts: {
          symbols: result.diagnostics.counts.symbols,
          patterns: result.diagnostics.counts.patterns,
          graphEdges: result.diagnostics.counts.graphEdges,
          uiCompositionEdges: result.diagnostics.counts.uiCompositionEdges,
          uiPropUsages: result.diagnostics.counts.uiPropUsages,
        },
      },
      trustLevel: result.diagnostics.warnings.length > 0 ? 'medium' : 'high',
      readinessState: 'ready',
      confidence: 'high',
      trust: result.diagnostics.warnings.length > 0 ? 'medium' : 'high',
    });
  },
};

export const refreshRepoHandler: RuntimeCapabilityHandler<RefreshRepoRequest, RefreshRepoResponse> = {
  capability: 'RefreshRepo',
  executionMode: 'one_shot',
  async execute(request, context) {
    const reposRoot = resolveReposRoot(
      request.repo?.repoPath ?? context.executionContext.repoTarget?.repoPath,
      context.dependencies.config.reposRoot,
    );
    const result = await refreshIndexes(reposRoot, {
      logger: context.dependencies.logger,
    });

    return createRuntimeResponse({
      capability: 'RefreshRepo',
      executionMode: 'one_shot',
      summary: {
        title: 'Repository refreshed',
        text: `Refresh completed with status ${result.diagnostics.status} for generation ${result.diagnostics.generationId}.`,
      },
      findings: [
        {
          id: 'delta',
          title: 'Refresh delta',
          summary: `${result.diagnostics.delta.added.length} added, ${result.diagnostics.delta.modified.length} modified, ${result.diagnostics.delta.deleted.length} deleted.`,
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
      ],
      warnings: result.diagnostics.warnings,
      details: {
        search: result.diagnostics.search,
        rebuild: result.diagnostics.rebuild,
        cleanup: result.diagnostics.cleanup,
      },
      machinePayload: {
        reposRoot,
        generationId: result.diagnostics.generationId,
        status: result.diagnostics.status,
        delta: {
          added: result.diagnostics.delta.added.length,
          modified: result.diagnostics.delta.modified.length,
          deleted: result.diagnostics.delta.deleted.length,
        },
        warnings: result.diagnostics.warnings,
      },
      trustLevel: result.diagnostics.search.status === 'ready' ? 'high' : 'medium',
      readinessState: result.diagnostics.search.status === 'ready' ? 'ready' : 'stale',
      confidence: result.diagnostics.status === 'committed' ? 'high' : 'medium',
      trust: result.diagnostics.search.status === 'ready' ? 'high' : 'medium',
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
    const trustAssessment = assessTrustFromHealth(health, {
      additionalWarnings: drift.warning ? [drift.warning] : [],
    });

    const primarySymbol = result.primarySymbol;
    const primaryFile = result.primaryFile;
    const ambiguityDetected = result.summary.totalCandidateCount > 1;
    const warnings = [
      ...(ambiguityDetected
        ? ['Target resolution is ambiguous; runtime result is intentionally compact.']
        : []),
      ...trustAssessment.warnings,
    ];
    const finalTrustLevel =
      primarySymbol && !ambiguityDetected && trustAssessment.trustLevel === 'high'
        ? 'high'
        : primarySymbol && trustAssessment.trustLevel === 'high'
          ? 'medium'
          : trustAssessment.trustLevel;
    const finalConfidence =
      primarySymbol && !ambiguityDetected && trustAssessment.confidence === 'high'
        ? 'high'
        : primarySymbol && trustAssessment.confidence === 'high'
          ? 'medium'
          : primarySymbol
            ? trustAssessment.confidence
            : 'low';

    return createRuntimeResponse({
      capability: 'ExploreComponent',
      executionMode: 'one_shot',
      summary: {
        title: primarySymbol?.name ?? request.target,
        text: primarySymbol
          ? `Resolved ${primarySymbol.name} with ${result.summary.relatedFileCount} related files.`
          : `No exact symbol resolution was found for ${request.target}.`,
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
        { name: 'readiness_state', value: trustAssessment.readinessState, importance: 'high' },
        { name: 'agent_workflows_ready', value: health.suitableForAgentWorkflows, importance: 'high' },
      ],
      warnings,
      details: {
        query: result.query,
        repo: result.repo,
        rawSummary: result.summary,
        healthTrustState: health.trustState,
        suitableForAgentWorkflows: health.suitableForAgentWorkflows,
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
        readinessState: trustAssessment.readinessState,
        ...(generationState?.createdAt ? { lastIndexedAt: generationState.createdAt } : {}),
      },
      trustLevel: primarySymbol ? finalTrustLevel : trustAssessment.trustLevel,
      readinessState: trustAssessment.readinessState,
      confidence: finalConfidence,
      trust: primarySymbol ? finalTrustLevel : trustAssessment.trustLevel,
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
    const [result, generationState] = await Promise.all([
      getCurrentIndexHealth(),
      loadCurrentGenerationState().catch(() => null),
    ]);
    const drift = await detectRepositoryDrift({
      repoPath,
      generationCreatedAt: generationState?.createdAt,
    });
    const trustAssessment = assessTrustFromHealth(result, {
      additionalWarnings: drift.warning ? [drift.warning] : [],
    });
    const correctiveCommand =
      result.trustState === 'stale-search' ? 'Run gojo index to refresh search and symbol data.' :
      result.trustState === 'inconsistent' ? 'Run gojo index to rebuild Gojo artifacts from a clean generation.' :
      drift.stale ? 'Run gojo index to rebuild data against the current filesystem state.' :
      result.generationStatus === 'missing' ? 'Run gojo index to create the first published generation.' :
      undefined;

    return createRuntimeResponse({
      capability: 'RunHealthChecks',
      executionMode: 'one_shot',
      summary: {
        title: 'Runtime health',
        text: `Current trust state is ${result.trustState}.`,
      },
      findings: [
        {
          id: 'trust-state',
          title: result.trustState,
          summary: result.reasons[0] ?? 'No additional health reason was recorded.',
          severity: result.errors.length > 0 ? 'error' : result.warnings.length > 0 ? 'warning' : 'info',
        },
      ],
      relatedEntities: [
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
        { name: 'trust_state', value: result.trustState, importance: 'high' },
        { name: 'suitable_for_agent_workflows', value: result.suitableForAgentWorkflows, importance: 'high' },
        { name: 'warning_count', value: result.warnings.length, importance: 'medium' },
        { name: 'error_count', value: result.errors.length, importance: 'high' },
      ],
      warnings: [...result.warnings, ...result.errors, ...trustAssessment.warnings],
      details: {
        reasons: result.reasons,
        recentActivity: result.recentActivity,
        search: result.search,
        ...(correctiveCommand ? { recommendedAction: correctiveCommand } : {}),
      },
      machinePayload: {
        trustState: result.trustState,
        suitableForAgentWorkflows: result.suitableForAgentWorkflows,
        generationId: result.generationId,
        generationStatus: result.generationStatus,
        readinessState: trustAssessment.readinessState,
        ...(correctiveCommand ? { recommendedAction: correctiveCommand } : {}),
      },
      trustLevel: trustAssessment.trustLevel,
      readinessState: trustAssessment.readinessState,
      confidence: trustAssessment.confidence,
      trust: trustAssessment.trustLevel,
    });
  },
};

export const serveMcpHandler: RuntimeCapabilityHandler<ServeMCPRequest, ServeMCPResponse> = {
  capability: 'ServeMCP',
  executionMode: 'long_running',
  async execute(request, context) {
    if (context.dependencies.startMcpServer) {
      return context.dependencies.startMcpServer(context, {
        transport: request.transport ?? 'stdio',
      });
    }

    return createRuntimeResponse({
      capability: 'ServeMCP',
      executionMode: 'long_running',
      summary: {
        title: 'MCP serve handler stub',
        text: 'No MCP adapter has been attached to the runtime host yet.',
      },
      findings: [
        {
          id: 'serve-mcp-stub',
          title: 'Adapter missing',
          summary: 'Attach a startMcpServer dependency from the future MCP surface integration layer.',
          severity: 'warning',
        },
      ],
      relatedEntities: [
        {
          kind: 'service',
          name: 'mcp',
        },
      ],
      signals: [{ name: 'transport', value: request.transport ?? 'stdio', importance: 'medium' }],
      warnings: ['ServeMCP is intentionally stubbed until the MCP surface is moved onto RuntimeHost.'],
      details: {
        // TODO(phase9): wire the existing MCP server startup through an injected adapter using RuntimeHost.
      },
      machinePayload: {
        transport: request.transport ?? 'stdio',
        status: 'stubbed',
      },
      trustLevel: 'low',
      readinessState: 'unknown',
      confidence: 'low',
      trust: 'low',
    });
  },
};
