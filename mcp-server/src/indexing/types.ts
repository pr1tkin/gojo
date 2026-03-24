export type IndexGenerationStatus = 'ready';
export type GenerationLifecycleStatus = 'staged' | 'committed' | 'abandoned';
export type SearchFreshnessStatus = 'pending' | 'ready' | 'stale' | 'failed' | 'unknown';
export type CoordinationMarkerParseStatus =
  | 'ok'
  | 'missing'
  | 'malformed'
  | 'incompatible-version'
  | 'unreadable'
  | 'unknown';
export type PatternIntegrityStatus = 'trusted' | 'degraded' | 'failed';
export type HighRiskRefreshValidationStatus = 'not-applicable' | 'passed' | 'degraded' | 'failed';
export type ConsistencyCheckSeverity = 'info' | 'warning' | 'error';
export type ConsistencyCheckStatus = 'passed' | 'warning' | 'failed' | 'repaired';
export type ConsistencyScope = 'generation' | 'artifact' | 'coordination' | 'maintenance';
export type ConsistencyRepairDisposition = 'applied' | 'recommended' | 'skipped' | 'failed';
export type IndexHealthTrustState =
  | 'healthy'
  | 'degraded'
  | 'repair-recommended'
  | 'stale-search'
  | 'inconsistent'
  | 'unknown';
export type RefreshFaultStage =
  | 'before-snapshot'
  | 'after-snapshot'
  | 'after-change-detection'
  | 'rebuild-symbols'
  | 'rebuild-graph'
  | 'rebuild-patterns'
  | 'persist-artifacts'
  | 'before-commit'
  | 'coordination-update'
  | 'consistency-maintenance';
export type RefreshFaultMode = 'throw' | 'crash' | 'partial-write' | 'skip-step';
export type RefreshFailureTrustImpact = 'degraded' | 'inconsistent';

export interface IndexedRepositoryDescriptor {
  repoId: string;
  repoRoot: string;
}

export interface FileFingerprintManifestEntry {
  key: string;
  repoId: string;
  repoRoot: string;
  filePath: string;
  normalizedPath: string;
  fileSizeBytes: number;
  modifiedTimeMs?: number;
  contentHash: string;
}

export interface IndexRefreshDelta {
  added: string[];
  modified: string[];
  deleted: string[];
}

export type RepositoryFileChangeKind = 'added' | 'modified' | 'deleted' | 'unchanged';

export type RepositoryFileChangeSignal =
  | 'contentChanged'
  | 'metadataOnlyChanged'
  | 'symbolSurfaceChanged'
  | 'importsChanged'
  | 'exportsChanged'
  | 'graphRelevantChanged'
  | 'uiStructureChanged'
  | 'uiPropsChanged'
  | 'uiRenderingChanged'
  | 'uiStylingChanged'
  | 'patternRelevantChanged'
  | 'likelyApiBoundaryChanged'
  | 'unknownStructuralChange';

export type RepositoryFileImpactHint =
  | 'requiresSymbolReindex'
  | 'requiresGraphRebuild'
  | 'requiresUiRefresh'
  | 'requiresPatternRefresh'
  | 'mayAffectDependents'
  | 'mayAffectSearchFreshness'
  | 'highRiskStructuralChange';

export interface RepositoryFileChangeRecord {
  key: string;
  repoId: string;
  filePath: string;
  changeKind: RepositoryFileChangeKind;
  classification?: 'source' | 'generated' | 'unknown';
  language?: 'ts' | 'tsx' | 'js' | 'jsx' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  signals: RepositoryFileChangeSignal[];
  impactHints: RepositoryFileImpactHint[];
  notes: string[];
}

export interface GenerationChangeSummaryOverview {
  filesChanged: number;
  added: number;
  modified: number;
  deleted: number;
  highRiskFiles: number;
  signalCounts: Partial<Record<RepositoryFileChangeSignal, number>>;
  impactHintCounts: Partial<Record<RepositoryFileImpactHint, number>>;
}

export interface GenerationChangeSummary {
  schemaVersion: number;
  generatedAt: string;
  files: RepositoryFileChangeRecord[];
  overview: GenerationChangeSummaryOverview;
}

export interface ConsistencyRepairRecord {
  actionId: string;
  description: string;
  disposition: ConsistencyRepairDisposition;
  targetArtifacts: string[];
  affectedFiles: string[];
  details?: string;
}

export interface ConsistencyCheckResult {
  checkId: string;
  name: string;
  severity: ConsistencyCheckSeverity;
  scope: ConsistencyScope;
  status: ConsistencyCheckStatus;
  summary: string;
  details: string[];
  targetArtifacts: string[];
  affectedFiles: string[];
  repairsApplied: ConsistencyRepairRecord[];
  repairsRecommended: ConsistencyRepairRecord[];
}

