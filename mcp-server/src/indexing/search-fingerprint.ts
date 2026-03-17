import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { listRepositories } from '../repositories.js';
import type {
  SearchFingerprintComparison,
  SearchFingerprintComparisonIssue,
  SearchFingerprintRepoMismatch,
  SearchRepoFingerprint,
} from './types.js';

export const SEARCH_FINGERPRINT_CONTRACT_VERSION = 1;

const SEARCH_IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'out',
  'storybook-static',
  'generated',
]);

const SEARCH_IGNORED_FILE_NAMES = new Set([
  '.ds_store',
]);

const SEARCH_IGNORED_FILE_SUFFIXES = [
  '.d.ts',
  '.generated.ts',
  '.generated.tsx',
  '.tmp',
  '.temp',
  '.swp',
  '.swo',
  '~',
];

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function compareCanonicalText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function sortCanonicalText(values: Iterable<string>): string[] {
  return Array.from(values).sort(compareCanonicalText);
}

function shouldIgnoreFile(relativePath: string): boolean {
  const normalizedPath = normalizeRelativePath(relativePath);
  const segments = normalizedPath.split('/').filter(Boolean);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const fileName = lowerSegments[lowerSegments.length - 1] ?? '';

  if (lowerSegments.some((segment) => SEARCH_IGNORED_DIRECTORIES.has(segment))) {
    return true;
  }

  if (SEARCH_IGNORED_FILE_NAMES.has(fileName)) {
    return true;
  }

  return SEARCH_IGNORED_FILE_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

async function hashFileContent(absolutePath: string): Promise<string> {
  const buffer = await fs.readFile(absolutePath);
  return createHash('sha256').update(buffer).digest('hex');
}

async function collectSearchFingerprintEntries(
  repositoryRoot: string,
  currentDirectory: string = repositoryRoot,
): Promise<Array<{ filePath: string; contentHash: string }>> {
  const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
  const files: Array<{ filePath: string; contentHash: string }> = [];

  for (const entry of entries) {
    const entryPath = path.join(currentDirectory, entry.name);
    const relativePath = normalizeRelativePath(path.relative(repositoryRoot, entryPath));

    if (shouldIgnoreFile(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await collectSearchFingerprintEntries(repositoryRoot, entryPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    files.push({
      filePath: relativePath,
      contentHash: await hashFileContent(entryPath),
    });
  }

  return files;
}

function createCanonicalFingerprint(lines: string[]): string {
  if (lines.length === 0) {
    return 'empty';
  }

  return createHash('sha256')
    .update(`${lines.join('\n')}\n`)
    .digest('hex');
}

export async function buildSearchRepoFingerprints(reposRoot: string): Promise<{
  aggregateFingerprint: string;
  repoFingerprints: SearchRepoFingerprint[];
}> {
  const repositories = await listRepositories(reposRoot);
  const repoFingerprints: SearchRepoFingerprint[] = [];

  for (const repository of repositories) {
    if (!repository.isGitRepository) {
      continue;
    }

    const fileEntries = await collectSearchFingerprintEntries(repository.rootPath);
    fileEntries.sort((left, right) => compareCanonicalText(left.filePath, right.filePath));
    const fingerprint = createCanonicalFingerprint(
      fileEntries.map((entry) => `${entry.filePath}\t${entry.contentHash}`),
    );
    repoFingerprints.push({
      repoId: repository.id,
      fingerprint,
      fileCount: fileEntries.length,
    });
  }

  repoFingerprints.sort((left, right) => compareCanonicalText(left.repoId, right.repoId));

  return {
    aggregateFingerprint: createCanonicalFingerprint(
      repoFingerprints.map((entry) => `${entry.repoId}\t${entry.fingerprint}\t${entry.fileCount}`),
    ),
    repoFingerprints,
  };
}

function normalizeRepoFingerprints(entries: SearchRepoFingerprint[]): SearchRepoFingerprint[] {
  return [...entries]
    .map((entry) => ({
      repoId: entry.repoId,
      fingerprint: entry.fingerprint,
      fileCount: entry.fileCount,
    }))
    .sort((left, right) => compareCanonicalText(left.repoId, right.repoId));
}

function createAggregateFingerprintFromRepos(entries: SearchRepoFingerprint[]): string {
  return createCanonicalFingerprint(
    normalizeRepoFingerprints(entries).map((entry) => `${entry.repoId}\t${entry.fingerprint}\t${entry.fileCount}`),
  );
}

function addIssue(
  issues: SearchFingerprintComparisonIssue[],
  severity: SearchFingerprintComparisonIssue['severity'],
  code: SearchFingerprintComparisonIssue['code'],
  message: string,
): void {
  issues.push({ severity, code, message });
}

function summarizeIssues(issues: SearchFingerprintComparisonIssue[]): string {
  if (issues.length === 0) {
    return 'Fingerprints are equivalent after normalization.';
  }

  return issues.map((issue) => issue.message).join(' ');
}

export function compareSearchFingerprintSets(
  expectedRepoFingerprints: SearchRepoFingerprint[],
  actualRepoFingerprints: SearchRepoFingerprint[],
  expectedAggregateFingerprint?: string,
  actualAggregateFingerprint?: string,
): SearchFingerprintComparison {
  const normalizedExpected = normalizeRepoFingerprints(expectedRepoFingerprints);
  const normalizedActual = normalizeRepoFingerprints(actualRepoFingerprints);
  const expectedByRepo = new Map(normalizedExpected.map((entry) => [entry.repoId, entry]));
  const actualByRepo = new Map(normalizedActual.map((entry) => [entry.repoId, entry]));
  const issues: SearchFingerprintComparisonIssue[] = [];
  const missingRepoIds: string[] = [];
  const unexpectedRepoIds: string[] = [];
  const mismatchedRepos: SearchFingerprintRepoMismatch[] = [];
  const normalizedExpectedAggregateFingerprint = createAggregateFingerprintFromRepos(normalizedExpected);
  const normalizedActualAggregateFingerprint = createAggregateFingerprintFromRepos(normalizedActual);

  for (const expected of normalizedExpected) {
    const actual = actualByRepo.get(expected.repoId);

    if (!actual) {
      missingRepoIds.push(expected.repoId);
      mismatchedRepos.push({
        repoId: expected.repoId,
        expectedFingerprint: expected.fingerprint,
        expectedFileCount: expected.fileCount,
      });
      addIssue(issues, 'error', 'missing-repo', `Zoekt snapshot is missing repo "${expected.repoId}".`);
      continue;
    }

    if (expected.fileCount !== actual.fileCount) {
      mismatchedRepos.push({
        repoId: expected.repoId,
        expectedFingerprint: expected.fingerprint,
        actualFingerprint: actual.fingerprint,
        expectedFileCount: expected.fileCount,
        actualFileCount: actual.fileCount,
      });
      addIssue(
        issues,
        'error',
        'file-count-mismatch',
        `Repo "${expected.repoId}" file count differs: MCP=${expected.fileCount}, Zoekt=${actual.fileCount}.`,
      );
    }

    if (expected.fingerprint !== actual.fingerprint) {
      if (
        !mismatchedRepos.some(
          (entry) =>
            entry.repoId === expected.repoId &&
            entry.expectedFingerprint === expected.fingerprint &&
            entry.actualFingerprint === actual.fingerprint,
        )
      ) {
        mismatchedRepos.push({
          repoId: expected.repoId,
          expectedFingerprint: expected.fingerprint,
          actualFingerprint: actual.fingerprint,
          expectedFileCount: expected.fileCount,
          actualFileCount: actual.fileCount,
        });
      }
      addIssue(
        issues,
        'error',
        'repo-fingerprint-mismatch',
        `Repo "${expected.repoId}" fingerprint differs: MCP=${expected.fingerprint}, Zoekt=${actual.fingerprint}.`,
      );
    }
  }

  for (const actual of normalizedActual) {
    if (!expectedByRepo.has(actual.repoId)) {
      unexpectedRepoIds.push(actual.repoId);
      mismatchedRepos.push({
        repoId: actual.repoId,
        actualFingerprint: actual.fingerprint,
        actualFileCount: actual.fileCount,
      });
      addIssue(issues, 'error', 'unexpected-repo', `Zoekt snapshot contains unexpected repo "${actual.repoId}".`);
    }
  }

  if (
    expectedAggregateFingerprint &&
    actualAggregateFingerprint &&
    expectedAggregateFingerprint !== actualAggregateFingerprint
  ) {
    addIssue(
      issues,
      issues.length === 0 ? 'warning' : 'error',
      'aggregate-mismatch',
      `Aggregate fingerprint differs: MCP=${expectedAggregateFingerprint}, Zoekt=${actualAggregateFingerprint}.`,
    );
  }

  return {
    equivalent: issues.every((issue) => issue.severity !== 'error'),
    contractVersion: SEARCH_FINGERPRINT_CONTRACT_VERSION,
    expectedAggregateFingerprint,
    actualAggregateFingerprint,
    normalizedExpectedAggregateFingerprint,
    normalizedActualAggregateFingerprint,
    expectedRepoFingerprints: normalizedExpected,
    actualRepoFingerprints: normalizedActual,
    missingRepoIds,
    unexpectedRepoIds,
    mismatchedRepos,
    issues,
    summary: summarizeIssues(issues),
  };
}
