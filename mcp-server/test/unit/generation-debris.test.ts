import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanupGenerationDebris } from '../../src/indexing/generation-debris.js';
import {
  getGenerationDirectory,
  initializeStagedGeneration,
  loadGenerationLifecycleMarker,
  loadCurrentGenerationState,
  markGenerationCommitted,
} from '../../src/indexing/generation-store.js';
import { refreshIndexes } from '../../src/indexing/refresh.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-generation-debris-test-'));
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

describe.sequential('generation debris cleanup', () => {
  it('marks interrupted refresh generations abandoned and cleans them on the next successful refresh', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function alpha(): string { return "a"; }',
    );

    const first = await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function beta(): string { return "b"; }',
    );

    let failedGenerationId = '';

    await expect(
      refreshIndexes(reposRoot, {
        logger: silentLogger,
        failBeforePublish: true,
        testHooks: {
          afterManifestScanned: () => undefined,
        },
      }),
    ).rejects.toThrow('Simulated refresh failure before publish.');

    const generationEntries = await fs.readdir(path.join(tempRoot, '.data', 'generations'));
    failedGenerationId = generationEntries.find((entry) => entry !== first.diagnostics.generationId) ?? '';
    expect(failedGenerationId).not.toBe('');
    expect((await loadGenerationLifecycleMarker(failedGenerationId))?.status).toBe('abandoned');

    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/next.ts',
      'export const nextValue = 1;',
    );
    await refreshIndexes(reposRoot, { logger: silentLogger });

    await expect(fs.access(getGenerationDirectory(failedGenerationId))).rejects.toThrow();
    const state = await loadCurrentGenerationState();
    expect(state?.generationId).not.toBe(failedGenerationId);
  });

  it('never deletes committed generations during debris cleanup', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const generationId = 'committed-generation';
    const createdAt = '2026-03-17T10:00:00.000Z';
    await initializeStagedGeneration(generationId, createdAt);
    await markGenerationCommitted(generationId, createdAt);

    const report = await cleanupGenerationDebris({
      logger: silentLogger,
      applyDeletes: true,
      maxStagedAgeMs: 0,
    });

    expect(report.removed).toEqual([]);
    await expect(fs.access(getGenerationDirectory(generationId))).resolves.toBeUndefined();
  });

  it('removes multiple abandoned staged generations safely', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await initializeStagedGeneration('staged-old-a', '2026-03-17T08:00:00.000Z');
    await initializeStagedGeneration('staged-old-b', '2026-03-17T08:05:00.000Z');

    const report = await cleanupGenerationDebris({
      logger: silentLogger,
      applyDeletes: true,
      maxStagedAgeMs: 0,
    });

    expect(report.removed.map((entry) => entry.generationId).sort()).toEqual([
      'staged-old-a',
      'staged-old-b',
    ]);
    await expect(fs.access(getGenerationDirectory('staged-old-a'))).rejects.toThrow();
    await expect(fs.access(getGenerationDirectory('staged-old-b'))).rejects.toThrow();
  });

  it('preserves a recent staged generation so cleanup does not race an active refresh', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await initializeStagedGeneration('staged-recent', new Date().toISOString());
    await initializeStagedGeneration('staged-stale', '2026-03-17T08:00:00.000Z');

    const report = await cleanupGenerationDebris({
      logger: silentLogger,
      applyDeletes: true,
      maxStagedAgeMs: 60 * 60 * 1000,
    });

    expect(report.removed.map((entry) => entry.generationId)).toEqual(['staged-stale']);
    expect(report.preserved.some((entry) => entry.generationId === 'staged-recent')).toBe(true);
    await expect(fs.access(getGenerationDirectory('staged-recent'))).resolves.toBeUndefined();
  });
});
