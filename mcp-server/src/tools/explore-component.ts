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
import {
  SharedContextBuilder,
  dedupeNavigationHints,
  finalizeShapedResponse,
  splitPrimarySecondary,
  toScoreBucket,
  type ResponseShapingOptions,
} from './response-shaping.js';
import { buildExploreComponentTrustMetadata } from './trust-metadata.js';

const DEFAULT_CANDIDATE_LIMIT = 5;
const DEFAULT_RELATED_LIMIT = 10;

export const exploreComponentToolDefinition = {
  name: 'explore_component',
  title: 'Explore Component',
  description: 'Explore the structure and context of a component or symbol in a repository.',
  visibility: 'public' as const,
  inputSchema: exploreComponentInputSchema,
};

function compactTreeNodes(
  nodes: Array<Record<string, any>> | null | undefined,
  options: { expandRelated?: boolean },
): Array<Record<string, unknown>> {
  return (nodes ?? []).map((node) => ({
    name: node.name,
    resolution: node.resolution,
    ...(node.filePath ? { filePath: node.filePath } : {}),
    ...(node.symbolId ? { symbolId: node.symbolId } : {}),
    ...(node.hint ? { hint: node.hint } : {}),
    ...(node.source ? { source: node.source } : {}),
    ...(options.expandRelated && Array.isArray(node.children) && node.children.length > 0
      ? {
          children: node.children.map((child: Record<string, any>) => ({
            name: child.name,
            resolution: child.resolution,
            ...(child.filePath ? { filePath: child.filePath } : {}),
            ...(child.symbolId ? { symbolId: child.symbolId } : {}),
            ...(child.hint ? { hint: child.hint } : {}),
            ...(child.source ? { source: child.source } : {}),
          })),
        }
      : {}),
  }));
}

function buildNavigationHints(input: {
  primaryRelatedFiles: Array<{ filePath: string; repoId?: string }>;
  alternativeCandidates: Array<{ filePath: string; name: string }>;
  uiCompleteness?: number;
}): Array<Record<string, string>> {
  const hints: Array<Record<string, string>> = [];
  const [firstRelated] = input.primaryRelatedFiles;
  const [firstAlternative] = input.alternativeCandidates;

  if (firstRelated) {
    hints.push({
      type: 'open_related',
      filePath: firstRelated.filePath,
      ...(firstRelated.repoId ? { repoId: firstRelated.repoId } : {}),
      reason: 'strongest neighboring implementation context',
    });
  }

  if (firstAlternative) {
    hints.push({
      type: 'compare_candidate',
      filePath: firstAlternative.filePath,
      symbolName: firstAlternative.name,
      reason: 'alternate symbol candidate remains available',
    });
  }

  if (input.uiCompleteness !== undefined && input.uiCompleteness < 0.6) {
    hints.push({
      type: 'inspect_ui_gaps',
      reason: 'UI tree is only partially resolved',
    });
  }

  return dedupeNavigationHints(hints, 3);
}

function compactSymbolSurface(entries: Array<{ name: string; kind?: string }>, limit = 5): string[] {
  return Array.from(new Set(entries.map((entry) => entry.name).filter(Boolean))).slice(0, limit);
}

