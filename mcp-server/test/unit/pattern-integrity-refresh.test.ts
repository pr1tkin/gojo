import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getGenerationArtifactFilePath,
  loadCurrentGenerationState,
} from '../../src/indexing/generation-store.js';
import { runCurrentGenerationConsistencyMaintenance } from '../../src/indexing/consistency.js';
import { getCurrentIndexHealth } from '../../src/indexing/health.js';
import { refreshIndexes } from '../../src/indexing/refresh.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-pattern-integrity-test-'));
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

async function seedLargePatternRepo(reposRoot: string, repositoryId: string, count: number): Promise<void> {
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

describe.sequential('pattern integrity during refresh', () => {
  it('accepts legitimately small repositories without flagging a catastrophic pattern problem', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'small-repo');
    await writeRepositoryFile(
      reposRoot,
      'small-repo',
      'src/plain.ts',
      'export const answer = 42;',
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });
    const state = await loadCurrentGenerationState();

    expect(result.diagnostics.status).toBe('committed');
    expect(state?.patternIntegrity?.status).toBe('trusted');
  });

  it('keeps a healthy large repository trusted when pattern counts remain stable', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedLargePatternRepo(reposRoot, 'app-repo', 30);

    await refreshIndexes(reposRoot, { logger: silentLogger });
    const state = await loadCurrentGenerationState();

    expect(state?.counts.patterns).toBeGreaterThanOrEqual(30);
    expect(state?.patternIntegrity?.status).toBe('trusted');
  });

  it('blocks publish when a previously healthy large repository collapses to a suspicious pattern count', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedLargePatternRepo(reposRoot, 'app-repo', 30);
    const first = await refreshIndexes(reposRoot, { logger: silentLogger });

    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/components/Component0.tsx',
      'export function Component0() { return <main>updated</main>; }',
    );

    await expect(
      refreshIndexes(reposRoot, {
        logger: silentLogger,
        testHooks: {
          mutatePatternIndex: ({ patternIndex }) => ({
            ...patternIndex,
            patterns: patternIndex.patterns.slice(0, 2),
          }),
        },
      }),
    ).rejects.toThrow('Pattern integrity validation failed');

    const state = await loadCurrentGenerationState();

    expect(state?.generationId).toBe(first.diagnostics.generationId);
    expect(state?.counts.patterns).toBeGreaterThanOrEqual(30);
  });

  it('tolerates a malformed previous pattern artifact by rebuilding fresh patterns and surfacing a warning', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedLargePatternRepo(reposRoot, 'app-repo', 12);
    await refreshIndexes(reposRoot, { logger: silentLogger });
    const previousState = await loadCurrentGenerationState();

    if (!previousState) {
      throw new Error('expected current generation state');
    }

    await fs.writeFile(
      getGenerationArtifactFilePath(previousState.generationId, 'pattern-candidates.json'),
      '{bad json',
      'utf8',
    );
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/components/Component0.tsx',
      'export function Component0() { return <section>changed</section>; }',
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });
    const nextState = await loadCurrentGenerationState();

    expect(result.diagnostics.status).toBe('committed');
    expect(nextState?.generationId).not.toBe(previousState.generationId);
    expect(nextState?.warnings.join(' ')).toContain('previous pattern artifact was malformed');
  });

  it('does not raise a false catastrophic alarm for a narrow-scope change with stable pattern output', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedLargePatternRepo(reposRoot, 'app-repo', 25);
    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/components/Component1.tsx',
      'export function Component1() { return <section>narrow change</section>; }',
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });
    const state = await loadCurrentGenerationState();

    expect(result.diagnostics.status).toBe('committed');
    expect(state?.patternIntegrity?.status).toBe('trusted');
  });

  it('surfaces suspicious pattern state in health and consistency diagnostics', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedLargePatternRepo(reposRoot, 'app-repo', 15);
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    const state = await loadCurrentGenerationState();

    if (!state) {
      throw new Error('expected current generation state');
    }

    await fs.writeFile(
      getGenerationArtifactFilePath(state.generationId, 'pattern-candidates.json'),
      '{bad json',
      'utf8',
    );

    const report = await runCurrentGenerationConsistencyMaintenance({
      logger: silentLogger,
      applyRepairs: false,
    });
    const health = await getCurrentIndexHealth();
    const patternCheck = report?.checks.find((check) => check.checkId === 'pattern-state-integrity');

    expect(patternCheck?.status).toBe('failed');
    expect(patternCheck?.details.join(' ')).toContain('pattern artifact malformed');
    expect(patternCheck?.repairsRecommended[0]?.actionId).toBe('rebuild-pattern-state');
    expect(health.errors.join(' ')).toContain('consistency check');
    expect(health.warnings.join(' ')).toContain('consistency check');
  });
});
