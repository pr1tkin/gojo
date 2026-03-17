import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getGenerationsDirectory, loadCurrentGenerationState } from '../../src/indexing/generation-store.js';
import { getRefreshLockFilePath } from '../../src/indexing/refresh-coordinator.js';
import { refreshIndexes } from '../../src/indexing/refresh.js';
import { loadSymbolIndex } from '../../src/symbol-index/store.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-refresh-lock-test-'));
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

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = () => undefined;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

async function listGenerationDirectories(tempRoot: string): Promise<string[]> {
  const directory = path.join(tempRoot, '.data', 'generations');

  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

const tempDirectories: string[] = [];
const originalCwd = process.cwd();

beforeEach(() => {
  process.chdir(originalCwd);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe.sequential('refresh single-flight protection', () => {
  it('keeps only one active refresh execution and coalesces a burst into one follow-up run', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const logs: string[] = [];
    const logger = {
      info: (message: string) => logs.push(message),
      warn: (message: string) => logs.push(message),
      error: (message: string) => logs.push(message),
    };
    const gate = createDeferred();
    const started = createDeferred();
    let runStarts = 0;
    let activeRuns = 0;
    let maxActiveRuns = 0;

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const alpha = 1;');

    const first = refreshIndexes(reposRoot, {
      logger,
      testHooks: {
        onSingleFlightRunStart: async ({ iteration }) => {
          runStarts += 1;
          activeRuns += 1;
          maxActiveRuns = Math.max(maxActiveRuns, activeRuns);

          if (iteration === 1) {
            started.resolve();
            await gate.promise;
          }

          activeRuns -= 1;
        },
      },
    });

    await started.promise;
    const second = refreshIndexes(reposRoot, { logger });
    const third = refreshIndexes(reposRoot, { logger });
    const fourth = refreshIndexes(reposRoot, { logger });
    gate.resolve();

    const results = await Promise.all([first, second, third, fourth]);
    const generationDirectories = await listGenerationDirectories(tempRoot);

    expect(maxActiveRuns).toBe(1);
    expect(runStarts).toBe(2);
    expect(new Set(results.map((result) => result.diagnostics.generationId)).size).toBe(1);
    expect(generationDirectories).toHaveLength(1);
    expect(logs.some((message) => message.includes('action=lock-acquired'))).toBe(true);
    expect(logs.some((message) => message.includes('action=follow-up-scheduled'))).toBe(true);
    expect(logs.some((message) => message.includes('action=lock-released'))).toBe(true);
  });

  it('runs a queued follow-up refresh after the active run completes so changes are not lost', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
    const scanGate = createDeferred();
    const scanReached = createDeferred();
    let pausedOnce = false;
    let runStarts = 0;

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const alpha = 1;');
    await refreshIndexes(reposRoot, { logger });

    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const beta = 2;');

    const firstUpdate = refreshIndexes(reposRoot, {
      logger,
      testHooks: {
        onSingleFlightRunStart: () => {
          runStarts += 1;
        },
        afterManifestScanned: async ({ hasPreviousGeneration }) => {
          if (hasPreviousGeneration && !pausedOnce) {
            pausedOnce = true;
            scanReached.resolve();
            await scanGate.promise;
          }
        },
      },
    });

    await scanReached.promise;
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const gamma = 3;');
    const secondUpdate = refreshIndexes(reposRoot, { logger });
    scanGate.resolve();

    await Promise.all([firstUpdate, secondUpdate]);

    const state = await loadCurrentGenerationState();
    const symbolIndex = await loadSymbolIndex();
    const generationDirectories = await listGenerationDirectories(tempRoot);

    expect(runStarts).toBe(2);
    expect(state?.generationId).toBeTruthy();
    expect(symbolIndex.symbols.some((symbol) => symbol.name === 'gamma')).toBe(true);
    expect(symbolIndex.symbols.some((symbol) => symbol.name === 'beta')).toBe(false);
    expect(generationDirectories).toHaveLength(3);
  });

  it('releases the refresh lock when a refresh fails so the next refresh can proceed', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const alpha = 1;');

    await expect(
      refreshIndexes(reposRoot, { logger, failBeforePublish: true }),
    ).rejects.toThrow('Simulated refresh failure before publish.');

    await expect(fs.access(getRefreshLockFilePath(reposRoot))).rejects.toThrow();

    const nextResult = await refreshIndexes(reposRoot, { logger });

    expect(nextResult.diagnostics.generationId).toBeTruthy();
  });

  it('recovers from a stale file lock and refreshes successfully', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    const lockPath = getRefreshLockFilePath(reposRoot);
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const alpha = 1;');
    await fs.mkdir(lockPath, { recursive: true });
    await fs.writeFile(
      path.join(lockPath, 'lock.json'),
      JSON.stringify(
        {
          ownerId: 'stale-owner',
          ownerPid: 999999,
          ownerHost: 'stale-host',
          reposRoot,
          startedAt: '2020-01-01T00:00:00.000Z',
          heartbeatAt: '2020-01-01T00:00:00.000Z',
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await refreshIndexes(reposRoot, { logger });
    const nextResult = await refreshIndexes(reposRoot, { logger });

    expect(result.diagnostics.generationId).toBeTruthy();
    expect(nextResult.diagnostics.generationId).toBe(result.diagnostics.generationId);
  });

  it('does not create overlapping generation directories under concurrent refresh pressure', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
    const gate = createDeferred();
    const started = createDeferred();
    let firstIterationSeen = false;

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export const alpha = 1;');

    const first = refreshIndexes(reposRoot, {
      logger,
      testHooks: {
        onSingleFlightRunStart: async ({ iteration }) => {
          if (iteration === 1 && !firstIterationSeen) {
            firstIterationSeen = true;
            started.resolve();
            await gate.promise;
          }
        },
      },
    });

    await started.promise;
    const othersPromise = Promise.all([
      refreshIndexes(reposRoot, { logger }),
      refreshIndexes(reposRoot, { logger }),
      refreshIndexes(reposRoot, { logger }),
    ]);
    gate.resolve();
    const firstResult = await first;
    const others = await othersPromise;
    const generationDirectories = await listGenerationDirectories(tempRoot);
    const currentState = await loadCurrentGenerationState();
    const generationsDirectory = getGenerationsDirectory();

    expect(generationDirectories).toEqual([firstResult.diagnostics.generationId]);
    expect(others.every((result) => result.diagnostics.generationId === firstResult.diagnostics.generationId)).toBe(true);
    expect(currentState?.generationId).toBe(firstResult.diagnostics.generationId);
    await expect(fs.access(generationsDirectory)).resolves.toBeUndefined();
  });
});
