import { getDefinedSymbols, getExportedSymbols, getFileNode, getNeighboringFiles, getRelatedFiles } from '../graph/query.js';
import type { FileNode } from '../graph/types.js';
import { rankRelatedFileCandidates } from '../ranking/index.js';
import { getFileRelationById } from '../symbol-index/query.js';
import type { ExportRecord, FileRelation, ImportBinding } from '../symbol-index/types.js';
import type {
  AssembleFileContextOptions,
  ExplorationBudget,
  FileContextConnectionKind,
  FileContextBundle,
  RelatedFileContextBucket,
  RelatedFileContextBuckets,
  RankedFileContextItem,
} from './types.js';
import type { SymbolContextBudget } from './types.js';
import { EXECUTION_BUDGETS } from '../execution/budgets.js';

const DEFAULT_RELATED_LIMIT = 10;
const EXACT_RELATED_LIMIT_FLOOR = 24;
const INFERRED_RELATED_LIMIT_FLOOR = 8;
const DEFAULT_EXPLORATION_BUDGET: ExplorationBudget = {
  maxNodes: 480,
  maxEdges: 3200,
  maxDepth: 2,
};
const DEFAULT_SYMBOL_CONTEXT_BUDGET: SymbolContextBudget = EXECUTION_BUDGETS.standard.symbolContext;

function isNoisePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');

  return (
    /\.(test|spec)\.(tsx?|jsx?)$/i.test(normalized) ||
    /\.(stories|story)\.(tsx?|jsx?)$/i.test(normalized) ||
    /(^|\/)__tests__\//i.test(normalized) ||
    /(^|\/)(demo|demos|playground|playgrounds|example|examples)\//i.test(normalized)
  );
}

function hasStrongEdge(via: FileContextConnectionKind[]): boolean {
  return via.some((kind) =>
    ['import_usage', 'call_reference', 'symbol_reference', 'jsx_reference', 'type_reference', 'api_route_handler'].includes(kind),
  );
}

function hasMediumEdge(via: FileContextConnectionKind[]): boolean {
  return via.some((kind) =>
    [
      'incoming_file_imports_file',
      'incoming_file_reexports_file',
      'outgoing_file_reexports_file',
      'api_client_to_route',
      'api_propagation',
    ].includes(kind),
  );
}

function edgeStrengthRank(kind: FileContextConnectionKind): number {
  if (hasStrongEdge([kind])) {
    return 3;
  }

  if (hasMediumEdge([kind])) {
    return 2;
  }

  return 1;
}

function resolveExplorationBudget(options: AssembleFileContextOptions): ExplorationBudget {
  return {
    maxNodes: Math.max(1, options.explorationBudget?.maxNodes ?? DEFAULT_EXPLORATION_BUDGET.maxNodes),
    maxEdges: Math.max(1, options.explorationBudget?.maxEdges ?? DEFAULT_EXPLORATION_BUDGET.maxEdges),
    maxDepth: Math.max(1, options.explorationBudget?.maxDepth ?? DEFAULT_EXPLORATION_BUDGET.maxDepth),
  };
}

function resolveSymbolContextBudget(options: AssembleFileContextOptions): SymbolContextBudget {
  return {
    maxCandidateSymbols: Math.max(
      1,
      options.symbolContextBudget?.maxCandidateSymbols ?? DEFAULT_SYMBOL_CONTEXT_BUDGET.maxCandidateSymbols,
    ),
    maxDirectConsumerEdges: Math.max(
      1,
      options.symbolContextBudget?.maxDirectConsumerEdges ?? DEFAULT_SYMBOL_CONTEXT_BUDGET.maxDirectConsumerEdges,
    ),
    maxIndirectConsumerEdges: Math.max(
      1,
      options.symbolContextBudget?.maxIndirectConsumerEdges ?? DEFAULT_SYMBOL_CONTEXT_BUDGET.maxIndirectConsumerEdges,
    ),
    maxRelatedFiles: Math.max(1, options.symbolContextBudget?.maxRelatedFiles ?? DEFAULT_SYMBOL_CONTEXT_BUDGET.maxRelatedFiles),
    maxWeakExpansions: Math.max(
      0,
      options.symbolContextBudget?.maxWeakExpansions ?? DEFAULT_SYMBOL_CONTEXT_BUDGET.maxWeakExpansions,
    ),
    strongEvidenceThreshold: Math.max(
      1,
      options.symbolContextBudget?.strongEvidenceThreshold ?? DEFAULT_SYMBOL_CONTEXT_BUDGET.strongEvidenceThreshold,
    ),
  };
}

