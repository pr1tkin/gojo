export {
  createEmptyPatternIndex,
  createPatternCandidate,
  getPatternById,
  getPatternsForFile,
  getPatternsForSymbol,
  listPatternsByKind,
  registerPatternCandidate,
  registerPatternCandidateInIndex,
} from './repository.js';
export { createPatternId } from './ids.js';
export { createPatternClusterId } from './ids.js';
export { buildPatternIndex } from './build-index.js';
export { getPatternIndexFilePath, loadPatternIndex, savePatternIndex } from './store.js';
export {
  buildPatternClusters,
  computePatternSimilarity,
  createPatternSimilarityService,
  findSimilarPatterns,
  findSimilarPatternsForPattern,
  PatternSimilarityService,
} from './similarity.js';
export { runPatternExtractionStage } from './stage.js';
export type {
  PatternCandidate,
  PatternCluster,
  PatternFingerprint,
  PatternIndex,
  PatternKind,
  PatternPrecedentFamily,
  PatternSignal,
  PatternSignalType,
  PatternSubcluster,
  SimilarPatternMatch,
} from './types.js';
