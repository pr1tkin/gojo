import path from 'node:path';

import { computePathCloseness, countIntersection, createReason } from '../ranking/scoring.js';
import type { RankingReason } from '../ranking/index.js';
import { getDefinedSymbols, getExportedSymbols, getFileNode } from '../graph/query.js';
import {
  getLocalDependencyFamilyTokens,
  mapPatternStructuralAlignment,
  mapRelatedFileIds,
  type PatternStructuralAlignment,
} from '../patterns/structural-alignment.js';
import { getFileRelation, getFileRelationById, listFileRelations } from '../symbol-index/query.js';
import type { FileRelation } from '../symbol-index/types.js';
import type { SearchPatternsMode, SymbolKind } from '../types.js';
import { getFileExplorationContext } from './file-service.js';
import { getSymbolExplorationContext } from './symbol-service.js';
import type { PatternMatchContext, PatternMatchItem, PatternResolutionSummary, PatternTargetSummary } from './types.js';

const DEFAULT_MATCH_LIMIT = 6;
const STRONG_MATCH_THRESHOLD = 0.72;
const COMMON_FILE_SUFFIXES = ['test', 'spec', 'stories', 'story', 'styles', 'style'];
const STRUCTURAL_ALIGNMENT_WEIGHT = 0.4;
const DEPENDENCY_OVERLAP_WEIGHT = 0.3;
const RESPONSIBILITY_SIMILARITY_WEIGHT = 0.2;
const MATCH_STRENGTH_WEIGHT = 0.1;

type ResponsibilityKind = 'page' | 'hook' | 'component' | 'utility' | 'handler' | 'test' | 'story' | 'module';

interface PatternServiceOptions {
  repo?: string;
  limit?: number;
}

interface FilePatternProfile {
  relation: FileRelation;
  file: NonNullable<PatternTargetSummary['file']>;
  definedSymbols: PatternTargetSummary['definedSymbols'];
  exportedSymbols: PatternTargetSummary['exportedSymbols'];
  namingTokens: string[];
  directorySegments: string[];
  bundleStem: string;
  bundleSuffixes: string[];
  relatedFileIds: string[];
  resolvedLocalDependencyFileIds: string[];
  localDependencyFamilyTokens: string[];
  structuralAlignment: PatternStructuralAlignment;
}

interface CandidateScore {
  relation: FileRelation;
  score: number;
  reason: string;
  reasons: RankingReason[];
  signalScores: {
    structuralAlignment: number;
    dependencyOverlap: number;
    responsibilitySimilarity: number;
    matchStrength: number;
  };
}

