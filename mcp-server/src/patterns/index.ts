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
export { buildPatternIndex } from './build-index.js';
export { getPatternIndexFilePath, loadPatternIndex, savePatternIndex } from './store.js';
export { runPatternExtractionStage } from './stage.js';
export type {
  PatternCandidate,
  PatternFingerprint,
  PatternIndex,
  PatternKind,
  PatternSignal,
  PatternSignalType,
} from './types.js';
