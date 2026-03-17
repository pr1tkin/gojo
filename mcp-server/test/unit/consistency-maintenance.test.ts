import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getGenerationArtifactFilePath, loadCurrentGenerationState, updateGenerationState } from '../../src/indexing/generation-store.js';
import {
  loadCurrentConsistencyReport,
  runCurrentGenerationConsistencyMaintenance,
} from '../../src/indexing/consistency.js';
import { refreshIndexes } from '../../src/indexing/refresh.js';
import { loadPatternIndex } from '../../src/patterns/store.js';
import { loadSymbolIndex } from '../../src/symbol-index/store.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-consistency-test-'));
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

async function getCurrentArtifactPath(fileName: string): Promise<string> {
  const state = await loadCurrentGenerationState();

  if (!state) {
    throw new Error('expected a current generation');
  }

  return getGenerationArtifactFilePath(state.generationId, fileName);
}

async function overwriteCurrentArtifact(fileName: string, value: unknown): Promise<void> {
  await fs.writeFile(await getCurrentArtifactPath(fileName), JSON.stringify(value, null, 2), 'utf8');
}

async function readCurrentArtifact<T>(fileName: string): Promise<T> {
  const content = await fs.readFile(await getCurrentArtifactPath(fileName), 'utf8');
  return JSON.parse(content) as T;
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

describe.sequential('consistency maintenance', () => {
  it('detects missing required artifacts and recommends rebuilds', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export function alpha() { return "a"; }');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    await fs.rm(await getCurrentArtifactPath('symbol-index.json'));

    const report = await runCurrentGenerationConsistencyMaintenance({ logger: silentLogger, applyRepairs: false });
    const check = report?.checks.find((entry) => entry.checkId === 'generation-required-artifacts');

    expect(check?.status).toBe('failed');
    expect(check?.targetArtifacts).toContain('symbol-index.json');
    expect(check?.repairsRecommended).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionId: 'rebuild-published-generation' }),
      ]),
    );
  });

  it('cleans orphaned artifact entries when repair is enabled', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export function alpha() { return "a"; }');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    const symbolIndex = await readCurrentArtifact<Record<string, unknown>>('symbol-index.json');
    const mutatedSymbolIndex = {
      ...symbolIndex,
      symbols: [
        ...((symbolIndex.symbols as unknown[]) ?? []),
        {
          symbolId: 'app-repo:src/Ghost.ts:function:ghost:1',
          fileId: 'app-repo:src/Ghost.ts',
          name: 'ghost',
          kind: 'function',
          repo: 'app-repo',
          filePath: 'src/Ghost.ts',
          startLine: 1,
          endLine: 1,
          exported: true,
          declarationFingerprint: 'function:ghost:1',
        },
      ],
      byFile: {
        ...((symbolIndex.byFile as Record<string, unknown>) ?? {}),
        'app-repo:src/Ghost.ts': {
          fileId: 'app-repo:src/Ghost.ts',
          repo: 'app-repo',
          filePath: 'src/Ghost.ts',
          classification: 'source',
          symbolIds: ['app-repo:src/Ghost.ts:function:ghost:1'],
          symbolNames: ['ghost'],
          imports: [],
          exports: [],
          importTokens: [],
        },
      },
    };
    await overwriteCurrentArtifact('symbol-index.json', mutatedSymbolIndex);

    const patternIndex = await readCurrentArtifact<Record<string, unknown>>('pattern-candidates.json');
    await overwriteCurrentArtifact('pattern-candidates.json', {
      ...patternIndex,
      patterns: [
        ...((patternIndex.patterns as unknown[]) ?? []),
        {
          patternId: 'orphan-pattern',
          kind: 'utility-export',
          repoId: 'app-repo',
          fileId: 'app-repo:src/Ghost.ts',
          name: 'ghost',
          language: 'ts',
          startLine: 1,
          endLine: 1,
          signals: [],
          fingerprint: {
            patternKind: 'utility-export',
            structuralSignals: [],
            importSet: [],
            exportShape: 'named',
            symbolRole: 'utility',
          },
          supportingImports: [],
          relatedSymbolIds: [],
          confidence: 'low',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const report = await runCurrentGenerationConsistencyMaintenance({ logger: silentLogger, applyRepairs: true });
    const check = report?.checks.find((entry) => entry.checkId === 'orphaned-artifact-entries');
    const repairedSymbolIndex = await loadSymbolIndex();
    const repairedPatternIndex = await loadPatternIndex();

    expect(check?.status).toBe('repaired');
    expect(check?.repairsApplied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionId: 'cleanup-orphaned-artifact-entries' }),
      ]),
    );
    expect(repairedSymbolIndex.symbols.some((symbol) => symbol.filePath === 'src/Ghost.ts')).toBe(false);
    expect(repairedPatternIndex.patterns.some((pattern) => pattern.fileId === 'app-repo:src/Ghost.ts')).toBe(false);
  });

  it('flags cross-artifact mismatches without silently accepting them', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/a.ts',
      ["import { b } from './b';", 'export const a = b;'].join('\n'),
    );
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/b.ts', 'export const b = 1;');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    const graph = await readCurrentArtifact<Record<string, unknown>>('code-graph.json');
    await overwriteCurrentArtifact('code-graph.json', {
      ...graph,
      edges: [],
    });

    const report = await runCurrentGenerationConsistencyMaintenance({ logger: silentLogger, applyRepairs: false });
    const check = report?.checks.find((entry) => entry.checkId === 'cross-artifact-mismatches');

    expect(check?.status).toBe('failed');
    expect(check?.repairsRecommended).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionId: 'rebuild-mismatched-artifacts' }),
      ]),
    );
  });

  it('downgrades suspicious search freshness when coordination state is malformed', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export function alpha() { return "a"; }');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    const state = await loadCurrentGenerationState();

    if (!state) {
      throw new Error('expected current generation state');
    }

    await updateGenerationState(state.generationId, {
      ...state,
      search: {
        ...state.search,
        status: 'ready',
        details: 'manually promoted for test',
      },
    });

    const snapshotPath = path.join(tempRoot, '.data', 'coordination', 'zoekt-refresh-state.json');
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.writeFile(snapshotPath, '{not valid json', 'utf8');

    const report = await runCurrentGenerationConsistencyMaintenance({ logger: silentLogger, applyRepairs: true });
    const refreshedState = await loadCurrentGenerationState();
    const check = report?.checks.find((entry) => entry.checkId === 'coordination-state-sanity');

    expect(check?.status).toBe('repaired');
    expect(refreshedState?.search.status).not.toBe('ready');
  });

  it('removes temp files and incomplete generation debris when repair is enabled', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export function alpha() { return "a"; }');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    const tmpPointerPath = path.join(tempRoot, '.data', 'current-generation.tmp.json');
    const incompleteGenerationDir = path.join(tempRoot, '.data', 'generations', 'dangling-generation');
    await fs.mkdir(incompleteGenerationDir, { recursive: true });
    await fs.writeFile(tmpPointerPath, '{}', 'utf8');
    await fs.writeFile(path.join(incompleteGenerationDir, 'symbol-index.json'), '{}', 'utf8');

    const report = await runCurrentGenerationConsistencyMaintenance({ logger: silentLogger, applyRepairs: true });
    const check = report?.checks.find((entry) => entry.checkId === 'maintenance-debris');

    expect(check?.status).toBe('repaired');
    await expect(fs.access(tmpPointerPath)).rejects.toThrow();
    await expect(fs.access(incompleteGenerationDir)).rejects.toThrow();
  });

  it('preserves conservative behavior when repairs are disabled', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(reposRoot, 'app-repo', 'src/a.ts', 'export function alpha() { return "a"; }');
    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });

    const symbolIndex = await readCurrentArtifact<Record<string, unknown>>('symbol-index.json');
    await overwriteCurrentArtifact('symbol-index.json', {
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

    const report = await runCurrentGenerationConsistencyMaintenance({ logger: silentLogger, applyRepairs: false });
    const check = report?.checks.find((entry) => entry.checkId === 'orphaned-artifact-entries');
    const persistedSymbolIndex = await readCurrentArtifact<Record<string, unknown>>('symbol-index.json');

    expect(check?.status).toBe('warning');
    expect(check?.repairsApplied).toHaveLength(0);
    expect(Object.keys((persistedSymbolIndex.byFile as Record<string, unknown>) ?? {})).toContain('app-repo:src/Ghost.ts');
  });

  it('runs post-refresh consistency validation automatically for risky changes', async () => {
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

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });
    const report = await loadCurrentConsistencyReport();
    const state = await loadCurrentGenerationState();

    expect(result.diagnostics.consistency).toBeTruthy();
    expect(report?.overview.checksExecuted).toBeGreaterThan(0);
    expect(state?.consistency).toEqual(report?.overview);
  });
});