export interface ConsistencyRunOverview {
  checksExecuted: number;
  passed: number;
  warnings: number;
  failed: number;
  repaired: number;
  repairsApplied: number;
  repairsRecommended: number;
}

export interface ConsistencyRunReport {
  schemaVersion: number;
  generationId: string;
  generatedAt: string;
  overview: ConsistencyRunOverview;
  checks: ConsistencyCheckResult[];
}

export interface IndexGenerationCounts {
  files: number;
  symbols: number;
  fileRecords: number;
  graphFiles: number;
  graphSymbols: number;
  graphEdges: number;
  uiCompositionEdges: number;
  uiPropUsages: number;
  patterns: number;
}

export interface IndexGenerationRebuildSummary {
  symbolFilesRebuilt: number;
  patternFilesRebuilt: number;
  graphMode: 'full';
  uiCompositionMode: 'full';
  uiPropsMode: 'full';
}

export interface IndexGenerationCleanupSummary {
  deletedFileRecordsRemoved: number;
  deletedSymbolsRemoved: number;
  deletedPatternEntriesRemoved: number;
}

export interface SearchRepoFingerprint {
  repoId: string;
  fingerprint: string;
  fileCount: number;
  scope?: SearchRepoCoverageScopeSummary;
}

export type SearchVisibleCoverageExclusionCategory =
  | 'fixture_or_snapshot'
  | 'style_or_asset'
  | 'data_or_config'
  | 'documentation'
  | 'template_or_markup'
  | 'other_non_source';

export interface SearchRepoCoverageScopeSummary {
  rawSearchVisibleCount: number;
  relevantSourceCount: number;
  excludedVisibleCount: number;
  excludedByCategory: Partial<Record<SearchVisibleCoverageExclusionCategory, number>>;
}

export interface SearchFingerprintRepoMismatch {
  repoId: string;
  expectedFingerprint?: string;
  actualFingerprint?: string;
  expectedFileCount?: number;
  actualFileCount?: number;
}

export interface SearchFingerprintComparisonIssue {
  severity: 'warning' | 'error';
  code:
    | 'missing-repo'
    | 'unexpected-repo'
    | 'file-count-mismatch'
    | 'repo-fingerprint-mismatch'
    | 'aggregate-mismatch';
  message: string;
}

export interface SearchFingerprintComparison {
  equivalent: boolean;
  contractVersion: number;
  expectedAggregateFingerprint?: string;
  actualAggregateFingerprint?: string;
  normalizedExpectedAggregateFingerprint: string;
  normalizedActualAggregateFingerprint: string;
  expectedRepoFingerprints: SearchRepoFingerprint[];
  actualRepoFingerprints: SearchRepoFingerprint[];
  missingRepoIds: string[];
  unexpectedRepoIds: string[];
  mismatchedRepos: SearchFingerprintRepoMismatch[];
  issues: SearchFingerprintComparisonIssue[];
  summary: string;
}

export interface SearchFreshnessState {
  status: SearchFreshnessStatus;
  requestedAt?: string;
  refreshedAt?: string;
  aggregateFingerprint: string;
  repoFingerprints: SearchRepoFingerprint[];
  coordinationMode: 'shared-marker';
  details?: string;
  error?: string;
  snapshotId?: string;
  comparison?: SearchFingerprintComparison;
}

export interface PatternIntegrityIssue {
  code: string;
  severity: 'warning' | 'error';
  summary: string;
  details: string;
  recommendedAction: string;
}

export interface PatternIntegrityAssessment {
  status: PatternIntegrityStatus;
  checkedAt: string;
  totalPatterns: number;
  eligibleSourceFiles: number;
  patternBearingFiles: number;
  previousPatternCount?: number;
  previousEligibleSourceFiles?: number;
  issues: PatternIntegrityIssue[];
}

export interface HighRiskRefreshValidationIssue {
  code: string;
  severity: 'warning' | 'error';
  summary: string;
  details: string;
  recommendedAction: string;
}

export interface HighRiskRefreshValidationAssessment {
  status: HighRiskRefreshValidationStatus;
  checkedAt: string;
  isHighRiskRefresh: boolean;
  triggers: string[];
  issues: HighRiskRefreshValidationIssue[];
}

export interface GenerationIndexingCoverageIssue {
  repoId: string;
  filePath: string;
  fileId?: string;
  classification: 'source' | 'generated' | 'unknown';
  language: 'ts' | 'tsx' | 'js' | 'jsx' | 'unknown';
  stage:
    | 'read'
    | 'symbol_extraction'
    | 'file_metadata'
    | 'pattern_extraction'
    | 'semantic_graph'
    | 'ui_composition'
    | 'ui_props'
    | 'ui_semantics';
  disposition: 'partial' | 'skipped';
  source: 'io' | 'parser' | 'policy';
  reason: string;
}

