export type IndexGenerationStatus = 'ready';

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
  counts: IndexGenerationCounts;
  rebuild: IndexGenerationRebuildSummary;
  cleanup: IndexGenerationCleanupSummary;
  warnings: string[];
  status: 'no-op' | 'committed';
}

