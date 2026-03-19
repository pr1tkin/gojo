import path from 'node:path';

import type { PatternCandidate, PatternIndex } from '../patterns/types.js';
import type { FileRelation, SymbolIndex } from '../symbol-index/types.js';
import type { UiCompositionEdge, UiCompositionIndex } from '../ui-composition/types.js';
import type { UiPropSurfaceIndex, UiPropUsage } from '../ui-props/types.js';
import type { UiSemanticsIndex } from './ui-semantics.js';
import type {
  FileFingerprintManifestEntry,
  GenerationChangeSummary,
  GenerationChangeSummaryOverview,
  IndexRefreshDelta,
  RepositoryFileChangeRecord,
  RepositoryFileChangeSignal,
  RepositoryFileImpactHint,
} from './types.js';

const CHANGE_SUMMARY_SCHEMA_VERSION = 1;

interface ClassifyRepositoryChangesOptions {
  delta: IndexRefreshDelta;
  previousManifest: FileFingerprintManifestEntry[];
  manifest: FileFingerprintManifestEntry[];
  previousSymbolIndex: SymbolIndex;
  currentSymbolIndex: SymbolIndex;
  previousPatternIndex: PatternIndex;
  currentPatternIndex: PatternIndex;
  previousUiComposition: UiCompositionIndex;
  currentUiComposition: UiCompositionIndex;
  previousUiProps: UiPropSurfaceIndex;
  currentUiProps: UiPropSurfaceIndex;
  previousUiSemantics: UiSemanticsIndex;
  currentUiSemantics: UiSemanticsIndex;
  generatedAt: string;
}

function getLanguage(filePath: string): RepositoryFileChangeRecord['language'] {
  switch (path.extname(filePath).toLowerCase()) {
    case '.ts':
      return 'ts';
    case '.tsx':
      return 'tsx';
    case '.js':
      return 'js';
    case '.jsx':
      return 'jsx';
    default:
      return 'unknown';
  }
}

function toSortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function getFileRelation(index: SymbolIndex, repoId: string, filePath: string): FileRelation | undefined {
  return Object.values(index.byFile).find((relation) => relation.repo === repoId && relation.filePath === filePath);
}

function normalizeSymbolSurface(relation: FileRelation | undefined, index: SymbolIndex): string[] {
  if (!relation) {
    return [];
  }

  return toSortedUnique(
    index.symbols
      .filter((symbol) => symbol.fileId === relation.fileId)
      .map(
        (symbol) =>
          `${symbol.kind}:${symbol.name}:${symbol.exported ? 'exported' : 'internal'}:${symbol.declarationFingerprint ?? ''}`,
      ),
  );
}

function normalizeImports(relation: FileRelation | undefined): string[] {
  if (!relation) {
    return [];
  }

  return toSortedUnique(
    relation.imports.map((entry) => {
      const bindings = toSortedUnique(
        entry.bindings.map(
          (binding) =>
            `${binding.kind}:${binding.importedName ?? ''}:${binding.localName}:${binding.isTypeOnly ? 'type' : 'value'}`,
        ),
      ).join(',');
      return `${entry.source}|${entry.resolvedKind ?? 'unknown'}|${entry.resolvedTargetFileId ?? ''}|${bindings}`;
    }),
  );
}

function normalizeExports(relation: FileRelation | undefined): string[] {
  if (!relation) {
    return [];
  }

  return toSortedUnique(
    relation.exports.map(
      (entry) =>
        `${entry.kind}|${entry.exportedName ?? ''}|${entry.localName ?? ''}|${entry.source ?? ''}|${
          entry.isTypeOnly ? 'type' : 'value'
        }|${entry.symbolId ?? ''}`,
    ),
  );
}

function normalizeUiEdges(edges: UiCompositionEdge[], filePath: string): string[] {
  return toSortedUnique(
    edges
      .filter((edge) => edge.parentFilePath === filePath || edge.childFilePath === filePath)
      .map(
        (edge) =>
          `${edge.parentFilePath}|${edge.parentSymbolId ?? ''}|${edge.childComponentName}|${edge.childFilePath ?? ''}|${
            edge.childSymbolId ?? ''
          }|${edge.confidence}|${edge.resolution}|${edge.hint ?? ''}|${edge.dependencySource ?? ''}|${
            edge.memberExpression?.expression ?? ''
          }|${edge.memberExpression?.baseName ?? ''}|${edge.memberExpression?.members.join('.') ?? ''}|${
            edge.memberExpression?.resolutionKind ?? ''
          }`,
      ),
  );
}

