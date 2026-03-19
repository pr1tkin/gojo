import { findPrecedentsInputSchema } from '../schemas.js';
import {
  createPrecedentDiscoveryService,
  getPatternMatchesForComponent,
  getPatternMatchesForFile,
  getPatternMatchesForSymbol,
} from '../orchestrator/index.js';
import type { FindPrecedentsToolInput } from '../types.js';
import {
  buildPatternTargetExplainability,
  buildPrecedentCandidateExplainability,
} from './explainability.js';
import {
  SharedContextBuilder,
  dedupeNavigationHints,
  splitPrimarySecondary,
  toScoreBucket,
  type ResponseShapingOptions,
} from './response-shaping.js';
import { buildPatternTrustMetadata, type ToolTrustMetadata } from './trust-metadata.js';
import {
  normalizeFindPrecedentsResponse,
  type FindPrecedentsRelationship,
  type RawFindPrecedentsResponse,
} from '../tool-response/normalize-find-precedents.js';

const DEFAULT_PRECEDENT_LIMIT = 3;

type GroundingStrength = 'strong' | 'partial' | 'weak' | 'unknown';

export const findPrecedentsToolDefinition = {
  name: 'find_precedents',
  title: 'Find Precedents',
  description: 'Find the strongest reusable implementation precedents for a file, symbol, or component.',
  visibility: 'public' as const,
  inputSchema: findPrecedentsInputSchema,
};

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function toGroundingStrength(
  structuralAlignment: {
    graphAnchored: boolean;
    structuralContextStrength: 'high' | 'medium' | 'low';
  } | null | undefined,
): GroundingStrength {
  if (!structuralAlignment) {
    return 'unknown';
  }

  if (!structuralAlignment.graphAnchored || structuralAlignment.structuralContextStrength === 'low') {
    return 'weak';
  }

  if (structuralAlignment.structuralContextStrength === 'medium') {
    return 'partial';
  }

  return 'strong';
}

function buildNavigationHints(input: {
  precedents: Array<{
    filePath: string;
    repoId: string;
  }>;
  familyRef?: string;
  relatedFamilyRefs?: string[];
  weakTarget?: boolean;
}): Array<Record<string, string>> {
  const hints: Array<Record<string, string>> = [];
  const [first, second] = input.precedents;

  if (first) {
    hints.push({
      type: 'open_first',
      filePath: first.filePath,
      repoId: first.repoId,
      reason: 'best reusable precedent',
    });
  }

  if (input.weakTarget) {
    return dedupeNavigationHints(hints, 1);
  }

  if (second) {
    hints.push({
      type: 'compare_next',
      filePath: second.filePath,
      repoId: second.repoId,
      reason: 'secondary precedent for contrast',
    });
  }

  const relatedFamily = input.relatedFamilyRefs?.[0];
  if (relatedFamily) {
    hints.push({
      type: 'inspect_related_family',
      familyRef: relatedFamily,
      reason: 'related implementation family nearby',
    });
  }

  if (input.familyRef) {
    hints.push({
      type: 'stay_in_family',
      familyRef: input.familyRef,
      reason: 'target belongs to a known precedent family',
    });
  }

  return dedupeNavigationHints(hints, 3);
}

function collectUniqueRefs(
  target: { familyRef?: string; clusterRef?: string } | null | undefined,
  precedents: Array<{ familyRef?: string; clusterRef?: string }>,
): {
  familyRefs: Set<string>;
  clusterRefs: Set<string>;
  familyReuse: boolean;
  clusterReuse: boolean;
} {
  const familyCounts = new Map<string, number>();
  const clusterCounts = new Map<string, number>();

  const register = (value: string | undefined, counts: Map<string, number>) => {
    if (!value) {
      return;
    }

    counts.set(value, (counts.get(value) ?? 0) + 1);
  };

  register(target?.familyRef, familyCounts);
  register(target?.clusterRef, clusterCounts);
  for (const precedent of precedents) {
    register(precedent.familyRef, familyCounts);
    register(precedent.clusterRef, clusterCounts);
  }

  return {
    familyRefs: new Set(familyCounts.keys()),
    clusterRefs: new Set(clusterCounts.keys()),
    familyReuse: Array.from(familyCounts.values()).some((count) => count > 1),
    clusterReuse: Array.from(clusterCounts.values()).some((count) => count > 1),
  };
}