function compareScores(left: CandidateScore, right: CandidateScore): number {
  if (right.signalScores.structuralAlignment !== left.signalScores.structuralAlignment) {
    return right.signalScores.structuralAlignment - left.signalScores.structuralAlignment;
  }

  if (right.signalScores.dependencyOverlap !== left.signalScores.dependencyOverlap) {
    return right.signalScores.dependencyOverlap - left.signalScores.dependencyOverlap;
  }

  if (right.signalScores.responsibilitySimilarity !== left.signalScores.responsibilitySimilarity) {
    return right.signalScores.responsibilitySimilarity - left.signalScores.responsibilitySimilarity;
  }

  if (right.signalScores.matchStrength !== left.signalScores.matchStrength) {
    return right.signalScores.matchStrength - left.signalScores.matchStrength;
  }

  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return left.relation.repo.localeCompare(right.relation.repo) || left.relation.filePath.localeCompare(right.relation.filePath);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function tokenizeName(value: string): string[] {
  return dedupe(
    value
      .replace(/\.[^.]+$/g, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

function getBaseFileName(filePath: string): string {
  return path.basename(filePath).replace(/\.[^.]+$/g, '');
}

function getBundleStem(filePath: string): string {
  const baseName = getBaseFileName(filePath);

  for (const suffix of COMMON_FILE_SUFFIXES) {
    const marker = `.${suffix}`;

    if (baseName.endsWith(marker)) {
      return baseName.slice(0, -marker.length);
    }
  }

  return baseName;
}

function getBundleSuffix(filePath: string): string {
  const baseName = getBaseFileName(filePath);

  for (const suffix of COMMON_FILE_SUFFIXES) {
    const marker = `.${suffix}`;

    if (baseName.endsWith(marker)) {
      return suffix;
    }
  }

  return 'main';
}

function collectBundleSuffixes(target: FileRelation, relations: FileRelation[]): string[] {
  const targetStem = getBundleStem(target.filePath);
  const targetDir = path.posix.dirname(target.filePath);

  return dedupe(
    relations
      .filter((relation) => relation.repo === target.repo)
      .filter((relation) => path.posix.dirname(relation.filePath) === targetDir)
      .filter((relation) => getBundleStem(relation.filePath) === targetStem)
      .map((relation) => getBundleSuffix(relation.filePath)),
  ).sort();
}

function mapSymbolSummaries(symbols: Array<{ name: string; kind: SymbolKind }>): Array<{ name: string; kind: SymbolKind }> {
  return symbols.slice().sort((left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind));
}

function roundScore(value: number): number {
  return Number(value.toFixed(3));
}

function jaccard(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);

  if (union.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const value of leftSet) {
    if (rightSet.has(value)) {
      intersection += 1;
    }
  }

  return intersection / union.size;
}

function getStructuralAlignmentScore(alignment: PatternStructuralAlignment): number {
  if (!alignment.graphAnchored) {
    return 0.2;
  }

  if (alignment.structuralContextStrength === 'high') {
    return 1;
  }

  if (alignment.structuralContextStrength === 'medium') {
    return 0.6;
  }

  return 0.2;
}

function inferResponsibilityKind(relation: FileRelation): ResponsibilityKind {
  const normalizedFilePath = relation.filePath.toLowerCase();
  const extension = path.extname(normalizedFilePath);
  const baseName = path.posix.basename(normalizedFilePath);

  if (/(\.|\/)(stories|story)\.(tsx?|jsx?)$/i.test(normalizedFilePath)) {
    return 'story';
  }

  if (/(\.|\/)(test|spec)\.(tsx?|jsx?)$/i.test(normalizedFilePath)) {
    return 'test';
  }

  if (/(\.|\/)(page|layout)\.(tsx?|jsx?)$/i.test(normalizedFilePath)) {
    return 'page';
  }

  if (/(\.|\/)route\.(tsx?|jsx?)$/i.test(normalizedFilePath) || /^pages\/api\//i.test(normalizedFilePath)) {
    return 'handler';
  }

  if (
    relation.symbolNames.some((name) => /^use[A-Z0-9_]/.test(name)) ||
    normalizedFilePath.includes('/hooks/') ||
    /^use[a-z0-9_-]*/.test(baseName)
  ) {
    return 'hook';
  }

  if (
    normalizedFilePath.includes('/components/') ||
    ((extension === '.tsx' || extension === '.jsx') && relation.symbolNames.some((name) => /^[A-Z]/.test(name)))
  ) {
    return 'component';
  }

  if (
    normalizedFilePath.includes('/utils/') ||
    normalizedFilePath.includes('/helpers/') ||
    normalizedFilePath.includes('/services/')
  ) {
    return 'utility';
  }

  return 'module';
}

function getResponsibilitySimilarityScore(target: ResponsibilityKind, candidate: ResponsibilityKind): number {
  if (target === candidate) {
    return 1;
  }

  if ((target === 'page' && candidate === 'component') || (target === 'component' && candidate === 'page')) {
    return 0.4;
  }

  if ((target === 'utility' && candidate === 'handler') || (target === 'handler' && candidate === 'utility')) {
    return 0.35;
  }

  if ((target === 'component' && candidate === 'hook') || (target === 'hook' && candidate === 'component')) {
    return 0.2;
  }

  return 0;
}

function buildCandidateRelatedFileIdsByFileId(allRelations: FileRelation[]): Record<string, string[]> {
  const relatedFileIdsByFileId = Object.create(null) as Record<string, string[]>;

  const record = (fromFileId: string, toFileId: string) => {
    const existing = relatedFileIdsByFileId[fromFileId] ?? [];

    if (!existing.includes(toFileId)) {
      existing.push(toFileId);
      existing.sort((left, right) => left.localeCompare(right));
      relatedFileIdsByFileId[fromFileId] = existing;
    }
  };

  for (const relation of allRelations) {
    for (const importRecord of relation.imports) {
      if (!importRecord.resolvedTargetFileId) {
        continue;
      }

      record(relation.fileId, importRecord.resolvedTargetFileId);
      record(importRecord.resolvedTargetFileId, relation.fileId);
    }
  }

  return relatedFileIdsByFileId;
}

function buildResolutionFromSymbolCandidates(
  mode: SearchPatternsMode,
  context: Awaited<ReturnType<typeof getSymbolExplorationContext>>,
): PatternResolutionSummary {
  const candidates = context.rankedSymbols.map((entry) => ({
    symbolId: entry.item.symbolId,
    fileId: entry.item.fileId,
    repo: entry.item.repo,
    filePath: entry.item.filePath,
    name: entry.item.name,
    kind: entry.item.kind,
    exported: Boolean(entry.item.exported),
    score: entry.score,
    reasons: entry.reasons,
  }));

  return {
    status: context.primarySymbol ? 'resolved' : 'missing',
    mode,
    candidateCount: candidates.length,
    ambiguityDetected: candidates.length > 1,
    selectedCandidate: candidates[0] ?? null,
    alternativeCandidates: candidates.slice(1),
  };
}

function buildMissingResolution(mode: SearchPatternsMode): PatternResolutionSummary {
  return {
    status: 'missing',
    mode,
    candidateCount: 0,
    ambiguityDetected: false,
    selectedCandidate: null,
    alternativeCandidates: [],
  };
}

async function loadTargetProfile(fileId: string, allRelations: FileRelation[]): Promise<FilePatternProfile | null> {
  const [relation, file, definedSymbols, exportedSymbols, fileContext] = await Promise.all([
    getFileRelationById(fileId),
    getFileNode(fileId),
    getDefinedSymbols(fileId),
    getExportedSymbols(fileId),
    getFileExplorationContext(fileId, { relatedLimit: 20 }),
  ]);

  if (!relation || !file) {
    return null;
  }
  const filesById = Object.fromEntries(allRelations.map((entry) => [entry.fileId, entry]));
  const resolvedLocalDependencyFileIds = relation.imports
    .map((entry) => entry.resolvedTargetFileId)
    .filter((value): value is string => Boolean(value));

  const structuralAlignment = mapPatternStructuralAlignment({
    structurallyIndexed: relation.classification === 'source',
    resolvedLocalDependencyFileIds,
    relatedLocalFileIds: mapRelatedFileIds(fileContext.relatedFiles),
    filesById,
  });

  return {
    relation,
    file,
    definedSymbols: mapSymbolSummaries(definedSymbols.map((symbol) => ({ name: symbol.name, kind: symbol.kind }))),
    exportedSymbols: mapSymbolSummaries(exportedSymbols.map((symbol) => ({ name: symbol.name, kind: symbol.kind }))),
    namingTokens: dedupe([
      ...tokenizeName(path.posix.basename(relation.filePath)),
      ...relation.symbolNames.flatMap((name) => tokenizeName(name)),
    ]),
    directorySegments: relation.filePath.split('/').slice(0, -1).filter(Boolean),
    bundleStem: getBundleStem(relation.filePath),
    bundleSuffixes: collectBundleSuffixes(relation, allRelations),
    relatedFileIds: dedupe(fileContext.relatedFiles.map((entry) => entry.file.fileId)),
    resolvedLocalDependencyFileIds,
    localDependencyFamilyTokens: getLocalDependencyFamilyTokens(resolvedLocalDependencyFileIds, filesById),
    structuralAlignment,
  };
}

function determineReason(reasons: RankingReason[]): string {
  const hasHighStructuralAlignment = reasons.some(
    (reason) => reason.signal === 'structural_alignment' && reason.note === 'high',
  );
  const hasMediumStructuralAlignment = reasons.some(
    (reason) => reason.signal === 'structural_alignment' && reason.note === 'medium',
  );
  const hasDependencyOverlap = reasons.some((reason) => reason.signal === 'dependency_overlap');
  const hasResponsibilitySimilarity = reasons.some((reason) => reason.signal === 'responsibility_similarity');

  if (hasHighStructuralAlignment && hasDependencyOverlap && hasResponsibilitySimilarity) {
    return 'shared dependencies + same responsibility + high structural alignment';
  }

  if ((hasHighStructuralAlignment || hasMediumStructuralAlignment) && hasDependencyOverlap) {
    return 'shared dependencies + strong structural alignment';
  }

  if ((hasHighStructuralAlignment || hasMediumStructuralAlignment) && hasResponsibilitySimilarity) {
    return 'same responsibility + strong structural alignment';
  }

  if (hasHighStructuralAlignment || hasMediumStructuralAlignment) {
    return 'strong structural alignment';
  }

  if (hasDependencyOverlap) {
    return 'shared dependency context';
  }

  if (hasResponsibilitySimilarity) {
    return 'same responsibility';
  }

  if (reasons.some((reason) => reason.signal === 'shared_export_names')) {
    return 'similar export surface';
  }

  if (reasons.some((reason) => reason.signal === 'shared_related_files')) {
    return 'similar file neighborhood';
  }

  if (reasons.some((reason) => reason.signal === 'bundle_shape_overlap')) {
    return 'similar file bundle';
  }

  if (reasons.some((reason) => reason.signal === 'naming_family_overlap')) {
    return 'similar naming family';
  }

  if (reasons.some((reason) => reason.signal === 'path_closeness')) {
    return 'same directory family';
  }

  if (reasons.some((reason) => reason.signal === 'same_repo')) {
    return 'same repository';
  }

  return 'heuristic pattern match';
}

function scoreCandidate(profile: FilePatternProfile, candidate: FileRelation, allRelations: FileRelation[]): CandidateScore | null {
  const reasons: RankingReason[] = [];
  const filesById = Object.fromEntries(allRelations.map((relation) => [relation.fileId, relation]));
  const relatedFileIdsByFileId = buildCandidateRelatedFileIdsByFileId(allRelations);
  const candidateExportNames = dedupe(candidate.exports.map((entry) => entry.exportedName).filter((value): value is string => Boolean(value)));
  const targetExportNames = profile.exportedSymbols.map((symbol) => symbol.name);
  const exportNameOverlap = jaccard(targetExportNames, candidateExportNames);
  const importTokenOverlap = jaccard(profile.relation.importTokens, candidate.importTokens);
  const symbolNameOverlap = jaccard(profile.relation.symbolNames, candidate.symbolNames);
  const candidateNamingTokenOverlap = jaccard(
    profile.namingTokens,
    dedupe([...tokenizeName(path.posix.basename(candidate.filePath)), ...candidate.symbolNames.flatMap((name) => tokenizeName(name))]),
  );
  const pathCloseness = computePathCloseness(profile.relation.filePath, candidate.filePath);
  const candidateBundleSuffixes = collectBundleSuffixes(candidate, allRelations);
  const bundleOverlap = countIntersection(profile.bundleSuffixes, candidateBundleSuffixes);
  const candidateResolvedLocalDependencyFileIds = candidate.imports
    .map((entry) => entry.resolvedTargetFileId)
    .filter((value): value is string => Boolean(value));
  const candidateRelatedFileIds = relatedFileIdsByFileId[candidate.fileId] ?? [];
  const sharedLocalDependencies = countIntersection(
    profile.resolvedLocalDependencyFileIds,
    candidateResolvedLocalDependencyFileIds,
  );
  const candidateDependencyFamilyTokens = getLocalDependencyFamilyTokens(
    candidateResolvedLocalDependencyFileIds,
    filesById,
  );
  const sharedDependencyFamilies = countIntersection(
    profile.localDependencyFamilyTokens,
    candidateDependencyFamilyTokens,
  );
  const dependencyJaccard = jaccard(profile.resolvedLocalDependencyFileIds, candidateResolvedLocalDependencyFileIds);
  const dependencyFamilyOverlap = jaccard(profile.localDependencyFamilyTokens, candidateDependencyFamilyTokens);
  const sharedRelatedFileOverlap = jaccard(profile.relatedFileIds, candidateRelatedFileIds);
  const dependencyOverlap = Math.max(
    dependencyJaccard,
    dependencyFamilyOverlap * 0.7,
    sharedRelatedFileOverlap * 0.5,
    sharedLocalDependencies >= 2 ? 0.85 : 0,
  );
  const candidateStructuralAlignment = mapPatternStructuralAlignment({
    structurallyIndexed: candidate.classification === 'source',
    resolvedLocalDependencyFileIds: candidateResolvedLocalDependencyFileIds,
    relatedLocalFileIds: candidateRelatedFileIds,
    filesById,
  });
  const structuralAlignmentScore = getStructuralAlignmentScore(candidateStructuralAlignment);
  const responsibilitySimilarity = getResponsibilitySimilarityScore(
    inferResponsibilityKind(profile.relation),
    inferResponsibilityKind(candidate),
  );
  const sameBundleStem = getBundleStem(candidate.filePath) === profile.bundleStem ? 1 : 0;
  const heuristicMatchStrength = Math.max(
    0,
    Math.min(
      1,
      importTokenOverlap * 0.25 +
        exportNameOverlap * 0.2 +
        symbolNameOverlap * 0.15 +
        candidateNamingTokenOverlap * 0.2 +
        Math.min(pathCloseness, 3) / 3 * 0.1 +
        (sameBundleStem ? 1 : bundleOverlap > 0 ? 0.6 : 0) * 0.1,
    ),
  );

  if (structuralAlignmentScore > 0) {
    reasons.push(
      createReason(
        'structural_alignment',
        roundScore(structuralAlignmentScore * STRUCTURAL_ALIGNMENT_WEIGHT),
        candidateStructuralAlignment.structuralContextStrength,
      ),
    );
  }

  if (dependencyOverlap > 0) {
    reasons.push(createReason('dependency_overlap', roundScore(dependencyOverlap * DEPENDENCY_OVERLAP_WEIGHT)));
  }

  if (sharedLocalDependencies > 0) {
    reasons.push(createReason('shared_local_dependencies', sharedLocalDependencies));
  }

  if (sharedDependencyFamilies > 0) {
    reasons.push(createReason('shared_dependency_families', sharedDependencyFamilies));
  }

  if (responsibilitySimilarity > 0) {
    reasons.push(createReason('responsibility_similarity', roundScore(responsibilitySimilarity * RESPONSIBILITY_SIMILARITY_WEIGHT)));
  }

  if (heuristicMatchStrength > 0) {
    reasons.push(createReason('match_strength', roundScore(heuristicMatchStrength * MATCH_STRENGTH_WEIGHT)));
  }

  if (exportNameOverlap > 0) {
    reasons.push(createReason('shared_export_names', roundScore(exportNameOverlap), candidateExportNames.join(',')));
  }

  if (candidateNamingTokenOverlap > 0) {
    reasons.push(createReason('naming_family_overlap', roundScore(candidateNamingTokenOverlap)));
  }

  if (pathCloseness > 0) {
    reasons.push(createReason('path_closeness', roundScore(Math.min(pathCloseness, 3) / 3)));
  }

  if (sameBundleStem > 0 || bundleOverlap > 0) {
    reasons.push(createReason('bundle_shape_overlap', roundScore(sameBundleStem ? 1 : 0.6), candidateBundleSuffixes.join(',')));
  }

  const score = roundScore(
    structuralAlignmentScore * STRUCTURAL_ALIGNMENT_WEIGHT +
      dependencyOverlap * DEPENDENCY_OVERLAP_WEIGHT +
      responsibilitySimilarity * RESPONSIBILITY_SIMILARITY_WEIGHT +
      heuristicMatchStrength * MATCH_STRENGTH_WEIGHT,
  );

  if (score === 0) {
    return null;
  }

  return {
    relation: candidate,
    score,
    reason: determineReason(reasons),
    reasons,
    signalScores: {
      structuralAlignment: roundScore(structuralAlignmentScore),
      dependencyOverlap: roundScore(dependencyOverlap),
      responsibilitySimilarity: roundScore(responsibilitySimilarity),
      matchStrength: roundScore(heuristicMatchStrength),
    },
  };
}

async function hydratePatternMatch(entry: CandidateScore, allRelations: FileRelation[]): Promise<PatternMatchItem | null> {
  const [file, definedSymbols, exportedSymbols, fileContext] = await Promise.all([
    getFileNode(entry.relation.fileId),
    getDefinedSymbols(entry.relation.fileId),
    getExportedSymbols(entry.relation.fileId),
    getFileExplorationContext(entry.relation.fileId, { relatedLimit: 20 }),
  ]);

  if (!file) {
    return null;
  }

  const filesById = Object.fromEntries(allRelations.map((relation) => [relation.fileId, relation]));

  return {
    file,
    score: entry.score,
    reason: entry.reason,
    reasons: entry.reasons,
    definedSymbols: mapSymbolSummaries(definedSymbols.map((symbol) => ({ name: symbol.name, kind: symbol.kind }))),
    exportedSymbols: mapSymbolSummaries(exportedSymbols.map((symbol) => ({ name: symbol.name, kind: symbol.kind }))),
    bundle: {
      familyStem: getBundleStem(entry.relation.filePath),
      siblingFiles: allRelations
        .filter((relation) => relation.repo === entry.relation.repo)
        .filter((relation) => path.posix.dirname(relation.filePath) === path.posix.dirname(entry.relation.filePath))
        .filter((relation) => getBundleStem(relation.filePath) === getBundleStem(entry.relation.filePath))
        .map((relation) => relation.filePath)
        .sort(),
    },
    structuralAlignment: mapPatternStructuralAlignment({
      structurallyIndexed: entry.relation.classification === 'source',
      resolvedLocalDependencyFileIds: entry.relation.imports
        .map((candidate) => candidate.resolvedTargetFileId)
        .filter((value): value is string => Boolean(value)),
      relatedLocalFileIds: mapRelatedFileIds(fileContext.relatedFiles),
      filesById,
    }),
  };
}

async function buildPatternContextFromProfile(
  query: string,
  mode: SearchPatternsMode,
  profile: FilePatternProfile | null,
  resolution: PatternResolutionSummary,
  options: PatternServiceOptions,
): Promise<PatternMatchContext> {
  if (!profile) {
    return {
      query,
      mode,
      repo: options.repo,
      primaryTarget: {
        file: null,
        symbol: null,
        definedSymbols: [],
        exportedSymbols: [],
        structuralAlignment: null,
      },
      patternMatches: [],
      resolution,
      summary: {
        matchCount: 0,
        strongMatchCount: 0,
        graphAnchoredMatchCount: 0,
      },
    };
  }

  const relations = await listFileRelations();
  const candidates = relations
    .filter((relation) => relation.fileId !== profile.relation.fileId)
    .filter((relation) => (options.repo ? relation.repo === options.repo : relation.repo === profile.relation.repo))
    .map((relation) => scoreCandidate(profile, relation, relations))
    .filter((entry): entry is CandidateScore => Boolean(entry))
    .sort(compareScores)
    .slice(0, options.limit ?? DEFAULT_MATCH_LIMIT);
  const patternMatches = (await Promise.all(candidates.map((entry) => hydratePatternMatch(entry, relations)))).filter(
    (entry): entry is PatternMatchItem => Boolean(entry),
  );

  return {
    query,
    mode,
    repo: options.repo ?? profile.relation.repo,
    primaryTarget: {
      file: profile.file,
      symbol: resolution.selectedCandidate
        ? {
            symbolId: resolution.selectedCandidate.symbolId,
            fileId: resolution.selectedCandidate.fileId,
            repo: resolution.selectedCandidate.repo,
            filePath: resolution.selectedCandidate.filePath,
            name: resolution.selectedCandidate.name,
            kind: resolution.selectedCandidate.kind,
            startLine: 0,
            endLine: 0,
            exported: resolution.selectedCandidate.exported,
          }
        : null,
      definedSymbols: profile.definedSymbols,
      exportedSymbols: profile.exportedSymbols,
      structuralAlignment: profile.structuralAlignment,
    },
    patternMatches,
    resolution,
    summary: {
      matchCount: patternMatches.length,
      strongMatchCount: patternMatches.filter((entry) => entry.score >= STRONG_MATCH_THRESHOLD).length,
      graphAnchoredMatchCount: patternMatches.filter((entry) => entry.structuralAlignment.graphAnchored).length,
    },
  };
}

export async function getPatternMatchesForSymbol(name: string, options: PatternServiceOptions = {}): Promise<PatternMatchContext> {
  const symbolContext = await getSymbolExplorationContext(name, {
    repo: options.repo,
    limit: options.limit ?? DEFAULT_MATCH_LIMIT,
    relatedLimit: 20,
  });
  const resolution = buildResolutionFromSymbolCandidates('symbol', symbolContext);
  const primaryFileId = symbolContext.primaryFile?.fileId ?? symbolContext.primarySymbol?.fileId;

  if (!primaryFileId) {
    return buildPatternContextFromProfile(name, 'symbol', null, resolution, options);
  }

  const relations = await listFileRelations();
  const profile = await loadTargetProfile(primaryFileId, relations);
  const context = await buildPatternContextFromProfile(name, 'symbol', profile, resolution, options);

  if (symbolContext.primarySymbol) {
    context.primaryTarget.symbol = symbolContext.primarySymbol;
  }

  return context;
}

export async function getPatternMatchesForComponent(name: string, options: PatternServiceOptions = {}): Promise<PatternMatchContext> {
  const context = await getPatternMatchesForSymbol(name, options);
  return {
    ...context,
    mode: 'component',
    resolution: {
      ...context.resolution,
      mode: 'component',
    },
  };
}

export async function getPatternMatchesForFile(filePath: string, options: PatternServiceOptions = {}): Promise<PatternMatchContext> {
  try {
    const relation = await getFileRelation(filePath, options.repo);
    const relations = await listFileRelations();
    const profile = await loadTargetProfile(relation.fileId, relations);

    return buildPatternContextFromProfile(
      filePath,
      'file',
      profile,
      profile
        ? {
            status: 'resolved',
            mode: 'file',
            candidateCount: 1,
            ambiguityDetected: false,
            selectedCandidate: null,
            alternativeCandidates: [],
          }
        : buildMissingResolution('file'),
      options,
    );
  } catch {
    return buildPatternContextFromProfile(filePath, 'file', null, buildMissingResolution('file'), options);
  }
}
