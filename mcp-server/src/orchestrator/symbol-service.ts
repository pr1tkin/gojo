import { assembleSymbolContext } from '../context/index.js';
import { traceAsync } from '../instrumentation/trace.js';
import type { GetSymbolExplorationContextOptions, SymbolExplorationContext } from './types.js';

export async function getSymbolExplorationContext(
  name: string,
  options: GetSymbolExplorationContextOptions = {},
): Promise<SymbolExplorationContext> {
  const context = await traceAsync('symbol_exploration', 'assemble_symbol_context', () => assembleSymbolContext({
    name,
    repo: options.repo,
    kind: options.kind,
    limit: options.limit,
    relatedLimit: options.relatedLimit,
  }), {
    name,
    repo: options.repo ?? null,
    limit: options.limit ?? null,
    relatedLimit: options.relatedLimit ?? null,
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
      totalCandidateCount: context.totalRankedSymbols,
      ambiguityDetected: context.ambiguityDetected,
      viableAlternativeCount: context.viableAlternativeCount,
      relatedFileCount: context.relatedFiles.length,
      totalRelatedFileCount: context.totalRelatedFiles,
      exportedSymbolCount: context.exportedSymbols.length,
    },
    relatedFileBuckets: context.relatedFileBuckets,
    rawContext: context,
  };
}
