import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getCurrentHealthSnapshotFilePath,
  getGenerationArtifactFilePath,
  loadCurrentGenerationState,
} from '../../src/indexing/generation-store.js';
import { runCurrentGenerationConsistencyMaintenance } from '../../src/indexing/consistency.js';
import { getCurrentIndexHealth, loadCurrentIndexHealthSnapshot } from '../../src/indexing/health.js';
import { refreshIndexes } from '../../src/indexing/refresh.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-health-test-'));
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
  const filePath = path.join(cwd, '.data', 'coordination', 'zoekt-refresh-state.json');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
}

async function readCurrentArtifact<T>(cwd: string, fileName: string): Promise<T> {
  const state = await loadCurrentGenerationState();

  if (!state) {
    throw new Error('expected a current generation');
  }

  const content = await fs.readFile(path.join(cwd, '.data', 'generations', state.generationId, fileName), 'utf8');
  return JSON.parse(content) as T;
}

async function overwriteCurrentArtifact(cwd: string, fileName: string, value: unknown): Promise<void> {
  const state = await loadCurrentGenerationState();

  if (!state) {
    throw new Error('expected a current generation');
  }

  await fs.writeFile(path.join(cwd, '.data', 'generations', state.generationId, fileName), JSON.stringify(value, null, 2), 'utf8');
}

