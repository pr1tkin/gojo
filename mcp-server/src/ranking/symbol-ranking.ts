import type { FileRelation, IndexedSymbol } from '../symbol-index/types.js';
import { compareReasons, createReason } from './scoring.js';
import type {
  RankedSymbolCandidate,
  SymbolRankingContext,
  SymbolRankingDependencies,
} from './types.js';

type SymbolTier = 'canonical' | 'wrapper' | 'proxy';

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function compareIndexedSymbols(left: IndexedSymbol, right: IndexedSymbol): number {
  return (
    left.repo.localeCompare(right.repo) ||
    left.filePath.localeCompare(right.filePath) ||
    left.startLine - right.startLine ||
    left.endLine - right.endLine ||
    left.kind.localeCompare(right.kind)
  );
}

function lineSpan(symbol: IndexedSymbol): number {
  return Math.max(symbol.endLine - symbol.startLine + 1, 1);
}

function isHookLikeSymbol(symbol: IndexedSymbol): boolean {
  return /^use[A-Z0-9_]/.test(symbol.name);
}

function getPathSegments(filePath: string): string[] {
  return normalizePath(filePath).toLowerCase().split('/').filter(Boolean);
}

function hasPathSegment(filePath: string, pattern: RegExp): boolean {
  return getPathSegments(filePath).some((segment) => pattern.test(segment));
}

function isServicePath(filePath: string): boolean {
  return hasPathSegment(filePath, /^(services?|core)$/);
}

function isLibraryPath(filePath: string): boolean {
  return hasPathSegment(filePath, /^(lib|utils?|helpers?)$/);
}

function isHookPath(filePath: string): boolean {
  return hasPathSegment(filePath, /^(hooks?|queries?|mutations?)$/);
}

function isProxyPath(filePath: string): boolean {
  const normalized = normalizePath(filePath).toLowerCase();
  return (
    hasPathSegment(filePath, /^(wrappers?|proxies?)$/) ||
    /(^|\/)(index|barrel)\.(tsx?|jsx?)$/i.test(normalized)
  );
}

function getFileBaseName(filePath: string): string {
  const normalized = normalizePath(filePath);
  const lastSegment = normalized.split('/').pop() ?? normalized;
  return lastSegment.replace(/\.[^.]+$/g, '');
}

function classifySymbolTier(
  candidate: IndexedSymbol,
  relation: FileRelation | undefined,
  fanIn: number,
): {
  tier: SymbolTier;
  wrapperDetected: boolean;
  proxyDetected: boolean;
  thinPassThrough: boolean;
} {
  const span = lineSpan(candidate);
  const baseName = getFileBaseName(candidate.filePath);
  const hookPath = isHookPath(candidate.filePath);
  const proxyPath = isProxyPath(candidate.filePath);
  const sameNameReexport = relation?.exports.some((entry) =>
    (entry.kind === 'reexport-all' || entry.kind === 'reexport-named') &&
    (!entry.exportedName || entry.exportedName === candidate.name || entry.localName === candidate.name),
  ) ?? false;
  const symbolBackedExports = relation?.exports.filter((entry) => entry.symbolId === candidate.symbolId).length ?? 0;
  const thinPassThrough =
    (relation?.imports.length ?? 0) > 0 &&
    span <= 4 &&
    symbolBackedExports <= 1;
  const wrapperDetected =
    isHookLikeSymbol(candidate) ||
    hookPath ||
    thinPassThrough ||
    /wrapper|query|mutation/i.test(baseName);
  const proxyDetected =
    proxyPath ||
    (sameNameReexport && symbolBackedExports === 0) ||
    ((relation?.symbolIds.length ?? 0) === 0 && (relation?.exports.length ?? 0) > 0);

  if (proxyDetected) {
    return {
      tier: 'proxy',
      wrapperDetected,
      proxyDetected: true,
      thinPassThrough,
    };
  }

  if (wrapperDetected && fanIn <= 1 && !isServicePath(candidate.filePath)) {
    return {
      tier: 'wrapper',
      wrapperDetected: true,
      proxyDetected: false,
      thinPassThrough,
    };
  }

  return {
    tier: 'canonical',
    wrapperDetected,
    proxyDetected: false,
    thinPassThrough,
  };
}

function scoreCandidate(
  candidate: IndexedSymbol,
  context: SymbolRankingContext,
  dependencies: SymbolRankingDependencies,
): RankedSymbolCandidate {
  const reasons = [];
  let score = 0;
  const relation = dependencies.relationsByFile?.[candidate.fileId];
  const fanIn = dependencies.fileFanInById?.[candidate.fileId] ?? 0;
  const span = lineSpan(candidate);
  const tierDetails = classifySymbolTier(candidate, relation, fanIn);

  if (candidate.name === context.queryName) {
    score += 10;
    reasons.push(createReason('exact_name', 10));
  } else if (candidate.name.toLowerCase() === context.queryName.toLowerCase()) {
    score += 6;
    reasons.push(createReason('case_insensitive_name', 6));
  }

  if (context.kind && candidate.kind === context.kind) {
    score += 5;
    reasons.push(createReason('kind_match', 5));
  }

  if (context.repo && candidate.repo === context.repo) {
    score += 4;
    reasons.push(createReason('same_repo', 4));
  }

  if (candidate.exported) {
    score += 3;
    reasons.push(createReason('exported_symbol', 3));
  }

  if (tierDetails.tier === 'canonical') {
    score += 3;
    reasons.push(createReason('canonical_definition', 3));
  }

  if (isServicePath(candidate.filePath)) {
    score += 2;
    reasons.push(createReason('service_path', 2));
  } else if (isLibraryPath(candidate.filePath)) {
    score += 1;
    reasons.push(createReason('implementation_path', 1));
  }

  if (fanIn > 1) {
    score += 1;
    reasons.push(createReason('fan_in_bonus', 1, `${fanIn} importing files`));
  }

  if (span >= 8) {
    score += 1;
    reasons.push(createReason('logic_depth', 1, `${span} lines`));
  }

  if (tierDetails.wrapperDetected) {
    score -= 2;
    reasons.push(createReason(isHookPath(candidate.filePath) || isHookLikeSymbol(candidate) ? 'hook_detected' : 'wrapper_detected', -2));
  }

  if (tierDetails.thinPassThrough) {
    score -= 1;
    reasons.push(createReason('pass_through_penalty', -1, `${span} line wrapper`));
  }

  if (tierDetails.proxyDetected) {
    score -= 3;
    reasons.push(createReason('reexport_penalty', -3));
  }

  const frequencyPenalty = dependencies.stats?.globalByName[candidate.name] ?? 0;

  if (frequencyPenalty > 1) {
    const penalty = Math.min(frequencyPenalty - 1, 5);
    score -= penalty;
    reasons.push(createReason('name_frequency_penalty', -penalty, candidate.name));
  }

  return {
    item: candidate,
    score,
    reasons,
  };
}

export function rankSymbolCandidates(
  candidates: IndexedSymbol[],
  context: SymbolRankingContext,
  dependencies: SymbolRankingDependencies = {},
): RankedSymbolCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(candidate, context, dependencies))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return compareIndexedSymbols(left.item, right.item) || compareReasons(left.item.name, right.item.name);
    });
}
