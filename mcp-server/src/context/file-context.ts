import { getDefinedSymbols, getExportedSymbols, getFileNode, getNeighboringFiles, getRelatedFiles } from '../graph/query.js';
import type { FileNode } from '../graph/types.js';
import { rankRelatedFileCandidates } from '../ranking/index.js';
import { getFileRelationById } from '../symbol-index/query.js';
import type { FileRelation } from '../symbol-index/types.js';
import type {
  AssembleFileContextOptions,
  FileContextConnectionKind,
  FileContextBundle,
  RelatedFileContextBucket,
  RelatedFileContextBuckets,
  RankedFileContextItem,
} from './types.js';

const DEFAULT_RELATED_LIMIT = 10;
const EXACT_RELATED_LIMIT_FLOOR = 24;
const INFERRED_RELATED_LIMIT_FLOOR = 8;

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
  if (
    entry.via.some((kind) =>
      ['call_reference', 'symbol_reference', 'jsx_reference', 'type_reference', 'incoming_file_imports_file'].includes(kind),
    )
  ) {
    return 'direct_consumers';
  }

  if (entry.via.some((kind) => ['incoming_file_reexports_file', 'outgoing_file_reexports_file'].includes(kind))) {
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

  const relatedFiles = await getRelatedFiles(fileId);
  const signalsByFileId = buildGraphSignalsByFileId(relatedFiles);
  mergeReferenceSignals(signalsByFileId, options.referenceSignalsByFileId);
  const filesById = new Map(relatedFiles.map((entry) => [entry.file.fileId, entry.file]));
  const candidateRelations: FileRelation[] = [];

  for (const candidateFileId of signalsByFileId.keys()) {
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

  const ranked = rankRelatedFileCandidates(
    targetRelation,
    candidateRelations.map((relation) => ({
      relation,
      graphSignals: signalsByFileId.get(relation.fileId),
    })),
    Number.MAX_SAFE_INTEGER,
  );

  const mapped = mapRankedRelatedFiles(ranked, filesById, signalsByFileId);
  const bucketed = buildRelatedFileBuckets(mapped, options.relatedLimit ?? DEFAULT_RELATED_LIMIT);

  return {
    items: bucketed.items,
    totalCount: mapped.length,
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
