import { loadConfig } from '../config.js';
import { traceAsync, traceHotspot } from '../instrumentation/trace.js';
import {
  getExportedSymbols,
  getFileNode,
  getSemanticConsumersForSymbol,
  getSemanticGraph,
} from '../graph/query.js';
import { getRepositoryById } from '../repositories.js';
import { rankSymbolCandidates } from '../ranking/index.js';
import { loadRequiredSymbolIndex } from '../symbol-index/store.js';
import type { FileRelation, IndexedSymbol } from '../symbol-index/types.js';
import { collectApiPropagationForSymbol } from '../typescript/api-propagation.js';
import { findTypeScriptReferencesForIndexedSymbol } from '../typescript/symbol-references.js';
import type {
  ExplorationBudget,
  FileContextConnectionKind,
  SymbolContextBudget,
  SymbolContextBundle,
  SymbolContextQuery,
} from './types.js';
import { assembleRelatedFileContext } from './file-context.js';
import type { RelatedFileContextBuckets } from './types.js';
import { EXECUTION_BUDGETS } from '../execution/budgets.js';

const DEFAULT_REFERENCE_EXPLORATION_BUDGET: ExplorationBudget = EXECUTION_BUDGETS.standard.graph;
const DEFAULT_SYMBOL_CONTEXT_BUDGET: SymbolContextBudget = EXECUTION_BUDGETS.standard.symbolContext;
const fileFanInCache = new WeakMap<object, Record<string, number>>();

function confidenceRank(confidence: 'low' | 'medium' | 'high'): number {
  switch (confidence) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
  }
}

function buildFileFanInById(relationsByFile: Record<string, FileRelation>): Record<string, number> {
  const cached = fileFanInCache.get(relationsByFile);

  if (cached) {
    return cached;
  }

  const fanInById: Record<string, number> = Object.create(null);

  for (const relation of Object.values(relationsByFile)) {
    for (const entry of relation.imports) {
      if (!entry.resolvedTargetFileId) {
        continue;
      }

      fanInById[entry.resolvedTargetFileId] = (fanInById[entry.resolvedTargetFileId] ?? 0) + 1;
    }
  }

  fileFanInCache.set(relationsByFile, fanInById);
  return fanInById;
}

function detectRankingAmbiguity(rankedSymbols: ReturnType<typeof rankSymbolCandidates>): {
  ambiguityDetected: boolean;
  viableAlternativeCount: number;
} {
  if (rankedSymbols.length <= 1) {
    return {
      ambiguityDetected: false,
      viableAlternativeCount: 0,
    };
  }

  const primary = rankedSymbols[0];
  const viableAlternativeCount = rankedSymbols
    .slice(1)
    .filter((entry) => primary.score - entry.score <= 2)
    .length;

  return {
    ambiguityDetected: viableAlternativeCount > 0,
    viableAlternativeCount,
  };
}

function collectSymbolCandidates(
  index: Awaited<ReturnType<typeof loadRequiredSymbolIndex>>,
  query: SymbolContextQuery,
  budget: SymbolContextBudget,
): IndexedSymbol[] {
  const exactMatches = index.byName[query.name] ?? [];
  const lowerCaseMatches =
    exactMatches.length > 0
      ? exactMatches
      : index.byNameLower[query.name.toLowerCase()] ?? [];

  const filtered = lowerCaseMatches.filter((symbol) => {
    if (query.kind && symbol.kind !== query.kind) {
      return false;
    }

    if (query.repo && symbol.repo !== query.repo) {
      return false;
    }

    return true;
  });

  if (filtered.length <= budget.maxCandidateSymbols) {
    return filtered;
  }

  return filtered
    .slice()
    .sort((left, right) => {
      const exportedDelta = Number(Boolean(right.exported)) - Number(Boolean(left.exported));

      if (exportedDelta !== 0) {
        return exportedDelta;
      }

      const pathExactDelta = Number(right.filePath.endsWith(`/${query.name}.ts`) || right.filePath.endsWith(`/${query.name}.tsx`))
        - Number(left.filePath.endsWith(`/${query.name}.ts`) || left.filePath.endsWith(`/${query.name}.tsx`));

      if (pathExactDelta !== 0) {
        return pathExactDelta;
      }

      return left.filePath.localeCompare(right.filePath);
    })
    .slice(0, budget.maxCandidateSymbols);
}

