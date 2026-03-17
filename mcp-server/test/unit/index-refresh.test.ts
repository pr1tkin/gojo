import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCodeGraph } from '../../src/graph/store.js';
import { loadCurrentGenerationState } from '../../src/indexing/generation-store.js';
import { refreshIndexes } from '../../src/indexing/refresh.js';
import { loadPatternIndex } from '../../src/patterns/store.js';
import { loadSymbolIndex } from '../../src/symbol-index/store.js';
import { loadUiCompositionIndex } from '../../src/ui-composition/store.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-index-refresh-test-'));
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

async function ensureRepository(reposRoot: string, repositoryId: string): Promise<void> {
  await fs.mkdir(path.join(reposRoot, repositoryId, '.git'), { recursive: true });
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

describe.sequential('refreshIndexes', () => {
  it('takes the no-op path when the repository manifest is unchanged', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function greet(): string { return "hi"; }',
    );

    const first = await refreshIndexes(reposRoot, { logger: silentLogger });
    const second = await refreshIndexes(reposRoot, { logger: silentLogger });

    expect(first.diagnostics.status).toBe('committed');
    expect(second.diagnostics.status).toBe('no-op');
    expect(second.diagnostics.generationId).toBe(first.diagnostics.generationId);
    expect(second.diagnostics.delta).toEqual({
      added: [],
      modified: [],
      deleted: [],
    });
  });

  it('detects added files and indexes them into the published generation', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/a.ts',
      'export function alpha(): string { return "a"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/b.ts',
      'export function beta(): string { return "b"; }',
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });
    const symbolIndex = await loadSymbolIndex();
    const state = await loadCurrentGenerationState();

    expect(result.diagnostics.delta.added).toEqual(['app-repo/src/b.ts']);
    expect(symbolIndex.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'src/b.ts',
          name: 'beta',
        }),
      ]),
    );
    expect(state?.manifest.map((entry) => entry.key)).toEqual([
      'app-repo/src/a.ts',
      'app-repo/src/b.ts',
    ]);
  });

  it('replaces stale derived data when a file is modified', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function oldName(): string { return "old"; }',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function newName(): string { return "new"; }',
    );

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });
    const symbolIndex = await loadSymbolIndex();
    const patternIndex = await loadPatternIndex();

    expect(result.diagnostics.delta.modified).toEqual(['app-repo/src/util.ts']);
    expect(symbolIndex.symbols.find((symbol) => symbol.name === 'oldName')).toBeUndefined();
    expect(symbolIndex.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'src/util.ts',
          name: 'newName',
        }),
      ]),
    );
    expect(patternIndex.patterns.find((pattern) => pattern.name === 'oldName')).toBeUndefined();
  });

  it('removes deleted files from symbols, graph edges, UI structure, and pattern artifacts', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Child.tsx',
      'export function Child() { return <span>child</span>; }',
    );
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/Parent.tsx',
      [
        "import { Child } from './Child';",
        '',
        'export function Parent() {',
        '  return <Child />;',
        '}',
      ].join('\n'),
    );

    await refreshIndexes(reposRoot, { logger: silentLogger });
    await fs.rm(path.join(reposRoot, 'app-repo', 'src', 'Child.tsx'));

    const result = await refreshIndexes(reposRoot, { logger: silentLogger });
    const symbolIndex = await loadSymbolIndex();
    const graph = await loadCodeGraph();
    const uiComposition = await loadUiCompositionIndex();
    const patternIndex = await loadPatternIndex();

    expect(result.diagnostics.delta.deleted).toEqual(['app-repo/src/Child.tsx']);
    expect(symbolIndex.symbols.some((symbol) => symbol.filePath === 'src/Child.tsx')).toBe(false);
    expect(Object.values(symbolIndex.byFile).some((relation) => relation.filePath === 'src/Child.tsx')).toBe(false);
    expect(Object.values(graph.nodes.files).some((node) => node.filePath === 'src/Child.tsx')).toBe(false);
    expect(graph.edges.some((edge) => edge.fromId.includes('Child.tsx') || edge.toId.includes('Child.tsx'))).toBe(false);
    expect(
      uiComposition.edges.some(
        (edge) => edge.parentFilePath === 'src/Child.tsx' || edge.childFilePath === 'src/Child.tsx',
      ),
    ).toBe(false);
    expect(patternIndex.patterns.some((pattern) => pattern.fileId.includes('Child.tsx'))).toBe(false);
  });

  it('produces idempotent published artifacts across repeated refresh runs', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/a.ts',
      'export function alpha(): string { return "a"; }',
    );

    const first = await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/a.ts',
      'export function alpha(): string { return "updated"; }',
    );
    const second = await refreshIndexes(reposRoot, { logger: silentLogger });
    const third = await refreshIndexes(reposRoot, { logger: silentLogger });
    const symbolIndex = await loadSymbolIndex();

    expect(second.diagnostics.status).toBe('committed');
    expect(third.diagnostics.status).toBe('no-op');
    expect(third.diagnostics.generationId).toBe(second.diagnostics.generationId);
    expect(symbolIndex.symbols).toEqual([
      expect.objectContaining({
        name: 'alpha',
        filePath: 'src/a.ts',
      }),
    ]);
    expect(second.diagnostics.generationId).not.toBe(first.diagnostics.generationId);
  });

  it('does not publish a partially built generation when refresh fails before publish', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function stableName(): string { return "stable"; }',
    );

    const first = await refreshIndexes(reposRoot, { logger: silentLogger });
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/util.ts',
      'export function brokenPublishAttempt(): string { return "changed"; }',
    );

    await expect(
      refreshIndexes(reposRoot, { logger: silentLogger, failBeforePublish: true }),
    ).rejects.toThrow('Simulated refresh failure before publish.');

    const state = await loadCurrentGenerationState();
    const symbolIndex = await loadSymbolIndex();

    expect(state?.generationId).toBe(first.diagnostics.generationId);
    expect(symbolIndex.symbols).toEqual([
      expect.objectContaining({
        name: 'stableName',
        filePath: 'src/util.ts',
      }),
    ]);
    expect(symbolIndex.symbols.find((symbol) => symbol.name === 'brokenPublishAttempt')).toBeUndefined();
  });
});

