import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadCurrentGenerationState,
  loadSearchRefreshSnapshotResult,
} from '../../src/indexing/generation-store.js';
import { getCurrentIndexHealth } from '../../src/indexing/health.js';
import { refreshIndexes } from '../../src/indexing/refresh.js';
import { getCurrentSearchFreshness } from '../../src/indexing/search-freshness.js';
import { runCurrentGenerationConsistencyMaintenance } from '../../src/indexing/consistency.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-marker-resilience-test-'));
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

function getSnapshotMarkerPath(root: string): string {
  return path.join(root, '.data', 'coordination', 'zoekt-refresh-state.json');
}

function getRequestMarkerPath(root: string): string {
  return path.join(root, '.data', 'coordination', 'search-refresh-request.json');
}

async function writeSnapshotMarker(root: string, value: string | Record<string, unknown>): Promise<void> {
  const filePath = getSnapshotMarkerPath(root);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    'utf8',
  );
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
  vi.restoreAllMocks();
  process.chdir(originalCwd);
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe.sequential('coordination marker resilience', () => {
  it('keeps freshness and health conservative when coordination markers are missing', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const a = 1;');
    await refreshIndexes(reposRoot, { logger: silentLogger });

    await fs.rm(getRequestMarkerPath(tempRoot), { force: true });
    await fs.rm(getSnapshotMarkerPath(tempRoot), { force: true });

    const freshness = await getCurrentSearchFreshness(silentLogger);
    const health = await getCurrentIndexHealth();

    expect(freshness?.status).toBe('pending');
    expect(freshness?.status).not.toBe('ready');
    expect(freshness?.details).toContain('not trustworthy');
    expect(health.search?.status).toBe('pending');
    expect(health.warnings.join(' ')).toContain('coordination marker is missing');
  });

  it('categorizes malformed JSON markers and does not crash the no-op refresh path', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const a = 1;');
    const first = await refreshIndexes(reposRoot, { logger: silentLogger });

    await writeSnapshotMarker(tempRoot, '{bad json');

    const snapshotResult = await loadSearchRefreshSnapshotResult();
    const second = await refreshIndexes(reposRoot, { logger: silentLogger });

    expect(first.diagnostics.status).toBe('committed');
    expect(snapshotResult.status).toBe('malformed');
    expect(second.diagnostics.status).toBe('no-op');
    expect(second.diagnostics.search.status).not.toBe('ready');
  });

  it('treats missing required fields as malformed and surfaces the coordination issue in health and consistency', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const a = 1;');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    await writeSnapshotMarker(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'broken-structure',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      repoFingerprints: [],
    });

    const snapshotResult = await loadSearchRefreshSnapshotResult();
    const health = await getCurrentIndexHealth();
    const report = await runCurrentGenerationConsistencyMaintenance({
      logger: silentLogger,
      applyRepairs: false,
    });
    const coordinationCheck = report?.checks.find((check) => check.checkId === 'coordination-state-sanity');

    expect(snapshotResult.status).toBe('malformed');
    expect(health.warnings.join(' ')).toContain('Zoekt refresh snapshot coordination marker is malformed');
    expect(coordinationCheck?.details.join(' ')).toContain('Zoekt refresh snapshot marker malformed');
    expect(coordinationCheck?.details.join(' ')).toContain('search freshness consequence');
  });

  it('categorizes incompatible schema versions without crashing freshness evaluation', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const a = 1;');
    await refreshIndexes(reposRoot, { logger: silentLogger });
    const state = await loadCurrentGenerationState();

    await writeSnapshotMarker(tempRoot, {
      schemaVersion: 999,
      snapshotId: 'snapshot-v999',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: state?.search.aggregateFingerprint,
      repoFingerprints: state?.search.repoFingerprints,
    });

    const snapshotResult = await loadSearchRefreshSnapshotResult();
    const freshness = await getCurrentSearchFreshness(silentLogger);

    expect(snapshotResult.status).toBe('incompatible-version');
    expect(freshness?.status).not.toBe('ready');
    expect(freshness?.details).toContain('incompatible-version');
  });

  it('surfaces unreadable marker files as degraded instead of throwing', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const a = 1;');
    await refreshIndexes(reposRoot, { logger: silentLogger });

    const snapshotPath = getSnapshotMarkerPath(tempRoot);
    await fs.rm(snapshotPath, { force: true });
    await fs.mkdir(snapshotPath, { recursive: true });

    const snapshotResult = await loadSearchRefreshSnapshotResult();
    const freshness = await getCurrentSearchFreshness(silentLogger);

    expect(snapshotResult.status).toBe('unreadable');
    expect(freshness?.status).not.toBe('ready');
    expect(freshness?.details).toContain('unreadable');
  });
});
