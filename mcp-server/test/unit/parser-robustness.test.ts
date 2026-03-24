import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { extractSymbolsFromSourceMock } = vi.hoisted(() => ({
  extractSymbolsFromSourceMock: vi.fn(),
}));

vi.mock('../../src/symbols.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/symbols.js')>('../../src/symbols.js');

  return {
    ...actual,
    extractSymbolsFromSource: extractSymbolsFromSourceMock,
  };
});

import {
  saveSearchRefreshSnapshot,
  loadCurrentGenerationState,
} from '../../src/indexing/generation-store.js';
import { buildSemanticGraph } from '../../src/graph/build-semantic-graph.js';
import { runCurrentGenerationConsistencyMaintenance } from '../../src/indexing/consistency.js';
import { getCurrentIndexHealth } from '../../src/indexing/health.js';
import { refreshIndexes } from '../../src/indexing/refresh.js';
import { buildPatternIndexWithOptions } from '../../src/patterns/build-index.js';
import { buildIndexedSymbolsWithCoverage } from '../../src/symbol-index/build-index.js';
import { createFileId } from '../../src/symbol-index/ids.js';
import * as treeSitterModule from '../../src/tree-sitter.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-parser-robustness-test-'));
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

const tempDirectories: string[] = [];
const originalCwd = process.cwd();
const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

