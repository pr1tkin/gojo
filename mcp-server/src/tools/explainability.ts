import { loadCurrentGenerationState } from '../indexing/generation-store.js';
import { createPatternSimilarityService, loadPatternIndex, type PatternCandidate } from '../patterns/index.js';
import type { PatternStructuralAlignment } from '../patterns/structural-alignment.js';
import type {
  ExplainabilityConfidence,
  ExplainabilityMode,
  ExplainabilitySignalStrength,
  RefactorNearbyFile,
  RefactorSymbolCandidate,
  ResultExplainability,
} from '../orchestrator/types.js';
import type { PatternMatchItem, PatternTargetSummary, PatternResolutionSummary } from '../orchestrator/types.js';
import type { PrecedentCandidate } from '../orchestrator/precedent-discovery-types.js';
import type { RankingReason } from '../ranking/index.js';
import type { IndexedSymbol } from '../symbol-index/types.js';
import type { SymbolKind } from '../types.js';
import type { RankedFileContextItem } from '../context/index.js';

interface PatternClusterLookupEntry {
  family: string;
  parentClusterId: string;
  subClusterId?: string;
  clusterRole: string;
  isCoreMember: boolean;
  relatedClusterIds: string[];
  relatedClusterRoles: string[];
  clusterCohesion: number;
}

interface ClusterLookupSnapshot {
  byFileId: Map<string, PatternClusterLookupEntry>;
}

interface SymbolCandidateLike {
  symbolId: string;
  fileId: string;
  repo: string;
  filePath: string;
  name: string;
  kind: SymbolKind;
  exported: boolean;
  score: number;
  reasons: RankingReason[];
}

interface BaseExplainabilityOptions {
  detail: ExplainabilityMode;
  selectionReason: string;
  role?: string;
  family?: string | null;
  score?: number;
  rawReasons?: RankingReason[];
  alignment?: ExplainabilitySignalStrength;
  dependencyOverlap?: ExplainabilitySignalStrength;
  familyMatch?: boolean;
  clusterCohesion?: ExplainabilitySignalStrength;
  fileId?: string | null;
  filePath?: string | null;
}

const PATTERN_KIND_PRIORITY: Record<string, number> = {
  component: 7,
  hook: 6,
  'async-data-flow': 5,
  'api-handler': 4,
  'utility-export': 3,
  'storybook-story': 2,
  'test-suite': 1,
};

let cachedGenerationId: string | null = null;
let cachedLookupPromise: Promise<ClusterLookupSnapshot> | null = null;

function bucketNumericScore(
  value: number | null | undefined,
  thresholds = { high: 0.75, medium: 0.35 },
): ExplainabilitySignalStrength | undefined {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return undefined;
  }

  if (value >= thresholds.high) {
    return 'high';
  }

  if (value >= thresholds.medium) {
    return 'medium';
  }

  return 'low';
}