function mergeSignal(
  signalsByFileId: Record<string, { kinds: FileContextConnectionKind[]; connectionCount: number }>,
  fileId: string,
  kinds: FileContextConnectionKind[],
  connectionCount: number,
): void {
  const existing = signalsByFileId[fileId];

  if (!existing) {
    signalsByFileId[fileId] = {
      kinds: [...new Set(kinds)],
      connectionCount,
    };
    return;
  }

  existing.connectionCount += connectionCount;

  for (const kind of kinds) {
    if (!existing.kinds.includes(kind)) {
      existing.kinds.push(kind);
    }
  }
}

function mapSemanticEdgeKindsToConnectionKinds(
  kind: Awaited<ReturnType<typeof getSemanticConsumersForSymbol>>[number]['edge']['kind'],
): FileContextConnectionKind[] {
  switch (kind) {
    case 'symbol_call':
      return ['call_reference'];
    case 'symbol_reference':
      return ['symbol_reference'];
    case 'jsx_reference':
      return ['jsx_reference'];
    case 'type_reference':
      return ['type_reference'];
    case 'api_route_handler':
      return ['api_route_handler'];
    case 'api_client_to_route':
      return ['api_client_to_route'];
    case 'api_propagation':
      return ['api_client_to_route', 'api_propagation'];
  }
}

function semanticEdgePriority(
  kind: Awaited<ReturnType<typeof getSemanticConsumersForSymbol>>[number]['edge']['kind'],
): number {
  switch (kind) {
    case 'symbol_call':
      return 7;
    case 'api_route_handler':
      return 6;
    case 'symbol_reference':
    case 'jsx_reference':
      return 5;
    case 'api_propagation':
      return 4;
    case 'api_client_to_route':
      return 3;
    case 'type_reference':
      return 2;
  }
}

function resolveExplorationBudget(query: SymbolContextQuery): ExplorationBudget {
  return {
    maxNodes: Math.max(1, query.explorationBudget?.maxNodes ?? DEFAULT_REFERENCE_EXPLORATION_BUDGET.maxNodes),
    maxEdges: Math.max(1, query.explorationBudget?.maxEdges ?? DEFAULT_REFERENCE_EXPLORATION_BUDGET.maxEdges),
    maxDepth: Math.max(1, query.explorationBudget?.maxDepth ?? DEFAULT_REFERENCE_EXPLORATION_BUDGET.maxDepth),
  };
}

function getRepoFileCount(
  index: Awaited<ReturnType<typeof loadRequiredSymbolIndex>>,
  repo: string | undefined,
): number {
  if (!repo) {
    return 0;
  }

  let count = 0;

  for (const relation of Object.values(index.byFile)) {
    if (relation.repo === repo) {
      count += 1;
    }
  }

  return count;
}

function resolveSymbolContextBudget(
  query: SymbolContextQuery,
  index: Awaited<ReturnType<typeof loadRequiredSymbolIndex>>,
): SymbolContextBudget {
  const profile =
    query.repo && getRepoFileCount(index, query.repo) >= 5000
      ? EXECUTION_BUDGETS.large.symbolContext
      : DEFAULT_SYMBOL_CONTEXT_BUDGET;

  return {
    maxCandidateSymbols: Math.max(1, query.symbolContextBudget?.maxCandidateSymbols ?? profile.maxCandidateSymbols),
    maxDirectConsumerEdges: Math.max(1, query.symbolContextBudget?.maxDirectConsumerEdges ?? profile.maxDirectConsumerEdges),
    maxIndirectConsumerEdges: Math.max(1, query.symbolContextBudget?.maxIndirectConsumerEdges ?? profile.maxIndirectConsumerEdges),
    maxRelatedFiles: Math.max(1, query.symbolContextBudget?.maxRelatedFiles ?? profile.maxRelatedFiles),
    maxWeakExpansions: Math.max(0, query.symbolContextBudget?.maxWeakExpansions ?? profile.maxWeakExpansions),
    strongEvidenceThreshold: Math.max(1, query.symbolContextBudget?.strongEvidenceThreshold ?? profile.strongEvidenceThreshold),
  };
}

