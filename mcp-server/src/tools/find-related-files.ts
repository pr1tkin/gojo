import { rankRelatedFiles } from '../ranking.js';
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
  const candidates = relations.filter(
    (relation) => !(relation.repo === target.repo && relation.filePath === target.filePath),
  );
  const ranked = rankRelatedFiles(target, candidates, limit);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(ranked, null, 2),
      },
    ],
  };
}
