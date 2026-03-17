import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanupGenerationDebris } from '../../src/indexing/generation-debris.js';
import {
  getRefreshFailureHistoryFilePath,
  getGenerationArtifactFilePath,
  getGenerationsDirectory,
  loadCurrentGenerationState,
  loadGenerationLifecycleMarker,
  loadRefreshFailure,
  saveSearchRefreshSnapshot,
} from '../../src/indexing/generation-store.js';
import { getCurrentIndexHealth } from '../../src/indexing/health.js';
import { refreshIndexes } from '../../src/indexing/refresh.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-refresh-fault-test-'));
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

async function listGenerationDirectories(tempRoot: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(tempRoot, '.data', 'generations'), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

async function markCurrentSearchReady(snapshotId: string = 'test-snapshot'): Promise<void> {
  const state = await loadCurrentGenerationState();

  if (!state) {
    throw new Error('current generation state is unavailable');
  }

  await saveSearchRefreshSnapshot({
    schemaVersion: 1,
    fingerprintContractVersion: 1,
    snapshotId,
    status: 'ready',
    refreshedAt: new Date().toISOString(),
    aggregateFingerprint: state.search.aggregateFingerprint,
    repoFingerprints: state.search.repoFingerprints,
    details: 'test search snapshot ready',
  });
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

describe.sequential('refresh fault injection', () => {
  it('fails before commit without publishing a new generation and recovers on the next refresh', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const alpha = 1;');

    const first = await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const beta = 2;');

    await expect(
      refreshIndexes(reposRoot, {
        logger: silentLogger,
        runConsistencyChecks: 'never',
        faultInjection: { stage: 'before-commit', mode: 'throw' },
      }),
    ).rejects.toThrow('before-commit');

    const stateAfterFailure = await loadCurrentGenerationState();
    const failure = await loadRefreshFailure();
    const healthAfterFailure = await getCurrentIndexHealth();

    expect(stateAfterFailure?.generationId).toBe(first.diagnostics.generationId);
    expect(failure?.stage).toBe('before-commit');
    expect(healthAfterFailure.trustState).not.toBe('healthy');
    expect(healthAfterFailure.reasons.join(' ')).toContain('last refresh failed');

    const recovered = await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await markCurrentSearchReady('recovery-success');
    const healthAfterRecovery = await getCurrentIndexHealth();

    expect(recovered.diagnostics.generationId).not.toBe(first.diagnostics.generationId);
    expect(await loadRefreshFailure()).toBeNull();
    expect(healthAfterRecovery.lastRefreshFailure).toBeNull();
    expect(healthAfterRecovery.reasons.join(' ')).not.toContain('last refresh failed');
    expect(healthAfterRecovery.trustState).toBe('healthy');
    expect(healthAfterRecovery.suitableForAgentWorkflows).toBe(true);
  });

  it('keeps partially written staged artifacts out of the published generation and cleans them up later', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const alpha = 1;');

    const first = await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const beta = 2;');

    await expect(
      refreshIndexes(reposRoot, {
        logger: silentLogger,
        runConsistencyChecks: 'never',
        faultInjection: {
          stage: 'persist-artifacts',
          mode: 'partial-write',
          target: 'symbol-index.json',
        },
      }),
    ).rejects.toThrow('persist-artifacts');

    const generationDirectories = await listGenerationDirectories(tempRoot);
    const failedGenerationId = generationDirectories.find((generationId) => generationId !== first.diagnostics.generationId);

    expect(failedGenerationId).toBeTruthy();
    expect((await loadCurrentGenerationState())?.generationId).toBe(first.diagnostics.generationId);
    expect((await loadGenerationLifecycleMarker(failedGenerationId!))?.status).toBe('abandoned');
    await expect(
      fs.readFile(getGenerationArtifactFilePath(failedGenerationId!, 'symbol-index.json'), 'utf8').then((content) =>
        JSON.parse(content),
      ),
    ).rejects.toThrow();

    const debrisReport = await cleanupGenerationDebris({
      logger: silentLogger,
      applyDeletes: false,
      maxStagedAgeMs: 0,
    });

    expect(
      debrisReport.preserved.some((entry) => entry.generationId === failedGenerationId && entry.status === 'abandoned'),
    ).toBe(true);

    await writeRepositoryFile(reposRoot, 'app-repo', 'src/next.ts', 'export const gamma = 3;');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    await expect(fs.access(path.join(getGenerationsDirectory(), failedGenerationId!))).rejects.toThrow();
  });

  it('can degrade coordination state without crashing the refresh', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const alpha = 1;');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const beta = 2;');

    const result = await refreshIndexes(reposRoot, {
      logger: silentLogger,
      runConsistencyChecks: 'never',
      faultInjection: { stage: 'coordination-update', mode: 'skip-step' },
    });
    const state = await loadCurrentGenerationState();
    const health = await getCurrentIndexHealth();

    expect(result.diagnostics.status).toBe('committed');
    expect(state?.warnings.join(' ')).toContain('coordination-update');
    expect(health.search?.status).toBe('pending');
    expect(['stale-search', 'degraded', 'unknown']).toContain(health.trustState);
  });

  it('records consistency-phase failures without discarding the committed generation', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const alpha = 1;');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const beta = 2;');

    const result = await refreshIndexes(reposRoot, {
      logger: silentLogger,
      runConsistencyChecks: 'always',
      faultInjection: { stage: 'consistency-maintenance', mode: 'throw' },
    });
    const state = await loadCurrentGenerationState();
    const failure = await loadRefreshFailure();
    const health = await getCurrentIndexHealth();

    expect(result.diagnostics.status).toBe('committed');
    expect(state?.generationId).toBe(result.diagnostics.generationId);
    expect(state?.errors.join(' ')).toContain('consistency-maintenance');
    expect(failure?.stage).toBe('consistency-maintenance');
    expect(health.lastRefreshFailure?.stage).toBe('consistency-maintenance');
    expect(health.trustState).not.toBe('healthy');
  });

  it('does not clear failure state on partial recovery that still leaves blocking health issues', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const alpha = 1;');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const beta = 2;');

    await expect(
      refreshIndexes(reposRoot, {
        logger: silentLogger,
        runConsistencyChecks: 'never',
        faultInjection: { stage: 'before-commit', mode: 'throw' },
      }),
    ).rejects.toThrow('before-commit');

    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const gamma = 3;');

    await refreshIndexes(reposRoot, {
      logger: silentLogger,
      runConsistencyChecks: 'always',
      faultInjection: { stage: 'consistency-maintenance', mode: 'throw' },
    });
    const health = await getCurrentIndexHealth();

    expect(await loadRefreshFailure()).not.toBeNull();
    expect(health.lastRefreshFailure).not.toBeNull();
    expect(health.trustState).not.toBe('healthy');
  });

  it('archives a recovered failure only once when recovery is detected during the immediate pending state', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const alpha = 1;');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const beta = 2;');
    await expect(
      refreshIndexes(reposRoot, {
        logger: silentLogger,
        runConsistencyChecks: 'never',
        faultInjection: { stage: 'before-commit', mode: 'throw' },
      }),
    ).rejects.toThrow('before-commit');

    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const gamma = 3;');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    const health = await getCurrentIndexHealth();
    const history = JSON.parse(await fs.readFile(getRefreshFailureHistoryFilePath(), 'utf8')) as Array<{
      resolution: string;
    }>;

    expect(await loadRefreshFailure()).toBeNull();
    expect(health.lastRefreshFailure).toBeNull();
    expect(health.search?.status).toBe('pending');
    expect(history).toHaveLength(1);
    expect(history[0]?.resolution).toBe('recovered');
  });

  it('archives multiple failures and clears the active failure after a final successful recovery', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const alpha = 1;');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const beta = 2;');
    await expect(
      refreshIndexes(reposRoot, {
        logger: silentLogger,
        runConsistencyChecks: 'never',
        faultInjection: { stage: 'before-commit', mode: 'throw' },
      }),
    ).rejects.toThrow('before-commit');

    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const gamma = 3;');
    await expect(
      refreshIndexes(reposRoot, {
        logger: silentLogger,
        runConsistencyChecks: 'never',
        faultInjection: { stage: 'before-commit', mode: 'throw' },
      }),
    ).rejects.toThrow('before-commit');

    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const delta = 4;');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await markCurrentSearchReady('multiple-recovery');

    const health = await getCurrentIndexHealth();
    const history = JSON.parse(await fs.readFile(getRefreshFailureHistoryFilePath(), 'utf8')) as Array<{
      resolution: string;
    }>;

    expect(await loadRefreshFailure()).toBeNull();
    expect(health.lastRefreshFailure).toBeNull();
    expect(health.reasons.join(' ')).not.toContain('last refresh failed');
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.every((entry) => entry.resolution === 'recovered')).toBe(true);
  });

  it('leaves healthy baseline state untouched when no prior failure exists', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const alpha = 1;');

    const result = await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await markCurrentSearchReady('baseline');
    const health = await getCurrentIndexHealth();

    expect(result.diagnostics.status).toBe('committed');
    expect(await loadRefreshFailure()).toBeNull();
    expect(health.lastRefreshFailure).toBeNull();
    expect(health.trustState).toBe('healthy');
    expect(health.suitableForAgentWorkflows).toBe(true);
  });

  it('supports deterministic activation from environment variables', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const alpha = 1;');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    await writeRepositoryFile(reposRoot, 'app-repo', 'src/util.ts', 'export const beta = 2;');
    process.env.FAULT_INJECTION_STAGE = 'before-commit';
    process.env.FAULT_INJECTION_MODE = 'throw';

    try {
      await expect(
        refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' }),
      ).rejects.toThrow('before-commit');
    } finally {
      delete process.env.FAULT_INJECTION_STAGE;
      delete process.env.FAULT_INJECTION_MODE;
    }

    expect((await loadRefreshFailure())?.stage).toBe('before-commit');
  });
});
