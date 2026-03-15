import { getDefinedSymbols, getExportedSymbols, getFileNode, getNeighboringFiles, getRelatedFiles } from '../graph/query.js';
import type { FileNode, GraphEdgeType } from '../graph/types.js';
import { rankRelatedFileCandidates } from '../ranking/index.js';
import { getFileRelationById } from '../symbol-index/query.js';
import type { FileRelation } from '../symbol-index/types.js';
import type {
  AssembleFileContextOptions,
  FileContextBundle,
  RankedFileContextItem,
} from './types.js';

const DEFAULT_RELATED_LIMIT = 10;

function buildGraphSignalsByFileId(
  relatedFiles: Awaited<ReturnType<typeof getRelatedFiles>>,
): Map<string, { edgeTypes: GraphEdgeType[]; connectionCount: number }> {
  const signalsByFileId = new Map<string, { edgeTypes: GraphEdgeType[]; connectionCount: number }>();

  for (const entry of relatedFiles) {
    const existing = signalsByFileId.get(entry.file.fileId);

    if (existing) {
      existing.connectionCount += 1;

      if (!existing.edgeTypes.includes(entry.via)) {
        existing.edgeTypes.push(entry.via);
      }

      continue;
    }

    signalsByFileId.set(entry.file.fileId, {
      edgeTypes: [entry.via],
      connectionCount: 1,
    });
  }

  return signalsByFileId;
}

function mapRankedRelatedFiles(
  ranked: ReturnType<typeof rankRelatedFileCandidates>,
  filesById: Map<string, FileNode>,
  signalsByFileId: Map<string, { edgeTypes: GraphEdgeType[]; connectionCount: number }>,
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
): Promise<RankedFileContextItem[]> {
  const targetRelation = await getFileRelationById(fileId);

  if (!targetRelation) {
    return [];
  }

  const relatedFiles = await getRelatedFiles(fileId);
  const signalsByFileId = buildGraphSignalsByFileId(relatedFiles);
  const filesById = new Map(relatedFiles.map((entry) => [entry.file.fileId, entry.file]));
  const candidateRelations: FileRelation[] = [];

  for (const candidateFileId of signalsByFileId.keys()) {
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
    options.relatedLimit ?? DEFAULT_RELATED_LIMIT,
  );

  return mapRankedRelatedFiles(ranked, filesById, signalsByFileId);
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
    relatedFiles,
    definedSymbols,
    exportedSymbols,
  };
}
