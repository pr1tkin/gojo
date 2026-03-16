import path from 'node:path';

import { computePathCloseness, countIntersection, createReason } from '../ranking/scoring.js';
import type { RankingReason } from '../ranking/index.js';
import { getDefinedSymbols, getExportedSymbols, getFileNode } from '../graph/query.js';
import { getFileRelation, getFileRelationById, listFileRelations } from '../symbol-index/query.js';
import type { FileRelation } from '../symbol-index/types.js';
import type { SearchPatternsMode, SymbolKind } from '../types.js';
import { getFileExplorationContext } from './file-service.js';
import { getSymbolExplorationContext } from './symbol-service.js';
import type { PatternMatchContext, PatternMatchItem, PatternResolutionSummary, PatternTargetSummary } from './types.js';

const DEFAULT_MATCH_LIMIT = 6;
const STRONG_MATCH_THRESHOLD = 10;
const COMMON_FILE_SUFFIXES = ['test', 'spec', 'stories', 'story', 'styles', 'style'];

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
}

interface CandidateScore {
  relation: FileRelation;
  score: number;
  reason: string;
  reasons: RankingReason[];
}

function compareScores(left: CandidateScore, right: CandidateScore): number {
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
  };
}

function determineReason(reasons: RankingReason[]): string {
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
  let score = 0;
  const candidateExportNames = dedupe(candidate.exports.map((entry) => entry.exportedName).filter((value): value is string => Boolean(value)));
  const targetExportNames = profile.exportedSymbols.map((symbol) => symbol.name);
  const sharedExportNames = countIntersection(targetExportNames, candidateExportNames);
  const sharedImportTokens = countIntersection(profile.relation.importTokens, candidate.importTokens);
  const sharedSymbolNames = countIntersection(profile.relation.symbolNames, candidate.symbolNames);
  const sharedNamingTokens = countIntersection(
    profile.namingTokens,
    dedupe([...tokenizeName(path.posix.basename(candidate.filePath)), ...candidate.symbolNames.flatMap((name) => tokenizeName(name))]),
  );
  const pathCloseness = computePathCloseness(profile.relation.filePath, candidate.filePath);
  const candidateBundleSuffixes = collectBundleSuffixes(candidate, allRelations);
  const bundleOverlap = countIntersection(profile.bundleSuffixes, candidateBundleSuffixes);
  const candidateRelatedFileIds = dedupe(candidate.imports.map((entry) => entry.resolvedTargetFileId).filter((value): value is string => Boolean(value)));
  const sharedRelatedFiles = countIntersection(profile.relatedFileIds, candidateRelatedFileIds);
  const sameRepo = candidate.repo === profile.relation.repo ? 1 : 0;
  const sameBundleStem = getBundleStem(candidate.filePath) === profile.bundleStem ? 1 : 0;

  if (sameRepo) {
    score += 4;
    reasons.push(createReason('same_repo', 4, candidate.repo));
  }

  if (pathCloseness > 0) {
    const value = pathCloseness * 2;
    score += value;
    reasons.push(createReason('path_closeness', value));
  }

  if (sharedExportNames > 0) {
    const value = sharedExportNames * 4;
    score += value;
    reasons.push(createReason('shared_export_names', value));
  }

  if (sharedImportTokens > 0) {
    const value = Math.min(sharedImportTokens * 2, 8);
    score += value;
    reasons.push(createReason('shared_import_tokens', value));
  }

  if (sharedSymbolNames > 0) {
    const value = Math.min(sharedSymbolNames * 2, 6);
    score += value;
    reasons.push(createReason('shared_symbol_names', value));
  }

  if (sharedNamingTokens > 0) {
    const value = Math.min(sharedNamingTokens * 2, 6);
    score += value;
    reasons.push(createReason('naming_family_overlap', value));
  }

  if (bundleOverlap > 0) {
    const value = Math.min(bundleOverlap * 2, 6);
    score += value;
    reasons.push(createReason('bundle_shape_overlap', value, candidateBundleSuffixes.join(',')));
  }

  if (sameBundleStem > 0) {
    score += 2;
    reasons.push(createReason('same_bundle_stem', 2, getBundleStem(candidate.filePath)));
  }

  if (sharedRelatedFiles > 0) {
    const value = sharedRelatedFiles * 3;
    score += value;
    reasons.push(createReason('shared_related_files', value));
  }

  if (score === 0) {
    return null;
  }

  return {
    relation: candidate,
    score,
    reason: determineReason(reasons),
    reasons,
  };
}

async function hydratePatternMatch(entry: CandidateScore, allRelations: FileRelation[]): Promise<PatternMatchItem | null> {
  const [file, definedSymbols, exportedSymbols] = await Promise.all([
    getFileNode(entry.relation.fileId),
    getDefinedSymbols(entry.relation.fileId),
    getExportedSymbols(entry.relation.fileId),
  ]);

  if (!file) {
    return null;
  }

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
      },
      patternMatches: [],
      resolution,
      summary: {
        matchCount: 0,
        strongMatchCount: 0,
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
    },
    patternMatches,
    resolution,
    summary: {
      matchCount: patternMatches.length,
      strongMatchCount: patternMatches.filter((entry) => entry.score >= STRONG_MATCH_THRESHOLD).length,
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
