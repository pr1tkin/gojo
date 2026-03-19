import { searchPatternsInputSchema } from '../schemas.js';
import {
  getPatternMatchesForComponent,
  getPatternMatchesForFile,
  getPatternMatchesForSymbol,
} from '../orchestrator/index.js';
import type { SearchPatternsInput } from '../types.js';
import {
  buildPatternMatchExplainability,
  buildPatternResolutionExplainability,
  buildPatternTargetExplainability,
} from './explainability.js';
import {
  SharedContextBuilder,
  dedupeNavigationHints,
  finalizeShapedResponse,
  splitPrimarySecondary,
  toScoreBucket,
  type ResponseShapingOptions,
} from './response-shaping.js';
import { buildPatternTrustMetadata } from './trust-metadata.js';

const DEFAULT_MATCH_LIMIT = 6;

function buildNavigationHints(input: {
  fileMatches: Array<{ filePath: string; repoId?: string | null }>;
  targetFamilyRef?: string;
  relatedFamilyRefs?: string[];
}): Array<Record<string, string>> {
  const hints: Array<Record<string, string>> = [];
  const [first, second] = input.fileMatches;

  if (first) {
    hints.push({
      type: 'open_first',
      filePath: first.filePath,
      ...(first.repoId ? { repoId: first.repoId } : {}),
      reason: 'strongest similar implementation',
    });
  }

  if (second) {
    hints.push({
      type: 'compare_next',
      filePath: second.filePath,
      ...(second.repoId ? { repoId: second.repoId } : {}),
      reason: 'secondary match for contrast',
    });
  }

  const relatedFamilyRef = input.relatedFamilyRefs?.[0];
  if (relatedFamilyRef) {
    hints.push({
      type: 'inspect_related_family',
      familyRef: relatedFamilyRef,
      reason: 'neighboring implementation family',
    });
  }

  if (input.targetFamilyRef) {
    hints.push({
      type: 'stay_in_family',
      familyRef: input.targetFamilyRef,
      reason: 'target belongs to a known pattern family',
    });
  }

  return dedupeNavigationHints(hints, 3);
}

export const searchPatternsToolDefinition = {
  name: 'search_patterns',
  title: 'Search Patterns',
  description: 'Find similar implementations and repository precedents using heuristic pattern discovery.',
  visibility: 'internal' as const,
  inputSchema: searchPatternsInputSchema,
};

