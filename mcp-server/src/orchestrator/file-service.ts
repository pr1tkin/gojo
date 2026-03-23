import { assembleFileContext } from '../context/index.js';
import type { FileExplorationContext, GetFileExplorationContextOptions } from './types.js';

export async function getFileExplorationContext(
  fileId: string,
  options: GetFileExplorationContextOptions = {},
): Promise<FileExplorationContext> {
  const context = await assembleFileContext(fileId, options);

  return {
    fileId: context.fileId,
    primaryFile: context.file,
    repo: context.repo,
    relatedFiles: context.relatedFiles,
    neighboringFiles: context.neighboringFiles,
    definedSymbols: context.definedSymbols,
    exportedSymbols: context.exportedSymbols,
    summary: {
      relatedFileCount: context.relatedFiles.length,
      totalRelatedFileCount: context.totalRelatedFiles,
      neighboringFileCount: context.neighboringFiles.length,
      definedSymbolCount: context.definedSymbols.length,
      exportedSymbolCount: context.exportedSymbols.length,
    },
    relatedFileBuckets: context.relatedFileBuckets,
    rawContext: context,
  };
}