beforeEach(async () => {
  process.chdir(originalCwd);
  vi.clearAllMocks();

  const actual = await vi.importActual<typeof import('../../src/symbols.js')>('../../src/symbols.js');
  extractSymbolsFromSourceMock.mockImplementation(actual.extractSymbolsFromSource);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe.sequential('parser robustness', () => {
  it('isolates single-file parser failures and keeps a partial file relation', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/good.ts',
      'export function alpha(): string { return "a"; }',
    );
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/bad.ts',
      [
        "import { alpha } from './good';",
        'export const beta = alpha();',
      ].join('\n'),
    );

    extractSymbolsFromSourceMock.mockImplementation((source: string, filePath: string, symbolIdentityFilePath?: string) => {
      if (symbolIdentityFilePath === 'src/bad.ts') {
        throw new Error('Invalid argument');
      }

      return [
        {
          name: 'alpha',
          kind: 'function',
          filePath,
          startLine: 1,
          endLine: 1,
        },
      ];
    });

    const result = await buildIndexedSymbolsWithCoverage(reposRoot);
    const badFileId = createFileId('app-repo', 'src/bad.ts');

    expect(result.index.symbols).toEqual([
      expect.objectContaining({
        filePath: 'src/good.ts',
        name: 'alpha',
      }),
    ]);
    expect(result.index.byFile[badFileId]).toEqual(
      expect.objectContaining({
        fileId: badFileId,
        filePath: 'src/bad.ts',
        coverage: 'partial',
        imports: [
          expect.objectContaining({
            source: './good',
          }),
        ],
      }),
    );
    expect(result.coverage.partialFiles).toBe(1);
    expect(result.coverage.fullyIndexedFiles).toBe(1);
    expect(result.coverage.trustImpact).toBe('degraded');
    expect(result.coverage.issueCounts.parserFailures).toBe(1);
    expect(result.coverage.issues).toEqual([
      expect.objectContaining({
        filePath: 'src/bad.ts',
        stage: 'symbol_extraction',
        disposition: 'partial',
        source: 'parser',
        reason: 'Invalid argument',
      }),
    ]);
  });

  it('explicitly skips low-value generated or tooling files without aborting indexing', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/good.ts',
      'export function alpha(): string { return "a"; }',
    );
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'bench/ignored.ts',
      'export function ignoredBenchmark(): void {}',
    );

    const result = await buildIndexedSymbolsWithCoverage(reposRoot);

    expect(Object.keys(result.index.byFile)).toEqual([createFileId('app-repo', 'src/good.ts')]);
    expect(result.coverage.skippedFiles).toBe(1);
    expect(result.coverage.issueCounts.policySkipped).toBe(1);
    expect(result.coverage.trustImpact).toBe('none');
    expect(result.coverage.issues).toEqual([
      expect.objectContaining({
        filePath: 'bench/ignored.ts',
        disposition: 'skipped',
        source: 'policy',
      }),
    ]);
  });

  it('publishes a generation and degrades health when parser failures force partial coverage', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/good.ts',
      'export function alpha(): string { return "a"; }',
    );
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/bad.ts',
      'export const beta = alpha();',
    );

    extractSymbolsFromSourceMock.mockImplementation((source: string, filePath: string, symbolIdentityFilePath?: string) => {
      if (symbolIdentityFilePath === 'src/bad.ts') {
        throw new Error('Invalid argument');
      }

      return [
        {
          name: 'alpha',
          kind: 'function',
          filePath,
          startLine: 1,
          endLine: 1,
        },
      ];
    });

    const refreshResult = await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'never' });
    const state = await loadCurrentGenerationState();

    if (!state) {
      throw new Error('expected a current generation');
    }

    await saveSearchRefreshSnapshot({
      schemaVersion: 1,
      fingerprintContractVersion: 1,
      snapshotId: 'parser-robustness-ready',
      status: 'ready',
      refreshedAt: new Date().toISOString(),
      aggregateFingerprint: state.search.aggregateFingerprint,
      repoFingerprints: state.search.repoFingerprints,
      details: 'test search snapshot ready',
    });

    const health = await getCurrentIndexHealth();

    expect(refreshResult.diagnostics.status).toBe('committed');
    expect(state.indexingCoverage).toEqual(
      expect.objectContaining({
        partialFiles: 1,
        fullyIndexedFiles: 1,
        trustImpact: 'degraded',
      }),
    );
    expect(health.generationStatus).toBe('ready');
    expect(health.indexingCoverage?.partialFiles).toBe(1);
    expect(health.trustState).toBe('degraded');
    expect(health.reasons.join(' ')).toContain('partial indexing coverage');
  });

  it('does not mark policy-skipped high-risk files as missing pattern corruption during consistency maintenance', async () => {
    const tempRoot = await createTempDirectory();
    const reposRoot = path.join(tempRoot, 'repos');
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/good.ts',
      'export function alpha(): string { return "a"; }',
    );
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'bench/ignored.ts',
      'export function ignoredBenchmark(): void {}',
    );

    await refreshIndexes(reposRoot, { logger: silentLogger, runConsistencyChecks: 'always' });
    const report = await runCurrentGenerationConsistencyMaintenance({
      logger: silentLogger,
      applyRepairs: false,
    });
    const structuralCheck = report?.checks.find((check) => check.checkId === 'structure-missing-records');

    expect(structuralCheck?.details.join(' ')).not.toContain('no pattern artifacts were published for the file');
  });

  it('isolates parser failures in pattern extraction without aborting the stage', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    await ensureRepository(reposRoot, 'app-repo');
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/good.tsx',
      'export function Good() { return <section />; }',
    );
    await writeRepositoryFile(
      reposRoot,
      'app-repo',
      'src/bad.tsx',
      'export function Bad() { return <div />; }',
    );

    const index = await buildIndexedSymbolsWithCoverage(reposRoot);
    const issues: Array<{ filePath: string; stage: string; reason: string }> = [];
    const actualParse = treeSitterModule.parseTypeScriptSource;
    const parseSpy = vi.spyOn(treeSitterModule, 'parseTypeScriptSource').mockImplementation((filePath, source) => {
      if (filePath === 'src/bad.tsx') {
        throw new Error('Invalid argument');
      }

      return actualParse(filePath, source);
    });

    try {
      const patternIndex = await buildPatternIndexWithOptions(reposRoot, index.index, {
        onIssue: (issue) => issues.push({
          filePath: issue.filePath,
          stage: issue.stage,
          reason: issue.reason,
        }),
      });

      expect(patternIndex.patterns.some((pattern) => pattern.fileId === createFileId('app-repo', 'src/good.tsx'))).toBe(true);
      expect(patternIndex.patterns.some((pattern) => pattern.fileId === createFileId('app-repo', 'src/bad.tsx'))).toBe(false);
      expect(issues).toEqual([
        expect.objectContaining({
          filePath: 'src/bad.tsx',
          stage: 'pattern_extraction',
          reason: 'Invalid argument',
        }),
      ]);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('bounds semantic graph materialization for very large repositories instead of exhausting memory', async () => {
    const largeByFile = Object.fromEntries(
      Array.from({ length: 12001 }, (_, index) => {
        const filePath = `src/file-${index}.ts`;
        const fileId = createFileId('large-repo', filePath);

        return [
          fileId,
          {
            fileId,
            repo: 'large-repo',
            filePath,
            classification: 'source' as const,
            coverage: 'full' as const,
            symbolIds: [],
            symbolNames: [],
            imports: [],
            exports: [],
            importTokens: [],
          },
        ];
      }),
    );
    const issues: Array<{ stage: string; disposition: string; source: string; reason: string }> = [];

    const semanticGraph = await buildSemanticGraph(
      {
        schemaVersion: 4,
        symbols: [
          {
            symbolId: 'large-repo:src/root.ts:function:root:1',
            fileId: createFileId('large-repo', 'src/root.ts'),
            name: 'root',
            kind: 'function',
            repo: 'large-repo',
            filePath: 'src/root.ts',
            startLine: 1,
            endLine: 1,
            exported: true,
          },
        ],
        byName: Object.create(null),
        byNameLower: Object.create(null),
        byFile: largeByFile,
        stats: {
          globalByName: Object.create(null),
          globalByNameLower: Object.create(null),
          byRepo: Object.create(null),
          exportedByName: Object.create(null),
          byKind: Object.create(null),
        },
      },
      [
        {
          id: 'large-repo',
          name: 'large-repo',
          rootPath: '/tmp/large-repo',
          isGitRepository: true,
        },
      ],
      {
        onIssue: (issue) =>
          issues.push({
            stage: issue.stage,
            disposition: issue.disposition,
            source: issue.source,
            reason: issue.reason,
          }),
      },
    );

    expect(semanticGraph.edges).toEqual([]);
    expect(issues).toEqual([
      expect.objectContaining({
        stage: 'semantic_graph',
        disposition: 'partial',
        source: 'policy',
      }),
    ]);
  });
});
