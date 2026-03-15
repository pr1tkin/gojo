import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildIndexedSymbols } from '../../src/symbol-index/build-index.js';
import { createFileId, createSymbolId } from '../../src/symbol-index/ids.js';
import { findSymbol, getFileRelation } from '../../src/symbol-index/query.js';
import { loadSymbolIndex, saveSymbolIndex } from '../../src/symbol-index/store.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-symbol-index-store-test-'));
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

describe('symbol-index store and query', () => {
  it('persists ids and resolves file relations from repo plus path', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    const reposRoot = path.join(tempRoot, 'repos');
    const repositoryRoot = path.join(reposRoot, 'query-repo');
    process.chdir(tempRoot);

    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'query.ts'),
      [
        "import { helper } from './helper';",
        'export function lookup(): void {',
        '  helper();',
        '}',
      ].join('\n'),
      'utf8',
    );

    const builtIndex = await buildIndexedSymbols(reposRoot);
    await saveSymbolIndex(builtIndex);

    const loadedIndex = await loadSymbolIndex();
    const fileId = createFileId('query-repo', 'src/query.ts');

    expect(loadedIndex.schemaVersion).toBe(3);
    expect(loadedIndex.byFile[fileId]).toEqual(
      expect.objectContaining({
        fileId,
        repo: 'query-repo',
        filePath: 'src/query.ts',
        classification: 'source',
        symbolNames: ['lookup'],
        importTokens: ['./helper', 'helper'],
      }),
    );
    expect(loadedIndex.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolId: createSymbolId(fileId, 'function', 'lookup', 1),
          fileId,
          declarationFingerprint: 'function:lookup:1',
        }),
      ]),
    );

    const matches = await findSymbol('lookup', 'function', 'query-repo');
    const relation = await getFileRelation('src/query.ts', 'query-repo');

    expect(matches).toEqual([
      expect.objectContaining({
        symbolId: createSymbolId(fileId, 'function', 'lookup', 1),
        fileId,
        repo: 'query-repo',
        filePath: 'src/query.ts',
      }),
    ]);
    expect(relation).toEqual(
      expect.objectContaining({
        fileId,
        repo: 'query-repo',
        filePath: 'src/query.ts',
        classification: 'source',
        symbolNames: ['lookup'],
        importTokens: ['./helper', 'helper'],
      }),
    );
  });

  it('backfills ids when loading a legacy snapshot shape', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);
    await fs.mkdir(path.join(tempRoot, '.data'), { recursive: true });

    await fs.writeFile(
      path.join(tempRoot, '.data', 'symbol-index.json'),
      JSON.stringify(
        {
          symbols: [
            {
              name: 'legacyLookup',
              kind: 'function',
              repo: 'legacy-repo',
              filePath: 'src/legacy.ts',
              startLine: 1,
              endLine: 1,
              exported: true,
            },
          ],
          byName: {
            legacyLookup: [
              {
                name: 'legacyLookup',
                kind: 'function',
                repo: 'legacy-repo',
                filePath: 'src/legacy.ts',
                startLine: 1,
                endLine: 1,
                exported: true,
              },
            ],
          },
          byNameLower: {},
          byFile: {
            'legacy-repo/src/legacy.ts': {
              repo: 'legacy-repo',
              filePath: 'src/legacy.ts',
              symbols: ['legacyLookup'],
              imports: [],
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const loadedIndex = await loadSymbolIndex();
    const fileId = createFileId('legacy-repo', 'src/legacy.ts');

    expect(loadedIndex.schemaVersion).toBe(3);
    expect(loadedIndex.byFile[fileId]).toEqual(
      expect.objectContaining({
        fileId,
        repo: 'legacy-repo',
        filePath: 'src/legacy.ts',
        classification: 'source',
        symbolNames: ['legacyLookup'],
        importTokens: [],
      }),
    );
    expect(loadedIndex.byName.legacyLookup).toEqual([
      expect.objectContaining({
        symbolId: createSymbolId(fileId, 'function', 'legacyLookup', 1),
        fileId,
        declarationFingerprint: 'function:legacyLookup:1',
      }),
    ]);
  });
});
