import { getExportedSymbols, getFileNode } from '../graph/query.js';
import { rankSymbolCandidates } from '../ranking/index.js';
import { loadRequiredSymbolIndex } from '../symbol-index/store.js';
import type { FileRelation, IndexedSymbol } from '../symbol-index/types.js';
import type { SymbolContextBundle, SymbolContextQuery } from './types.js';
import { assembleRelatedFileContext } from './file-context.js';

function buildFileFanInById(relationsByFile: Record<string, FileRelation>): Record<string, number> {
  const fanInById: Record<string, number> = Object.create(null);

  for (const relation of Object.values(relationsByFile)) {
    for (const entry of relation.imports) {
      if (!entry.resolvedTargetFileId) {
        continue;
      }

      fanInById[entry.resolvedTargetFileId] = (fanInById[entry.resolvedTargetFileId] ?? 0) + 1;
    }
  }

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
  symbols: IndexedSymbol[],
  query: SymbolContextQuery,
): IndexedSymbol[] {
  return symbols.filter((symbol) => {
    const exactNameMatch = symbol.name === query.name;
    const caseInsensitiveNameMatch = symbol.name.toLowerCase() === query.name.toLowerCase();

    if (!exactNameMatch && !caseInsensitiveNameMatch) {
      return false;
    }

    if (query.kind && symbol.kind !== query.kind) {
      return false;
    }

    if (query.repo && symbol.repo !== query.repo) {
      return false;
    }

    return true;
  });
}

export async function assembleSymbolContext(query: SymbolContextQuery): Promise<SymbolContextBundle> {
  const index = await loadRequiredSymbolIndex();
  const candidates = collectSymbolCandidates(index.symbols, query);
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
  const limitedRankedSymbols = rankedSymbols.slice(0, query.limit);
  const ambiguity = detectRankingAmbiguity(limitedRankedSymbols);
  const primarySymbol = limitedRankedSymbols[0]?.item ?? null;
  const primaryFile = primarySymbol ? await getFileNode(primarySymbol.fileId) : null;
  const relatedFiles = primarySymbol
    ? await assembleRelatedFileContext(primarySymbol.fileId, { relatedLimit: query.relatedLimit })
    : { items: [], totalCount: 0 };
  const exportedSymbols = primarySymbol ? await getExportedSymbols(primarySymbol.fileId) : [];

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
    exportedSymbols,
  };
}
