import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evaluateHighRiskRefreshValidation } from '../../src/indexing/high-risk-validation.js';
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

  it('does not treat explicitly skipped coverage files as missing symbol-index corruption during high-risk validation', () => {
    const validation = evaluateHighRiskRefreshValidation({
      checkedAt: '2026-03-23T17:00:00.000Z',
      current: {
        schemaVersion: 3,
        generationId: 'gen-1',
        reposRoot: '/repos',
        repositories: [{ repoId: 'app-repo', repoRoot: '/repos/app-repo' }],
        createdAt: '2026-03-23T17:00:00.000Z',
        status: 'ready',
        manifest: [
          {
            key: 'app-repo/src/kept.ts',
            repoId: 'app-repo',
            repoRoot: '/repos/app-repo',
            filePath: 'src/kept.ts',
            normalizedPath: 'src/kept.ts',
            fileSizeBytes: 10,
            contentHash: 'a',
          },
          {
            key: 'app-repo/bench/ignored.ts',
            repoId: 'app-repo',
            repoRoot: '/repos/app-repo',
            filePath: 'bench/ignored.ts',
            normalizedPath: 'bench/ignored.ts',
            fileSizeBytes: 10,
            contentHash: 'b',
          },
        ],
        delta: { added: 2, modified: 0, deleted: 0 },
        counts: {
          files: 1,
          symbols: 1,
          fileRecords: 1,
          graphFiles: 1,
          graphSymbols: 1,
          graphEdges: 0,
          uiCompositionEdges: 0,
          uiPropUsages: 0,
          patterns: 0,
        },
        rebuild: {
          symbolFilesRebuilt: 2,
          patternFilesRebuilt: 1,
          graphMode: 'full',
          uiCompositionMode: 'full',
          uiPropsMode: 'full',
        },
        cleanup: {
          deletedFileRecordsRemoved: 0,
          deletedSymbolsRemoved: 0,
          deletedPatternEntriesRemoved: 0,
        },
        changeSummary: {
          filesChanged: 2,
          added: 2,
          modified: 0,
          deleted: 0,
          highRiskFiles: 1,
          signalCounts: { unknownStructuralChange: 1 },
          impactHintCounts: {},
        },
        search: {
          status: 'ready',
          requestedAt: '2026-03-23T17:00:00.000Z',
          refreshedAt: '2026-03-23T17:00:01.000Z',
          aggregateFingerprint: 'fp',
          repoFingerprints: [],
          coordinationMode: 'shared-marker',
        },
        indexingCoverage: {
          schemaVersion: 1,
          generatedAt: '2026-03-23T17:00:00.000Z',
          totalSourceFiles: 2,
          fullyIndexedFiles: 1,
          partialFiles: 0,
          skippedFiles: 1,
          trustImpact: 'none',
          issueCounts: {
            parserFailures: 0,
            readFailures: 0,
            metadataFallbacks: 0,
            policySkipped: 1,
          },
          issues: [
            {
              repoId: 'app-repo',
              filePath: 'bench/ignored.ts',
              fileId: 'app-repo:bench/ignored.ts',
              classification: 'source',
              language: 'ts',
              stage: 'symbol_extraction',
              disposition: 'skipped',
              source: 'policy',
              reason: 'skipped benchmark harness source outside the main application surface',
            },
          ],
          omittedIssueCount: 0,
        },
        warnings: [],
        errors: [],
      },
      changeSummary: {
        schemaVersion: 1,
        generatedAt: '2026-03-23T17:00:00.000Z',
        files: [
          {
            key: 'app-repo/bench/ignored.ts',
            repoId: 'app-repo',
            filePath: 'bench/ignored.ts',
            changeKind: 'added',
            confidence: 'low',
            signals: ['unknownStructuralChange'],
            impactHints: ['highRiskStructuralChange'],
            notes: [],
          },
        ],
        overview: {
          filesChanged: 2,
          added: 2,
          modified: 0,
          deleted: 0,
          highRiskFiles: 1,
          signalCounts: { unknownStructuralChange: 1 },
          impactHintCounts: {},
        },
      },
      baseline: null,
      symbolIndex: {
        schemaVersion: 4,
        symbols: [],
        byName: Object.create(null),
        byNameLower: Object.create(null),
        byFile: {
          'app-repo:src/kept.ts': {
            fileId: 'app-repo:src/kept.ts',
            repo: 'app-repo',
            filePath: 'src/kept.ts',
            classification: 'source',
            coverage: 'full',
            symbolIds: [],
            symbolNames: [],
            imports: [],
            exports: [],
            importTokens: [],
          },
        },
        stats: {
          globalByName: Object.create(null),
          globalByNameLower: Object.create(null),
          byRepo: Object.create(null),
          exportedByName: Object.create(null),
          byKind: Object.create(null),
        },
      },
      graph: {
        schemaVersion: 1,
        generatedAt: '2026-03-23T17:00:00.000Z',
        nodes: {
          repos: { 'repo:app-repo': { id: 'repo:app-repo', type: 'repo', repo: 'app-repo' } },
          files: { 'app-repo:src/kept.ts': { id: 'app-repo:src/kept.ts', type: 'file', repo: 'app-repo', filePath: 'src/kept.ts' } },
          symbols: {},
        },
        edges: [],
      },
      uiComposition: {
        schemaVersion: 1,
        sourceSymbolIndexSchemaVersion: 4,
        generatedAt: '2026-03-23T17:00:00.000Z',
        edges: [],
      },
      uiProps: {
        schemaVersion: 1,
        sourceSymbolIndexSchemaVersion: 4,
        generatedAt: '2026-03-23T17:00:00.000Z',
        propUsages: [],
      },
      patternIndex: {
        schemaVersion: 1,
        sourceSymbolIndexSchemaVersion: 4,
        generatedAt: '2026-03-23T17:00:00.000Z',
        patterns: [],
      },
    });

    expect(validation.issues.find((issue) => issue.code === 'missing-symbol-relations')).toBeUndefined();
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