function toConnectionKind(entry: Awaited<ReturnType<typeof getRelatedFiles>>[number]): FileContextConnectionKind {
  if (entry.via === 'file_imports_file') {
    return entry.direction === 'outgoing' ? 'outgoing_file_imports_file' : 'incoming_file_imports_file';
  }

  if (entry.via === 'file_reexports_file') {
    return entry.direction === 'outgoing' ? 'outgoing_file_reexports_file' : 'incoming_file_reexports_file';
  }

  return entry.via as FileContextConnectionKind;
}

function buildGraphSignalsByFileId(
  relatedFiles: Awaited<ReturnType<typeof getRelatedFiles>>,
): Map<string, { edgeTypes: FileContextConnectionKind[]; connectionCount: number }> {
  const signalsByFileId = new Map<string, { edgeTypes: FileContextConnectionKind[]; connectionCount: number }>();

  for (const entry of relatedFiles) {
    const connectionKind = toConnectionKind(entry);
    const existing = signalsByFileId.get(entry.file.fileId);

    if (existing) {
      existing.connectionCount += 1;

      if (!existing.edgeTypes.includes(connectionKind)) {
        existing.edgeTypes.push(connectionKind);
      }

      continue;
    }

    signalsByFileId.set(entry.file.fileId, {
      edgeTypes: [connectionKind],
      connectionCount: 1,
    });
  }

  return signalsByFileId;
}

function classifyRelatedFileBucket(entry: RankedFileContextItem): RelatedFileContextBucket['kind'] {
  if (isNoisePath(entry.file.filePath)) {
    return 'related_context';
  }

  if (hasStrongEdge(entry.via)) {
    return 'direct_consumers';
  }

  if (hasMediumEdge(entry.via)) {
    return 'indirect_consumers';
  }

  return 'related_context';
}

function bucketDisplay(
  kind: RelatedFileContextBucket['kind'],
): Pick<RelatedFileContextBucket, 'kind' | 'label' | 'explanation' | 'confidence' | 'coverage'> {
  switch (kind) {
    case 'direct_consumers':
      return {
        kind,
        label: 'Direct consumers (exact)',
        explanation: 'confirmed symbol-level usage',
        confidence: 'high',
        coverage: 'exact',
      };
    case 'indirect_consumers':
      return {
        kind,
        label: 'Indirect consumers (inferred)',
        explanation: 'likely usage via wrappers or re-exports',
        confidence: 'medium',
        coverage: 'inferred',
      };
    case 'related_context':
      return {
        kind,
        label: 'Related context (exploratory)',
        explanation: 'nearby or dependent files, not guaranteed direct usage',
        confidence: 'low',
        coverage: 'exploratory',
      };
  }
}

function getBucketLimit(
  kind: RelatedFileContextBucket['kind'],
  requestedLimit: number,
): number {
  switch (kind) {
    case 'direct_consumers':
      return Math.max(requestedLimit * 4, EXACT_RELATED_LIMIT_FLOOR);
    case 'indirect_consumers':
      return Math.max(requestedLimit, INFERRED_RELATED_LIMIT_FLOOR);
    case 'related_context':
      return requestedLimit;
  }
}

