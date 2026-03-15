import { getRelatedFiles as getGraphRelatedFiles } from '../graph/query.js';
import { rankRelatedFileCandidates } from '../ranking/index.js';
import { findRelatedFilesInputSchema } from '../schemas.js';
import { getFileRelation, listFileRelations } from '../symbol-index/query.js';
import type { FindRelatedFilesInput } from '../types.js';

const DEFAULT_RELATED_FILES_LIMIT = 10;

export const findRelatedFilesToolDefinition = {
  name: 'find_related_files',
  title: 'Find Related Files',
  description: 'Find likely related files using the lightweight relation index.',
  inputSchema: findRelatedFilesInputSchema,
};

export async function runFindRelatedFilesTool(
  input: FindRelatedFilesInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const target = await getFileRelation(input.filePath, input.repo);
  const limit = input.limit ?? DEFAULT_RELATED_FILES_LIMIT;
  const relations = await listFileRelations();
  const graphRelatedFiles = await getGraphRelatedFiles(target.fileId);
  const graphSignalsByFileId = new Map(
    graphRelatedFiles.map((entry) => [
      entry.file.fileId,
      {
        edgeTypes: [entry.via],
        connectionCount: graphRelatedFiles.filter((candidate) => candidate.file.fileId === entry.file.fileId).length,
      },
    ]),
  );
  const candidates = relations.filter(
    (relation) => !(relation.repo === target.repo && relation.filePath === target.filePath),
  );
  const ranked = rankRelatedFileCandidates(
    target,
    candidates.map((relation) => ({
      relation,
      graphSignals: graphSignalsByFileId.get(relation.fileId),
    })),
    limit,
  ).map((entry) => ({
    repo: entry.repo,
    filePath: entry.filePath,
    reason: entry.reason,
    score: entry.score,
  }));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(ranked, null, 2),
      },
    ],
  };
}
