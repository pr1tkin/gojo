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
  splitPrimarySecondary,
  toScoreBucket,
  type ResponseShapingOptions,
} from './response-shaping.js';
import { buildExploreComponentTrustMetadata } from './trust-metadata.js';
import {
  normalizeExploreComponentResponse,
  type RawExploreComponentResponse,
  type RawExploreComponentUiTreeNode,
} from '../tool-response/normalize-explore-component.js';
import type { RelatedFileContextBucket } from '../context/types.js';
import type { RelatedFileContextBuckets } from '../context/types.js';

const DEFAULT_CANDIDATE_LIMIT = 5;
const DEFAULT_RELATED_LIMIT = 10;

interface CompactTreeNode {
  name?: string | null;
  resolution?: string | null;
  filePath?: string;
  symbolId?: string;
  hint?: string;
  source?: string;
  children?: CompactTreeNode[];
}

export const exploreComponentToolDefinition = {
  name: 'explore_component',
  title: 'Explore Component',
  description: 'Targeted component inspection tool for structure, dependencies, role, and UI context.',
  visibility: 'public' as const,
  role: 'specialist' as const,
  inputSchema: exploreComponentInputSchema,
};

function compactTreeNodes(
  nodes: CompactTreeNode[] | null | undefined,
  options: { expandRelated?: boolean },
): RawExploreComponentUiTreeNode[] {
  return (nodes ?? []).map((node) => ({
    name: node.name ?? 'unknown',
    resolution: node.resolution ?? 'unresolved',
    ...(node.filePath ? { filePath: node.filePath } : {}),
    ...(node.symbolId ? { symbolId: node.symbolId } : {}),
    ...(node.hint ? { hint: node.hint } : {}),
    ...(node.source ? { source: node.source } : {}),
    ...(options.expandRelated && Array.isArray(node.children) && node.children.length > 0
      ? {
          children: node.children.map((child) => ({
            name: child.name ?? 'unknown',
            resolution: child.resolution ?? 'unresolved',
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

function createEmptyRelatedBuckets(): RelatedFileContextBuckets {
  return {
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
  };
}

function buildRawBucket(
  bucket: RelatedFileContextBucket,
  entries: RawExploreComponentResponse['results']['primary'],
): NonNullable<RawExploreComponentResponse['direct_consumers']> {
  return {
    label: bucket.label,
    explanation: bucket.explanation,
    entries,
    total: bucket.total,
    shown: bucket.shown,
    truncated: bucket.truncated,
    confidence: bucket.confidence,
    coverage: bucket.coverage,
  };
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
  const ambiguityDetected = symbolContext.summary.ambiguityDetected;
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
  const relatedFilesByPath = new Map(relatedFiles.map((entry) => [entry.filePath, entry]));
  const relatedBuckets = fileContext?.relatedFileBuckets ?? symbolContext.relatedFileBuckets ?? createEmptyRelatedBuckets();
  const directBucketEntries = relatedBuckets.directConsumers.entries
    .map((entry: RelatedFileContextBucket['entries'][number]) => relatedFilesByPath.get(entry.file.filePath))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const indirectBucketEntries = relatedBuckets.indirectConsumers.entries
    .map((entry: RelatedFileContextBucket['entries'][number]) => relatedFilesByPath.get(entry.file.filePath))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const relatedContextBucketEntries = relatedBuckets.relatedContext.entries
    .map((entry: RelatedFileContextBucket['entries'][number]) => relatedFilesByPath.get(entry.file.filePath))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const resolvedPrimarySymbolExplanation = symbolContext.primarySymbol
    ? sharedContext.registerExplainability(await buildIndexedSymbolExplainability(symbolContext.primarySymbol, detail))
    : null;

  const relatedTiers = splitPrimarySecondary(relatedFiles, Math.min(2, relatedFiles.length));
  const builtSharedContext = sharedContext.build();

  const target = {
    status: (symbolContext.primarySymbol ? 'resolved' : 'missing') as 'resolved' | 'missing',
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
      candidateCount: symbolContext.summary.totalCandidateCount,
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

  const shapedOutput: RawExploreComponentResponse = {
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
    direct_consumers: buildRawBucket(relatedBuckets.directConsumers, directBucketEntries),
    indirect_consumers: buildRawBucket(relatedBuckets.indirectConsumers, indirectBucketEntries),
    related_context: buildRawBucket(relatedBuckets.relatedContext, relatedContextBucketEntries),
    summary: {
      resultCount: relatedFiles.length,
      strongMatches: relatedFiles.filter((entry) => entry.confidence === 'high').length,
      relatedFileCount: relatedFiles.length,
      alternativeCandidateCount: Math.max(candidateSummaries.length - 1, 0),
      uiCompleteness: uiHierarchy?.renderTreeSummary.completeness ?? null,
    },
    internal: {
      totalRelatedCount:
        fileContext?.summary.totalRelatedFileCount ?? symbolContext.summary.totalRelatedFileCount,
      returnedRelatedCount: relatedFiles.length,
      appliedRelatedLimit: input.relatedLimit ?? DEFAULT_RELATED_LIMIT,
      totalCandidateCount: symbolContext.summary.totalCandidateCount,
      returnedCandidateCount: candidateSummaries.length,
      appliedCandidateLimit: input.limit ?? DEFAULT_CANDIDATE_LIMIT,
      navigationHintLimit: 3,
    },
  };
  const normalizedOutput = normalizeExploreComponentResponse({
    rawResponse: shapedOutput,
    mode: detail,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(normalizedOutput, null, 2),
      },
    ],
  };
}
