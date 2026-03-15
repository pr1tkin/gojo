import { getExportedSymbols, getFileNode } from '../graph/query.js';
import { rankSymbolCandidates } from '../ranking/index.js';
import { loadRequiredSymbolIndex } from '../symbol-index/store.js';
import type { IndexedSymbol } from '../symbol-index/types.js';
import type { SymbolContextBundle, SymbolContextQuery } from './types.js';
import { assembleRelatedFileContext } from './file-context.js';

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
    },
  ).slice(0, query.limit);
  const primarySymbol = rankedSymbols[0]?.item ?? null;
  const primaryFile = primarySymbol ? await getFileNode(primarySymbol.fileId) : null;
  const relatedFiles = primarySymbol
    ? await assembleRelatedFileContext(primarySymbol.fileId, { relatedLimit: query.relatedLimit })
    : [];
  const exportedSymbols = primarySymbol ? await getExportedSymbols(primarySymbol.fileId) : [];

  return {
    query: query.name,
    repo: query.repo,
    kind: query.kind,
    rankedSymbols,
    primarySymbol,
    primaryFile,
    relatedFiles,
    exportedSymbols,
  };
}
