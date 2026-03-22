import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getGenerationArtifactFilePath,
  loadCurrentGenerationState,
  updateGenerationState,
} from '../../src/indexing/generation-store.js';
import { runCurrentGenerationConsistencyMaintenance } from '../../src/indexing/consistency.js';
import { getCurrentIndexHealth } from '../../src/indexing/health.js';
import { refreshIndexes } from '../../src/indexing/refresh.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-count-health-test-'));
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

async function writeSearchSnapshot(cwd: string, snapshot: Record<string, unknown>): Promise<void> {
  const filePath = path.join(cwd, 'gojo', 'runtime', 'coordination', 'zoekt-refresh-state.json');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
}

async function seedComponentRepo(reposRoot: string, repositoryId: string, count: number): Promise<void> {
  await ensureRepository(reposRoot, repositoryId);

  for (let index = 0; index < count; index += 1) {
    await writeRepositoryFile(
      reposRoot,
      repositoryId,
      `src/components/Component${index}.tsx`,
      [
        `export function Component${index}() {`,
        `  return <section>Component ${index}</section>;`,
        '}',
      ].join('\n'),
    );
  }
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

describe.sequential('health count regressions', () => {
  it('keeps health healthy when large-repo counts remain stable', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedComponentRepo(reposRoot, 'app-repo', 20);
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    const state = await loadCurrentGenerationState();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'stable-ready',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: state?.search.aggregateFingerprint,
      repoFingerprints: state?.search.repoFingerprints,
    });
    await runCurrentGenerationConsistencyMaintenance({ logger: silentLogger, applyRepairs: true });

    const health = await getCurrentIndexHealth();

    expect(health.trustState).toBe('healthy');
    expect(health.errors).toEqual([]);
  });

  it('accepts legitimately small repositories without catastrophic classification', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'small-repo');
    await writeRepositoryFile(reposRoot, 'small-repo', 'src/plain.ts', 'export const answer = 42;');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    const health = await getCurrentIndexHealth();

    expect(health.errors.join(' ')).not.toContain('collapsed');
    expect(['healthy', 'stale-search', 'unknown']).toContain(health.trustState);
  });

  it('does not trigger catastrophic count invariants for a narrow local change with stable counts', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedComponentRepo(reposRoot, 'app-repo', 18);
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/components/Component0.tsx',
      'export function Component0() { return <section>changed</section>; }',
    );
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    const health = await getCurrentIndexHealth();

    expect(health.errors.join(' ')).not.toContain('collapsed');
  });

  it('treats catastrophic pattern-count regression as a structural failure that outranks stale-search', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedComponentRepo(reposRoot, 'app-repo', 20);
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/components/Component0.tsx',
      'export function Component0() { return <section>changed</section>; }',
    );
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    const state = await loadCurrentGenerationState();

    if (!state) {
      throw new Error('expected current generation state');
    }

    await updateGenerationState(state.generationId, {
      ...state,
      counts: {
        ...state.counts,
        patterns: 2,
      },
    });

    const health = await getCurrentIndexHealth();

    expect(health.trustState).toBe('inconsistent');
    expect(health.reasons.join(' ')).toContain('pattern count collapsed');
    expect(health.search?.status).toBe('pending');
    expect(health.suitableForAgentWorkflows).toBe(false);
  });

  it('surfaces catastrophic symbol and graph regressions clearly', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedComponentRepo(reposRoot, 'app-repo', 20);
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/components/Component1.tsx',
      'export function Component1() { return <section>changed</section>; }',
    );
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    const state = await loadCurrentGenerationState();

    if (!state) {
      throw new Error('expected current generation state');
    }

    await updateGenerationState(state.generationId, {
      ...state,
      counts: {
        ...state.counts,
        symbols: 5,
        graphEdges: 0,
      },
    });

    const report = await runCurrentGenerationConsistencyMaintenance({
      logger: silentLogger,
      applyRepairs: false,
    });
    const health = await getCurrentIndexHealth();
    const regressionCheck = report?.checks.find((check) => check.checkId === 'catastrophic-count-regressions');

    expect(regressionCheck?.status).toBe('failed');
    expect(regressionCheck?.details.join(' ')).toContain('symbol count collapsed');
    expect(regressionCheck?.details.join(' ')).toContain('graph edge count collapsed');
    expect(health.errors.join(' ')).toContain('symbol count collapsed');
    expect(health.errors.join(' ')).toContain('graph edge count collapsed');
  });

  it('keeps structural regression as the top-level failure when stale-search is also present', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedComponentRepo(reposRoot, 'app-repo', 20);
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/components/Component2.tsx',
      'export function Component2() { return <section>changed</section>; }',
    );
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    const state = await loadCurrentGenerationState();

    if (!state) {
      throw new Error('expected current generation state');
    }

    await updateGenerationState(state.generationId, {
      ...state,
      counts: {
        ...state.counts,
        patterns: 2,
      },
    });

    const health = await getCurrentIndexHealth();

    expect(health.trustState).toBe('inconsistent');
    expect(health.reasons[0]).toContain('pattern count collapsed');
    expect(health.reasons.join(' ')).toContain('coordination markers are not trustworthy');
  });
});