export interface GenerationIndexingCoverage {
  schemaVersion: number;
  generatedAt: string;
  totalSourceFiles: number;
  fullyIndexedFiles: number;
  partialFiles: number;
  skippedFiles: number;
  trustImpact: 'none' | 'degraded';
  issueCounts: {
    parserFailures: number;
    readFailures: number;
    metadataFallbacks: number;
    policySkipped: number;
  };
  issues: GenerationIndexingCoverageIssue[];
  omittedIssueCount: number;
}

export interface IndexGenerationState {
  schemaVersion: number;
  generationId: string;
  reposRoot: string;
  repositories: IndexedRepositoryDescriptor[];
  createdAt: string;
  status: IndexGenerationStatus;
  manifest: FileFingerprintManifestEntry[];
  delta: {
    added: number;
    modified: number;
    deleted: number;
  };
  counts: IndexGenerationCounts;
  rebuild: IndexGenerationRebuildSummary;
  cleanup: IndexGenerationCleanupSummary;
  changeSummary: GenerationChangeSummaryOverview;
  consistency?: ConsistencyRunOverview;
  search: SearchFreshnessState;
  patternIntegrity?: PatternIntegrityAssessment;
  highRiskRefreshValidation?: HighRiskRefreshValidationAssessment;
  indexingCoverage?: GenerationIndexingCoverage;
  warnings: string[];
  errors: string[];
}

export interface CurrentGenerationPointer {
  schemaVersion: number;
  generationId: string;
  publishedAt: string;
}

export interface GenerationLifecycleMarker {
  schemaVersion: number;
  generationId: string;
  status: GenerationLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  abandonedAt?: string;
  reason?: string;
}

export interface IndexRefreshDiagnostics {
  generationId: string;
  createdAt: string;
  delta: IndexRefreshDelta;
  changeSummary: GenerationChangeSummary;
  consistency?: ConsistencyRunReport;
  counts: IndexGenerationCounts;
  rebuild: IndexGenerationRebuildSummary;
  cleanup: IndexGenerationCleanupSummary;
  search: SearchFreshnessState;
  warnings: string[];
  status: 'no-op' | 'committed';
}

export interface RefreshFailureRecord {
  schemaVersion: number;
  failedAt: string;
  generationId?: string;
  stage?: RefreshFaultStage;
  mode?: RefreshFaultMode;
  reason: string;
  cleanupRequired: boolean;
  trustImpact: RefreshFailureTrustImpact;
}

export interface RefreshFailureHistoryEntry extends RefreshFailureRecord {
  archivedAt: string;
  recoveryGenerationId?: string;
  recoveredAt?: string;
  resolution: 'recovered' | 'superseded';
}

export interface SearchRefreshRequest {
  schemaVersion: number;
  fingerprintContractVersion?: number;
  generationId: string;
  requestedAt: string;
  aggregateFingerprint: string;
  repoFingerprints: SearchRepoFingerprint[];
}

export interface SearchRefreshSnapshot {
  schemaVersion: number;
  fingerprintContractVersion?: number;
  snapshotId: string;
  status: 'ready' | 'failed';
  refreshedAt: string;
  aggregateFingerprint?: string;
  repoFingerprints: SearchRepoFingerprint[];
  details?: string;
  error?: string;
}

export interface CoordinationMarkerParseResult<T> {
  status: CoordinationMarkerParseStatus;
  path: string;
  value: T | null;
  reason: string;
  rawSummary?: string;
  trustDegraded: boolean;
}

export interface IndexHealthRecentActivity {
  lastRefreshAt?: string;
  lastRefreshStatus: 'committed' | 'no-op' | 'unknown';
  delta: {
    added: number;
    modified: number;
    deleted: number;
  };
  maintenanceRan: boolean;
  repairsApplied: number;
  repairsRecommended: number;
  riskyChangeCount: number;
  unknownStructuralChangeCount: number;
  recentChangedFiles: string[];
}

export interface IndexHealthSummary {
  schemaVersion: number;
  generatedAt: string;
  generationId?: string;
  generationStatus: IndexGenerationStatus | 'missing';
  publishedAt?: string;
  repositories: IndexedRepositoryDescriptor[];
  reposRoot?: string;
  search: SearchFreshnessState | null;
  changeSummary: GenerationChangeSummary | null;
  consistency: ConsistencyRunReport | null;
  indexingCoverage?: GenerationIndexingCoverage;
  recentActivity: IndexHealthRecentActivity;
  lastRefreshFailure?: RefreshFailureRecord | null;
  trustState: IndexHealthTrustState;
  suitableForAgentWorkflows: boolean;
  reasons: string[];
  warnings: string[];
  errors: string[];
}