async function removeCurrentArtifact(fileName: string): Promise<void> {
  const state = await loadCurrentGenerationState();

  if (!state) {
    throw new Error('expected a current generation');
  }

  await fs.rm(getGenerationArtifactFilePath(state.generationId, fileName), { force: true });
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

describe.sequential('index health', () => {
  it('reports a fully healthy current generation when search is ready and consistency checks pass', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export function alpha() { return "a"; }');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    const state = await loadCurrentGenerationState();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'snapshot-ready-1',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: state?.search.aggregateFingerprint,
      repoFingerprints: state?.search.repoFingerprints,
      details: 'Zoekt indexing pass completed successfully.',
    });
    await runCurrentGenerationConsistencyMaintenance({ logger: silentLogger, applyRepairs: true });

    const health = await getCurrentIndexHealth();
    const snapshot = await loadCurrentIndexHealthSnapshot();

    expect(health.trustState).toBe('healthy');
    expect(health.search?.status).toBe('ready');
    expect(health.errors).toEqual([]);
    expect(snapshot?.trustState).toBe('healthy');
  });

  it('reports stale-search when search freshness is still pending', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export function alpha() { return "a"; }');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    const health = await getCurrentIndexHealth();

    expect(health.trustState).toBe('stale-search');
    expect(health.search?.status).toBe('pending');
    expect(health.reasons.join(' ')).toContain('coordination markers are not trustworthy');
  });

  it('downgrades trust to inconsistent when the published symbol index is missing', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export function alpha() { return "a"; }');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    const state = await loadCurrentGenerationState();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'snapshot-ready-symbol-missing',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: state?.search.aggregateFingerprint,
      repoFingerprints: state?.search.repoFingerprints,
    });
    await removeCurrentArtifact('symbol-index.json');

    const health = await getCurrentIndexHealth();

    expect(health.trustState).toBe('inconsistent');
    expect(health.suitableForAgentWorkflows).toBe(false);
    expect(health.errors.join(' ')).toContain('symbol-index.json is missing');
  });

  it('downgrades trust when the published pattern artifact is missing', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export function alpha() { return "a"; }');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    const state = await loadCurrentGenerationState();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'snapshot-ready-pattern-missing',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: state?.search.aggregateFingerprint,
      repoFingerprints: state?.search.repoFingerprints,
    });
    await removeCurrentArtifact('pattern-candidates.json');

    const health = await getCurrentIndexHealth();

    expect(['degraded', 'inconsistent']).toContain(health.trustState);
    expect(health.suitableForAgentWorkflows).toBe(false);
    expect([...health.warnings, ...health.errors].join(' ')).toContain('pattern artifact is missing');
  });

  it('treats unreadable coordination markers as trust-degrading instead of only stale-search', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export function alpha() { return "a"; }');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    const snapshotPath = path.join(tempRoot, '.data', 'coordination', 'zoekt-refresh-state.json');
    await fs.rm(snapshotPath, { force: true });
    await fs.mkdir(snapshotPath, { recursive: true });

    const health = await getCurrentIndexHealth();

    expect(health.trustState).toBe('degraded');
    expect(health.suitableForAgentWorkflows).toBe(false);
    expect(health.reasons.join(' ')).toContain('Zoekt refresh snapshot coordination marker is unreadable');
  });

  it('does not overreact when a non-critical UI artifact is missing', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.tsx', 'export function Alpha() { return <div className="x" />; }');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    const state = await loadCurrentGenerationState();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'snapshot-ready-ui-optional',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: state?.search.aggregateFingerprint,
      repoFingerprints: state?.search.repoFingerprints,
    });
    await removeCurrentArtifact('ui-semantics.json');

    const health = await getCurrentIndexHealth();

    expect(health.trustState).toBe('healthy');
    expect(health.errors).toEqual([]);
  });

  it('reports inconsistent with explicit evidence when consistency checks fail', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export function alpha() { return "a"; }');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    await fs.rm(path.join(tempRoot, '.data', 'generations', (await loadCurrentGenerationState())?.generationId ?? '', 'symbol-index.json'));
    await runCurrentGenerationConsistencyMaintenance({ logger: silentLogger, applyRepairs: false });

    const health = await getCurrentIndexHealth();

    expect(health.trustState).toBe('inconsistent');
    expect(health.errors.join(' ')).toContain('consistency check');
    expect(health.reasons.join(' ')).toContain('repair action');
  });

  it('surfaces applied repairs and downgrades trust to degraded rather than pretending everything is pristine', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export function alpha() { return "a"; }');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    const symbolIndex = await readCurrentArtifact<Record<string, unknown>>(tempRoot, 'symbol-index.json');
    await overwriteCurrentArtifact(tempRoot, 'symbol-index.json', {
      ...symbolIndex,
      byFile: {
        ...((symbolIndex.byFile as Record<string, unknown>) ?? {}),
        'app-repo:src/Ghost.ts': {
          fileId: 'app-repo:src/Ghost.ts',
          repo: 'app-repo',
          filePath: 'src/Ghost.ts',
          classification: 'source',
          symbolIds: [],
          symbolNames: [],
          imports: [],
          exports: [],
          importTokens: [],
        },
      },
    });
    await runCurrentGenerationConsistencyMaintenance({ logger: silentLogger, applyRepairs: true });
    const state = await loadCurrentGenerationState();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'snapshot-ready-2',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: state?.search.aggregateFingerprint,
      repoFingerprints: state?.search.repoFingerprints,
      details: 'Zoekt indexing pass completed successfully.',
    });

    const health = await getCurrentIndexHealth();

    expect(health.trustState).toBe('degraded');
    expect(health.consistency?.overview.repairsApplied).toBeGreaterThan(0);
    expect(health.reasons.join(' ')).toContain('consistency maintenance repaired');
  });

  it('stays explicit and unknown when persisted generation state is missing', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const health = await getCurrentIndexHealth();

    expect(health.trustState).toBe('unknown');
    expect(health.suitableForAgentWorkflows).toBe(false);
    expect(health.errors.join(' ')).toContain('missing');
  });

  it('reflects recent risky unknown structural changes in the health summary', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function stableName(): string { return "before"; }',
    );
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function stableName(): string { return "after"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    const state = await loadCurrentGenerationState();

    await writeSearchSnapshot(tempRoot, {
      schemaVersion: 1,
      snapshotId: 'snapshot-ready-3',
      status: 'ready',
      refreshedAt: '2026-03-17T10:00:00.000Z',
      aggregateFingerprint: state?.search.aggregateFingerprint,
      repoFingerprints: state?.search.repoFingerprints,
      details: 'Zoekt indexing pass completed successfully.',
    });

    const health = await getCurrentIndexHealth();

    expect(health.recentActivity.unknownStructuralChangeCount).toBeGreaterThan(0);
    expect(health.reasons.join(' ')).toContain('unknownStructuralChange');
    expect(['degraded', 'inconsistent']).toContain(health.trustState);
  });

  it('can be consumed as a reusable internal diagnostics summary and persists a snapshot', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export function alpha() { return "a"; }');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    const health = await getCurrentIndexHealth();
    const snapshotPath = getCurrentHealthSnapshotFilePath();
    const snapshot = await loadCurrentIndexHealthSnapshot();

    expect(typeof health.generationId).toBe('string');
    expect(typeof health.suitableForAgentWorkflows).toBe('boolean');
    await expect(fs.access(snapshotPath)).resolves.toBeUndefined();
    expect(snapshot?.generationId).toBe(health.generationId);
  });
});
