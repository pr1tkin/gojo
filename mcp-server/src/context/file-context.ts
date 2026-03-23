import { getDefinedSymbols, getExportedSymbols, getFileNode, getNeighboringFiles, getRelatedFiles } from '../graph/query.js';
import type { FileNode } from '../graph/types.js';
import { rankRelatedFileCandidates } from '../ranking/index.js';
import { getFileRelationById } from '../symbol-index/query.js';
import type { FileRelation } from '../symbol-index/types.js';
import type {
  AssembleFileContextOptions,
  FileContextConnectionKind,
  FileContextBundle,
  RankedFileContextItem,
} from './types.js';

const DEFAULT_RELATED_LIMIT = 10;

function buildGraphSignalsByFileId(
  relatedFiles: Awaited<ReturnType<typeof getRelatedFiles>>,
): Map<string, { edgeTypes: FileContextConnectionKind[]; connectionCount: number }> {
  const signalsByFileId = new Map<string, { edgeTypes: FileContextConnectionKind[]; connectionCount: number }>();

  for (const entry of relatedFiles) {
    const existing = signalsByFileId.get(entry.file.fileId);

    if (existing) {
      existing.connectionCount += 1;

      if (!existing.edgeTypes.includes(entry.via as FileContextConnectionKind)) {
        existing.edgeTypes.push(entry.via as FileContextConnectionKind);
      }

      continue;
    }

    signalsByFileId.set(entry.file.fileId, {
      edgeTypes: [entry.via as FileContextConnectionKind],
      connectionCount: 1,
    });
  }

  return signalsByFileId;
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
): Promise<{ items: RankedFileContextItem[]; totalCount: number }> {
  const targetRelation = await getFileRelationById(fileId);

  if (!targetRelation) {
    return {
      items: [],
      totalCount: 0,
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

  return {
    items: mapped.slice(0, options.relatedLimit ?? DEFAULT_RELATED_LIMIT),
    totalCount: mapped.length,
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
    definedSymbols,
    exportedSymbols,
  };
}
