import { assembleSymbolContext } from '../context/index.js';
import type { GetSymbolExplorationContextOptions, SymbolExplorationContext } from './types.js';

export async function getSymbolExplorationContext(
  name: string,
  options: GetSymbolExplorationContextOptions = {},
): Promise<SymbolExplorationContext> {
  const context = await assembleSymbolContext({
    name,
    repo: options.repo,
    kind: options.kind,
    limit: options.limit,
    relatedLimit: options.relatedLimit,
  });

  return {
    query: context.query,
    repo: context.repo,
    kind: context.kind,
    primarySymbol: context.primarySymbol,
    primaryFile: context.primaryFile,
    rankedSymbols: context.rankedSymbols,
    relatedFiles: context.relatedFiles,
    exportedSymbols: context.exportedSymbols,
    summary: {
      candidateCount: context.rankedSymbols.length,
      relatedFileCount: context.relatedFiles.length,
      exportedSymbolCount: context.exportedSymbols.length,
    },
    rawContext: context,
  };
}
