import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCodeGraph } from '../../src/graph/build-graph.js';
import { assembleFileContext, assembleRelatedFileContext, assembleSymbolContext } from '../../src/context/index.js';
import { createFileId, createSymbolId } from '../../src/symbol-index/ids.js';
import { buildIndexedSymbols } from '../../src/symbol-index/build-index.js';
import { saveCodeGraph } from '../../src/graph/store.js';
import { buildSemanticGraph } from '../../src/graph/build-semantic-graph.js';
import { saveSemanticGraph } from '../../src/graph/semantic-store.js';
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
    expect(bundle.relatedFileBuckets.directConsumers.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: expect.objectContaining({ fileId: consumerFileId }),
          via: expect.arrayContaining(['import_usage']),
        }),
      ]),
    );
    expect(bundle.relatedFileBuckets.indirectConsumers.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: expect.objectContaining({ fileId: barrelFileId }),
        }),
      ]),
    );
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

  it('surfaces api-mediated hook consumers as inferred related files', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const reposRoot = path.join(tempRoot, 'repos');
    const repositoryRoot = path.join(reposRoot, 'api-context-repo');
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
    await saveCodeGraph(await buildCodeGraph());
    await saveSemanticGraph(await buildSemanticGraph(index, [
      {
        id: 'api-context-repo',
        name: 'api-context-repo',
        rootPath: repositoryRoot,
        isGitRepository: true,
      },
    ]));

    const bundle = await assembleSymbolContext({
      name: 'getAutomations',
      repo: 'api-context-repo',
    });

    expect(bundle.primarySymbol).toEqual(
      expect.objectContaining({
        filePath: 'lib/services/automations.ts',
      }),
    );
    expect(bundle.relatedFileBuckets.directConsumers.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: expect.objectContaining({ filePath: 'app/api/automations/route.ts' }),
        }),
      ]),
    );
    expect(bundle.relatedFileBuckets.indirectConsumers.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: expect.objectContaining({ filePath: 'lib/hooks/useAutomationsQuery.ts' }),
          via: expect.arrayContaining(['api_client_to_route', 'api_propagation']),
        }),
      ]),
    );
    expect(bundle.relatedFileBuckets.directConsumers.entries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: expect.objectContaining({ filePath: 'lib/hooks/useAutomationsQuery.ts' }),
        }),
      ]),
    );
  });

  it('keeps API-only consumers indirect when no exact import-usage evidence exists', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const reposRoot = path.join(tempRoot, 'repos');
    const repositoryRoot = path.join(reposRoot, 'api-only-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'lib', 'services'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'lib', 'hooks'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'app', 'api', 'widgets'), { recursive: true });
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
      path.join(repositoryRoot, 'lib', 'services', 'widgets.ts'),
      ['export async function listWidgets() {', '  return [];', '}'].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'app', 'api', 'widgets', 'route.ts'),
      [
        "import { listWidgets } from '../../../lib/services/widgets';",
        'export async function GET() {',
        '  return Response.json(await listWidgets());',
        '}',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'lib', 'hooks', 'useWidgets.ts'),
      ['export async function useWidgets() {', "  return fetch('/api/widgets');", '}'].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    await saveSymbolIndex(index);
    await saveCodeGraph(await buildCodeGraph());
    await saveSemanticGraph(await buildSemanticGraph(index, [
      {
        id: 'api-only-repo',
        name: 'api-only-repo',
        rootPath: repositoryRoot,
        isGitRepository: true,
      },
    ]));

    const bundle = await assembleSymbolContext({
      name: 'listWidgets',
      repo: 'api-only-repo',
    });

    expect(bundle.relatedFileBuckets.indirectConsumers.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: expect.objectContaining({ filePath: 'lib/hooks/useWidgets.ts' }),
          via: expect.arrayContaining(['api_client_to_route', 'api_propagation']),
        }),
      ]),
    );
    expect(bundle.relatedFileBuckets.directConsumers.entries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: expect.objectContaining({ filePath: 'lib/hooks/useWidgets.ts' }),
        }),
      ]),
    );
  });

  it('applies exploration budgets after prioritizing stronger symbol edges', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const reposRoot = path.join(tempRoot, 'repos');
    const repositoryRoot = path.join(reposRoot, 'budget-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(repositoryRoot, 'src', 'shared.ts'), 'export const shared = 1;', 'utf8');
    await fs.writeFile(path.join(repositoryRoot, 'src', 'barrel.ts'), "export { shared } from './shared';", 'utf8');
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.ts'),
      [
        "import { shared } from './shared';",
        'export function useShared() {',
        '  return shared;',
        '}',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);
    await saveSymbolIndex(index);
    await saveCodeGraph(await buildCodeGraph());

    const sharedFileId = createFileId('budget-repo', 'src/shared.ts');
    const consumerFileId = createFileId('budget-repo', 'src/consumer.ts');

    const related = await assembleRelatedFileContext(sharedFileId, {
      relatedLimit: 1,
      explorationBudget: {
        maxNodes: 1,
        maxEdges: 8,
        maxDepth: 2,
      },
      referenceSignalsByFileId: {
        [consumerFileId]: {
          kinds: ['call_reference'],
          connectionCount: 1,
        },
      },
    });

    expect(related.totalCount).toBe(2);
    expect(related.items).toEqual([
      expect.objectContaining({
        file: expect.objectContaining({ filePath: 'src/consumer.ts' }),
        via: expect.arrayContaining(['call_reference']),
      }),
    ]);
    expect(related.buckets.directConsumers.entries).toEqual([
      expect.objectContaining({
        file: expect.objectContaining({ filePath: 'src/consumer.ts' }),
      }),
    ]);
  });

  it('stops broad weak related-file expansion once strong evidence is already available', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const reposRoot = path.join(tempRoot, 'repos');
    const repositoryRoot = path.join(reposRoot, 'pruned-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(repositoryRoot, 'src', 'shared.ts'), 'export const shared = 1;', 'utf8');
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'consumer.ts'),
      [
        "import { shared } from './shared';",
        'export const consumer = shared;',
      ].join('\n'),
      'utf8',
    );

    for (const name of ['barrel-a', 'barrel-b', 'barrel-c', 'barrel-d']) {
      await fs.writeFile(
        path.join(repositoryRoot, 'src', `${name}.ts`),
        `export { shared } from './shared';`,
        'utf8',
      );
    }

    const index = await buildIndexedSymbols(reposRoot);
    await saveSymbolIndex(index);
    await saveCodeGraph(await buildCodeGraph());

    const sharedFileId = createFileId('pruned-repo', 'src/shared.ts');
    const consumerFileId = createFileId('pruned-repo', 'src/consumer.ts');

    const related = await assembleRelatedFileContext(sharedFileId, {
      relatedLimit: 2,
      symbolContextBudget: {
        strongEvidenceThreshold: 1,
        maxRelatedFiles: 4,
        maxWeakExpansions: 0,
        maxCandidateSymbols: 8,
        maxDirectConsumerEdges: 4,
        maxIndirectConsumerEdges: 2,
      },
      referenceSignalsByFileId: {
        [consumerFileId]: {
          kinds: ['call_reference'],
          connectionCount: 1,
        },
      },
    });

    expect(related.totalCount).toBe(1);
    expect(related.buckets.directConsumers.entries).toEqual([
      expect.objectContaining({
        file: expect.objectContaining({ filePath: 'src/consumer.ts' }),
      }),
    ]);
    expect(related.buckets.relatedContext.entries).toEqual([]);
  });

  it('caps symbol-context candidates early without losing the strongest repo match', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const reposRoot = path.join(tempRoot, 'repos');
    const repositoryRoot = path.join(reposRoot, 'candidate-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });

    await fs.writeFile(path.join(repositoryRoot, 'src', 'preferred.ts'), 'export function AppRouter() {}', 'utf8');

    for (let indexValue = 0; indexValue < 8; indexValue += 1) {
      await fs.writeFile(
        path.join(repositoryRoot, 'src', `duplicate-${indexValue}.ts`),
        `function AppRouter() { return ${indexValue}; }`,
        'utf8',
      );
    }

    const index = await buildIndexedSymbols(reposRoot);
    await saveSymbolIndex(index);
    await saveCodeGraph(await buildCodeGraph());

    const bundle = await assembleSymbolContext({
      name: 'AppRouter',
      repo: 'candidate-repo',
      symbolContextBudget: {
        maxCandidateSymbols: 3,
        maxDirectConsumerEdges: 4,
        maxIndirectConsumerEdges: 2,
        maxRelatedFiles: 4,
        maxWeakExpansions: 1,
        strongEvidenceThreshold: 2,
      },
    });

    expect(bundle.totalRankedSymbols).toBe(3);
    expect(bundle.primarySymbol).toEqual(
      expect.objectContaining({
        filePath: 'src/preferred.ts',
        exported: true,
      }),
    );
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
      relatedFileBuckets: expect.objectContaining({
        directConsumers: expect.objectContaining({ total: 0, shown: 0, truncated: false, entries: [] }),
        indirectConsumers: expect.objectContaining({ total: 0, shown: 0, truncated: false, entries: [] }),
        relatedContext: expect.objectContaining({ total: 0, shown: 0, truncated: false, entries: [] }),
      }),
      definedSymbols: [],
      exportedSymbols: [],
    });
    expect(missingRelatedContext).toEqual({
      items: [],
      totalCount: 0,
      buckets: expect.objectContaining({
        directConsumers: expect.objectContaining({ total: 0, shown: 0, truncated: false, entries: [] }),
        indirectConsumers: expect.objectContaining({ total: 0, shown: 0, truncated: false, entries: [] }),
        relatedContext: expect.objectContaining({ total: 0, shown: 0, truncated: false, entries: [] }),
      }),
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
      relatedFileBuckets: expect.objectContaining({
        directConsumers: expect.objectContaining({ total: 0, shown: 0, truncated: false, entries: [] }),
        indirectConsumers: expect.objectContaining({ total: 0, shown: 0, truncated: false, entries: [] }),
        relatedContext: expect.objectContaining({ total: 0, shown: 0, truncated: false, entries: [] }),
      }),
      exportedSymbols: [],
    });
  });
});
