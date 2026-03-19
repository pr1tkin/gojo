import { createPatternId } from './ids.js';
import { loadPatternIndex, savePatternIndex } from './store.js';
import type {
  PatternCandidate,
  PatternFingerprint,
  PatternIndex,
  PatternKind,
  PatternSignal,
  PatternStructuralAnchor,
} from './types.js';

function comparePatterns(left: PatternCandidate, right: PatternCandidate): number {
  return (
    left.repoId.localeCompare(right.repoId) ||
    left.fileId.localeCompare(right.fileId) ||
    (left.symbolId ?? '').localeCompare(right.symbolId ?? '') ||
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    left.startLine - right.startLine ||
    left.endLine - right.endLine
  );
}

export function createEmptyPatternIndex(sourceSymbolIndexSchemaVersion: number = 0, generatedAt: string = ''): PatternIndex {
  return {
    schemaVersion: 1,
    sourceSymbolIndexSchemaVersion,
    generatedAt,
    patterns: [],
  };
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function normalizePatternCandidate(candidate: PatternCandidate): PatternCandidate {
  return {
    ...candidate,
    supportingImports: dedupeStrings(candidate.supportingImports),
    relatedSymbolIds: dedupeStrings(candidate.relatedSymbolIds),
    fingerprint: {
      ...candidate.fingerprint,
      structuralSignals: dedupeStrings(candidate.fingerprint.structuralSignals),
      importSet: dedupeStrings(candidate.fingerprint.importSet),
      ...(candidate.fingerprint.uiSignals ? { uiSignals: dedupeStrings(candidate.fingerprint.uiSignals) } : {}),
      ...(candidate.fingerprint.asyncSignals ? { asyncSignals: dedupeStrings(candidate.fingerprint.asyncSignals) } : {}),
      ...(candidate.fingerprint.responsibilitySignals
        ? { responsibilitySignals: dedupeStrings(candidate.fingerprint.responsibilitySignals) }
        : {}),
    },
    ...(candidate.structuralAnchor
      ? {
          structuralAnchor: {
            structurallyIndexed: candidate.structuralAnchor.structurallyIndexed,
            resolvedLocalDependencyFileIds: dedupeStrings(candidate.structuralAnchor.resolvedLocalDependencyFileIds),
            localDependencyFamilyTokens: dedupeStrings(candidate.structuralAnchor.localDependencyFamilyTokens),
          },
        }
      : {}),
    signals: [...candidate.signals].sort((left, right) => left.type.localeCompare(right.type) || left.strength.localeCompare(right.strength)),
  };
}

export interface RegisterPatternCandidateInput {
  kind: PatternKind;
  repoId: string;
  fileId: string;
  symbolId?: string;
  name: string;
  language: PatternCandidate['language'];
  startLine: number;
  endLine: number;
  signals: PatternSignal[];
  fingerprint: PatternFingerprint;
  supportingImports?: string[];
  relatedSymbolIds?: string[];
  structuralAnchor?: PatternStructuralAnchor;
  confidence: PatternCandidate['confidence'];
  createdAt?: string;
}

export function createPatternCandidate(input: RegisterPatternCandidateInput): PatternCandidate {
  return normalizePatternCandidate({
    patternId: createPatternId(
      input.repoId,
      input.fileId,
      input.kind,
      input.name,
      input.startLine,
      input.endLine,
      input.symbolId,
    ),
    kind: input.kind,
    repoId: input.repoId,
    fileId: input.fileId,
    ...(input.symbolId ? { symbolId: input.symbolId } : {}),
    name: input.name,
    language: input.language,
    startLine: input.startLine,
    endLine: input.endLine,
    signals: input.signals,
    fingerprint: input.fingerprint,
    supportingImports: input.supportingImports ?? [],
    relatedSymbolIds: input.relatedSymbolIds ?? [],
    ...(input.structuralAnchor ? { structuralAnchor: input.structuralAnchor } : {}),
    confidence: input.confidence,
    createdAt: input.createdAt ?? new Date(0).toISOString(),
  });
}

export function registerPatternCandidateInIndex(index: PatternIndex, candidate: PatternCandidate): PatternIndex {
  const normalized = normalizePatternCandidate(candidate);
  const dedupeKey = `${normalized.symbolId ?? normalized.fileId}:${normalized.kind}:${normalized.fingerprint.structuralSignals.join('|')}`;
  const existing = index.patterns.filter((entry) => {
    const entryKey = `${entry.symbolId ?? entry.fileId}:${entry.kind}:${entry.fingerprint.structuralSignals.join('|')}`;
    return entry.patternId !== normalized.patternId && entryKey !== dedupeKey;
  });
  existing.push(normalized);
  existing.sort(comparePatterns);

  return {
    ...index,
    patterns: existing,
  };
}

export async function registerPatternCandidate(candidate: PatternCandidate): Promise<PatternCandidate> {
  const index = await loadPatternIndex();
  const nextIndex = registerPatternCandidateInIndex(index, candidate);
  await savePatternIndex(nextIndex);
  return normalizePatternCandidate(candidate);
}

export async function getPatternsForFile(fileId: string): Promise<PatternCandidate[]> {
  const index = await loadPatternIndex();
  return index.patterns.filter((entry) => entry.fileId === fileId).sort(comparePatterns);
}

export async function getPatternsForSymbol(symbolId: string): Promise<PatternCandidate[]> {
  const index = await loadPatternIndex();
  return index.patterns.filter((entry) => entry.symbolId === symbolId).sort(comparePatterns);
}

export async function listPatternsByKind(kind: PatternKind): Promise<PatternCandidate[]> {
  const index = await loadPatternIndex();
  return index.patterns.filter((entry) => entry.kind === kind).sort(comparePatterns);
}

export async function getPatternById(patternId: string): Promise<PatternCandidate | null> {
  const index = await loadPatternIndex();
  return index.patterns.find((entry) => entry.patternId === patternId) ?? null;
}