export async function runExploreComponentTool(
  input: ExploreComponentInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const detail = input.detail ?? 'agent';
  const shaping: ResponseShapingOptions = {
    detail,
    expandClusters: input.expandClusters,
    expandDebug: input.expandDebug,
    expandRelated: input.expandRelated,
  };
  const sharedContext = new SharedContextBuilder(shaping);
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
      const explanation = sharedContext.registerExplainability(
        await buildSymbolCandidateExplainability(
          {
            symbolId: entry.item.symbolId,
            fileId: entry.item.fileId,
            repo: entry.item.repo,
            filePath: entry.item.filePath,
            name: entry.item.name,
            kind: entry.item.kind,
            exported: Boolean(entry.item.exported),
            score: entry.score,
            reasons: entry.reasons,
          },
          detail,
        ),
      );
      return {
        symbolId: entry.item.symbolId,
        fileId: entry.item.fileId,
        repoId: entry.item.repo,
        filePath: entry.item.filePath,
        name: entry.item.name,
        kind: entry.item.kind,
        exported: Boolean(entry.item.exported),
        matchStrength: toScoreBucket(entry.score, { high: 14, medium: 8 }),
        ...(explanation?.role ? { role: explanation.role } : {}),
        ...(explanation?.confidence ? { confidence: explanation.confidence } : {}),
        ...(explanation?.familyRef ? { familyRef: explanation.familyRef } : {}),
        ...(explanation?.clusterRef ? { clusterRef: explanation.clusterRef } : {}),
        ...(explanation?.membership ? { membership: explanation.membership } : {}),
        ...(explanation?.selectionReason ? { selectionReason: explanation.selectionReason } : {}),
        ...(explanation?.explanationSignals ? { explanationSignals: explanation.explanationSignals } : {}),
        ...(detail === 'debug' || input.expandDebug ? { debug: explanation?.debug } : {}),
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
    (fileContext?.relatedFiles ?? symbolContext.relatedFiles).map(async (entry, index) => {
      const explanation = sharedContext.registerExplainability(await buildRelatedFileExplainability(entry, detail));
      return {
        rank: index + 1,
        filePath: entry.file.filePath,
        repoId: entry.file.repoId,
        via: entry.via.slice(0, 2),
        matchStrength: toScoreBucket(entry.score, { high: 24, medium: 14 }),
        ...(explanation?.role ? { role: explanation.role } : {}),
        ...(explanation?.confidence ? { confidence: explanation.confidence } : {}),
        ...(explanation?.familyRef ? { familyRef: explanation.familyRef } : {}),
        ...(explanation?.clusterRef ? { clusterRef: explanation.clusterRef } : {}),
        ...(explanation?.membership ? { membership: explanation.membership } : {}),
        ...(explanation?.selectionReason ? { selectionReason: explanation.selectionReason } : {}),
        ...(explanation?.explanationSignals ? { explanationSignals: explanation.explanationSignals } : {}),
        ...(detail === 'debug' || input.expandDebug ? { debug: explanation?.debug } : {}),
      };
    }),
  );
  const resolvedPrimarySymbolExplanation = symbolContext.primarySymbol
    ? sharedContext.registerExplainability(await buildIndexedSymbolExplainability(symbolContext.primarySymbol, detail))
    : null;

  const relatedTiers = splitPrimarySecondary(relatedFiles, Math.min(2, relatedFiles.length));
  const builtSharedContext = sharedContext.build();

  const target = {
    status: symbolContext.primarySymbol ? 'resolved' : 'missing',
    requestedName: input.name,
    requestedRepo: input.repo,
    symbolId: symbolContext.primarySymbol?.symbolId ?? null,
    symbolName: symbolContext.primarySymbol?.name ?? input.name,
    filePath: (fileContext?.primaryFile ?? symbolContext.primaryFile)?.filePath ?? null,
    repoId: (fileContext?.primaryFile ?? symbolContext.primaryFile)?.repoId ?? null,
    ...(resolvedPrimarySymbolExplanation?.role ? { role: resolvedPrimarySymbolExplanation.role } : {}),
    ...(resolvedPrimarySymbolExplanation?.confidence ? { confidence: resolvedPrimarySymbolExplanation.confidence } : {}),
    ...(resolvedPrimarySymbolExplanation?.familyRef ? { familyRef: resolvedPrimarySymbolExplanation.familyRef } : {}),
    ...(resolvedPrimarySymbolExplanation?.clusterRef ? { clusterRef: resolvedPrimarySymbolExplanation.clusterRef } : {}),
    ...(resolvedPrimarySymbolExplanation?.membership ? { membership: resolvedPrimarySymbolExplanation.membership } : {}),
    resolution: {
      candidateCount: candidateSummaries.length,
      ambiguityDetected,
    },
    symbolSurface: {
      defined: compactSymbolSurface(fileContext?.definedSymbols ?? []),
      exported: compactSymbolSurface(fileContext?.exportedSymbols ?? symbolContext.exportedSymbols),
    },
    ...(uiHierarchy
      ? {
          ui: {
            renderTreeSummary: uiHierarchy.renderTreeSummary,
            renderedByTreeSummary: uiHierarchy.renderedByTreeSummary,
            observedProps: uiHierarchy.observedProps.slice(0, 5),
          },
        }
      : {}),
  };

  const shapedOutput = finalizeShapedResponse({
    requestedName: input.name,
    requestedRepo: input.repo,
    explainabilityMode: detail,
    metadata: await buildExploreComponentTrustMetadata({
      renderTree: uiHierarchy?.renderTree,
      completeness: uiHierarchy?.renderTreeSummary.completeness,
    }),
    target,
    results: {
      primary: relatedTiers.primary,
      secondary: relatedTiers.secondary,
      ...(ambiguityDetected ? { alternatives: candidateSummaries.slice(1) } : {}),
      ...(uiHierarchy
        ? {
            ui: {
              renders: compactTreeNodes(uiHierarchy.renderTree, { expandRelated: input.expandRelated }),
              renderedBy: compactTreeNodes(uiHierarchy.renderedByTree, { expandRelated: input.expandRelated }),
            },
          }
        : {}),
    },
    ...(builtSharedContext ? { sharedContext: builtSharedContext } : {}),
    navigationHints: buildNavigationHints({
      primaryRelatedFiles: relatedTiers.primary.map((entry) => ({
        filePath: entry.filePath,
        ...(entry.repoId ? { repoId: entry.repoId } : {}),
      })),
      alternativeCandidates: candidateSummaries.slice(1).map((entry) => ({
        filePath: entry.filePath,
        name: entry.name,
      })),
      uiCompleteness: uiHierarchy?.renderTreeSummary.completeness,
    }),
    summary: {
      resultCount: relatedFiles.length,
      strongMatches: relatedFiles.filter((entry) => entry.confidence === 'high').length,
      relatedFileCount: relatedFiles.length,
      alternativeCandidateCount: Math.max(candidateSummaries.length - 1, 0),
      uiCompleteness: uiHierarchy?.renderTreeSummary.completeness ?? null,
    },
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(shapedOutput, null, 2),
      },
    ],
  };
}
