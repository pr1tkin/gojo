import { collectRefactorContextInputSchema } from '../schemas.js';
import { getCollectRefactorContext } from '../orchestrator/index.js';
import type { CollectRefactorContextInput } from '../types.js';
import {
  buildIndexedSymbolExplainability,
  buildNearbyFileExplainability,
  buildRefactorSymbolCandidateExplainability,
  buildRelatedFileExplainability,
} from './explainability.js';
import {
  SharedContextBuilder,
  dedupeNavigationHints,
  finalizeShapedResponse,
  splitPrimarySecondary,
  toScoreBucket,
  type ResponseShapingOptions,
} from './response-shaping.js';

export const collectRefactorContextToolDefinition = {
  name: 'collect_refactor_context',
  title: 'Collect Refactor Context',
  description: 'Assemble refactor impact context for a file, component, or symbol using existing graph and symbol signals.',
  visibility: 'public' as const,
  inputSchema: collectRefactorContextInputSchema,
};

function inferPathFromFileId(fileId: string | undefined): string | null {
  if (!fileId) {
    return null;
  }

  const separatorIndex = fileId.indexOf(':');
  return separatorIndex >= 0 ? fileId.slice(separatorIndex + 1) : fileId;
}

function inferRepoFromFileId(fileId: string | undefined): string | null {
  if (!fileId) {
    return null;
  }

  const separatorIndex = fileId.indexOf(':');
  return separatorIndex >= 0 ? fileId.slice(0, separatorIndex) : null;
}

function buildNavigationHints(input: {
  primaryRelatedFiles: Array<{ filePath?: string; repoId?: string }>;
  nearbyFiles: Array<{ filePath?: string }>;
  symbolCandidates: Array<{ filePath: string; name: string }>;
}): Array<Record<string, string>> {
  const hints: Array<Record<string, string>> = [];

  const [firstRelated] = input.primaryRelatedFiles;
  if (firstRelated?.filePath) {
    hints.push({
      type: 'open_related',
      filePath: firstRelated.filePath,
      ...(firstRelated.repoId ? { repoId: firstRelated.repoId } : {}),
      reason: 'highest-value neighboring file before refactor',
    });
  }

  const [firstNearby] = input.nearbyFiles;
  if (firstNearby?.filePath) {
    hints.push({
      type: 'inspect_nearby',
      filePath: firstNearby.filePath,
      reason: 'bundle or directory neighbor may need coordinated changes',
    });
  }

  const [firstCandidate] = input.symbolCandidates;
  if (firstCandidate) {
    hints.push({
      type: 'compare_candidate',
      filePath: firstCandidate.filePath,
      symbolName: firstCandidate.name,
      reason: 'alternate symbol candidate remains available',
    });
  }

  return dedupeNavigationHints(hints, 3);
}

