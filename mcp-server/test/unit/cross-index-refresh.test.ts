import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCurrentGenerationState } from '../../src/indexing/generation-store.js';
import { refreshIndexes } from '../../src/indexing/refresh.js';
import { getCurrentSearchFreshness } from '../../src/indexing/search-freshness.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-cross-index-test-'));
}

async function ensureRepository(reposRoot: string, repositoryId: string): Promise<void> {
  await fs.mkdir(path.join(reposRoot, repositoryId, '.git'), { recursive: true });
}

async function writeRepositoryFile(
  reposRoot: string,
  repositoryId: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(reposRoot, repositoryId, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf8');
}

async function writeSearchSnapshot(
  cwd: string,
  snapshot: Record<string, unknown>,
): Promise<void> {
  const filePath = path.join(cwd, '.data', 'coordination', 'zoekt-refresh-state.json');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
}

const tempDirectories: string[] = [];
const originalCwd = process.cwd();
const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

beforeEach(() => {
  process.chdir(originalCwd);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe.sequential('cross-index refresh coordination', () => {
  it('marks search as pending when an MCP generation commits before Zoekt catches up', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function greet(): string { return "hi"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    const state = await loadCurrentGenerationState();

    expect(state?.search.status).toBe('pending');
    expect(state?.search.refreshedAt).toBeUndefined();
    expect(state?.search.aggregateFingerprint).not.toBe('');
  });

  it('transitions search to ready when a matching Zoekt snapshot is acknowledged', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function greet(): string { return "hi"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    const stateBefore = await loadCurrentGenerationState();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'snapshot-ready-1',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: stateBefore?.search.aggregateFingerprint,
      repoFingerprints: stateBefore?.search.repoFingerprints,
      details: 'Zoekt indexing pass completed successfully.',
    });

    const freshness = await getCurrentSearchFreshness(silentLogger);
    const stateAfter = await loadCurrentGenerationState();

    expect(freshness?.status).toBe('ready');
    expect(stateAfter?.search.status).toBe('ready');
    expect(stateAfter?.search.snapshotId).toBe('snapshot-ready-1');
  });

  it('accepts a normalized repo match even when Zoekt aggregate formatting differs', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'a-repo');
    await ensureRepository(reposRoot, 'b-repo');
    await writeRepositoryFile(reposRoot, 'a-repo', 'src/a.ts', 'export const a = 1;');
    await writeRepositoryFile(reposRoot, 'b-repo', 'src/b.ts', 'export const b = 2;');

    await refreshIndexes(reposRoot, { logger: silentLogger });
    const stateBefore = await loadCurrentGenerationState();
    const reversedFingerprints = [...(stateBefore?.search.repoFingerprints ?? [])].reverse();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'snapshot-ready-normalized',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: 'legacy-format-aggregate',
      repoFingerprints: reversedFingerprints,
      details: 'Zoekt indexing pass completed successfully.',
    });

    const freshness = await getCurrentSearchFreshness(silentLogger);

    expect(freshness?.status).toBe('ready');
    expect(freshness?.comparison?.equivalent).toBe(true);
    expect(freshness?.details).toContain('after normalization');
  });

  it('marks search as failed when Zoekt reports a refresh failure after the current generation commit', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function greet(): string { return "hi"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'snapshot-failed-1',
      status: 'failed',
      refreshedAt: '2099-03-17T10:00:00.000Z',
      repoFingerprints: [],
      error: 'zoekt-git-index exited with status 1',
      details: 'Zoekt indexing pass failed before producing a refreshed snapshot.',
    });

    const freshness = await getCurrentSearchFreshness(silentLogger);
    const stateAfter = await loadCurrentGenerationState();

    expect(freshness?.status).toBe('failed');
    expect(freshness?.error).toContain('status 1');
    expect(stateAfter?.search.status).toBe('failed');
  });

  it('reverts freshness when a newer MCP generation supersedes a previously ready Zoekt snapshot', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function greet(): string { return "hi"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    const firstState = await loadCurrentGenerationState();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'snapshot-ready-1',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: firstState?.search.aggregateFingerprint,
      repoFingerprints: firstState?.search.repoFingerprints,
      details: 'Zoekt indexing pass completed successfully.',
    });
    await getCurrentSearchFreshness(silentLogger);

    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function greetAgain(): string { return "hello"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    const secondState = await loadCurrentGenerationState();

    expect(secondState?.generationId).not.toBe(firstState?.generationId);
    expect(secondState?.search.status).toBe('pending');
    expect(secondState?.search.aggregateFingerprint).not.toBe(firstState?.search.aggregateFingerprint);
  });

  it('returns to ready after a small change once Zoekt catches up again', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function greet(): string { return "hi"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    const firstState = await loadCurrentGenerationState();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'snapshot-ready-1',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: firstState?.search.aggregateFingerprint,
      repoFingerprints: firstState?.search.repoFingerprints,
      details: 'Zoekt indexing pass completed successfully.',
    });
    await getCurrentSearchFreshness(silentLogger);

    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function greet(): string { return "hello"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    const secondState = await loadCurrentGenerationState();
    expect(secondState?.search.status).toBe('pending');

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'snapshot-ready-2',
      status: 'ready',
      refreshedAt: '2026-03-17T10:05:00.000Z',
      aggregateFingerprint: secondState?.search.aggregateFingerprint,
      repoFingerprints: secondState?.search.repoFingerprints,
      details: 'Zoekt indexing pass completed successfully.',
    });

    const freshness = await getCurrentSearchFreshness(silentLogger);
    expect(freshness?.status).toBe('ready');
    expect(freshness?.snapshotId).toBe('snapshot-ready-2');
  });

  it('stays ready across a no-op refresh when the repository state and Zoekt snapshot are unchanged', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function greet(): string { return "hi"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    const firstState = await loadCurrentGenerationState();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'snapshot-ready-stable',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: firstState?.search.aggregateFingerprint,
      repoFingerprints: firstState?.search.repoFingerprints,
      details: 'Zoekt indexing pass completed successfully.',
    });

    await getCurrentSearchFreshness(silentLogger);
    const secondRefresh = await refreshIndexes(reposRoot, { logger: silentLogger });
    const secondState = await loadCurrentGenerationState();
    const secondFreshness = await getCurrentSearchFreshness(silentLogger);

    expect(secondRefresh.diagnostics.status).toBe('no-op');
    expect(secondState?.generationId).toBe(firstState?.generationId);
    expect(secondFreshness?.status).toBe('ready');
    expect(secondFreshness?.aggregateFingerprint).toBe(firstState?.search.aggregateFingerprint);
  });

  it('reports stale when a known Zoekt snapshot does not match the current generation fingerprint', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function greet(): string { return "hi"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    const state = await loadCurrentGenerationState();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'snapshot-stale-1',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: 'different-fingerprint',
      repoFingerprints: [
        {
          repoId: 'app-repo',
          fingerprint: 'different-repo-fingerprint',
          fileCount: state?.search.repoFingerprints[0]?.fileCount ?? 0,
        },
      ],
      details: 'Zoekt indexing pass completed successfully.',
    });

    const freshness = await getCurrentSearchFreshness(silentLogger);

    expect(freshness?.status).toBe('stale');
    expect(freshness?.details).toContain('does not match');
    expect(freshness?.comparison?.summary).toContain('Repo "app-repo" fingerprint differs');
  });
});