function mapAlignmentStrength(
  alignment: PatternStructuralAlignment | null | undefined,
): ExplainabilitySignalStrength | undefined {
  if (!alignment) {
    return undefined;
  }

  if (!alignment.graphAnchored || alignment.structuralContextStrength === 'low') {
    return 'low';
  }

  if (alignment.structuralContextStrength === 'medium') {
    return 'medium';
  }

  return 'high';
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function getRoleFromFamily(family: string | null | undefined): string | undefined {
  switch (family) {
    case 'ui_component':
    case 'ui_wrapper_or_shell':
      return 'component';
    case 'state_or_store':
      return 'store';
    case 'hook_or_context':
      return 'hook';
    case 'page':
    case 'routed_page_or_screen':
      return 'page';
    case 'util_or_helper':
      return 'util';
    case 'api_or_handler':
      return 'handler';
    case 'module_or_integration':
      return 'module';
    case 'support_runtime':
      return 'support';
    default:
      return undefined;
  }
}

function inferRoleFromFile(filePath: string | null | undefined, symbolNames: string[] = [], kind?: SymbolKind): string {
  const normalized = (filePath ?? '').toLowerCase();
  const baseName = normalized.split('/').pop() ?? '';
  const hasHookName = symbolNames.some((name) => /^use[A-Z0-9_]/.test(name));
  const inPathFamily = (segment: string): boolean =>
    normalized.startsWith(`${segment}/`) || normalized.includes(`/${segment}/`);

  if (/(\.|\/)(page|layout)\.(tsx?|jsx?)$/i.test(normalized)) {
    return 'page';
  }

  if (/(\.|\/)route\.(tsx?|jsx?)$/i.test(normalized) || normalized.includes('/api/')) {
    return 'handler';
  }

  if (/(\.|\/)(stories|story)\.(tsx?|jsx?)$/i.test(normalized)) {
    return 'story';
  }

  if (/(\.|\/)(test|spec)\.(tsx?|jsx?)$/i.test(normalized)) {
    return 'test';
  }

  if (normalized.includes('/store/') || /provider|context|store/.test(baseName)) {
    return 'store';
  }

  if (hasHookName || inPathFamily('hooks') || /^use[a-z0-9_-]*/.test(baseName)) {
    return 'hook';
  }

  if (inPathFamily('components') || inPathFamily('_components') || kind === 'function') {
    return 'component';
  }

  if (inPathFamily('utils') || inPathFamily('helpers') || inPathFamily('services')) {
    return 'util';
  }

  return 'module';
}

function buildSymbolSelectionReason(reasons: RankingReason[]): string {
  if (reasons.some((reason) => reason.signal === 'exact_name')) {
    return reasons.some((reason) => reason.signal === 'kind_match')
      ? 'exact name + kind match'
      : 'exact name match';
  }

  if (reasons.some((reason) => reason.signal === 'case_insensitive_name')) {
    return reasons.some((reason) => reason.signal === 'kind_match')
      ? 'name match + kind match'
      : 'name match';
  }

  if (reasons.some((reason) => reason.signal === 'graph_connection')) {
    return 'graph-related file context';
  }

  if (reasons.some((reason) => reason.signal === 'shared_import_tokens')) {
    return 'shared import surface';
  }

  if (reasons.some((reason) => reason.signal === 'shared_symbol_names')) {
    return 'shared symbol names';
  }

  if (reasons.some((reason) => reason.signal === 'exported_symbol')) {
    return 'exported symbol candidate';
  }

  if (reasons.some((reason) => reason.signal === 'same_repo')) {
    return 'same repository';
  }

  return 'ranked symbol candidate';
}

function buildSymbolCandidateConfidence(candidate: SymbolCandidateLike): ExplainabilityConfidence {
  if (
    candidate.reasons.some((reason) => reason.signal === 'exact_name') &&
    candidate.reasons.some((reason) => reason.signal === 'kind_match')
  ) {
    return 'high';
  }

  if (
    candidate.reasons.some((reason) => reason.signal === 'exact_name' || reason.signal === 'case_insensitive_name') ||
    candidate.score >= 8
  ) {
    return 'medium';
  }

  return 'low';
}

function buildGenericConfidence(options: {
  alignment?: ExplainabilitySignalStrength;
  dependencyOverlap?: ExplainabilitySignalStrength;
  familyMatch?: boolean;
  score?: number;
}): ExplainabilityConfidence {
  const { alignment, dependencyOverlap, familyMatch, score } = options;

  if (
    familyMatch &&
    alignment === 'high' &&
    (dependencyOverlap === 'high' || dependencyOverlap === 'medium')
  ) {
    return 'high';
  }

  if (
    alignment === 'medium' ||
    alignment === 'high' ||
    dependencyOverlap === 'medium' ||
    dependencyOverlap === 'high' ||
    familyMatch ||
    (score !== undefined && score >= 0.55)
  ) {
    return 'medium';
  }

  return 'low';
}

function confidenceFromSignals(options: BaseExplainabilityOptions): ExplainabilityConfidence {
  return buildGenericConfidence({
    alignment: options.alignment,
    dependencyOverlap: options.dependencyOverlap,
    familyMatch: options.familyMatch,
    score: options.score,
  });
}

function buildExplainability(options: BaseExplainabilityOptions): Promise<ResultExplainability> {
  return loadPatternClusterLookup().then((lookup) => {
    const clusterEntry =
      options.fileId ? lookup.byFileId.get(options.fileId) : undefined;
    const family = options.family ?? clusterEntry?.family ?? null;
    const role =
      getRoleFromFamily(family) ??
      options.role ??
      inferRoleFromFile(options.filePath, [], undefined);
    const confidence = confidenceFromSignals({
      ...options,
      familyMatch:
        options.familyMatch ??
        (options.family && clusterEntry ? options.family === clusterEntry.family : undefined),
      clusterCohesion: options.clusterCohesion ?? bucketNumericScore(clusterEntry?.clusterCohesion),
    });
    const explanation: ResultExplainability = {
      ...(family ? { family } : {}),
      ...(clusterEntry?.subClusterId ? { subClusterId: clusterEntry.subClusterId } : {}),
      role,
      confidence,
      selectionReason: options.selectionReason,
      explanationSignals: {
        ...(options.alignment ? { alignment: options.alignment } : {}),
        ...(options.dependencyOverlap ? { dependencyOverlap: options.dependencyOverlap } : {}),
        ...(options.familyMatch !== undefined ? { familyMatch: options.familyMatch } : {}),
        ...(options.clusterCohesion
          ? { clusterCohesion: options.clusterCohesion }
          : clusterEntry
            ? { clusterCohesion: bucketNumericScore(clusterEntry.clusterCohesion) }
            : {}),
      },
      ...(clusterEntry
        ? {
            clusterContext: {
              parentClusterId: clusterEntry.parentClusterId,
              ...(clusterEntry.subClusterId ? { subClusterId: clusterEntry.subClusterId } : {}),
              clusterRole: clusterEntry.clusterRole,
              isCoreMember: clusterEntry.isCoreMember,
              relatedClusterIds: clusterEntry.relatedClusterIds.slice(0, 3),
            },
          }
        : {}),
      ...(clusterEntry
        ? {
            relatedContext: {
              relatedClusterIds: clusterEntry.relatedClusterIds.slice(0, 3),
              neighborTypes: clusterEntry.relatedClusterRoles.slice(0, 3),
            },
          }
        : {}),
    };

    if (options.detail === 'debug') {
      explanation.debug = {
        ...(options.score !== undefined ? { score: options.score } : {}),
        ...(options.rawReasons ? { rawReasons: options.rawReasons } : {}),
      };
    }

    return explanation;
  });
}

function compareClusterEntries(
  left: { pattern: PatternCandidate; context: PatternClusterLookupEntry },
  right: { pattern: PatternCandidate; context: PatternClusterLookupEntry },
): number {
  if (left.context.subClusterId && !right.context.subClusterId) {
    return -1;
  }

  if (!left.context.subClusterId && right.context.subClusterId) {
    return 1;
  }

  if (left.context.isCoreMember !== right.context.isCoreMember) {
    return left.context.isCoreMember ? -1 : 1;
  }

  const leftPriority = PATTERN_KIND_PRIORITY[left.pattern.kind] ?? 0;
  const rightPriority = PATTERN_KIND_PRIORITY[right.pattern.kind] ?? 0;
  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }

  const confidenceOrder = { high: 3, medium: 2, low: 1 } as const;
  const leftConfidence = confidenceOrder[left.pattern.confidence];
  const rightConfidence = confidenceOrder[right.pattern.confidence];
  if (leftConfidence !== rightConfidence) {
    return rightConfidence - leftConfidence;
  }

  if (left.pattern.fingerprint.structuralSignals.length !== right.pattern.fingerprint.structuralSignals.length) {
    return right.pattern.fingerprint.structuralSignals.length - left.pattern.fingerprint.structuralSignals.length;
  }

  return left.pattern.patternId.localeCompare(right.pattern.patternId);
}