function buildRelatedFileBuckets(
  entries: RankedFileContextItem[],
  requestedLimit: number,
): { items: RankedFileContextItem[]; buckets: RelatedFileContextBuckets } {
  const grouped: Record<RelatedFileContextBucket['kind'], RankedFileContextItem[]> = {
    direct_consumers: [],
    indirect_consumers: [],
    related_context: [],
  };

  for (const entry of entries) {
    grouped[classifyRelatedFileBucket(entry)].push(entry);
  }

  const directEntries = grouped.direct_consumers.slice(0, getBucketLimit('direct_consumers', requestedLimit));
  const indirectEntries = grouped.indirect_consumers.slice(0, getBucketLimit('indirect_consumers', requestedLimit));
  const relatedEntries = grouped.related_context.slice(0, getBucketLimit('related_context', requestedLimit));

  const buckets: RelatedFileContextBuckets = {
    directConsumers: {
      ...bucketDisplay('direct_consumers'),
      entries: directEntries,
      total: grouped.direct_consumers.length,
      shown: directEntries.length,
      truncated: directEntries.length < grouped.direct_consumers.length,
    },
    indirectConsumers: {
      ...bucketDisplay('indirect_consumers'),
      entries: indirectEntries,
      total: grouped.indirect_consumers.length,
      shown: indirectEntries.length,
      truncated: indirectEntries.length < grouped.indirect_consumers.length,
    },
    relatedContext: {
      ...bucketDisplay('related_context'),
      entries: relatedEntries,
      total: grouped.related_context.length,
      shown: relatedEntries.length,
      truncated: relatedEntries.length < grouped.related_context.length,
    },
  };

  return {
    items: [...directEntries, ...indirectEntries, ...relatedEntries],
    buckets,
  };
}

function mergeReferenceSignals(
  signalsByFileId: Map<string, { edgeTypes: FileContextConnectionKind[]; connectionCount: number }>,
  referenceSignalsByFileId: AssembleFileContextOptions['referenceSignalsByFileId'],
): void {
  for (const [fileId, referenceSignal] of Object.entries(referenceSignalsByFileId ?? {})) {
    const existing = signalsByFileId.get(fileId);

    if (existing) {
      existing.connectionCount += referenceSignal.connectionCount;

      for (const kind of referenceSignal.kinds) {
        if (!existing.edgeTypes.includes(kind)) {
          existing.edgeTypes.push(kind);
        }
      }

      continue;
    }

    signalsByFileId.set(fileId, {
      edgeTypes: [...referenceSignal.kinds],
      connectionCount: referenceSignal.connectionCount,
    });
  }
}

function getTargetExportSurface(exports: ExportRecord[]): { exportedNames: Set<string>; hasDefault: boolean } {
  const exportedNames = new Set<string>();
  let hasDefault = false;

  for (const entry of exports) {
    if (entry.kind === 'default') {
      hasDefault = true;
    }

    if (entry.exportedName) {
      exportedNames.add(entry.exportedName);
    }

    if (entry.localName) {
      exportedNames.add(entry.localName);
    }
  }

  return { exportedNames, hasDefault };
}

function bindingTargetsTargetExport(
  binding: ImportBinding,
  targetExportSurface: { exportedNames: Set<string>; hasDefault: boolean },
): boolean {
  if (binding.isTypeOnly) {
    return false;
  }

  if (binding.kind === 'default') {
    return targetExportSurface.hasDefault;
  }

  if (binding.kind === 'namespace') {
    return true;
  }

  return Boolean(binding.importedName && targetExportSurface.exportedNames.has(binding.importedName));
}

function mergeSignalKinds(
  signalsByFileId: Map<string, { edgeTypes: FileContextConnectionKind[]; connectionCount: number }>,
  fileId: string,
  kinds: FileContextConnectionKind[],
  connectionCount: number,
): void {
  const existing = signalsByFileId.get(fileId);

  if (!existing) {
    signalsByFileId.set(fileId, {
      edgeTypes: [...new Set(kinds)],
      connectionCount,
    });
    return;
  }

  existing.connectionCount += connectionCount;

  for (const kind of kinds) {
    if (!existing.edgeTypes.includes(kind)) {
      existing.edgeTypes.push(kind);
    }
  }
}