function normalizeUiProps(propUsages: UiPropUsage[], filePath: string): string[] {
  return toSortedUnique(
    propUsages
      .filter((usage) => usage.parentFilePath === filePath || usage.childFilePath === filePath)
      .map(
        (usage) =>
          `${usage.parentFilePath}|${usage.parentSymbolId ?? ''}|${usage.childComponentName}|${usage.childFilePath ?? ''}|${
            usage.childSymbolId ?? ''
          }|${usage.propName}|${usage.valueKind}`,
      ),
  );
}

function normalizeUiSemantics(index: UiSemanticsIndex, repoId: string, filePath: string): {
  wrapperElements: string[];
  structureSequence: string[];
  renderingSignals: string[];
  stylingSignals: string[];
} {
  const summary = index.files[`${repoId}/${filePath}`];

  return {
    wrapperElements: summary?.wrapperElements ?? [],
    structureSequence: summary?.structureSequence ?? [],
    renderingSignals: summary?.renderingSignals ?? [],
    stylingSignals: summary?.stylingSignals ?? [],
  };
}

function normalizeUiRenderingSignals(patterns: PatternCandidate[], fileId: string | undefined): string[] {
  if (!fileId) {
    return [];
  }

  return toSortedUnique(
    patterns
      .filter((pattern) => pattern.fileId === fileId)
      .flatMap((pattern) => {
        const matches: string[] = [];

        if (pattern.kind === 'conditional-rendering') {
          matches.push('conditional-render');
        }

        if (pattern.kind === 'list-rendering') {
          matches.push('list-rendering');
        }

        for (const signal of pattern.fingerprint.uiSignals ?? []) {
          if (signal === 'conditional-render' || signal === 'map-rendering') {
            matches.push(signal);
          }
        }

        return matches;
      }),
  );
}

function normalizePatterns(patterns: PatternCandidate[], fileId: string | undefined): string[] {
  if (!fileId) {
    return [];
  }

  return toSortedUnique(
    patterns
      .filter((pattern) => pattern.fileId === fileId)
      .map(
        (pattern) =>
          `${pattern.kind}|${pattern.name}|${pattern.symbolId ?? ''}|${pattern.fingerprint.patternKind}|${
            pattern.fingerprint.exportShape
          }|${pattern.fingerprint.symbolRole}|${pattern.fingerprint.structuralSignals.join(',')}|${
            pattern.fingerprint.importSet.join(',')
          }|${(pattern.fingerprint.uiSignals ?? []).join(',')}|${(pattern.fingerprint.asyncSignals ?? []).join(',')}|${
            (pattern.fingerprint.responsibilitySignals ?? []).join(',')
          }`,
      ),
  );
}

function addSignal(signals: Set<RepositoryFileChangeSignal>, signal: RepositoryFileChangeSignal): void {
  signals.add(signal);
}

function addImpactHint(hints: Set<RepositoryFileImpactHint>, hint: RepositoryFileImpactHint): void {
  hints.add(hint);
}

function createBaseRecord(
  key: string,
  repoId: string,
  filePath: string,
  changeKind: RepositoryFileChangeRecord['changeKind'],
  classification: RepositoryFileChangeRecord['classification'],
): RepositoryFileChangeRecord {
  return {
    key,
    repoId,
    filePath,
    changeKind,
    classification,
    language: getLanguage(filePath),
    confidence: 'high',
    signals: [],
    impactHints: [],
    notes: [],
  };
}

function finalizeRecord(
  record: RepositoryFileChangeRecord,
  signals: Set<RepositoryFileChangeSignal>,
  hints: Set<RepositoryFileImpactHint>,
): RepositoryFileChangeRecord {
  return {
    ...record,
    signals: Array.from(signals).sort(),
    impactHints: Array.from(hints).sort(),
    notes: [...record.notes],
  };
}

