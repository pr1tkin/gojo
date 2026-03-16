export { getFileExplorationContext } from './file-service.js';
export { analyzeSymbolImpact } from './impact-analysis-service.js';
export { planSymbolChange } from './change-planning-service.js';
export { analyzeSymbolOwnership } from './symbol-ownership-service.js';
export {
  getPatternMatchesForComponent,
  getPatternMatchesForFile,
  getPatternMatchesForSymbol,
} from './pattern-service.js';
export {
  getCollectRefactorContext,
  getRefactorContextForComponent,
  getRefactorContextForFile,
  getRefactorContextForSymbol,
} from './refactor-service.js';
export { getAnalyzeSymbolContext } from './symbol-analysis-service.js';
export { getSymbolExplorationContext } from './symbol-service.js';
export type {
  AnalyzeSymbolChangePlanInput,
  ChangePlanStep,
  ChangePlanningSignal,
  ChangePlanningSignalType,
  ChangeRiskLevel,
  ChangeScope,
  PlannedFileRole,
  SymbolChangePlanResult,
} from './change-planning-types.js';
export type {
  AnalyzeSymbolImpactInput,
  ImpactAnalysisMode,
  ImpactAnalysisResult,
  ImpactAnalysisSummary,
  ImpactAnalysisTarget,
  ImpactConfidence,
  ImpactEvidence,
  ImpactEvidenceSource,
  ImpactPathStep,
  ImpactReason,
  ImpactedFile,
  ImpactedSymbol,
  PublicSurfaceRisk,
  TransitiveImpact,
} from './impact-analysis-types.js';
export type {
  AnalyzeSymbolOwnershipInput,
  ApiBoundaryClassification,
  OwnershipClassification,
  OwnershipConfidence,
  OwnershipSignal,
  OwnershipSignalType,
  SymbolOwnershipResult,
  SymbolOwnershipTarget,
} from './symbol-ownership-types.js';
export type {
  FileExplorationContext,
  GetFileExplorationContextOptions,
  RefactorContext,
  SymbolAnalysis,
  PatternMatchContext,
  PatternMatchItem,
  GetSymbolExplorationContextOptions,
  SymbolExplorationContext,
} from './types.js';
