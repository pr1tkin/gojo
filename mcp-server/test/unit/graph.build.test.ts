import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildCodeGraphFromSymbolIndex } from '../../src/graph/build-graph.js';
import { createFileId, createSymbolId } from '../../src/symbol-index/ids.js';
import { buildIndexedSymbols } from '../../src/symbol-index/build-index.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-graph-build-test-'));
}

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('buildCodeGraphFromSymbolIndex', () => {
  it('creates repo, file, and symbol nodes plus deterministic ownership edges', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'graph-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'alpha.ts'),
      'export function alpha(): void {}',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.ts'),
      [
        "import { alpha } from './alpha';",
        'export const consumer = alpha;',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const graph = buildCodeGraphFromSymbolIndex(index);
    const alphaFileId = createFileId('graph-repo', 'src/alpha.ts');
    const consumerFileId = createFileId('graph-repo', 'src/consumer.ts');
    const alphaSymbolId = createSymbolId(alphaFileId, 'function', 'alpha', 1);
    const consumerSymbolId = createSymbolId(consumerFileId, 'variable', 'consumer', 1);

    expect(graph.schemaVersion).toBe(1);
    expect(graph.sourceSymbolIndexSchemaVersion).toBe(index.schemaVersion);
    expect(graph.nodes.repos['graph-repo']).toEqual(
      expect.objectContaining({
        nodeType: 'repo',
        repoId: 'graph-repo',
      }),
    );
    expect(graph.nodes.files[alphaFileId]).toEqual(
      expect.objectContaining({
        nodeType: 'file',
        fileId: alphaFileId,
        repoId: 'graph-repo',
      }),
    );
    expect(graph.nodes.symbols[alphaSymbolId]).toEqual(
      expect.objectContaining({
        nodeType: 'symbol',
        symbolId: alphaSymbolId,
        fileId: alphaFileId,
        name: 'alpha',
      }),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'repo_contains_file',
          fromId: 'graph-repo',
          toId: alphaFileId,
        }),
        expect.objectContaining({
          type: 'repo_contains_file',
          fromId: 'graph-repo',
          toId: consumerFileId,
        }),
        expect.objectContaining({
          type: 'file_defines_symbol',
          fromId: alphaFileId,
          toId: alphaSymbolId,
        }),
        expect.objectContaining({
          type: 'file_defines_symbol',
          fromId: consumerFileId,
          toId: consumerSymbolId,
        }),
        expect.objectContaining({
          type: 'file_exports_symbol',
          fromId: alphaFileId,
          toId: alphaSymbolId,
        }),
        expect.objectContaining({
          type: 'file_exports_symbol',
          fromId: consumerFileId,
          toId: consumerSymbolId,
        }),
        expect.objectContaining({
          type: 'file_imports_file',
          fromId: consumerFileId,
          toId: alphaFileId,
          metadata: {
            source: './alpha',
          },
        }),
      ]),
    );
  });

  it('does not create guessed local-file edges for package or ambiguous imports', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'ambiguous-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'shared'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'shared.ts'),
      'export function shared(): void {}',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'shared', 'index.ts'),
      'export function sharedIndex(): void {}',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.ts'),
      [
        "import React from 'react';",
        "import { shared } from './shared';",
        'export const consumer = shared;',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const graph = buildCodeGraphFromSymbolIndex(index);
    const consumerFileId = createFileId('ambiguous-repo', 'src/consumer.ts');
    const importEdges = graph.edges.filter(
      (edge) => edge.type === 'file_imports_file' && edge.fromId === consumerFileId,
    );

    expect(importEdges).toEqual([]);
  });

  it('creates deterministic local reexport edges only when the target is resolvable', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'reexport-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'alpha.ts'),
      'export function alpha(): void {}',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'index.ts'),
      "export { alpha } from './alpha';",
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const graph = buildCodeGraphFromSymbolIndex(index);
    const indexFileId = createFileId('reexport-repo', 'src/index.ts');
    const alphaFileId = createFileId('reexport-repo', 'src/alpha.ts');

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file_reexports_file',
          fromId: indexFileId,
          toId: alphaFileId,
          metadata: {
            source: './alpha',
            exportedName: 'alpha',
            localName: 'alpha',
          },
        }),
      ]),
    );
  });

  it('resolves extensionless local imports to ts and tsx files when exactly one target exists', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'extensionless-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'foo.ts'),
      'export const foo = 1;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'bar.tsx'),
      'export const Bar = () => null;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.ts'),
      [
        "import { foo } from './foo';",
        "import { Bar } from './bar';",
        'export const consumer = [foo, Bar];',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const graph = buildCodeGraphFromSymbolIndex(index);
    const consumerFileId = createFileId('extensionless-repo', 'src/consumer.ts');

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file_imports_file',
          fromId: consumerFileId,
          toId: createFileId('extensionless-repo', 'src/foo.ts'),
          metadata: { source: './foo' },
        }),
        expect.objectContaining({
          type: 'file_imports_file',
          fromId: consumerFileId,
          toId: createFileId('extensionless-repo', 'src/bar.tsx'),
          metadata: { source: './bar' },
        }),
      ]),
    );
  });

  it('resolves index-file conventions when they produce a single local target', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'index-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'widgets'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'panels'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'widgets', 'index.ts'),
      'export const widget = 1;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'panels', 'index.tsx'),
      'export const Panel = () => null;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.ts'),
      [
        "import { widget } from './widgets';",
        "import { Panel } from './panels';",
        'export const consumer = [widget, Panel];',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const graph = buildCodeGraphFromSymbolIndex(index);
    const consumerFileId = createFileId('index-repo', 'src/consumer.ts');

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file_imports_file',
          fromId: consumerFileId,
          toId: createFileId('index-repo', 'src/widgets/index.ts'),
          metadata: { source: './widgets' },
        }),
        expect.objectContaining({
          type: 'file_imports_file',
          fromId: consumerFileId,
          toId: createFileId('index-repo', 'src/panels/index.tsx'),
          metadata: { source: './panels' },
        }),
      ]),
    );
  });

  it('resolves parent-directory local imports across folders', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'nested-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'shared'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'features'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'shared', 'button.ts'),
      'export const button = 1;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'features', 'consumer.ts'),
      [
        "import { button } from '../shared/button';",
        'export const consumer = button;',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const graph = buildCodeGraphFromSymbolIndex(index);

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file_imports_file',
          fromId: createFileId('nested-repo', 'src/features/consumer.ts'),
          toId: createFileId('nested-repo', 'src/shared/button.ts'),
          metadata: { source: '../shared/button' },
        }),
      ]),
    );
  });

  it('does not resolve alias or missing imports to local file edges', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'strict-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.ts'),
      [
        "import { AliasThing } from '@/shared/button';",
        "import { MissingThing } from './missing';",
        'export const consumer = [AliasThing, MissingThing];',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const graph = buildCodeGraphFromSymbolIndex(index);
    const consumerFileId = createFileId('strict-repo', 'src/consumer.ts');
    const importEdges = graph.edges.filter(
      (edge) => edge.type === 'file_imports_file' && edge.fromId === consumerFileId,
    );

    expect(importEdges).toEqual([]);
  });
});
