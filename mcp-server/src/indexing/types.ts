export type IndexGenerationStatus = 'ready';
export type SearchFreshnessStatus = 'pending' | 'ready' | 'stale' | 'failed' | 'unknown';

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
  search: SearchFreshnessState;
  warnings: string[];
  errors: string[];
}

export interface CurrentGenerationPointer {
  schemaVersion: number;
  generationId: string;
  publishedAt: string;
}

export interface IndexRefreshDiagnostics {
  generationId: string;
  createdAt: string;
  delta: IndexRefreshDelta;
  changeSummary: GenerationChangeSummary;
  counts: IndexGenerationCounts;
  rebuild: IndexGenerationRebuildSummary;
  cleanup: IndexGenerationCleanupSummary;
  search: SearchFreshnessState;
  warnings: string[];
  status: 'no-op' | 'committed';
}

export interface SearchRefreshRequest {
  schemaVersion: number;
  generationId: string;
  requestedAt: string;
  aggregateFingerprint: string;
  repoFingerprints: SearchRepoFingerprint[];
}

export interface SearchRefreshSnapshot {
  schemaVersion: number;
  snapshotId: string;
  status: 'ready' | 'failed';
  refreshedAt: string;
  aggregateFingerprint?: string;
  repoFingerprints: SearchRepoFingerprint[];
  details?: string;
  error?: string;
}