function classifyAddedOrDeletedFile(options: {
  key: string;
  repoId: string;
  filePath: string;
  changeKind: 'added' | 'deleted';
  relation: FileRelation | undefined;
  patternIndex: PatternIndex;
  uiComposition: UiCompositionIndex;
  uiProps: UiPropSurfaceIndex;
  uiSemantics: UiSemanticsIndex;
}): RepositoryFileChangeRecord {
  const record = createBaseRecord(
    options.key,
    options.repoId,
    options.filePath,
    options.changeKind,
    options.relation?.classification,
  );
  const signals = new Set<RepositoryFileChangeSignal>();
  const hints = new Set<RepositoryFileImpactHint>();
  const fileId = options.relation?.fileId;
  const patternSurface = normalizePatterns(options.patternIndex.patterns, fileId);
  const uiEdges = normalizeUiEdges(options.uiComposition.edges, options.filePath);
  const uiProps = normalizeUiProps(options.uiProps.propUsages, options.filePath);
  const uiSemantics = normalizeUiSemantics(options.uiSemantics, options.repoId, options.filePath);

  if (options.changeKind === 'added') {
    addSignal(signals, 'contentChanged');
  }

  if (options.relation?.symbolIds.length || options.relation?.symbolNames.length) {
    addSignal(signals, 'symbolSurfaceChanged');
  }

  if ((options.relation?.imports.length ?? 0) > 0) {
    addSignal(signals, 'importsChanged');
    addSignal(signals, 'graphRelevantChanged');
  }

  if ((options.relation?.exports.length ?? 0) > 0) {
    addSignal(signals, 'exportsChanged');
    addSignal(signals, 'graphRelevantChanged');
    addSignal(signals, 'likelyApiBoundaryChanged');
  }

  if (uiEdges.length > 0) {
    addSignal(signals, 'uiStructureChanged');
  }

  if (uiProps.length > 0) {
    addSignal(signals, 'uiPropsChanged');
  }

  if (uiSemantics.wrapperElements.length > 0) {
    addSignal(signals, 'uiStructureChanged');
  }

  if (uiSemantics.structureSequence.length > 0) {
    addSignal(signals, 'uiStructureChanged');
  }

  if (uiSemantics.stylingSignals.length > 0) {
    addSignal(signals, 'uiStylingChanged');
  }

  if (uiSemantics.renderingSignals.length > 0) {
    addSignal(signals, 'uiRenderingChanged');
  }

  if (patternSurface.length > 0) {
    addSignal(signals, 'patternRelevantChanged');
  }

  if (!options.relation) {
    addSignal(signals, 'unknownStructuralChange');
    record.confidence = 'low';
    record.notes.push('file relation could not be derived; falling back to conservative structural change handling');
  }

  addImpactHint(hints, 'requiresSymbolReindex');
  addImpactHint(hints, 'requiresGraphRebuild');
  addImpactHint(hints, 'requiresPatternRefresh');
  addImpactHint(hints, 'mayAffectSearchFreshness');

  if (
    record.language === 'tsx' ||
    signals.has('uiStructureChanged') ||
    signals.has('uiPropsChanged') ||
    signals.has('uiStylingChanged')
  ) {
    addImpactHint(hints, 'requiresUiRefresh');
  }

  if (signals.has('importsChanged') || signals.has('exportsChanged') || signals.has('likelyApiBoundaryChanged')) {
    addImpactHint(hints, 'mayAffectDependents');
  }

  if (signals.has('unknownStructuralChange')) {
    addImpactHint(hints, 'highRiskStructuralChange');
  }

  return finalizeRecord(record, signals, hints);
}