function fileSignalStrength(kinds: FileContextConnectionKind[]): 'strong' | 'medium' | 'weak' {
  if (
    kinds.some((kind) =>
      ['call_reference', 'symbol_reference', 'jsx_reference', 'type_reference', 'import_usage', 'api_route_handler'].includes(kind),
    )
  ) {
    return 'strong';
  }

  if (kinds.some((kind) => ['api_client_to_route', 'api_propagation'].includes(kind))) {
    return 'medium';
  }

  return 'weak';
}

async function buildPersistedReferenceSignalsByFileId(
  primarySymbol: IndexedSymbol,
  budget: SymbolContextBudget,
): Promise<Record<string, { kinds: FileContextConnectionKind[]; connectionCount: number }> | null> {
  const semanticGraph = await getSemanticGraph();

  if (semanticGraph.sourceSymbolIndexSchemaVersion <= 0) {
    return null;
  }

  const sortedEdges = (await getSemanticConsumersForSymbol(primarySymbol.symbolId))
    .slice()
    .sort((left, right) => {
      return (
        semanticEdgePriority(right.edge.kind) - semanticEdgePriority(left.edge.kind) ||
        confidenceRank(right.edge.confidence) - confidenceRank(left.edge.confidence) ||
        (right.fromFile?.filePath ?? '').localeCompare(left.fromFile?.filePath ?? '')
      );
    });
  const signalsByFileId: Record<string, { kinds: FileContextConnectionKind[]; connectionCount: number }> = {};
  let directEdges = 0;
  let indirectEdges = 0;
  let weakEdges = 0;

  for (const entry of sortedEdges) {
    const fileId = entry.fromFile?.fileId ?? entry.edge.fromFileId;

    if (!fileId || fileId === primarySymbol.fileId) {
      continue;
    }

    const kinds = mapSemanticEdgeKindsToConnectionKinds(entry.edge.kind);
    const strength = fileSignalStrength(kinds);

    if (strength === 'strong') {
      if (directEdges >= budget.maxDirectConsumerEdges) {
        continue;
      }

      directEdges += 1;
    } else if (strength === 'medium') {
      if (indirectEdges >= budget.maxIndirectConsumerEdges) {
        continue;
      }

      indirectEdges += 1;
    } else {
      if (weakEdges >= budget.maxWeakExpansions) {
        continue;
      }

      weakEdges += 1;
    }

    mergeSignal(signalsByFileId, fileId, kinds, 1);

    const strongFileCount = Object.values(signalsByFileId).filter((signal) => fileSignalStrength(signal.kinds) === 'strong').length;

    if (
      strongFileCount >= budget.strongEvidenceThreshold &&
      indirectEdges >= Math.min(2, budget.maxIndirectConsumerEdges)
    ) {
      break;
    }
  }

  return signalsByFileId;
}