async function loadPatternClusterLookup(): Promise<ClusterLookupSnapshot> {
  const state = await loadCurrentGenerationState();
  const generationId = state?.generationId ?? 'missing-generation';

  if (cachedGenerationId === generationId && cachedLookupPromise) {
    return cachedLookupPromise;
  }

  cachedGenerationId = generationId;
  cachedLookupPromise = (async () => {
    try {
      const patternIndex = await loadPatternIndex();
      const clusters = createPatternSimilarityService(patternIndex).buildClusters();
      const clusterRoleById = new Map<string, string>(
        clusters.map((cluster) => [cluster.clusterId, cluster.precedentFamily]),
      );
      const patternById = new Map<string, PatternCandidate>(
        patternIndex.patterns.map((pattern) => [pattern.patternId, pattern]),
      );
      const bestByFileId = new Map<string, { pattern: PatternCandidate; context: PatternClusterLookupEntry }>();

      for (const cluster of clusters) {
        for (const memberPatternId of cluster.memberPatternIds) {
          const pattern = patternById.get(memberPatternId);
          if (!pattern) {
            continue;
          }

          const subcluster = (cluster.subclusters ?? []).find((entry) =>
            entry.memberPatternIds.includes(memberPatternId),
          );
          const context: PatternClusterLookupEntry = {
            family: cluster.precedentFamily,
            parentClusterId: cluster.clusterId,
            ...(subcluster ? { subClusterId: subcluster.subclusterId } : {}),
            clusterRole: cluster.precedentFamily,
            isCoreMember: (cluster.coreMemberPatternIds ?? []).includes(memberPatternId),
            relatedClusterIds: cluster.relatedClusterIds.slice(0, 3),
            relatedClusterRoles: dedupe(
              cluster.relatedClusterIds
                .slice(0, 3)
                .map((clusterId) => clusterRoleById.get(clusterId) ?? ''),
            ),
            clusterCohesion: cluster.cohesion.averageDependencyOverlap,
          };

          const existing = bestByFileId.get(pattern.fileId);

          if (!existing || compareClusterEntries(existing, { pattern, context }) > 0) {
            bestByFileId.set(pattern.fileId, { pattern, context });
          }
        }
      }

      return {
        byFileId: new Map(
          [...bestByFileId.entries()].map(([fileId, entry]) => [fileId, entry.context]),
        ),
      };
    } catch {
      return {
        byFileId: new Map<string, PatternClusterLookupEntry>(),
      };
    }
  })();

  return cachedLookupPromise;
}