function classifyModifiedFile(options: {
  key: string;
  repoId: string;
  filePath: string;
  previousEntry: FileFingerprintManifestEntry;
  currentEntry: FileFingerprintManifestEntry;
  previousSymbolIndex: SymbolIndex;
  currentSymbolIndex: SymbolIndex;
  previousPatternIndex: PatternIndex;
  currentPatternIndex: PatternIndex;
  previousUiComposition: UiCompositionIndex;
  currentUiComposition: UiCompositionIndex;
  previousUiProps: UiPropSurfaceIndex;
  currentUiProps: UiPropSurfaceIndex;
  previousUiSemantics: UiSemanticsIndex;
  currentUiSemantics: UiSemanticsIndex;
}): RepositoryFileChangeRecord {
  const previousRelation = getFileRelation(options.previousSymbolIndex, options.repoId, options.filePath);
  const currentRelation = getFileRelation(options.currentSymbolIndex, options.repoId, options.filePath);
  const classification = currentRelation?.classification ?? previousRelation?.classification;
  const record = createBaseRecord(options.key, options.repoId, options.filePath, 'modified', classification);
  const signals = new Set<RepositoryFileChangeSignal>();
  const hints = new Set<RepositoryFileImpactHint>();

  if (options.previousEntry.contentHash === options.currentEntry.contentHash) {
    addSignal(signals, 'metadataOnlyChanged');
    record.notes.push('content hash is unchanged; manifest delta was triggered by metadata drift only');
  } else {
    addSignal(signals, 'contentChanged');
  }

  const previousSymbols = normalizeSymbolSurface(previousRelation, options.previousSymbolIndex);
  const currentSymbols = normalizeSymbolSurface(currentRelation, options.currentSymbolIndex);
  const previousImports = normalizeImports(previousRelation);
  const currentImports = normalizeImports(currentRelation);
  const previousExports = normalizeExports(previousRelation);
  const currentExports = normalizeExports(currentRelation);
  const previousUiEdges = normalizeUiEdges(options.previousUiComposition.edges, options.filePath);
  const currentUiEdges = normalizeUiEdges(options.currentUiComposition.edges, options.filePath);
  const previousUiProps = normalizeUiProps(options.previousUiProps.propUsages, options.filePath);
  const currentUiProps = normalizeUiProps(options.currentUiProps.propUsages, options.filePath);
  const previousPatterns = normalizePatterns(options.previousPatternIndex.patterns, previousRelation?.fileId);
  const currentPatterns = normalizePatterns(options.currentPatternIndex.patterns, currentRelation?.fileId);
  const previousUiSemantics = normalizeUiSemantics(
    options.previousUiSemantics,
    options.repoId,
    options.filePath,
  );
  const currentUiSemantics = normalizeUiSemantics(
    options.currentUiSemantics,
    options.repoId,
    options.filePath,
  );
  const previousUiRendering = normalizeUiRenderingSignals(
    options.previousPatternIndex.patterns,
    previousRelation?.fileId,
  );
  const currentUiRendering = normalizeUiRenderingSignals(
    options.currentPatternIndex.patterns,
    currentRelation?.fileId,
  );

  if (!areStringArraysEqual(previousSymbols, currentSymbols)) {
    addSignal(signals, 'symbolSurfaceChanged');
  }

  if (!areStringArraysEqual(previousImports, currentImports)) {
    addSignal(signals, 'importsChanged');
    addSignal(signals, 'graphRelevantChanged');
  }

  if (!areStringArraysEqual(previousExports, currentExports)) {
    addSignal(signals, 'exportsChanged');
    addSignal(signals, 'graphRelevantChanged');
    addSignal(signals, 'likelyApiBoundaryChanged');
  }

  if (!areStringArraysEqual(previousUiEdges, currentUiEdges)) {
    addSignal(signals, 'uiStructureChanged');
  }

  if (!areStringArraysEqual(previousUiProps, currentUiProps)) {
    addSignal(signals, 'uiPropsChanged');
  }

  if (!areStringArraysEqual(previousUiSemantics.wrapperElements, currentUiSemantics.wrapperElements)) {
    addSignal(signals, 'uiStructureChanged');
  }

  if (!areStringArraysEqual(previousUiSemantics.structureSequence, currentUiSemantics.structureSequence)) {
    addSignal(signals, 'uiStructureChanged');
  }

  if (!areStringArraysEqual(previousUiRendering, currentUiRendering)) {
    addSignal(signals, 'uiRenderingChanged');
  }

  if (!areStringArraysEqual(previousUiSemantics.renderingSignals, currentUiSemantics.renderingSignals)) {
    addSignal(signals, 'uiRenderingChanged');
  }

  if (!areStringArraysEqual(previousUiSemantics.stylingSignals, currentUiSemantics.stylingSignals)) {
    addSignal(signals, 'uiStylingChanged');
  }

  if (!areStringArraysEqual(previousPatterns, currentPatterns)) {
    addSignal(signals, 'patternRelevantChanged');
  }

  if (!previousRelation || !currentRelation) {
    addSignal(signals, 'unknownStructuralChange');
    record.confidence = 'low';
    record.notes.push('one side of the file relation is missing; downstream invalidation is conservative');
  }

  const onlyMetadataChanged = signals.size === 1 && signals.has('metadataOnlyChanged');
  const derivedSignals = Array.from(signals).filter((signal) => signal !== 'contentChanged' && signal !== 'metadataOnlyChanged');

  if (!onlyMetadataChanged && derivedSignals.length === 0) {
    addSignal(signals, 'unknownStructuralChange');
    record.confidence = 'low';
    record.notes.push('content changed but no derived semantic delta was detected; marking as conservatively structural');
  }

  if (!signals.has('metadataOnlyChanged')) {
    addImpactHint(hints, 'requiresSymbolReindex');
    addImpactHint(hints, 'mayAffectSearchFreshness');
  }

  if (
    signals.has('importsChanged') ||
    signals.has('exportsChanged') ||
    signals.has('graphRelevantChanged') ||
    signals.has('unknownStructuralChange')
  ) {
    addImpactHint(hints, 'requiresGraphRebuild');
  }

  if (
    signals.has('uiStructureChanged') ||
    signals.has('uiPropsChanged') ||
    signals.has('uiRenderingChanged') ||
    signals.has('uiStylingChanged') ||
    (signals.has('unknownStructuralChange') && record.language === 'tsx')
  ) {
    addImpactHint(hints, 'requiresUiRefresh');
  }

  if (signals.has('patternRelevantChanged') || signals.has('unknownStructuralChange')) {
    addImpactHint(hints, 'requiresPatternRefresh');
  }

  if (signals.has('importsChanged') || signals.has('exportsChanged') || signals.has('likelyApiBoundaryChanged')) {
    addImpactHint(hints, 'mayAffectDependents');
  }

  if (signals.has('unknownStructuralChange')) {
    addImpactHint(hints, 'highRiskStructuralChange');
  }

  return finalizeRecord(record, signals, hints);
}

