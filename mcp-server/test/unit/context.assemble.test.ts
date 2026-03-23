import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCodeGraph } from '../../src/graph/build-graph.js';
import { assembleFileContext, assembleRelatedFileContext, assembleSymbolContext } from '../../src/context/index.js';
import { createFileId, createSymbolId } from '../../src/symbol-index/ids.js';
import { buildIndexedSymbols } from '../../src/symbol-index/build-index.js';
import { saveCodeGraph } from '../../src/graph/store.js';
import { saveSymbolIndex } from '../../src/symbol-index/store.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-context-test-'));
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

describe('context assembly', () => {
  it('assembles file context with graph-ranked related files and symbol relationships', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const reposRoot = path.join(tempRoot, 'repos');
    const repositoryRoot = path.join(reposRoot, 'context-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(repositoryRoot, 'src', 'shared.ts'), 'export const shared = 1;', 'utf8');
    await fs.writeFile(path.join(repositoryRoot, 'src', 'barrel.ts'), "export { shared } from './shared';", 'utf8');
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.ts'),
      [
        "import { shared } from './shared';",
        'export const consumer = shared;',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    await saveSymbolIndex(index);
    await saveCodeGraph(await buildCodeGraph());

    const sharedFileId = createFileId('context-repo', 'src/shared.ts');
    const sharedSymbolId = createSymbolId(sharedFileId, 'variable', 'shared', 1);
    const barrelFileId = createFileId('context-repo', 'src/barrel.ts');
    const consumerFileId = createFileId('context-repo', 'src/consumer.ts');

    const bundle = await assembleFileContext(sharedFileId);

    expect(bundle.file).toEqual(expect.objectContaining({ fileId: sharedFileId }));
    expect(bundle.repo).toBe('context-repo');
    expect(bundle.neighboringFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileId: barrelFileId }),
        expect.objectContaining({ fileId: consumerFileId }),
      ]),
    );
    expect(bundle.relatedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: expect.objectContaining({ fileId: barrelFileId }),
        }),
        expect.objectContaining({
          file: expect.objectContaining({ fileId: consumerFileId }),
        }),
      ]),
    );
    expect(bundle.relatedFiles.every((entry) => entry.reasons.some((reason) => reason.signal === 'graph_connection'))).toBe(true);
    expect(bundle.definedSymbols).toEqual([
      expect.objectContaining({ symbolId: sharedSymbolId }),
    ]);
    expect(bundle.exportedSymbols).toEqual([
      expect.objectContaining({ symbolId: sharedSymbolId }),
    ]);
  });

  it('assembles symbol context with ranked symbol candidates and primary-file context', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const reposRoot = path.join(tempRoot, 'repos');
    const preferredRepoRoot = path.join(reposRoot, 'preferred-repo');
    const otherRepoRoot = path.join(reposRoot, 'other-repo');
    await fs.mkdir(path.join(preferredRepoRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(otherRepoRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(preferredRepoRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(otherRepoRoot, 'src'), { recursive: true });

    await fs.writeFile(path.join(preferredRepoRoot, 'src', 'widget.ts'), 'export function Widget(): void {}', 'utf8');
    await fs.writeFile(path.join(otherRepoRoot, 'src', 'widget.ts'), 'function Widget(): void {}', 'utf8');

    const index = await buildIndexedSymbols(reposRoot);
    await saveSymbolIndex(index);
    await saveCodeGraph(await buildCodeGraph());

    const preferredFileId = createFileId('preferred-repo', 'src/widget.ts');

    const bundle = await assembleSymbolContext({
      name: 'Widget',
      kind: 'function',
      repo: 'preferred-repo',
    });

    expect(bundle.rankedSymbols).toHaveLength(1);
    expect(bundle.primarySymbol).toEqual(
      expect.objectContaining({
        repo: 'preferred-repo',
        fileId: preferredFileId,
        exported: true,
      }),
    );
    expect(bundle.primaryFile).toEqual(expect.objectContaining({ fileId: preferredFileId }));
    expect(bundle.exportedSymbols).toEqual([
      expect.objectContaining({ fileId: preferredFileId }),
    ]);
    expect(bundle.relatedFiles).toEqual([]);
    expect(bundle.ambiguityDetected).toBe(false);
    expect(bundle.viableAlternativeCount).toBe(0);
  });

  it('degrades safely for missing file and unresolved symbol context requests', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await saveSymbolIndex({
      schemaVersion: 4,
      symbols: [],
      byName: Object.create(null),
      byNameLower: Object.create(null),
      byFile: Object.create(null),
      stats: {
        globalByName: {},
        globalByNameLower: {},
        byRepo: {},
        exportedByName: {},
        byKind: {},
      },
    });
    await saveCodeGraph({
      schemaVersion: 1,
      sourceSymbolIndexSchemaVersion: 4,
      generatedAt: new Date().toISOString(),
      nodes: {
        repos: Object.create(null),
        files: Object.create(null),
        symbols: Object.create(null),
      },
      edges: [],
    });

    const missingFileContext = await assembleFileContext('missing-file');
    const missingRelatedContext = await assembleRelatedFileContext('missing-file');
    const missingSymbolContext = await assembleSymbolContext({ name: 'MissingSymbol' });

    expect(missingFileContext).toEqual({
      fileId: 'missing-file',
      file: null,
      repo: null,
      neighboringFiles: [],
      relatedFiles: [],
      totalRelatedFiles: 0,
      definedSymbols: [],
      exportedSymbols: [],
    });
    expect(missingRelatedContext).toEqual({
      items: [],
      totalCount: 0,
    });
    expect(missingSymbolContext).toEqual({
      query: 'MissingSymbol',
      repo: undefined,
      kind: undefined,
      rankedSymbols: [],
      primarySymbol: null,
      primaryFile: null,
      relatedFiles: [],
      totalRankedSymbols: 0,
      ambiguityDetected: false,
      viableAlternativeCount: 0,
      totalRelatedFiles: 0,
      exportedSymbols: [],
    });
  });
});