function shouldUseMicroShaper(input: {
  precedentCount: number;
  targetGrounding: GroundingStrength;
  precedents: Array<{ confidence: string }>;
}): boolean {
  return (
    input.precedentCount <= 1 ||
    input.targetGrounding === 'weak' ||
    (input.precedentCount > 0 && input.precedents.every((entry) => entry.confidence === 'low'))
  );
}

function withAdditionalWarnings(metadata: ToolTrustMetadata, warnings: string[]): ToolTrustMetadata {
  const mergedWarnings = dedupe([...(metadata.warnings ?? []), ...warnings]);
  return {
    ...metadata,
    ...(mergedWarnings.length > 0 ? { warnings: mergedWarnings } : {}),
  };
}

export async function runFindPrecedentsTool(
  input: FindPrecedentsToolInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const mode = input.mode ?? 'component';
  const detail = input.detail ?? 'agent';
  const limit = input.limit ?? DEFAULT_PRECEDENT_LIMIT;
  const includeFamilyContext = input.includeFamilyContext ?? false;
  const shaping: ResponseShapingOptions = {
    detail,
    expandClusters: input.expandClusters,
    expandDebug: input.expandDebug,
    expandRelated: input.expandRelated,
  };
  const sharedContext = new SharedContextBuilder(shaping);
  const options = {
    repo: input.repo,
    limit: Math.max(limit, DEFAULT_PRECEDENT_LIMIT),
  };

  const patternContext =
    mode === 'file'
      ? await getPatternMatchesForFile(input.name, options)
      : mode === 'symbol'
        ? await getPatternMatchesForSymbol(input.name, options)
        : await getPatternMatchesForComponent(input.name, options);

  const targetExplainability = sharedContext.registerExplainability(
    await buildPatternTargetExplainability(patternContext.primaryTarget, detail),
  );
  const metadata = await buildPatternTrustMetadata(patternContext);
  const precedentService = await createPrecedentDiscoveryService();

  let precedentResult = null;
  if (patternContext.resolution.selectedCandidate?.symbolId) {
    precedentResult = precedentService.findPrecedentsForSymbol(patternContext.resolution.selectedCandidate.symbolId, limit);
  } else if (patternContext.primaryTarget.file?.fileId) {
    precedentResult = precedentService.findPrecedentsForFile(patternContext.primaryTarget.file.fileId, limit);
  }

  const targetRepoId =
    input.repo ??
    patternContext.primaryTarget.file?.repoId ??
    precedentResult?.target.repoId ??
    null;
  const scopedCandidates = precedentResult
    ? precedentResult.candidates.filter((candidate) => (targetRepoId ? candidate.repoId === targetRepoId : true))
    : [];
  const compactPrecedents = precedentResult
    ? await Promise.all(
        scopedCandidates.slice(0, limit).map(async (candidate, index) => {
          const explanation = sharedContext.registerExplainability(
            await buildPrecedentCandidateExplainability(
              candidate,
              targetExplainability?.familyRef ?? null,
              detail,
            ),
          );
          return {
            rank: index + 1,
            repoId: candidate.repoId,
            filePath: candidate.filePath,
            symbolName: candidate.symbolName,
            role: explanation?.role ?? 'module',
            confidence: explanation?.confidence ?? 'low',
            matchStrength: toScoreBucket(candidate.precedentScore),
            grounding: toGroundingStrength(candidate.structuralAlignment),
            relationship: (
              explanation?.explanationSignals?.familyMatch === true
                ? 'peer_family'
                : candidate.structuralAlignment.graphAnchored
                  ? 'structural_neighbor'
                  : 'heuristic_neighbor'
            ) as FindPrecedentsRelationship,
            selectionReason: explanation?.selectionReason ?? 'ranked precedent',
            ...(explanation?.familyRef ? { familyRef: explanation.familyRef } : {}),
            ...(explanation?.clusterRef ? { clusterRef: explanation.clusterRef } : {}),
            ...(explanation?.explanationSignals ? { explanationSignals: explanation.explanationSignals } : {}),
            ...(detail === 'debug' || input.expandDebug
              ? {
                  debug: {
                    precedentScore: candidate.precedentScore,
                    similarityScore: candidate.similarityScore,
                    reasonSignals: candidate.reasonSignals,
                    ...(explanation?.debug ? { explanation: explanation.debug } : {}),
                  },
                }
              : {}),
          };
        }),
      )
    : [];
  const precedents = splitPrimarySecondary(compactPrecedents, Math.min(2, compactPrecedents.length));

  const familyContext =
    includeFamilyContext && targetExplainability
      ? {
          role: targetExplainability.role,
          confidence: targetExplainability.confidence,
          ...(targetExplainability.familyRef ? { familyRef: targetExplainability.familyRef } : {}),
          ...(targetExplainability.clusterRef ? { clusterRef: targetExplainability.clusterRef } : {}),
          ...(targetExplainability.membership ? { membership: targetExplainability.membership } : {}),
        }
      : null;

  const target = {
    status: patternContext.resolution.status,
    filePath: patternContext.primaryTarget.file?.filePath ?? precedentResult?.target.filePath ?? null,
    repoId: patternContext.primaryTarget.file?.repoId ?? precedentResult?.target.repoId ?? null,
    symbolName:
      patternContext.primaryTarget.symbol?.name ??
      precedentResult?.target.symbolName ??
      (mode === 'file' ? null : input.name),
    confidence: targetExplainability?.confidence ?? 'low',
    grounding: toGroundingStrength(patternContext.primaryTarget.structuralAlignment),
    ...(targetExplainability?.role ? { role: targetExplainability.role } : {}),
    ...(targetExplainability?.familyRef ? { familyRef: targetExplainability.familyRef } : {}),
    ...(targetExplainability?.clusterRef ? { clusterRef: targetExplainability.clusterRef } : {}),
    resolution: {
      candidateCount: patternContext.resolution.candidateCount,
      ambiguityDetected: patternContext.resolution.ambiguityDetected,
    },
  };

  const microShaperEnabled = shouldUseMicroShaper({
    precedentCount: compactPrecedents.length,
    targetGrounding: target.grounding,
    precedents: compactPrecedents,
  });
  const refUsage = collectUniqueRefs(target, compactPrecedents);
  const collapseSharedContext =
    microShaperEnabled &&
    (refUsage.familyRefs.size <= 1 ||
      refUsage.clusterRefs.size <= 1 ||
      (!refUsage.familyReuse && !refUsage.clusterReuse));
  const builtSharedContext = collapseSharedContext ? undefined : sharedContext.build();
  const targetFamilyRefs =
    targetExplainability?.familyRef && builtSharedContext?.families?.[targetExplainability.familyRef]?.relatedFamilyRefs
      ? builtSharedContext.families[targetExplainability.familyRef].relatedFamilyRefs
      : [];
  const navigationHints = buildNavigationHints({
    precedents: [...precedents.primary, ...precedents.secondary].map((entry) => ({
      filePath: entry.filePath,
      repoId: entry.repoId,
    })),
    familyRef: targetExplainability?.familyRef,
    relatedFamilyRefs: targetFamilyRefs,
    weakTarget: microShaperEnabled && target.grounding === 'weak',
  });

  const shapedResults =
    microShaperEnabled && compactPrecedents.length <= 1
      ? {
          primary: precedents.primary,
        }
      : precedents;

  const shapedOutput: RawFindPrecedentsResponse = {
    requestedName: input.name,
    requestedRepo: input.repo,
    requestedMode: mode,
    explainabilityMode: detail,
    metadata: withAdditionalWarnings(
      metadata,
      [
        ...(compactPrecedents.length === 0 ? ['No reusable precedents were found for the resolved target'] : []),
        ...(precedentResult && scopedCandidates.length === 0 && precedentResult.candidates.length > 0
          ? ['No repo-local precedents remained after scoping results to the resolved target repository']
          : []),
      ],
    ),
    target,
    results: shapedResults,
    ...(builtSharedContext ? { sharedContext: builtSharedContext } : {}),
    ...(!microShaperEnabled && familyContext ? { familyContext } : {}),
    navigationHints,
    summary: microShaperEnabled
      ? {
          precedentCount: compactPrecedents.length,
          targetGrounding: target.grounding,
        }
      : {
          resultCount: compactPrecedents.length,
          strongMatches: compactPrecedents.filter((entry) => entry.confidence === 'high').length,
          targetGrounding: target.grounding,
        },
    ...(detail === 'debug' && precedentResult
      ? {
          debug: {
            serviceSummary:
              scopedCandidates.length === precedentResult.candidates.length
                ? precedentResult.summary
                : `Retained ${scopedCandidates.length} repo-local precedents after filtering cross-repository candidates.`,
            rawTarget: precedentResult.target,
          },
        }
      : {}),
    internal: {
      scopedCandidateCount: compactPrecedents.length,
      totalCandidateCount: scopedCandidates.length,
      appliedLimit: limit,
      navigationHintLimit: microShaperEnabled && target.grounding === 'weak' ? 1 : 3,
    },
  };
  const normalizedOutput = normalizeFindPrecedentsResponse({
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