function createOverview(files: RepositoryFileChangeRecord[]): GenerationChangeSummaryOverview {
  const signalCounts: Partial<Record<RepositoryFileChangeSignal, number>> = {};
  const impactHintCounts: Partial<Record<RepositoryFileImpactHint, number>> = {};

  for (const file of files) {
    for (const signal of file.signals) {
      signalCounts[signal] = (signalCounts[signal] ?? 0) + 1;
    }

    for (const hint of file.impactHints) {
      impactHintCounts[hint] = (impactHintCounts[hint] ?? 0) + 1;
    }
  }

  return {
    filesChanged: files.length,
    added: files.filter((file) => file.changeKind === 'added').length,
    modified: files.filter((file) => file.changeKind === 'modified').length,
    deleted: files.filter((file) => file.changeKind === 'deleted').length,
    highRiskFiles: files.filter((file) => file.impactHints.includes('highRiskStructuralChange')).length,
    signalCounts,
    impactHintCounts,
  };
}

export function createEmptyGenerationChangeSummary(generatedAt: string): GenerationChangeSummary {
  return {
    schemaVersion: CHANGE_SUMMARY_SCHEMA_VERSION,
    generatedAt,
    files: [],
    overview: createOverview([]),
  };
}

export function classifyRepositoryChanges(
  options: ClassifyRepositoryChangesOptions,
): GenerationChangeSummary {
  const previousManifestByKey = new Map(options.previousManifest.map((entry) => [entry.key, entry]));
  const manifestByKey = new Map(options.manifest.map((entry) => [entry.key, entry]));
  const files: RepositoryFileChangeRecord[] = [];

  for (const key of [...options.delta.added].sort((left, right) => left.localeCompare(right))) {
    const entry = manifestByKey.get(key);

    if (!entry) {
      continue;
    }

    files.push(
      classifyAddedOrDeletedFile({
        key,
        repoId: entry.repoId,
        filePath: entry.filePath,
        changeKind: 'added',
        relation: getFileRelation(options.currentSymbolIndex, entry.repoId, entry.filePath),
        patternIndex: options.currentPatternIndex,
        uiComposition: options.currentUiComposition,
        uiProps: options.currentUiProps,
        uiSemantics: options.currentUiSemantics,
      }),
    );
  }

  for (const key of [...options.delta.modified].sort((left, right) => left.localeCompare(right))) {
    const previousEntry = previousManifestByKey.get(key);
    const currentEntry = manifestByKey.get(key);

    if (!previousEntry || !currentEntry) {
      continue;
    }

    files.push(
      classifyModifiedFile({
        key,
        repoId: currentEntry.repoId,
        filePath: currentEntry.filePath,
        previousEntry,
        currentEntry,
        previousSymbolIndex: options.previousSymbolIndex,
        currentSymbolIndex: options.currentSymbolIndex,
        previousPatternIndex: options.previousPatternIndex,
        currentPatternIndex: options.currentPatternIndex,
        previousUiComposition: options.previousUiComposition,
        currentUiComposition: options.currentUiComposition,
        previousUiProps: options.previousUiProps,
        currentUiProps: options.currentUiProps,
        previousUiSemantics: options.previousUiSemantics,
        currentUiSemantics: options.currentUiSemantics,
      }),
    );
  }

  for (const key of [...options.delta.deleted].sort((left, right) => left.localeCompare(right))) {
    const entry = previousManifestByKey.get(key);

    if (!entry) {
      continue;
    }

    files.push(
      classifyAddedOrDeletedFile({
        key,
        repoId: entry.repoId,
        filePath: entry.filePath,
        changeKind: 'deleted',
        relation: getFileRelation(options.previousSymbolIndex, entry.repoId, entry.filePath),
        patternIndex: options.previousPatternIndex,
        uiComposition: options.previousUiComposition,
        uiProps: options.previousUiProps,
        uiSemantics: options.previousUiSemantics,
      }),
    );
  }

  files.sort((left, right) => left.key.localeCompare(right.key));

  return {
    schemaVersion: CHANGE_SUMMARY_SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    files,
    overview: createOverview(files),
  };
}