function promoteExactImportUsageSignals(
  targetRelation: FileRelation,
  candidateRelations: FileRelation[],
  signalsByFileId: Map<string, { edgeTypes: FileContextConnectionKind[]; connectionCount: number }>,
): void {
  const targetExportSurface = getTargetExportSurface(targetRelation.exports);

  for (const relation of candidateRelations) {
    let exactBindingCount = 0;

    for (const entry of relation.imports) {
      if (entry.resolvedTargetFileId !== targetRelation.fileId) {
        continue;
      }

      for (const binding of entry.bindings) {
        if (!bindingTargetsTargetExport(binding, targetExportSurface)) {
          continue;
        }

        if (!relation.importTokens.includes(binding.localName)) {
          continue;
        }

        exactBindingCount += 1;
      }
    }

    if (exactBindingCount === 0) {
      continue;
    }

    mergeSignalKinds(signalsByFileId, relation.fileId, ['import_usage'], exactBindingCount);
  }
}

function prioritizeCandidateFileIds(
  signalsByFileId: Map<string, { edgeTypes: FileContextConnectionKind[]; connectionCount: number }>,
  requestedLimit: number,
  budget: ExplorationBudget,
  symbolContextBudget: SymbolContextBudget,
): string[] {
  const rankedEntries = Array.from(signalsByFileId.entries())
    .map(([fileId, signal]) => {
      const strongestEdgeRank = signal.edgeTypes.reduce((current, kind) => Math.max(current, edgeStrengthRank(kind)), 0);

      return {
        fileId,
        strongestEdgeRank,
        connectionCount: signal.connectionCount,
        distinctEdgeCount: signal.edgeTypes.length,
      };
    })
    .sort((left, right) => {
      return (
        right.strongestEdgeRank - left.strongestEdgeRank ||
        right.connectionCount - left.connectionCount ||
        right.distinctEdgeCount - left.distinctEdgeCount ||
        left.fileId.localeCompare(right.fileId)
      );
    });

  const strongEntries = rankedEntries.filter((entry) => entry.strongestEdgeRank >= 3);
  const mediumEntries = rankedEntries.filter((entry) => entry.strongestEdgeRank === 2);
  const weakEntries = rankedEntries.filter((entry) => entry.strongestEdgeRank <= 1);
  const candidateFloor = Math.max(requestedLimit * 4, EXACT_RELATED_LIMIT_FLOOR);
  const maxCandidates = Math.min(
    Math.min(budget.maxNodes, symbolContextBudget.maxRelatedFiles),
    Math.max(candidateFloor, requestedLimit * 6),
  );
  const allowWeak =
    strongEntries.length < symbolContextBudget.strongEvidenceThreshold ||
    mediumEntries.length === 0;
  const selected = [
    ...strongEntries.slice(0, Math.min(strongEntries.length, maxCandidates)),
    ...mediumEntries.slice(
      0,
      Math.max(
        0,
        Math.min(mediumEntries.length, maxCandidates - Math.min(strongEntries.length, maxCandidates)),
      ),
    ),
  ];

  if (allowWeak && selected.length < maxCandidates) {
    selected.push(
      ...weakEntries.slice(0, Math.min(symbolContextBudget.maxWeakExpansions, maxCandidates - selected.length)),
    );
  }

  return selected.slice(0, maxCandidates).map((entry) => entry.fileId);
}

function mapRankedRelatedFiles(
  ranked: ReturnType<typeof rankRelatedFileCandidates>,
  filesById: Map<string, FileNode>,
  signalsByFileId: Map<string, { edgeTypes: FileContextConnectionKind[]; connectionCount: number }>,
): RankedFileContextItem[] {
  const results: RankedFileContextItem[] = [];

  for (const entry of ranked) {
    const file = filesById.get(entry.fileId);

    if (!file) {
      continue;
    }

    results.push({
      file,
      score: entry.score,
      reason: entry.reason,
      reasons: entry.reasons,
      via: signalsByFileId.get(entry.fileId)?.edgeTypes ?? [],
    });
  }

  return results;
}