export async function runSearchPatternsTool(
  input: SearchPatternsInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const mode = input.mode ?? 'component';
  const detail = input.detail ?? 'agent';
  const shaping: ResponseShapingOptions = {
    detail,
    expandClusters: input.expandClusters,
    expandDebug: input.expandDebug,
    expandRelated: input.expandRelated,
  };
  const sharedContext = new SharedContextBuilder(shaping);
  const options = {
    repo: input.repo,
    limit: input.limit ?? DEFAULT_MATCH_LIMIT,
  };

  const result =
    mode === 'file'
      ? await getPatternMatchesForFile(input.name, options)
      : mode === 'symbol'
        ? await getPatternMatchesForSymbol(input.name, options)
        : await getPatternMatchesForComponent(input.name, options);
  const metadata = await buildPatternTrustMetadata(result);
  const primaryTargetExplanation = sharedContext.registerExplainability(
    await buildPatternTargetExplainability(result.primaryTarget, detail),
  );
  const resolution = await buildPatternResolutionExplainability(result.resolution, detail);
  const targetFamilyRef = primaryTargetExplanation?.familyRef ?? result.primaryTarget.explanation?.family ?? null;
  const patternMatches = await Promise.all(
    result.patternMatches.map(async (entry, index) => {
      const explanation = sharedContext.registerExplainability(
        await buildPatternMatchExplainability(entry, targetFamilyRef, detail),
      );
      return {
        rank: index + 1,
        filePath: entry.file.filePath,
        ...(entry.file.repoId ? { repoId: entry.file.repoId } : {}),
        role: explanation?.role ?? 'module',
        confidence: explanation?.confidence ?? 'low',
        matchStrength: toScoreBucket(entry.score, { high: 18, medium: 10 }),
        structuralAlignment: {
          graphAnchored: entry.structuralAlignment.graphAnchored,
          structuralContextStrength: entry.structuralAlignment.structuralContextStrength,
        },
        selectionReason: explanation?.selectionReason ?? entry.reason,
        ...(explanation?.familyRef ? { familyRef: explanation.familyRef } : {}),
        ...(explanation?.clusterRef ? { clusterRef: explanation.clusterRef } : {}),
        ...(explanation?.membership ? { membership: explanation.membership } : {}),
        ...(explanation?.explanationSignals ? { explanationSignals: explanation.explanationSignals } : {}),
        ...(detail === 'debug' || input.expandDebug
          ? {
              debug: {
                score: entry.score,
                rawReason: entry.reason,
                rawReasons: entry.reasons,
                ...(explanation?.debug ? { explanation: explanation.debug } : {}),
              },
            }
          : {}),
      };
    }),
  );
  const shapedMatches = splitPrimarySecondary(patternMatches, Math.min(2, patternMatches.length));
  const builtSharedContext = sharedContext.build();
  const targetRelatedFamilies =
    targetFamilyRef && builtSharedContext?.families?.[targetFamilyRef]?.relatedFamilyRefs
      ? builtSharedContext.families[targetFamilyRef].relatedFamilyRefs
      : [];

  const target = {
    status: result.resolution.status,
    mode,
    requestedName: input.name,
    requestedRepo: input.repo,
    filePath: result.primaryTarget.file?.filePath ?? null,
    repoId: result.primaryTarget.file?.repoId ?? null,
    symbolName: result.primaryTarget.symbol?.name ?? (mode === 'file' ? null : input.name),
    confidence: primaryTargetExplanation?.confidence ?? 'low',
    structuralAlignment: result.primaryTarget.structuralAlignment
      ? {
          graphAnchored: result.primaryTarget.structuralAlignment.graphAnchored,
          structuralContextStrength: result.primaryTarget.structuralAlignment.structuralContextStrength,
        }
      : null,
    ...(primaryTargetExplanation?.role ? { role: primaryTargetExplanation.role } : {}),
    ...(primaryTargetExplanation?.familyRef ? { familyRef: primaryTargetExplanation.familyRef } : {}),
    ...(primaryTargetExplanation?.clusterRef ? { clusterRef: primaryTargetExplanation.clusterRef } : {}),
    ...(primaryTargetExplanation?.membership ? { membership: primaryTargetExplanation.membership } : {}),
    resolution: {
      candidateCount: resolution.candidateCount,
      ambiguityDetected: resolution.ambiguityDetected,
    },
  };

  const shapedOutput = finalizeShapedResponse({
    requestedName: input.name,
    requestedRepo: input.repo,
    requestedMode: mode,
    explainabilityMode: detail,
    metadata,
    target,
    results: shapedMatches,
    ...(builtSharedContext ? { sharedContext: builtSharedContext } : {}),
    navigationHints: buildNavigationHints({
      fileMatches: [...shapedMatches.primary, ...shapedMatches.secondary].map((entry) => ({
        filePath: entry.filePath,
        repoId: 'repoId' in entry ? entry.repoId : null,
      })),
      targetFamilyRef: primaryTargetExplanation?.familyRef,
      relatedFamilyRefs: targetRelatedFamilies,
    }),
    summary: {
      matchCount: result.summary.matchCount,
      strongMatches: patternMatches.filter((entry) => entry.confidence === 'high').length,
      graphAnchoredMatches: result.summary.graphAnchoredMatchCount,
    },
    ...(detail === 'debug' || input.expandDebug
      ? {
          debug: {
            resolution,
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