async function buildReferenceSignalsByFileId(
  primarySymbol: IndexedSymbol | null,
  indexedSymbols: IndexedSymbol[],
  relationsByFile: Record<string, FileRelation>,
  explorationBudget: ExplorationBudget,
  symbolContextBudget: SymbolContextBudget,
): Promise<Record<string, { kinds: FileContextConnectionKind[]; connectionCount: number }>> {
  if (!primarySymbol) {
    return {};
  }

  const persistedSignals = await buildPersistedReferenceSignalsByFileId(primarySymbol, symbolContextBudget).catch(() => null);

  if (persistedSignals) {
    return persistedSignals;
  }

  let repository: Awaited<ReturnType<typeof getRepositoryById>> | null = null;

  try {
    repository = await getRepositoryById(loadConfig().reposRoot, primarySymbol.repo);
  } catch {
    repository = null;
  }

  if (!repository) {
    return {};
  }

  let matches;

  try {
    matches = await findTypeScriptReferencesForIndexedSymbol(repository, primarySymbol);
  } catch {
    return {};
  }
  const fileIdByPath = new Map<string, string>();

  for (const relation of Object.values(relationsByFile)) {
    if (relation.repo === primarySymbol.repo) {
      fileIdByPath.set(relation.filePath, relation.fileId);
    }
  }

  const signalsByFileId: Record<string, { kinds: FileContextConnectionKind[]; connectionCount: number }> = {};

  for (const match of matches) {
    if (match.filePath === primarySymbol.filePath) {
      continue;
    }

    const fileId = fileIdByPath.get(match.filePath);

    if (!fileId) {
      continue;
    }

    const kinds = new Set<FileContextConnectionKind>();

    if (match.isCallReference) {
      kinds.add('call_reference');
    }

    if (match.isJsxReference) {
      kinds.add('jsx_reference');
    }

    if (match.isTypeReference) {
      kinds.add('type_reference');
    }

    if (kinds.size === 0) {
      kinds.add('symbol_reference');
    }

    mergeSignal(signalsByFileId, fileId, [...kinds], 1);

    const strongFileCount = Object.values(signalsByFileId).filter((signal) => fileSignalStrength(signal.kinds) === 'strong').length;

    if (strongFileCount >= symbolContextBudget.strongEvidenceThreshold) {
      break;
    }
  }

  const apiPropagation = await collectApiPropagationForSymbol(repository, primarySymbol, relationsByFile, indexedSymbols);

  for (const routeHandler of apiPropagation.routeHandlers) {
    mergeSignal(signalsByFileId, routeHandler.routeFileId, ['api_route_handler'], routeHandler.referenceCount);
  }

  for (const propagatedClient of apiPropagation.propagatedClients) {
    mergeSignal(signalsByFileId, propagatedClient.clientFileId, ['api_client_to_route', 'api_propagation'], 1);
  }

  return Object.fromEntries(
    Object.entries(signalsByFileId)
      .sort((left, right) => {
        const leftStrength = fileSignalStrength(left[1].kinds);
        const rightStrength = fileSignalStrength(right[1].kinds);
        const strengthRank = { strong: 3, medium: 2, weak: 1 };

        return (
          strengthRank[rightStrength] - strengthRank[leftStrength] ||
          right[1].connectionCount - left[1].connectionCount ||
          left[0].localeCompare(right[0])
        );
      })
      .slice(0, explorationBudget.maxNodes),
  );
}

