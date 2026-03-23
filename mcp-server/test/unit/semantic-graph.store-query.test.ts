import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCodeGraph } from '../../src/graph/build-graph.js';
import { buildSemanticGraph } from '../../src/graph/build-semantic-graph.js';
import {
  getIncomingSemanticEdgesForSymbol,
  getSemanticConsumersForSymbol,
  getSemanticGraph,
} from '../../src/graph/query.js';
import { loadSemanticGraph, saveSemanticGraph } from '../../src/graph/semantic-store.js';
import { createFileId, createSymbolId } from '../../src/symbol-index/ids.js';
import { buildIndexedSymbols } from '../../src/symbol-index/build-index.js';
import { saveCodeGraph } from '../../src/graph/store.js';
import { saveSymbolIndex } from '../../src/symbol-index/store.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-semantic-graph-test-'));
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

describe('semantic graph store and query', () => {
  it('persists exact and inferred semantic edges with reusable query helpers', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const reposRoot = path.join(tempRoot, 'repos');
    const repositoryRoot = path.join(reposRoot, 'semantic-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'lib', 'services'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'lib', 'hooks'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'app', 'api', 'automations'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'preserve',
          allowJs: true,
          skipLibCheck: true,
        },
        include: ['**/*.ts', '**/*.tsx'],
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'lib', 'services', 'automations.ts'),
      [
        'export async function getAutomations() {',
        '  return [];',
        '}',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'app', 'api', 'automations', 'route.ts'),
      [
        "import { getAutomations } from '../../../lib/services/automations';",
        '',
        'export async function GET() {',
        '  return Response.json(await getAutomations());',
        '}',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'lib', 'hooks', 'useAutomationsQuery.ts'),
      [
        'export async function useAutomationsQuery() {',
        "  return fetch('/api/automations');",
        '}',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    await saveSymbolIndex(index);
    const graph = await buildCodeGraph();
    const semanticGraph = await buildSemanticGraph(index, [
      {
        id: 'semantic-repo',
        name: 'semantic-repo',
        rootPath: repositoryRoot,
        isGitRepository: true,
      },
    ]);

    await saveCodeGraph(graph);
    await saveSemanticGraph(semanticGraph);

    const serviceFileId = createFileId('semantic-repo', 'lib/services/automations.ts');
    const serviceSymbolId = createSymbolId(serviceFileId, 'function', 'getAutomations', 1);
    const loaded = await loadSemanticGraph();
    const loadedFromQuery = await getSemanticGraph();
    const exactConsumers = await getIncomingSemanticEdgesForSymbol(serviceSymbolId, { exactness: 'exact' });
    const inferredConsumers = await getSemanticConsumersForSymbol(serviceSymbolId, { exactness: 'inferred' });

    expect(loaded).toEqual(loadedFromQuery);
    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.sourceSymbolIndexSchemaVersion).toBe(index.schemaVersion);
    expect(loaded.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'api_route_handler',
          strength: 'strong',
          confidence: 'high',
          exactness: 'exact',
          metadata: expect.objectContaining({
            routeId: '/api/automations',
            routeFilePath: 'app/api/automations/route.ts',
          }),
        }),
        expect.objectContaining({
          kind: 'api_propagation',
          strength: 'medium',
          confidence: 'medium',
          exactness: 'inferred',
          metadata: expect.objectContaining({
            routeId: '/api/automations',
            routeFilePath: 'app/api/automations/route.ts',
          }),
        }),
      ]),
    );
    expect(exactConsumers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromFile: expect.objectContaining({ filePath: 'app/api/automations/route.ts' }),
          edge: expect.objectContaining({ kind: 'api_route_handler', exactness: 'exact' }),
        }),
      ]),
    );
    expect(inferredConsumers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromFile: expect.objectContaining({ filePath: 'lib/hooks/useAutomationsQuery.ts' }),
          edge: expect.objectContaining({ kind: 'api_propagation', exactness: 'inferred' }),
        }),
      ]),
    );
  });

  it('replaces stale semantic graph snapshots deterministically on save', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await saveSemanticGraph({
      schemaVersion: 1,
      sourceSymbolIndexSchemaVersion: 1,
      generatedAt: '2026-03-23T00:00:00.000Z',
      edges: [
        {
          edgeId: 'stale-edge',
          kind: 'symbol_reference',
          strength: 'weak',
          confidence: 'low',
          exactness: 'exploratory',
          fromFileId: 'stale:src/a.ts',
          toFileId: 'stale:src/b.ts',
        },
      ],
    });
    await saveSemanticGraph({
      schemaVersion: 1,
      sourceSymbolIndexSchemaVersion: 4,
      generatedAt: '2026-03-23T01:00:00.000Z',
      edges: [],
    });

    expect(await loadSemanticGraph()).toEqual({
      schemaVersion: 1,
      sourceSymbolIndexSchemaVersion: 4,
      generatedAt: '2026-03-23T01:00:00.000Z',
      edges: [],
    });
  });
});
