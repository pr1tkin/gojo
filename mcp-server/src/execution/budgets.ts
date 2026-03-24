import type { ExplorationBudget, SymbolContextBudget } from '../context/types.js';

export type RepoExecutionScale = 'standard' | 'large';

export interface ExecutionBudgetProfile {
  scale: RepoExecutionScale;
  graph: ExplorationBudget;
  symbolContext: SymbolContextBudget;
  refactor: {
    relatedLimit: number;
    nearbyFileLimit: number;
  };
  precedents: {
    enabled: boolean;
    limit: number;
  };
  planning: {
    enabled: boolean;
    maxDepth: number;
    maxOrderedFiles: number;
  };
  bundle: {
    focusedMode: boolean;
    maxStrongResults: number;
    maxWeakResults: number;
    strongEvidenceThreshold: number;
  };
}

const LARGE_REPO_FILE_THRESHOLD = 5000;

export const EXECUTION_BUDGETS: Record<RepoExecutionScale, ExecutionBudgetProfile> = {
  standard: {
    scale: 'standard',
    graph: {
      maxNodes: 480,
      maxEdges: 3200,
      maxDepth: 2,
    },
    symbolContext: {
      maxCandidateSymbols: 120,
      maxDirectConsumerEdges: 96,
      maxIndirectConsumerEdges: 64,
      maxRelatedFiles: 72,
      maxWeakExpansions: 24,
      strongEvidenceThreshold: 4,
    },
    refactor: {
      relatedLimit: 3,
      nearbyFileLimit: 3,
    },
    precedents: {
      enabled: true,
      limit: 3,
    },
    planning: {
      enabled: true,
      maxDepth: 2,
      maxOrderedFiles: 48,
    },
    bundle: {
      focusedMode: false,
      maxStrongResults: 6,
      maxWeakResults: 6,
      strongEvidenceThreshold: 3,
    },
  },
  large: {
    scale: 'large',
    graph: {
      maxNodes: 240,
      maxEdges: 1200,
      maxDepth: 2,
    },
    symbolContext: {
      maxCandidateSymbols: 48,
      maxDirectConsumerEdges: 48,
      maxIndirectConsumerEdges: 24,
      maxRelatedFiles: 24,
      maxWeakExpansions: 6,
      strongEvidenceThreshold: 3,
    },
    refactor: {
      relatedLimit: 2,
      nearbyFileLimit: 2,
    },
    precedents: {
      enabled: false,
      limit: 1,
    },
    planning: {
      enabled: false,
      maxDepth: 1,
      maxOrderedFiles: 24,
    },
    bundle: {
      focusedMode: true,
      maxStrongResults: 4,
      maxWeakResults: 2,
      strongEvidenceThreshold: 3,
    },
  },
};

export function getExecutionBudgetProfile(repoFileCount: number): ExecutionBudgetProfile {
  return repoFileCount >= LARGE_REPO_FILE_THRESHOLD
    ? EXECUTION_BUDGETS.large
    : EXECUTION_BUDGETS.standard;
}
