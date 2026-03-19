import { exploreComponentInputSchema } from '../schemas.js';
import {
  getFileExplorationContext,
  getSymbolExplorationContext,
  getUiHierarchySummary,
} from '../orchestrator/index.js';
import type { ExploreComponentInput } from '../types.js';
import {
  buildIndexedSymbolExplainability,
  buildRelatedFileExplainability,
  buildSymbolCandidateExplainability,
} from './explainability.js';
import { buildExploreComponentTrustMetadata } from './trust-metadata.js';

const DEFAULT_CANDIDATE_LIMIT = 5;
const DEFAULT_RELATED_LIMIT = 10;

export const exploreComponentToolDefinition = {
  name: 'explore_component',
  title: 'Explore Component',
  description: 'Explore the structure and context of a component or symbol in a repository.',
  inputSchema: exploreComponentInputSchema,
};

function buildCandidateSummary(
  entry: Awaited<ReturnType<typeof getSymbolExplorationContext>>['rankedSymbols'][number],
) {
  return {
    symbolId: entry.item.symbolId,
    fileId: entry.item.fileId,
    repo: entry.item.repo,
    filePath: entry.item.filePath,
    name: entry.item.name,
    kind: entry.item.kind,
    exported: Boolean(entry.item.exported),
    score: entry.score,
    reasons: entry.reasons,
  };
}

export async function runExploreComponentTool(
  input: ExploreComponentInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const detail = input.detail ?? 'agent';
  const symbolContext = await getSymbolExplorationContext(input.name, {
    repo: input.repo,
    limit: input.limit ?? DEFAULT_CANDIDATE_LIMIT,
    relatedLimit: input.relatedLimit ?? DEFAULT_RELATED_LIMIT,
  });

  const primaryFileId = symbolContext.primaryFile?.fileId ?? symbolContext.primarySymbol?.fileId ?? null;
  const fileContext = primaryFileId
    ? await getFileExplorationContext(primaryFileId, {
        relatedLimit: input.relatedLimit ?? DEFAULT_RELATED_LIMIT,
      })
    : null;
  const candidateSummaries = await Promise.all(
    symbolContext.rankedSymbols.map(async (entry) => {
      const summary = buildCandidateSummary(entry);
      return {
        ...summary,
        explanation: await buildSymbolCandidateExplainability(summary, detail),
      };
    }),
  );
  const ambiguityDetected = candidateSummaries.length > 1;
  const uiHierarchy =
    symbolContext.primarySymbol && (fileContext?.primaryFile ?? symbolContext.primaryFile)
      ? await getUiHierarchySummary({
          filePath: symbolContext.primarySymbol.filePath,
          symbolId: symbolContext.primarySymbol.symbolId,
          symbolName: symbolContext.primarySymbol.name,
        })
      : null;
  const relatedFiles = await Promise.all(
    (fileContext?.relatedFiles ?? symbolContext.relatedFiles).map(async (entry) => ({
      ...entry,
      explanation: await buildRelatedFileExplainability(entry, detail),
    })),
  );
  const resolvedPrimarySymbol = symbolContext.primarySymbol
    ? {
        ...symbolContext.primarySymbol,
        explanation: await buildIndexedSymbolExplainability(symbolContext.primarySymbol, detail),
      }
    : null;

  const result = {
    requestedName: input.name,
    requestedRepo: input.repo,
    explainabilityMode: detail,
    resolution: {
      status: symbolContext.primarySymbol ? 'resolved' : 'missing',
      candidateCount: candidateSummaries.length,
      ambiguityDetected,
      selectedCandidate: candidateSummaries[0] ?? null,
      alternativeCandidates: ambiguityDetected ? candidateSummaries.slice(1) : [],
    },
    resolvedPrimarySymbol,
    resolvedPrimaryFile: fileContext?.primaryFile ?? symbolContext.primaryFile,
    relatedFiles,
    definedSymbols: fileContext?.definedSymbols ?? [],
    exportedSymbols: fileContext?.exportedSymbols ?? symbolContext.exportedSymbols,
    ...(uiHierarchy ? { uiHierarchy } : {}),
    metadata: await buildExploreComponentTrustMetadata({
      renderTree: uiHierarchy?.renderTree,
      completeness: uiHierarchy?.renderTreeSummary.completeness,
    }),
    summary: {
      relatedFileCount: relatedFiles.length,
      definedSymbolCount: fileContext?.definedSymbols.length ?? 0,
      exportedSymbolCount: (fileContext?.exportedSymbols ?? symbolContext.exportedSymbols).length,
    },
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
