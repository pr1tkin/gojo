import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCodeGraph, buildCodeGraphFromSymbolIndex } from '../../src/graph/build-graph.js';
import {
  getDefinedSymbols,
  getExportedSymbols,
  getFileNode,
  getFileRepo,
  getGraph,
  getImportedFiles,
  getImportingFiles,
  getIncomingEdges,
  getNeighboringFiles,
  getOutgoingEdges,
  getRelatedFiles,
  getReexportedFiles,
  getReexportingFiles,
  getRepoFiles,
  getSymbolFile,
  getSymbolNode,
} from '../../src/graph/query.js';
import { loadCodeGraph, saveCodeGraph } from '../../src/graph/store.js';
import { createFileId, createSymbolId } from '../../src/symbol-index/ids.js';
import { buildIndexedSymbols } from '../../src/symbol-index/build-index.js';
import { saveSymbolIndex } from '../../src/symbol-index/store.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-graph-store-test-'));
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

describe('graph store and query', () => {
  it('persists and reloads the graph snapshot and exposes internal query helpers', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const graph = buildCodeGraphFromSymbolIndex({
      schemaVersion: 4,
      symbols: [
        {
          symbolId: 'repo-a:src/a.ts:function:alpha:1',
          fileId: 'repo-a:src/a.ts',
          name: 'alpha',
          kind: 'function',
          repo: 'repo-a',
          filePath: 'src/a.ts',
          startLine: 1,
          endLine: 1,
          exported: true,
          declarationFingerprint: 'function:alpha:1',
        },
      ],
      byName: Object.create(null),
      byNameLower: Object.create(null),
      byFile: {
        'repo-a:src/a.ts': {
          fileId: 'repo-a:src/a.ts',
          repo: 'repo-a',
          filePath: 'src/a.ts',
          classification: 'source',
          symbolIds: ['repo-a:src/a.ts:function:alpha:1'],
          symbolNames: ['alpha'],
          imports: [],
          exports: [
            {
              fileId: 'repo-a:src/a.ts',
              kind: 'named',
              exportedName: 'alpha',
              localName: 'alpha',
              symbolId: 'repo-a:src/a.ts:function:alpha:1',
            },
          ],
          importTokens: [],
        },
      },
      stats: {
        globalByName: { alpha: 1 },
        globalByNameLower: { alpha: 1 },
        byRepo: { 'repo-a': { alpha: 1 } },
        exportedByName: { alpha: 1 },
        byKind: { function: { alpha: 1 } },
      },
    });

    await saveCodeGraph(graph);

    const loadedGraph = await loadCodeGraph();
    const loadedFromQuery = await getGraph();
    const fileNode = await getFileNode('repo-a:src/a.ts');
    const symbolNode = await getSymbolNode('repo-a:src/a.ts:function:alpha:1');
    const outgoing = await getOutgoingEdges('repo-a:src/a.ts', 'file_exports_symbol');
    const incoming = await getIncomingEdges('repo-a:src/a.ts:function:alpha:1', 'file_exports_symbol');

    expect(loadedGraph).toEqual(graph);
    expect(loadedFromQuery).toEqual(graph);
    expect(fileNode).toEqual(
      expect.objectContaining({
        nodeType: 'file',
        fileId: 'repo-a:src/a.ts',
      }),
    );
    expect(symbolNode).toEqual(
      expect.objectContaining({
        nodeType: 'symbol',
        symbolId: 'repo-a:src/a.ts:function:alpha:1',
      }),
    );
    expect(outgoing).toEqual([
      expect.objectContaining({
        type: 'file_exports_symbol',
        fromId: 'repo-a:src/a.ts',
        toId: 'repo-a:src/a.ts:function:alpha:1',
      }),
    ]);
    expect(incoming).toEqual([
      expect.objectContaining({
        type: 'file_exports_symbol',
        fromId: 'repo-a:src/a.ts',
        toId: 'repo-a:src/a.ts:function:alpha:1',
      }),
    ]);
  });

  it('builds the graph from the persisted symbol-index snapshot', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const reposRoot = path.join(tempRoot, 'repos');
    const repositoryRoot = path.join(reposRoot, 'persisted-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'alpha.ts'),
      [
        "import { beta } from './beta';",
        'export const alpha = beta;',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'beta.ts'),
      'export const beta = 1;',
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    await saveSymbolIndex(index);

    const graph = await buildCodeGraph();
    const alphaFileId = createFileId('persisted-repo', 'src/alpha.ts');
    const betaFileId = createFileId('persisted-repo', 'src/beta.ts');
    const alphaSymbolId = createSymbolId(alphaFileId, 'variable', 'alpha', 1);

    expect(graph.sourceSymbolIndexSchemaVersion).toBe(index.schemaVersion);
    expect(graph.nodes.files[alphaFileId]).toEqual(
      expect.objectContaining({
        fileId: alphaFileId,
        repoId: 'persisted-repo',
      }),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file_imports_file',
          fromId: alphaFileId,
          toId: betaFileId,
        }),
        expect.objectContaining({
          type: 'file_exports_symbol',
          fromId: alphaFileId,
          toId: alphaSymbolId,
        }),
      ]),
    );
  });

  it('returns higher-level file and symbol graph relationships', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const reposRoot = path.join(tempRoot, 'repos');
    const repositoryRoot = path.join(reposRoot, 'query-graph-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'shared.ts'),
      'export const shared = 1;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'barrel.ts'),
      "export { shared } from './shared';",
      'utf8',
    );
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
    const graph = await buildCodeGraph();
    await saveCodeGraph(graph);

    const sharedFileId = createFileId('query-graph-repo', 'src/shared.ts');
    const barrelFileId = createFileId('query-graph-repo', 'src/barrel.ts');
    const consumerFileId = createFileId('query-graph-repo', 'src/consumer.ts');
    const sharedSymbolId = createSymbolId(sharedFileId, 'variable', 'shared', 1);
    const consumerSymbolId = createSymbolId(consumerFileId, 'variable', 'consumer', 1);

    expect(await getImportedFiles(consumerFileId)).toEqual([
      expect.objectContaining({ fileId: sharedFileId }),
    ]);
    expect(await getImportingFiles(sharedFileId)).toEqual([
      expect.objectContaining({ fileId: consumerFileId }),
    ]);
    expect(await getReexportedFiles(barrelFileId)).toEqual([
      expect.objectContaining({ fileId: sharedFileId }),
    ]);
    expect(await getReexportingFiles(sharedFileId)).toEqual([
      expect.objectContaining({ fileId: barrelFileId }),
    ]);
    expect(await getNeighboringFiles(sharedFileId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileId: consumerFileId }),
        expect.objectContaining({ fileId: barrelFileId }),
      ]),
    );
    expect(await getDefinedSymbols(sharedFileId)).toEqual([
      expect.objectContaining({ symbolId: sharedSymbolId }),
    ]);
    expect(await getExportedSymbols(sharedFileId)).toEqual([
      expect.objectContaining({ symbolId: sharedSymbolId }),
    ]);
    expect(await getDefinedSymbols(consumerFileId)).toEqual([
      expect.objectContaining({ symbolId: consumerSymbolId }),
    ]);
    expect(await getExportedSymbols(consumerFileId)).toEqual([
      expect.objectContaining({ symbolId: consumerSymbolId }),
    ]);
    expect(await getSymbolFile(sharedSymbolId)).toEqual(
      expect.objectContaining({ fileId: sharedFileId }),
    );
    expect(await getRepoFiles('query-graph-repo')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileId: sharedFileId }),
        expect.objectContaining({ fileId: barrelFileId }),
        expect.objectContaining({ fileId: consumerFileId }),
      ]),
    );
    expect(await getFileRepo(sharedFileId)).toEqual(
      expect.objectContaining({ repoId: 'query-graph-repo' }),
    );
    expect(await getRelatedFiles(sharedFileId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: expect.objectContaining({ fileId: consumerFileId }),
          via: 'file_imports_file',
        }),
        expect.objectContaining({
          file: expect.objectContaining({ fileId: barrelFileId }),
          via: 'file_reexports_file',
        }),
      ]),
    );
  });

  it('returns safe empty results for missing nodes', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);
    await saveCodeGraph(await loadCodeGraph());

    expect(await getImportedFiles('missing-file')).toEqual([]);
    expect(await getImportingFiles('missing-file')).toEqual([]);
    expect(await getReexportedFiles('missing-file')).toEqual([]);
    expect(await getReexportingFiles('missing-file')).toEqual([]);
    expect(await getNeighboringFiles('missing-file')).toEqual([]);
    expect(await getDefinedSymbols('missing-file')).toEqual([]);
    expect(await getExportedSymbols('missing-file')).toEqual([]);
    expect(await getSymbolFile('missing-symbol')).toBeNull();
    expect(await getRepoFiles('missing-repo')).toEqual([]);
    expect(await getFileRepo('missing-file')).toBeNull();
    expect(await getRelatedFiles('missing-file')).toEqual([]);
  });
});
