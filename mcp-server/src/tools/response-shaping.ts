import type {
  ExplainabilityConfidence,
  ExplainabilityMode,
  ResultExplainability,
  ResultExplainabilitySignals,
} from '../orchestrator/types.js';

type Membership = 'core' | 'peripheral' | 'unknown';
type SignalBucket = 'high' | 'medium' | 'low';

export interface ResponseShapingOptions {
  detail: ExplainabilityMode;
  expandClusters?: boolean;
  expandDebug?: boolean;
  expandRelated?: boolean;
}

export interface CompactSharedFamily {
  role?: string;
  relatedFamilyRefs?: string[];
}

export interface CompactSharedCluster {
  role?: string;
  membership: Membership;
  parentClusterRef?: string;
  relatedClusterRefs?: string[];
}

export interface SharedResponseContext {
  families?: Record<string, CompactSharedFamily>;
  clusters?: Record<string, CompactSharedCluster>;
}

export interface CompactExplainability {
  role: string;
  confidence: ExplainabilityConfidence;
  selectionReason: string;
  explanationSignals?: ResultExplainabilitySignals;
  familyRef?: string;
  clusterRef?: string;
  membership?: Membership;
  debug?: ResultExplainability['debug'];
}

function compactSignalMap(
  signals: ResultExplainabilitySignals | undefined,
  options: ResponseShapingOptions,
): ResultExplainabilitySignals | undefined {
  if (!signals) {
    return undefined;
  }

  const compact: ResultExplainabilitySignals = {
    ...(signals.alignment ? { alignment: signals.alignment } : {}),
    ...(signals.dependencyOverlap ? { dependencyOverlap: signals.dependencyOverlap } : {}),
    ...(signals.familyMatch !== undefined ? { familyMatch: signals.familyMatch } : {}),
    ...((options.detail === 'debug' || options.expandDebug) && signals.clusterCohesion
      ? { clusterCohesion: signals.clusterCohesion }
      : {}),
  };

  return Object.keys(compact).length > 0 ? compact : undefined;
}

function toMembership(value: boolean | undefined): Membership {
  if (value === true) {
    return 'core';
  }

  if (value === false) {
    return 'peripheral';
  }

  return 'unknown';
}

export function toScoreBucket(value: number | null | undefined, thresholds = { high: 0.8, medium: 0.55 }): SignalBucket {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'low';
  }

  if (value >= thresholds.high) {
    return 'high';
  }

  if (value >= thresholds.medium) {
    return 'medium';
  }

  return 'low';
}

export function estimateTokenCount(payload: unknown): number {
  return Math.ceil(JSON.stringify(payload).length / 4);
}

export function splitPrimarySecondary<T>(items: T[], primaryCount = 2): { primary: T[]; secondary: T[] } {
  return {
    primary: items.slice(0, primaryCount),
    secondary: items.slice(primaryCount),
  };
}

export function dedupeNavigationHints<T extends Record<string, unknown>>(hints: T[], max = 3): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const hint of hints) {
    const key = JSON.stringify(hint);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(hint);
    if (unique.length >= max) {
      break;
    }
  }

  return unique;
}

export class SharedContextBuilder {
  private readonly familyEntries = new Map<string, CompactSharedFamily>();
  private readonly clusterEntries = new Map<string, CompactSharedCluster>();

  constructor(private readonly options: ResponseShapingOptions) {}

  registerExplainability(explanation: ResultExplainability | null | undefined): CompactExplainability | null {
    if (!explanation) {
      return null;
    }

    const familyRef = explanation.family ?? undefined;
    const clusterContext = explanation.clusterContext;
    const clusterRef = clusterContext?.subClusterId ?? clusterContext?.parentClusterId ?? undefined;

    if (familyRef) {
      const relatedFamilyRefs = this.options.expandRelated
        ? explanation.relatedContext?.neighborTypes?.slice(0, 3)
        : explanation.relatedContext?.neighborTypes?.slice(0, 2);
      this.familyEntries.set(familyRef, {
        role: explanation.role,
        ...(relatedFamilyRefs?.length ? { relatedFamilyRefs } : {}),
      });
    }

    if (clusterRef) {
      const membership = toMembership(clusterContext?.isCoreMember);
      const parentClusterRef =
        clusterContext?.subClusterId && clusterContext.parentClusterId !== clusterContext.subClusterId
          ? clusterContext.parentClusterId
          : undefined;
      const relatedClusterRefs = this.options.expandRelated
        ? explanation.relatedContext?.relatedClusterIds?.slice(0, 3) ?? clusterContext?.relatedClusterIds?.slice(0, 3)
        : undefined;
      this.clusterEntries.set(clusterRef, {
        membership,
        ...(clusterContext?.clusterRole ? { role: clusterContext.clusterRole } : {}),
        ...(parentClusterRef ? { parentClusterRef } : {}),
        ...(relatedClusterRefs?.length ? { relatedClusterRefs } : {}),
      });
    }

    return {
      role: explanation.role,
      confidence: explanation.confidence,
      selectionReason: explanation.selectionReason,
      ...(compactSignalMap(explanation.explanationSignals, this.options)
        ? { explanationSignals: compactSignalMap(explanation.explanationSignals, this.options) }
        : {}),
      ...(familyRef ? { familyRef } : {}),
      ...(clusterRef ? { clusterRef } : {}),
      ...(clusterRef ? { membership: toMembership(clusterContext?.isCoreMember) } : {}),
      ...(this.options.detail === 'debug' || this.options.expandDebug
        ? { debug: explanation.debug }
        : {}),
    };
  }

  build(): SharedResponseContext | undefined {
    const families = this.familyEntries.size > 0 ? Object.fromEntries(this.familyEntries) : undefined;
    const clusters = this.clusterEntries.size > 0 ? Object.fromEntries(this.clusterEntries) : undefined;

    if (!families && !clusters) {
      return undefined;
    }

    return {
      ...(families ? { families } : {}),
      ...(clusters ? { clusters } : {}),
    };
  }
}

export function finalizeShapedResponse<
  T extends {
    summary?: Record<string, unknown>;
  },
>(payload: T): T & { summary: Record<string, unknown> } {
  const tokenEstimate = estimateTokenCount(payload);
  return {
    ...payload,
    summary: {
      ...(payload.summary ?? {}),
      tokenEstimate,
    },
  };
}
