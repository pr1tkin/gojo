import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCurrentGenerationState } from '../../src/indexing/generation-store.js';
import { runCurrentGenerationConsistencyMaintenance } from '../../src/indexing/consistency.js';
import { getCurrentIndexHealth } from '../../src/indexing/health.js';
import { refreshIndexes } from '../../src/indexing/refresh.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-high-risk-refresh-test-'));
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

async function seedUiRepo(reposRoot: string, repositoryId: string): Promise<void> {
  await ensureRepository(reposRoot, repositoryId);
  await writeRepositoryFile(
    reposRoot,
    repositoryId,
    'src/components/Child.tsx',
    'export function Child(props: { label?: string; tone?: string }) { return <span>{props.label}</span>; }',
  );
  await writeRepositoryFile(
    reposRoot,
    repositoryId,
    'src/components/Parent.tsx',
    [
      "import { Child } from './Child';",
      '',
      'export function Parent() {',
      '  return <Child label="before" />;',
      '}',
    ].join('\n'),
  );
}

async function seedLargeComponentRepo(reposRoot: string, repositoryId: string, count: number): Promise<void> {
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

describe.sequential('high-risk post-refresh validation', () => {
  it('does not trigger enhanced validation for low-risk local changes', async () => {
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

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function beta(): string { return "b"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    const state = await loadCurrentGenerationState();

    expect(state?.highRiskRefreshValidation?.status).toBe('not-applicable');
    expect(state?.highRiskRefreshValidation?.isHighRiskRefresh).toBe(false);
  });

  it('passes cleanly for a high-risk refresh when rebuilt artifacts are coherent', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedUiRepo(reposRoot, 'app-repo');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/components/Parent.tsx',
      [
        "import { Child } from './Child';",
        '',
        'export function Parent() {',
        '  return <section><Child tone="primary" /></section>;',
        '}',
      ].join('\n'),
    );

    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    const state = await loadCurrentGenerationState();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'high-risk-pass',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: state?.search.aggregateFingerprint,
      repoFingerprints: state?.search.repoFingerprints,
    });

    const health = await getCurrentIndexHealth();

    expect(state?.highRiskRefreshValidation?.isHighRiskRefresh).toBe(true);
    expect(state?.highRiskRefreshValidation?.status).toBe('passed');
    expect(health.trustState).toBe('healthy');
  });

  it('publishes a degraded generation when high-risk UI validation surfaces suspicious but non-fatal evidence', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedUiRepo(reposRoot, 'app-repo');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/components/Parent.tsx',
      [
        "import { Child } from './Child';",
        '',
        'export function Parent() {',
        '  return <div><Child tone="secondary" /></div>;',
        '}',
      ].join('\n'),
    );

    await refreshIndexes(reposRoot, {
      logger: silentLogger,
      runConsistencyChecks: 'never',
      testHooks: {
        mutateDerivedArtifacts: ({ uiComposition, uiProps }) => ({
          uiComposition: { ...uiComposition, edges: [] },
          uiProps: { ...uiProps, propUsages: [] },
        }),
      },
    });
    const state = await loadCurrentGenerationState();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'high-risk-warning',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: state?.search.aggregateFingerprint,
      repoFingerprints: state?.search.repoFingerprints,
    });

    const report = await runCurrentGenerationConsistencyMaintenance({
      logger: silentLogger,
      applyRepairs: false,
    });
    const health = await getCurrentIndexHealth();
    const validationCheck = report?.checks.find((check) => check.checkId === 'high-risk-post-refresh-validation');

    expect(state?.highRiskRefreshValidation?.status).toBe('degraded');
    expect(validationCheck?.status).toBe('warning');
    expect(validationCheck?.details.join(' ')).toContain('validation triggers');
    expect(health.trustState).toBe('repair-recommended');
    expect(health.reasons.join(' ')).toContain('high-risk refresh validation was triggered');
    expect(health.suitableForAgentWorkflows).toBe(false);
  });

  it('blocks publish when a high-risk refresh leaves incomplete structure artifacts', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedUiRepo(reposRoot, 'app-repo');
    const first = await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/components/Parent.tsx',
      'export function Parent() { return <main>changed</main>; }',
    );

    await expect(
      refreshIndexes(reposRoot, {
        logger: silentLogger,
        testHooks: {
          mutateDerivedArtifacts: ({ symbolIndex }) => ({
            symbolIndex: {
              ...symbolIndex,
              byFile: Object.fromEntries(
                Object.entries(symbolIndex.byFile).filter(([, relation]) => relation.filePath !== 'src/components/Parent.tsx'),
              ),
            },
          }),
        },
      }),
    ).rejects.toThrow('High-risk refresh validation failed');

    const state = await loadCurrentGenerationState();

    expect(state?.generationId).toBe(first.diagnostics.generationId);
  });

  it('blocks publish when a high-risk refresh produces a catastrophic symbol-count regression', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedLargeComponentRepo(reposRoot, 'app-repo', 30);
    const first = await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/components/Component0.tsx',
      'export function Component0() { return <main>changed</main>; }',
    );

    await expect(
      refreshIndexes(reposRoot, {
        logger: silentLogger,
        testHooks: {
          mutateDerivedArtifacts: ({ symbolIndex }) => ({
            symbolIndex: {
              ...symbolIndex,
              symbols: symbolIndex.symbols.slice(0, 2),
            },
          }),
        },
      }),
    ).rejects.toThrow('High-risk refresh validation failed');

    const state = await loadCurrentGenerationState();

    expect(state?.generationId).toBe(first.diagnostics.generationId);
    expect(state?.counts.patterns).toBeGreaterThanOrEqual(30);
  });

  it('blocks publish when a high-risk refresh produces malformed cross-artifact graph output', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await seedUiRepo(reposRoot, 'app-repo');
    const first = await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/components/Parent.tsx',
      'export function Parent() { return <main>changed</main>; }',
    );

    await expect(
      refreshIndexes(reposRoot, {
        logger: silentLogger,
        testHooks: {
          mutateDerivedArtifacts: ({ graph }) => ({
            graph: {
              ...graph,
              edges: [
                ...graph.edges,
                {
                  edgeId: 'dangling-edge',
                  fromId: 'missing:file',
                  toId: 'missing:symbol',
                  kind: 'imports',
                },
              ],
            },
          }),
        },
      }),
    ).rejects.toThrow('High-risk refresh validation failed');

    const state = await loadCurrentGenerationState();

    expect(state?.generationId).toBe(first.diagnostics.generationId);
  });
});