export async function assembleSymbolContext(query: SymbolContextQuery): Promise<SymbolContextBundle> {
  const index = await traceAsync('symbol_context', 'load_symbol_index', () => loadRequiredSymbolIndex(), {
    query: query.name,
    repo: query.repo ?? null,
  });
  const explorationBudget = resolveExplorationBudget(query);
  const symbolContextBudget = resolveSymbolContextBudget(query, index);
  const candidates = collectSymbolCandidates(index, query, symbolContextBudget);
  traceHotspot('symbol_context', 'candidate_collection', {
    query: query.name,
    repo: query.repo ?? null,
    candidates: candidates.length,
    maxCandidateSymbols: symbolContextBudget.maxCandidateSymbols,
  });
  const rankedSymbols = rankSymbolCandidates(
    candidates,
    {
      queryName: query.name,
      kind: query.kind,
      repo: query.repo,
    },
    {
      stats: index.stats,
      relationsByFile: index.byFile,
      fileFanInById: buildFileFanInById(index.byFile),
    },
  );
  traceHotspot('symbol_context', 'candidate_ranking', {
    query: query.name,
    rankedSymbols: rankedSymbols.length,
  });
  const limitedRankedSymbols = rankedSymbols.slice(0, query.limit);
  const ambiguity = detectRankingAmbiguity(limitedRankedSymbols);
  const primarySymbol = limitedRankedSymbols[0]?.item ?? null;
  const primaryFile = primarySymbol
    ? await traceAsync('symbol_context', 'load_primary_file', () => getFileNode(primarySymbol.fileId), {
        symbolId: primarySymbol.symbolId,
      })
    : null;
  const referenceSignalsByFileId = await traceAsync('symbol_context', 'build_reference_signals', () => buildReferenceSignalsByFileId(
    primarySymbol,
    index.symbols,
    index.byFile,
    explorationBudget,
    symbolContextBudget,
  ), {
    symbolId: primarySymbol?.symbolId ?? null,
    budgetNodes: explorationBudget.maxNodes,
    budgetEdges: explorationBudget.maxEdges,
    maxDirectConsumerEdges: symbolContextBudget.maxDirectConsumerEdges,
    maxIndirectConsumerEdges: symbolContextBudget.maxIndirectConsumerEdges,
  });
  const relatedFiles = primarySymbol
    ? await traceAsync('symbol_context', 'assemble_related_file_context', () => assembleRelatedFileContext(primarySymbol.fileId, {
        relatedLimit: query.relatedLimit,
        explorationBudget,
        symbolContextBudget,
        referenceSignalsByFileId,
      }), {
        symbolId: primarySymbol.symbolId,
        relatedLimit: query.relatedLimit ?? null,
      })
    : {
        items: [],
        totalCount: 0,
        buckets: {
          directConsumers: {
            kind: 'direct_consumers',
            label: 'Direct consumers (exact)',
            explanation: 'confirmed symbol-level usage',
            confidence: 'high',
            coverage: 'exact',
            entries: [],
            total: 0,
            shown: 0,
            truncated: false,
          },
          indirectConsumers: {
            kind: 'indirect_consumers',
            label: 'Indirect consumers (inferred)',
            explanation: 'likely usage via wrappers or re-exports',
            confidence: 'medium',
            coverage: 'inferred',
            entries: [],
            total: 0,
            shown: 0,
            truncated: false,
          },
          relatedContext: {
            kind: 'related_context',
            label: 'Related context (exploratory)',
            explanation: 'nearby or dependent files, not guaranteed direct usage',
            confidence: 'low',
            coverage: 'exploratory',
            entries: [],
            total: 0,
            shown: 0,
            truncated: false,
          },
        } satisfies RelatedFileContextBuckets,
      };
  const exportedSymbols = primarySymbol
    ? await traceAsync('symbol_context', 'load_exported_symbols', () => getExportedSymbols(primarySymbol.fileId), {
        symbolId: primarySymbol.symbolId,
      })
    : [];
  traceHotspot('symbol_context', 'result_summary', {
    query: query.name,
    relatedFiles: relatedFiles.totalCount,
    direct: relatedFiles.buckets.directConsumers.total,
    indirect: relatedFiles.buckets.indirectConsumers.total,
    related: relatedFiles.buckets.relatedContext.total,
    ambiguityDetected: ambiguity.ambiguityDetected,
  });

  return {
    query: query.name,
    repo: query.repo,
    kind: query.kind,
    rankedSymbols: limitedRankedSymbols,
    totalRankedSymbols: rankedSymbols.length,
    ambiguityDetected: ambiguity.ambiguityDetected,
    viableAlternativeCount: ambiguity.viableAlternativeCount,
    primarySymbol,
    primaryFile,
    relatedFiles: relatedFiles.items,
    totalRelatedFiles: relatedFiles.totalCount,
    relatedFileBuckets: relatedFiles.buckets,
    exportedSymbols,
  };
}
