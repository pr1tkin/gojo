import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildCodeGraphFromSymbolIndex } from '../../src/graph/build-graph.js';
import { loadRepoResolutionConfigs } from '../../src/graph/repo-config.js';
import { createFileId, createSymbolId, createSyntheticDefaultExportSymbolId } from '../../src/symbol-index/ids.js';
import { buildIndexedSymbols } from '../../src/symbol-index/build-index.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-graph-build-test-'));
}

async function loadGraphRepoConfigs(reposRoot: string, ...repoIds: string[]) {
  return loadRepoResolutionConfigs(
    Object.fromEntries(repoIds.map((repoId) => [repoId, path.join(reposRoot, repoId)])),
  );
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

  it('creates file export edges for anonymous default exports through their synthetic symbol identity', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'default-export-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'widget.jsx'),
      'export default () => <div />;',
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const graph = buildCodeGraphFromSymbolIndex(index);
    const fileId = createFileId('default-export-repo', 'src/widget.jsx');
    const symbolId = createSyntheticDefaultExportSymbolId(fileId);

    expect(graph.nodes.symbols[symbolId]).toEqual(
      expect.objectContaining({
        nodeType: 'symbol',
        symbolId,
        fileId,
        exported: true,
      }),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file_defines_symbol',
          fromId: fileId,
          toId: symbolId,
        }),
        expect.objectContaining({
          type: 'file_exports_symbol',
          fromId: fileId,
          toId: symbolId,
          metadata: expect.objectContaining({
            symbolId,
            exportedName: 'default',
          }),
        }),
      ]),
    );
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

  it('resolves extensionless local imports to js and jsx files when exactly one target exists', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'js-extensionless-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'foo.js'),
      'export const foo = 1;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'Bar.jsx'),
      'export const Bar = () => <div />;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.js'),
      [
        "import { foo } from './foo';",
        "import { Bar } from './Bar';",
        'export const consumer = [foo, Bar];',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const graph = buildCodeGraphFromSymbolIndex(index);
    const consumerFileId = createFileId('js-extensionless-repo', 'src/consumer.js');

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file_imports_file',
          fromId: consumerFileId,
          toId: createFileId('js-extensionless-repo', 'src/foo.js'),
          metadata: { source: './foo' },
        }),
        expect.objectContaining({
          type: 'file_imports_file',
          fromId: consumerFileId,
          toId: createFileId('js-extensionless-repo', 'src/Bar.jsx'),
          metadata: { source: './Bar' },
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

  it('resolves tsconfig alias imports when a simple local mapping is configured', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'alias-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'shared'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['./src/*'],
          },
        },
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'shared', 'button.ts'),
      'export const button = 1;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.ts'),
      [
        "import { button } from '@/shared/button';",
        'export const consumer = button;',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const repoResolutionConfigsById = await loadGraphRepoConfigs(reposRoot, 'alias-repo');
    const graph = buildCodeGraphFromSymbolIndex(index, { repoResolutionConfigsById });

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file_imports_file',
          fromId: createFileId('alias-repo', 'src/consumer.ts'),
          toId: createFileId('alias-repo', 'src/shared/button.ts'),
          metadata: { source: '@/shared/button' },
        }),
      ]),
    );
  });

  it('resolves baseUrl-style local imports when they map to one indexed file', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'baseurl-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'components', 'card'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: './src',
        },
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'components', 'card', 'index.tsx'),
      'export const Card = () => null;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.ts'),
      [
        "import { Card } from 'components/card';",
        'export const consumer = Card;',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const repoResolutionConfigsById = await loadGraphRepoConfigs(reposRoot, 'baseurl-repo');
    const graph = buildCodeGraphFromSymbolIndex(index, { repoResolutionConfigsById });

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file_imports_file',
          fromId: createFileId('baseurl-repo', 'src/consumer.ts'),
          toId: createFileId('baseurl-repo', 'src/components/card/index.tsx'),
          metadata: { source: 'components/card' },
        }),
      ]),
    );
  });

  it('resolves repo-root baseUrl imports for components, utils, and lib paths', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'root-baseurl-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'components', 'admin', 'cleanup'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'utils', 'api'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'lib'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
        },
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'components', 'admin', 'cleanup', 'header.tsx'),
      'export const AdminCleanupHeader = () => null;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'utils', 'api', 'index.ts'),
      'export const api = 1;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'lib', 'session.ts'),
      'export const session = 1;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'pages.tsx'),
      [
        "import { AdminCleanupHeader } from 'components/admin/cleanup/header';",
        "import { api } from 'utils/api';",
        "import { session } from 'lib/session';",
        'export const page = [AdminCleanupHeader, api, session];',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const repoResolutionConfigsById = await loadGraphRepoConfigs(reposRoot, 'root-baseurl-repo');
    const graph = buildCodeGraphFromSymbolIndex(index, { repoResolutionConfigsById });
    const consumerFileId = createFileId('root-baseurl-repo', 'pages.tsx');

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file_imports_file',
          fromId: consumerFileId,
          toId: createFileId('root-baseurl-repo', 'components/admin/cleanup/header.tsx'),
          metadata: { source: 'components/admin/cleanup/header' },
        }),
        expect.objectContaining({
          type: 'file_imports_file',
          fromId: consumerFileId,
          toId: createFileId('root-baseurl-repo', 'utils/api/index.ts'),
          metadata: { source: 'utils/api' },
        }),
        expect.objectContaining({
          type: 'file_imports_file',
          fromId: consumerFileId,
          toId: createFileId('root-baseurl-repo', 'lib/session.ts'),
          metadata: { source: 'lib/session' },
        }),
      ]),
    );
  });

  it('resolves deterministic repo-root baseUrl reexports', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'root-baseurl-reexport-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'components', 'ui'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
        },
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'components', 'ui', 'Button.tsx'),
      'export const Button = () => null;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'index.ts'),
      "export { Button } from 'components/ui/Button';",
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const repoResolutionConfigsById = await loadGraphRepoConfigs(reposRoot, 'root-baseurl-reexport-repo');
    const graph = buildCodeGraphFromSymbolIndex(index, { repoResolutionConfigsById });

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file_reexports_file',
          fromId: createFileId('root-baseurl-reexport-repo', 'index.ts'),
          toId: createFileId('root-baseurl-reexport-repo', 'components/ui/Button.tsx'),
          metadata: {
            source: 'components/ui/Button',
            exportedName: 'Button',
            localName: 'Button',
          },
        }),
      ]),
    );
  });

  it('resolves alias reexports when the configured target is deterministic', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'alias-reexport-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'shared'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['./src/*'],
          },
        },
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'shared', 'button.tsx'),
      'export const Button = () => null;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'index.ts'),
      "export { Button } from '@/shared/button';",
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const repoResolutionConfigsById = await loadGraphRepoConfigs(reposRoot, 'alias-reexport-repo');
    const graph = buildCodeGraphFromSymbolIndex(index, { repoResolutionConfigsById });

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file_reexports_file',
          fromId: createFileId('alias-reexport-repo', 'src/index.ts'),
          toId: createFileId('alias-reexport-repo', 'src/shared/button.tsx'),
          metadata: {
            source: '@/shared/button',
            exportedName: 'Button',
            localName: 'Button',
          },
        }),
      ]),
    );
  });

  it('keeps package imports unresolved even when baseUrl exists', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'strict-package-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: './src',
        },
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.ts'),
      [
        "import React from 'react';",
        'export const consumer = React;',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const repoResolutionConfigsById = await loadGraphRepoConfigs(reposRoot, 'strict-package-repo');
    const graph = buildCodeGraphFromSymbolIndex(index, { repoResolutionConfigsById });
    const consumerFileId = createFileId('strict-package-repo', 'src/consumer.ts');

    expect(graph.edges.filter((edge) => edge.type === 'file_imports_file' && edge.fromId === consumerFileId)).toEqual(
      [],
    );
  });

  it('does not resolve missing repo-root baseUrl targets', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'missing-root-baseurl-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
        },
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'consumer.ts'),
      [
        "import { MissingHeader } from 'components/admin/cleanup/header';",
        'export const consumer = MissingHeader;',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const repoResolutionConfigsById = await loadGraphRepoConfigs(reposRoot, 'missing-root-baseurl-repo');
    const graph = buildCodeGraphFromSymbolIndex(index, { repoResolutionConfigsById });
    const consumerFileId = createFileId('missing-root-baseurl-repo', 'consumer.ts');

    expect(graph.edges.filter((edge) => edge.type === 'file_imports_file' && edge.fromId === consumerFileId)).toEqual(
      [],
    );
  });

  it('does not resolve ambiguous repo-root baseUrl candidates', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'ambiguous-root-baseurl-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'utils', 'api'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
        },
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'utils', 'api.ts'),
      'export const api = 1;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'utils', 'api', 'index.ts'),
      'export const apiIndex = 1;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'consumer.ts'),
      [
        "import { api } from 'utils/api';",
        'export const consumer = api;',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const repoResolutionConfigsById = await loadGraphRepoConfigs(reposRoot, 'ambiguous-root-baseurl-repo');
    const graph = buildCodeGraphFromSymbolIndex(index, { repoResolutionConfigsById });
    const consumerFileId = createFileId('ambiguous-root-baseurl-repo', 'consumer.ts');

    expect(graph.edges.filter((edge) => edge.type === 'file_imports_file' && edge.fromId === consumerFileId)).toEqual(
      [],
    );
  });

  it('does not resolve configured alias imports when the target is missing', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'missing-alias-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['./src/*'],
          },
        },
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.ts'),
      [
        "import { MissingThing } from '@/missing';",
        'export const consumer = MissingThing;',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const repoResolutionConfigsById = await loadGraphRepoConfigs(reposRoot, 'missing-alias-repo');
    const graph = buildCodeGraphFromSymbolIndex(index, { repoResolutionConfigsById });
    const consumerFileId = createFileId('missing-alias-repo', 'src/consumer.ts');

    expect(graph.edges.filter((edge) => edge.type === 'file_imports_file' && edge.fromId === consumerFileId)).toEqual(
      [],
    );
  });

  it('does not resolve configured imports when alias or baseUrl candidates are ambiguous', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'ambiguous-alias-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'shared'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['./src/*'],
          },
        },
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'shared.ts'),
      'export const shared = 1;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'shared', 'index.ts'),
      'export const sharedIndex = 1;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.ts'),
      [
        "import { shared } from '@/shared';",
        'export const consumer = shared;',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const repoResolutionConfigsById = await loadGraphRepoConfigs(reposRoot, 'ambiguous-alias-repo');
    const graph = buildCodeGraphFromSymbolIndex(index, { repoResolutionConfigsById });
    const consumerFileId = createFileId('ambiguous-alias-repo', 'src/consumer.ts');

    expect(graph.edges.filter((edge) => edge.type === 'file_imports_file' && edge.fromId === consumerFileId)).toEqual(
      [],
    );
  });

  it('does not guess through unsupported complex alias config', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'complex-alias-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src', 'shared'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['./src/*', './generated/*'],
          },
        },
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'shared', 'button.ts'),
      'export const button = 1;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.ts'),
      [
        "import { button } from '@/shared/button';",
        'export const consumer = button;',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    const repoResolutionConfigsById = await loadGraphRepoConfigs(reposRoot, 'complex-alias-repo');
    const graph = buildCodeGraphFromSymbolIndex(index, { repoResolutionConfigsById });
    const consumerFileId = createFileId('complex-alias-repo', 'src/consumer.ts');

    expect(graph.edges.filter((edge) => edge.type === 'file_imports_file' && edge.fromId === consumerFileId)).toEqual(
      [],
    );
  });
});