export async function buildSymbolCandidateExplainability(
  candidate: SymbolCandidateLike,
  detail: ExplainabilityMode,
): Promise<ResultExplainability> {
  return buildExplainability({
    detail,
    family: null,
    fileId: candidate.fileId,
    filePath: candidate.filePath,
    role: inferRoleFromFile(candidate.filePath, [candidate.name], candidate.kind),
    score: candidate.score,
    rawReasons: candidate.reasons,
    selectionReason: buildSymbolSelectionReason(candidate.reasons),
  }).then((explanation) => ({
    ...explanation,
    confidence: buildSymbolCandidateConfidence(candidate),
  }));
}

export async function buildRelatedFileExplainability(
  entry: RankedFileContextItem,
  detail: ExplainabilityMode,
): Promise<ResultExplainability> {
  return buildExplainability({
    detail,
    fileId: entry.file.fileId,
    filePath: entry.file.filePath,
    role: inferRoleFromFile(entry.file.filePath),
    selectionReason: entry.reason,
    rawReasons: entry.reasons,
  });
}

export async function buildNearbyFileExplainability(
  entry: RefactorNearbyFile,
  detail: ExplainabilityMode,
): Promise<ResultExplainability> {
  return buildExplainability({
    detail,
    fileId: entry.file.fileId,
    filePath: entry.file.filePath,
    role: inferRoleFromFile(entry.file.filePath),
    selectionReason: entry.category === 'bundle_family' ? 'bundle-family companion' : 'same-directory companion',
  });
}

export async function buildPatternTargetExplainability(
  target: PatternTargetSummary,
  detail: ExplainabilityMode,
): Promise<ResultExplainability | null> {
  const file = target.file;
  if (!file) {
    return null;
  }

  return buildExplainability({
    detail,
    fileId: file.fileId,
    filePath: file.filePath,
    role: inferRoleFromFile(file.filePath, [
      ...target.definedSymbols.map((entry) => entry.name),
      ...target.exportedSymbols.map((entry) => entry.name),
    ]),
    alignment: mapAlignmentStrength(target.structuralAlignment),
    selectionReason: 'resolved primary target',
  });
}

function extractDependencyOverlapStrength(reasons: RankingReason[]): ExplainabilitySignalStrength | undefined {
  const dependencyReason = reasons.find((reason) => reason.signal === 'dependency_overlap');
  return bucketNumericScore(dependencyReason?.value);
}

function extractAlignmentStrength(reasons: RankingReason[], fallback: PatternStructuralAlignment): ExplainabilitySignalStrength {
  const structuralReason = reasons.find((reason) => reason.signal === 'structural_alignment');
  if (structuralReason?.note === 'high' || structuralReason?.note === 'medium' || structuralReason?.note === 'low') {
    return structuralReason.note;
  }

  return mapAlignmentStrength(fallback) ?? 'low';
}

export async function buildPatternMatchExplainability(
  match: PatternMatchItem,
  targetFamily: string | null | undefined,
  detail: ExplainabilityMode,
): Promise<ResultExplainability> {
  const clusterLookup = await loadPatternClusterLookup();
  const clusterEntry = clusterLookup.byFileId.get(match.file.fileId);
  const family = clusterEntry?.family ?? null;
  const familyMatch = targetFamily ? family === targetFamily : undefined;
  const alignment = extractAlignmentStrength(match.reasons, match.structuralAlignment);
  const dependencyOverlap = extractDependencyOverlapStrength(match.reasons);

  return buildExplainability({
    detail,
    fileId: match.file.fileId,
    filePath: match.file.filePath,
    family,
    familyMatch,
    role: inferRoleFromFile(
      match.file.filePath,
      [...match.definedSymbols.map((entry) => entry.name), ...match.exportedSymbols.map((entry) => entry.name)],
    ),
    score: match.score <= 1 ? match.score : Math.min(1, match.score / 20),
    rawReasons: match.reasons,
    alignment,
    dependencyOverlap,
    selectionReason: match.reason,
  });
}

