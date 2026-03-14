import { getRepositoryById } from '../repositories.js';
import { findSymbol } from '../symbol-index/query.js';
import type { IndexedSymbol } from '../symbol-index/types.js';
import type { FindReferenceMatch, FindReferencesInput, FindSymbolInput } from '../types.js';
import { findTypeScriptDefinitions } from './definitions.js';
import { findTypeScriptReferences } from './references.js';

async function tryFindCompilerMatchesForRepository(
  reposRoot: string,
  repositoryId: string,
  name: string,
  kind: FindSymbolInput['kind'],
): Promise<IndexedSymbol[] | null> {
  const repository = await getRepositoryById(reposRoot, repositoryId);

  if (!repository) {
    return null;
  }

  try {
    return await findTypeScriptDefinitions(repository, name, kind);
  } catch {
    return null;
  }
}

function mergeBaselineWithCompilerMatches(
  baseline: IndexedSymbol[],
  compilerMatchesByRepo: Map<string, IndexedSymbol[]>,
): IndexedSymbol[] {
  const results: IndexedSymbol[] = [];
  const baselineByRepo = new Map<string, IndexedSymbol[]>();

  for (const symbol of baseline) {
    if (!baselineByRepo.has(symbol.repo)) {
      baselineByRepo.set(symbol.repo, []);
    }

    baselineByRepo.get(symbol.repo)?.push(symbol);
  }

  const repoIds = new Set<string>([
    ...baselineByRepo.keys(),
    ...compilerMatchesByRepo.keys(),
  ]);

  for (const repoId of repoIds) {
    const compilerMatches = compilerMatchesByRepo.get(repoId);

    if (compilerMatches && compilerMatches.length > 0) {
      results.push(...compilerMatches);
      continue;
    }

    results.push(...(baselineByRepo.get(repoId) ?? []));
  }

  return results;
}

export async function findSymbolWithTypeScriptFallback(
  reposRoot: string,
  input: FindSymbolInput,
): Promise<IndexedSymbol[]> {
  const baseline = await findSymbol(input.name, input.kind, input.repo);

  if (input.repo) {
    const compilerMatches = await tryFindCompilerMatchesForRepository(
      reposRoot,
      input.repo,
      input.name,
      input.kind,
    );

    if (compilerMatches && compilerMatches.length > 0) {
      return compilerMatches;
    }

    return baseline;
  }

  if (baseline.length === 0) {
    return baseline;
  }

  const compilerMatchesByRepo = new Map<string, IndexedSymbol[]>();

  for (const repositoryId of new Set(baseline.map((symbol) => symbol.repo))) {
    const compilerMatches = await tryFindCompilerMatchesForRepository(
      reposRoot,
      repositoryId,
      input.name,
      input.kind,
    );

    if (compilerMatches && compilerMatches.length > 0) {
      compilerMatchesByRepo.set(repositoryId, compilerMatches);
    }
  }

  if (compilerMatchesByRepo.size === 0) {
    return baseline;
  }

  return mergeBaselineWithCompilerMatches(baseline, compilerMatchesByRepo);
}

async function tryFindCompilerReferencesForRepository(
  reposRoot: string,
  repositoryId: string,
  symbol: string,
): Promise<FindReferenceMatch[] | null> {
  const repository = await getRepositoryById(reposRoot, repositoryId);

  if (!repository) {
    return null;
  }

  try {
    return await findTypeScriptReferences(repository, symbol);
  } catch {
    return null;
  }
}

function compareReferenceMatches(left: FindReferenceMatch, right: FindReferenceMatch): number {
  return (
    left.repo.localeCompare(right.repo) ||
    left.filePath.localeCompare(right.filePath) ||
    left.line - right.line ||
    left.snippet.localeCompare(right.snippet)
  );
}

function mergeHeuristicWithCompilerReferences(
  baseline: FindReferenceMatch[],
  compilerMatchesByRepo: Map<string, FindReferenceMatch[]>,
): FindReferenceMatch[] {
  const baselineByRepo = new Map<string, FindReferenceMatch[]>();

  for (const match of baseline) {
    if (!baselineByRepo.has(match.repo)) {
      baselineByRepo.set(match.repo, []);
    }

    baselineByRepo.get(match.repo)?.push(match);
  }

  const results: FindReferenceMatch[] = [];
  const repoIds = new Set<string>([
    ...baselineByRepo.keys(),
    ...compilerMatchesByRepo.keys(),
  ]);

  for (const repoId of repoIds) {
    const compilerMatches = compilerMatchesByRepo.get(repoId);

    if (compilerMatches && compilerMatches.length > 0) {
      results.push(...compilerMatches);
      continue;
    }

    results.push(...(baselineByRepo.get(repoId) ?? []));
  }

  const seen = new Set<string>();
  const deduped: FindReferenceMatch[] = [];

  for (const result of results) {
    const key = [result.symbol, result.repo, result.filePath, result.line, result.snippet].join(':');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(result);
  }

  return deduped.sort(compareReferenceMatches);
}

export async function findReferencesWithTypeScriptFallback(
  reposRoot: string,
  input: FindReferencesInput,
  heuristicProvider: () => Promise<FindReferenceMatch[]>,
): Promise<FindReferenceMatch[]> {
  const definitions = await findSymbol(input.symbol, undefined, input.repo);

  if (definitions.length === 0) {
    return [];
  }

  if (input.repo) {
    const compilerMatches = await tryFindCompilerReferencesForRepository(
      reposRoot,
      input.repo,
      input.symbol,
    );

    if (compilerMatches && compilerMatches.length > 0) {
      return compilerMatches.slice(0, input.limit ?? compilerMatches.length);
    }

    return heuristicProvider();
  }

  const compilerMatchesByRepo = new Map<string, FindReferenceMatch[]>();

  for (const repositoryId of new Set(definitions.map((definition) => definition.repo))) {
    const compilerMatches = await tryFindCompilerReferencesForRepository(
      reposRoot,
      repositoryId,
      input.symbol,
    );

    if (compilerMatches && compilerMatches.length > 0) {
      compilerMatchesByRepo.set(repositoryId, compilerMatches);
    }
  }

  if (compilerMatchesByRepo.size === 0) {
    return heuristicProvider();
  }

  const baseline = await heuristicProvider();
  return mergeHeuristicWithCompilerReferences(baseline, compilerMatchesByRepo).slice(
    0,
    input.limit ?? baseline.length,
  );
}