export async function runCollectRefactorContextTool(
  input: CollectRefactorContextInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const detail = input.detail ?? 'agent';
  const shaping: ResponseShapingOptions = {
    detail,
    expandClusters: input.expandClusters,
    expandDebug: input.expandDebug,
    expandRelated: input.expandRelated,
  };
  const sharedContext = new SharedContextBuilder(shaping);
  const result = await getCollectRefactorContext({
    name: input.name,
    repo: input.repo,
    mode: input.mode ?? 'component',
    limit: input.limit,
  });
  const relatedFiles = await Promise.all(
    result.relatedFiles.map(async (entry, index) => {
      const explanation = sharedContext.registerExplainability(await buildRelatedFileExplainability(entry, detail));
      return {
        rank: index + 1,
        filePath: entry.file.filePath ?? inferPathFromFileId(entry.file.fileId),
        repoId: entry.file.repoId ?? inferRepoFromFileId(entry.file.fileId),
        via: entry.via.slice(0, 2),
        matchStrength: toScoreBucket(entry.score, { high: 22, medium: 12 }),
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
  const nearbyFiles = await Promise.all(
    result.nearbyFiles.map(async (entry) => {
      const explanation = sharedContext.registerExplainability(await buildNearbyFileExplainability(entry, detail));
      return {
        category: entry.category,
        filePath: entry.file.filePath ?? inferPathFromFileId(entry.file.fileId),
        repoId: entry.file.repoId ?? inferRepoFromFileId(entry.file.fileId),
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
  const symbolCandidates = await Promise.all(
    result.symbolCandidates.map(async (entry) => {
      const explanation = sharedContext.registerExplainability(
        await buildRefactorSymbolCandidateExplainability(entry, detail),
      );
      return {
        filePath: entry.filePath,
        repoId: entry.repo,
        name: entry.name,
        kind: entry.kind,
        exported: entry.exported,
        matchStrength: toScoreBucket(entry.score, { high: 12, medium: 7 }),
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
  const targetSymbol = result.target.symbol
    ? sharedContext.registerExplainability(await buildIndexedSymbolExplainability(result.target.symbol, detail))
    : null;
  const relatedTiers = splitPrimarySecondary(relatedFiles, Math.min(2, relatedFiles.length));
  const builtSharedContext = sharedContext.build();

  const target = {
    requestedName: result.target.requestedName,
    requestedMode: result.target.requestedMode,
    requestedRepo: result.target.repo,
    filePath:
      result.target.symbol?.filePath ??
      result.target.file?.filePath ??
      inferPathFromFileId(result.target.file?.fileId) ??
      null,
    repoId:
      result.target.symbol?.repo ??
      result.target.file?.repoId ??
      inferRepoFromFileId(result.target.file?.fileId) ??
      null,
    symbolId: result.target.symbol?.symbolId ?? null,
    symbolName: result.target.symbol?.name ?? null,
    ...(targetSymbol?.role ? { role: targetSymbol.role } : {}),
    ...(targetSymbol?.confidence ? { confidence: targetSymbol.confidence } : {}),
    ...(targetSymbol?.familyRef ? { familyRef: targetSymbol.familyRef } : {}),
    ...(targetSymbol?.clusterRef ? { clusterRef: targetSymbol.clusterRef } : {}),
    ...(targetSymbol?.membership ? { membership: targetSymbol.membership } : {}),
  };

  const shapedOutput = finalizeShapedResponse({
    requestedName: input.name,
    requestedRepo: input.repo,
    requestedMode: input.mode ?? 'component',
    explainabilityMode: detail,
    target,
    results: {
      primary: relatedTiers.primary,
      secondary: relatedTiers.secondary,
      ...(nearbyFiles.length > 0 ? { nearby: nearbyFiles.slice(0, input.expandRelated ? 6 : 3) } : {}),
      ...(symbolCandidates.length > 0 ? { candidates: symbolCandidates.slice(0, input.expandRelated ? 6 : 3) } : {}),
    },
    ...(builtSharedContext ? { sharedContext: builtSharedContext } : {}),
    navigationHints: buildNavigationHints({
      primaryRelatedFiles: relatedTiers.primary.map((entry) => ({
        filePath: entry.filePath,
        ...(entry.repoId ? { repoId: entry.repoId } : {}),
      })),
      nearbyFiles,
      symbolCandidates: symbolCandidates.map((entry) => ({
        filePath: entry.filePath,
        name: entry.name,
      })),
    }),
    summary: {
      resultCount: relatedFiles.length + nearbyFiles.length + symbolCandidates.length,
      strongMatches: relatedFiles.filter((entry) => entry.confidence === 'high').length,
      importingFileCount: result.summary.importingFileCount,
      importedFileCount: result.summary.importedFileCount,
      graphNeighborCount: result.summary.graphNeighborCount,
      notes: result.summary.notes,
    },
    ...(detail === 'debug' || input.expandDebug
      ? {
          debug: {
            rawSummary: result.summary,
          },
        }
      : {}),
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
