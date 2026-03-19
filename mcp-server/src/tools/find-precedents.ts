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
import { buildPatternTrustMetadata, type ToolTrustMetadata } from './trust-metadata.js';

const DEFAULT_PRECEDENT_LIMIT = 3;

type GroundingStrength = 'strong' | 'partial' | 'weak' | 'unknown';

interface CompactClusterRef {
  parentClusterId: string;
  subClusterId?: string;
  clusterRole?: string;
  membership: 'core' | 'peripheral' | 'unknown';
  relatedFamilies?: string[];
  relatedClusterIds?: string[];
}

export const findPrecedentsToolDefinition = {
  name: 'find_precedents',
  title: 'Find Precedents',
  description: 'Find the strongest reusable implementation precedents for a file, symbol, or component.',
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

function toClusterRef(
  explanation: {
    clusterContext?: {
      parentClusterId?: string;
      subClusterId?: string;
      clusterRole?: string;
      isCoreMember?: boolean;
      relatedClusterIds?: string[];
    };
    relatedContext?: {
      neighborTypes?: string[];
    };
  } | null | undefined,
  detail: 'agent' | 'debug',
): CompactClusterRef | null {
  const clusterContext = explanation?.clusterContext;

  if (!clusterContext?.parentClusterId) {
    return null;
  }

  return {
    parentClusterId: clusterContext.parentClusterId,
    ...(clusterContext.subClusterId ? { subClusterId: clusterContext.subClusterId } : {}),
    ...(clusterContext.clusterRole ? { clusterRole: clusterContext.clusterRole } : {}),
    membership:
      clusterContext.isCoreMember === true
        ? 'core'
        : clusterContext.isCoreMember === false
          ? 'peripheral'
          : 'unknown',
    ...(explanation?.relatedContext?.neighborTypes?.length
      ? { relatedFamilies: explanation.relatedContext.neighborTypes.slice(0, 3) }
      : {}),
    ...(detail === 'debug' && clusterContext.relatedClusterIds?.length
      ? { relatedClusterIds: clusterContext.relatedClusterIds.slice(0, 3) }
      : {}),
  };
}

function summarizeSelectionReason(reason: string): string {
  return reason;
}

function buildNavigationHints(input: {
  precedents: Array<{
    filePath: string;
    repoId: string;
    symbolName: string;
    selectionReason: string;
    family?: string | null;
  }>;
  familyContext: {
    family?: string | null;
    relatedFamilies?: string[];
  } | null;
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

  if (second) {
    hints.push({
      type: 'compare_next',
      filePath: second.filePath,
      repoId: second.repoId,
      reason: 'secondary precedent for contrast',
    });
  }

  const relatedFamily = input.familyContext?.relatedFamilies?.[0];
  if (relatedFamily) {
    hints.push({
      type: 'inspect_related_family',
      family: relatedFamily,
      reason: 'related implementation family nearby',
    });
  }

  return hints.slice(0, 3);
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
  const includeFamilyContext = input.includeFamilyContext ?? true;
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

  const targetExplanation = await buildPatternTargetExplainability(patternContext.primaryTarget, detail);
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
  const precedents = precedentResult
    ? await Promise.all(
        scopedCandidates.slice(0, limit).map(async (candidate, index) => {
          const explanation = await buildPrecedentCandidateExplainability(
            candidate,
            targetExplanation?.family ?? null,
            detail,
          );
          return {
            rank: index + 1,
            repoId: candidate.repoId,
            filePath: candidate.filePath,
            symbolName: candidate.symbolName,
            patternKind: candidate.patternKind,
            role: explanation.role,
            ...(explanation.family ? { family: explanation.family } : {}),
            confidence: explanation.confidence,
            precedentScore: candidate.precedentScore,
            structuralAlignment: {
              graphAnchored: candidate.structuralAlignment.graphAnchored,
              structuralContextStrength: candidate.structuralAlignment.structuralContextStrength,
            },
            relationship:
              explanation.explanationSignals.familyMatch === true
                ? 'peer_family'
                : candidate.structuralAlignment.graphAnchored
                  ? 'structural_neighbor'
                  : 'heuristic_neighbor',
            selectionReason: summarizeSelectionReason(explanation.selectionReason),
            ...(toClusterRef(explanation, detail) ? { clusterRef: toClusterRef(explanation, detail) } : {}),
            ...(detail === 'debug'
              ? {
                  debug: {
                    similarityScore: candidate.similarityScore,
                    reasonSignals: candidate.reasonSignals,
                    ...(explanation.debug ? { explanation: explanation.debug } : {}),
                  },
                }
              : {}),
          };
        }),
      )
    : [];

  const familyContext =
    includeFamilyContext && targetExplanation
      ? {
          ...(targetExplanation.family ? { family: targetExplanation.family } : {}),
          role: targetExplanation.role,
          confidence: targetExplanation.confidence,
          ...(targetExplanation.relatedContext?.neighborTypes?.length
            ? { relatedFamilies: targetExplanation.relatedContext.neighborTypes.slice(0, 3) }
            : {}),
          ...(toClusterRef(targetExplanation, detail) ? { clusterRef: toClusterRef(targetExplanation, detail) } : {}),
        }
      : null;

  const target = {
    status: patternContext.resolution.status,
    mode,
    requestedName: input.name,
    requestedRepo: input.repo,
    filePath: patternContext.primaryTarget.file?.filePath ?? precedentResult?.target.filePath ?? null,
    repoId: patternContext.primaryTarget.file?.repoId ?? precedentResult?.target.repoId ?? null,
    symbolName:
      patternContext.primaryTarget.symbol?.name ??
      precedentResult?.target.symbolName ??
      (mode === 'file' ? null : input.name),
    confidence: targetExplanation?.confidence ?? 'low',
    grounding: toGroundingStrength(patternContext.primaryTarget.structuralAlignment),
    structuralAlignment: patternContext.primaryTarget.structuralAlignment
      ? {
          graphAnchored: patternContext.primaryTarget.structuralAlignment.graphAnchored,
          structuralContextStrength: patternContext.primaryTarget.structuralAlignment.structuralContextStrength,
        }
      : null,
    ...(targetExplanation?.role ? { role: targetExplanation.role } : {}),
    ...(targetExplanation?.family ? { family: targetExplanation.family } : {}),
    ...(toClusterRef(targetExplanation, detail) ? { clusterRef: toClusterRef(targetExplanation, detail) } : {}),
    resolution: {
      candidateCount: patternContext.resolution.candidateCount,
      ambiguityDetected: patternContext.resolution.ambiguityDetected,
    },
  };

  const navigationHints = buildNavigationHints({
    precedents: precedents.map((entry) => ({
      filePath: entry.filePath,
      repoId: entry.repoId,
      symbolName: entry.symbolName,
      selectionReason: entry.selectionReason,
      family: 'family' in entry ? entry.family : null,
    })),
    familyContext,
  });

  const output = {
    requestedName: input.name,
    requestedRepo: input.repo,
    requestedMode: mode,
    explainabilityMode: detail,
    metadata: withAdditionalWarnings(
      metadata,
      [
        ...(precedents.length === 0 ? ['No reusable precedents were found for the resolved target'] : []),
        ...(precedentResult && scopedCandidates.length === 0 && precedentResult.candidates.length > 0
          ? ['No repo-local precedents remained after scoping results to the resolved target repository']
          : []),
      ],
    ),
    target,
    precedents,
    ...(familyContext ? { familyContext } : {}),
    navigationHints,
    summary: {
      precedentCount: precedents.length,
      hasStrongPrecedent: precedents.some((entry) => entry.confidence === 'high'),
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
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(output, null, 2),
      },
    ],
  };
}
