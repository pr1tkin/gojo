import { loadConfig } from '../config.js';
import { getExportedSymbols, getFileNode } from '../graph/query.js';
import { getRepositoryById } from '../repositories.js';
import { rankSymbolCandidates } from '../ranking/index.js';
import { loadRequiredSymbolIndex } from '../symbol-index/store.js';
import type { FileRelation, IndexedSymbol } from '../symbol-index/types.js';
import { findTypeScriptReferencesForIndexedSymbol } from '../typescript/symbol-references.js';
import type { SymbolContextBundle, SymbolContextQuery } from './types.js';
import { assembleRelatedFileContext } from './file-context.js';
import type { RelatedFileContextBuckets } from './types.js';

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

async function buildReferenceSignalsByFileId(
  primarySymbol: IndexedSymbol | null,
  relationsByFile: Record<string, FileRelation>,
): Promise<Record<string, { kinds: Array<'symbol_reference' | 'call_reference' | 'jsx_reference' | 'type_reference'>; connectionCount: number }>> {
  if (!primarySymbol) {
    return {};
  }

  let repository: Awaited<ReturnType<typeof getRepositoryById>> | null = null;

  try {
    repository = await getRepositoryById(loadConfig().reposRoot, primarySymbol.repo);
  } catch {
    repository = null;
  }

  if (!repository) {
    return {};
  }

  let matches;

  try {
    matches = await findTypeScriptReferencesForIndexedSymbol(repository, primarySymbol);
  } catch {
    return {};
  }
  const fileIdByPath = new Map<string, string>();

  for (const relation of Object.values(relationsByFile)) {
    if (relation.repo === primarySymbol.repo) {
      fileIdByPath.set(relation.filePath, relation.fileId);
    }
  }

  const signalsByFileId: Record<string, { kinds: Array<'symbol_reference' | 'call_reference' | 'jsx_reference' | 'type_reference'>; connectionCount: number }> = {};

  for (const match of matches) {
    if (match.filePath === primarySymbol.filePath) {
      continue;
    }

    const fileId = fileIdByPath.get(match.filePath);

    if (!fileId) {
      continue;
    }

    const kinds = new Set<'symbol_reference' | 'call_reference' | 'jsx_reference' | 'type_reference'>();

    if (match.isCallReference) {
      kinds.add('call_reference');
    }

    if (match.isJsxReference) {
      kinds.add('jsx_reference');
    }

    if (match.isTypeReference) {
      kinds.add('type_reference');
    }

    if (kinds.size === 0) {
      kinds.add('symbol_reference');
    }

    const existing = signalsByFileId[fileId];

    if (!existing) {
      signalsByFileId[fileId] = {
        kinds: [...kinds],
        connectionCount: 1,
      };
      continue;
    }

    existing.connectionCount += 1;

    for (const kind of kinds) {
      if (!existing.kinds.includes(kind)) {
        existing.kinds.push(kind);
      }
    }
  }

  return signalsByFileId;
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
  const referenceSignalsByFileId = await buildReferenceSignalsByFileId(primarySymbol, index.byFile);
  const relatedFiles = primarySymbol
    ? await assembleRelatedFileContext(primarySymbol.fileId, {
        relatedLimit: query.relatedLimit,
        referenceSignalsByFileId,
      })
    : {
        items: [],
        totalCount: 0,
        buckets: {
          directConsumers: {
            kind: 'direct_consumers',
            label: 'Direct consumers (exact)',
            explanation: 'confirmed symbol-level usage',
            confidence: 'high',
            coverage: 'exact',
            entries: [],
            total: 0,
            shown: 0,
            truncated: false,
          },
          indirectConsumers: {
            kind: 'indirect_consumers',
            label: 'Indirect consumers (inferred)',
            explanation: 'likely usage via wrappers or re-exports',
            confidence: 'medium',
            coverage: 'inferred',
            entries: [],
            total: 0,
            shown: 0,
            truncated: false,
          },
          relatedContext: {
            kind: 'related_context',
            label: 'Related context (exploratory)',
            explanation: 'nearby or dependent files, not guaranteed direct usage',
            confidence: 'low',
            coverage: 'exploratory',
            entries: [],
            total: 0,
            shown: 0,
            truncated: false,
          },
        } satisfies RelatedFileContextBuckets,
      };
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
    relatedFileBuckets: relatedFiles.buckets,
    exportedSymbols,
  };
}