export async function assembleRelatedFileContext(
  fileId: string,
  options: AssembleFileContextOptions = {},
): Promise<{ items: RankedFileContextItem[]; totalCount: number; buckets: RelatedFileContextBuckets }> {
  const targetRelation = await getFileRelationById(fileId);

  if (!targetRelation) {
    return {
      items: [],
      totalCount: 0,
      buckets: buildRelatedFileBuckets([], options.relatedLimit ?? DEFAULT_RELATED_LIMIT).buckets,
    };
  }

  const budget = resolveExplorationBudget(options);
  const symbolContextBudget = resolveSymbolContextBudget(options);
  const signalsByFileId = new Map<string, { edgeTypes: FileContextConnectionKind[]; connectionCount: number }>();
  mergeReferenceSignals(signalsByFileId, options.referenceSignalsByFileId);
  const strongReferenceCount = Array.from(signalsByFileId.values()).filter((signal) => hasStrongEdge(signal.edgeTypes)).length;
  const shouldExpandGraphContext =
    strongReferenceCount < symbolContextBudget.strongEvidenceThreshold &&
    signalsByFileId.size < symbolContextBudget.maxRelatedFiles;

  let relatedFiles = [] as Awaited<ReturnType<typeof getRelatedFiles>>;

  if (shouldExpandGraphContext) {
    relatedFiles = await getRelatedFiles(fileId);

    for (const [candidateFileId, signal] of buildGraphSignalsByFileId(relatedFiles).entries()) {
      mergeSignalKinds(signalsByFileId, candidateFileId, signal.edgeTypes, signal.connectionCount);
    }
  }

  const totalCandidateCount = signalsByFileId.size;
  const candidateFileIds = prioritizeCandidateFileIds(
    signalsByFileId,
    options.relatedLimit ?? DEFAULT_RELATED_LIMIT,
    budget,
    symbolContextBudget,
  );
  const candidateFileIdSet = new Set(candidateFileIds);
  const filesById = new Map(
    relatedFiles
      .filter((entry) => candidateFileIdSet.has(entry.file.fileId))
      .map((entry) => [entry.file.fileId, entry.file]),
  );
  const candidateRelations: FileRelation[] = [];

  for (const candidateFileId of candidateFileIds) {
    if (!filesById.has(candidateFileId)) {
      const file = await getFileNode(candidateFileId);

      if (file) {
        filesById.set(candidateFileId, file);
      }
    }

    const relation = await getFileRelationById(candidateFileId);

    if (relation) {
      candidateRelations.push(relation);
    }
  }

  promoteExactImportUsageSignals(targetRelation, candidateRelations, signalsByFileId);

  const ranked = rankRelatedFileCandidates(
    targetRelation,
    candidateRelations.map((relation) => ({
      relation,
      graphSignals: signalsByFileId.get(relation.fileId),
    })),
    Math.min(candidateRelations.length, budget.maxNodes, symbolContextBudget.maxRelatedFiles),
  );

  const mapped = mapRankedRelatedFiles(ranked, filesById, signalsByFileId);
  const bucketed = buildRelatedFileBuckets(mapped, options.relatedLimit ?? DEFAULT_RELATED_LIMIT);

  return {
    items: bucketed.items,
    totalCount: totalCandidateCount,
    buckets: bucketed.buckets,
  };
}

export async function assembleFileContext(
  fileId: string,
  options: AssembleFileContextOptions = {},
): Promise<FileContextBundle> {
  const file = await getFileNode(fileId);

  if (!file) {
    return {
      fileId,
      file: null,
      repo: null,
      neighboringFiles: [],
      relatedFiles: [],
      totalRelatedFiles: 0,
      relatedFileBuckets: buildRelatedFileBuckets([], options.relatedLimit ?? DEFAULT_RELATED_LIMIT).buckets,
      definedSymbols: [],
      exportedSymbols: [],
    };
  }

  const [neighboringFiles, relatedFiles, definedSymbols, exportedSymbols] = await Promise.all([
    getNeighboringFiles(fileId),
    assembleRelatedFileContext(fileId, options),
    getDefinedSymbols(fileId),
    getExportedSymbols(fileId),
  ]);

  return {
    fileId,
    file,
    repo: file.repoId,
    neighboringFiles,
    relatedFiles: relatedFiles.items,
    totalRelatedFiles: relatedFiles.totalCount,
    relatedFileBuckets: relatedFiles.buckets,
    definedSymbols,
    exportedSymbols,
  };
}