export async function buildRefactorSymbolCandidateExplainability(
  candidate: RefactorSymbolCandidate,
  detail: ExplainabilityMode,
): Promise<ResultExplainability> {
  return buildSymbolCandidateExplainability(candidate, detail);
}

export async function buildPatternResolutionExplainability(
  resolution: PatternResolutionSummary,
  detail: ExplainabilityMode,
): Promise<PatternResolutionSummary> {
  const selectedCandidate = resolution.selectedCandidate
    ? {
        ...resolution.selectedCandidate,
        explanation: await buildSymbolCandidateExplainability(resolution.selectedCandidate, detail),
      }
    : null;
  const alternativeCandidates = await Promise.all(
    resolution.alternativeCandidates.map(async (candidate) => ({
      ...candidate,
      explanation: await buildSymbolCandidateExplainability(candidate, detail),
    })),
  );

  return {
    ...resolution,
    selectedCandidate,
    alternativeCandidates,
  };
}

export async function buildIndexedSymbolExplainability(
  symbol: IndexedSymbol,
  detail: ExplainabilityMode,
): Promise<ResultExplainability> {
  return buildSymbolCandidateExplainability(
    {
      symbolId: symbol.symbolId,
      fileId: symbol.fileId,
      repo: symbol.repo,
      filePath: symbol.filePath,
      name: symbol.name,
      kind: symbol.kind,
      exported: Boolean(symbol.exported),
      score: 0,
      reasons: [],
    },
    detail,
  ).then((explanation) => ({
    ...explanation,
    selectionReason: 'resolved primary symbol',
    confidence: symbol.exported ? 'high' : 'medium',
  }));
}

function inferDependencyOverlapFromReasonSignals(reasonSignals: string[]): ExplainabilitySignalStrength | undefined {
  if (reasonSignals.includes('shared-local-dependencies')) {
    return 'high';
  }

  if (reasonSignals.includes('shared-imports') || reasonSignals.includes('responsibility-match')) {
    return 'medium';
  }

  return undefined;
}

function buildPrecedentSelectionReason(reasonSignals: string[]): string {
  if (reasonSignals.includes('shared-local-dependencies') && reasonSignals.includes('responsibility-match')) {
    return 'same family + strong dependency overlap';
  }

  if (reasonSignals.includes('high-structural-similarity') && reasonSignals.includes('graph-anchored')) {
    return 'top structural alignment';
  }

  if (reasonSignals.includes('responsibility-match')) {
    return 'same responsibility family';
  }

  if (reasonSignals.includes('shared-imports')) {
    return 'shared import surface';
  }

  if (reasonSignals.includes('graph-anchored')) {
    return 'graph-anchored precedent';
  }

  return 'ranked precedent';
}

export async function buildPrecedentCandidateExplainability(
  candidate: PrecedentCandidate,
  targetFamily: string | null | undefined,
  detail: ExplainabilityMode,
): Promise<ResultExplainability> {
  const clusterLookup = await loadPatternClusterLookup();
  const clusterEntry = clusterLookup.byFileId.get(candidate.fileId);
  const family = clusterEntry?.family ?? null;
  const familyMatch = targetFamily ? family === targetFamily : undefined;
  const explanation = await buildExplainability({
    detail,
    fileId: candidate.fileId,
    filePath: candidate.filePath,
    family,
    familyMatch,
    role: inferRoleFromFile(candidate.filePath, [candidate.symbolName], undefined),
    score: candidate.precedentScore,
    alignment: mapAlignmentStrength(candidate.structuralAlignment),
    dependencyOverlap: inferDependencyOverlapFromReasonSignals(candidate.reasonSignals),
    selectionReason: buildPrecedentSelectionReason(candidate.reasonSignals),
  });

  if (detail === 'debug') {
    explanation.debug = {
      ...(explanation.debug ?? {}),
      score: candidate.precedentScore,
      reasonSignals: candidate.reasonSignals,
    };
  }

  return explanation;
}
