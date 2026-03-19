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
  splitPrimarySecondary,
  toScoreBucket,
  type ResponseShapingOptions,
} from './response-shaping.js';
import {
  normalizeCollectRefactorContextResponse,
  type RawCollectRefactorContextResponse,
} from '../tool-response/normalize-collect-refactor-context.js';

export const collectRefactorContextToolDefinition = {
  name: 'collect_refactor_context',
  title: 'Collect Refactor Context',
  description: 'Targeted refactor-impact tool for bounded context, nearby files, and change-surface analysis.',
  visibility: 'public' as const,
  role: 'specialist' as const,
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
    status: (result.target.symbol || result.target.file ? 'resolved' : 'missing') as 'resolved' | 'missing',
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
    resolution: {
      candidateCount: result.summary.symbolCandidateCount,
      ambiguityDetected: result.summary.ambiguityDetected,
    },
    symbolSurface: {
      defined: result.definedSymbols
        .map((entry) => entry.name)
        .filter((value): value is string => Boolean(value))
        .slice(0, 8),
      exported: result.exportedSymbols
        .map((entry) => entry.name)
        .filter((value): value is string => Boolean(value))
        .slice(0, 8),
    },
  };

  const shapedOutput: RawCollectRefactorContextResponse = {
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
      reexportingFileCount: result.summary.reexportingFileCount,
      reexportedFileCount: result.summary.reexportedFileCount,
      graphNeighborCount: result.summary.graphNeighborCount,
      nearbyFileCount: result.summary.nearbyFileCount,
      relatedFileCount: result.summary.relatedFileCount,
      definedSymbolCount: result.summary.definedSymbolCount,
      exportedSymbolCount: result.summary.exportedSymbolCount,
      notes: result.summary.notes,
    },
    context: {
      importingFiles: result.importingFiles.map((entry) => inferPathFromFileId(entry.fileId)).filter((value): value is string => Boolean(value)),
      importedFiles: result.importedFiles.map((entry) => inferPathFromFileId(entry.fileId)).filter((value): value is string => Boolean(value)),
      reexportingFiles: result.reexportingFiles.map((entry) => inferPathFromFileId(entry.fileId)).filter((value): value is string => Boolean(value)),
      reexportedFiles: result.reexportedFiles.map((entry) => inferPathFromFileId(entry.fileId)).filter((value): value is string => Boolean(value)),
      graphNeighbors: result.graphNeighbors.map((entry) => inferPathFromFileId(entry.fileId)).filter((value): value is string => Boolean(value)),
      definedSymbols: result.definedSymbols.map((entry) => entry.name).filter((value): value is string => Boolean(value)),
      exportedSymbols: result.exportedSymbols.map((entry) => entry.name).filter((value): value is string => Boolean(value)),
    },
    ...(detail === 'debug' || input.expandDebug
      ? {
          debug: {
            rawSummary: result.summary,
          },
        }
      : {}),
    internal: {
      returnedRelatedCount: relatedFiles.length,
      totalRelatedCount: result.summary.relatedFileCount,
      appliedRelatedLimit: input.limit,
      returnedNearbyCount: Math.min(nearbyFiles.length, input.expandRelated ? 6 : 3),
      totalNearbyCount: result.summary.nearbyFileCount,
      appliedNearbyLimit: input.expandRelated ? 6 : 3,
      returnedCandidateCount: Math.min(symbolCandidates.length, input.expandRelated ? 6 : 3),
      totalCandidateCount: result.summary.symbolCandidateCount,
      appliedCandidateLimit: input.expandRelated ? 6 : 3,
      navigationHintLimit: 3,
    },
  };
  const normalizedOutput = normalizeCollectRefactorContextResponse({
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
