import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildIndexedSymbols } from '../../src/symbol-index/build-index.js';
import { createFileId, createSymbolId } from '../../src/symbol-index/ids.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-build-index-test-'));
}

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('buildIndexedSymbols', () => {
  it('indexes symbols whose names collide with Object prototype properties', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'prototype-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'reserved-names.ts'),
      [
        'export function constructor(): void {}',
        'export const toString = (): string => "ok";',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);

    expect(index.byName.constructor).toEqual([
      expect.objectContaining({
        symbolId: createSymbolId(
          createFileId('prototype-repo', 'src/reserved-names.ts'),
          'function',
          'constructor',
          1,
        ),
        fileId: createFileId('prototype-repo', 'src/reserved-names.ts'),
        name: 'constructor',
        repo: 'prototype-repo',
        filePath: 'src/reserved-names.ts',
      }),
    ]);
    expect(index.byName.toString).toEqual([
      expect.objectContaining({
        symbolId: createSymbolId(
          createFileId('prototype-repo', 'src/reserved-names.ts'),
          'variable',
          'toString',
          1,
        ),
        fileId: createFileId('prototype-repo', 'src/reserved-names.ts'),
        name: 'toString',
        repo: 'prototype-repo',
        filePath: 'src/reserved-names.ts',
      }),
    ]);
    expect(Object.getPrototypeOf(index.byName)).toBeNull();
    expect(Object.getPrototypeOf(index.byNameLower)).toBeNull();
  });

  it('excludes generated directories and declaration files from the symbol index', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'generated-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, '.next', 'dev', 'types'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'generated'), { recursive: true });

    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'kept.ts'),
      'export function keepMe(): void {}',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, '.next', 'dev', 'types', 'routes.d.ts'),
      'export type GeneratedRoute = string;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'component.generated.tsx'),
      'export function GeneratedComponent(): null { return null; }',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'generated', 'api.ts'),
      'export function fromGeneratedDir(): void {}',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'types.d.ts'),
      'export interface GeneratedTypes {}',
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);

    expect(index.schemaVersion).toBe(2);
    expect(index.symbols).toEqual([
      expect.objectContaining({
        symbolId: createSymbolId(
          createFileId('generated-repo', 'src/kept.ts'),
          'function',
          'keepMe',
          1,
        ),
        fileId: createFileId('generated-repo', 'src/kept.ts'),
        name: 'keepMe',
        repo: 'generated-repo',
        filePath: 'src/kept.ts',
      }),
    ]);
    expect(index.symbols).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filePath: '.next/dev/types/routes.d.ts' }),
        expect.objectContaining({ filePath: 'src/component.generated.tsx' }),
        expect.objectContaining({ filePath: 'generated/api.ts' }),
        expect.objectContaining({ filePath: 'src/types.d.ts' }),
      ]),
    );
    expect(Object.keys(index.byFile)).toEqual([createFileId('generated-repo', 'src/kept.ts')]);
    expect(index.byFile[createFileId('generated-repo', 'src/kept.ts')]).toEqual(
      expect.objectContaining({
        fileId: createFileId('generated-repo', 'src/kept.ts'),
        repo: 'generated-repo',
        filePath: 'src/kept.ts',
      }),
    );
  });

  it('generates deterministic file and symbol IDs and disambiguates repeated names by ordinal', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'identity-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'duplicates.ts'),
      [
        'export function repeat(): void {}',
        'export function repeat(): void {}',
        'export class repeat {}',
      ].join('\n'),
      'utf8',
    );

    const firstIndex = await buildIndexedSymbols(reposRoot);
    const secondIndex = await buildIndexedSymbols(reposRoot);
    const fileId = createFileId('identity-repo', 'src/duplicates.ts');
    const repeatFunctions = firstIndex.symbols.filter(
      (symbol) => symbol.fileId === fileId && symbol.name === 'repeat' && symbol.kind === 'function',
    );
    const repeatClass = firstIndex.symbols.find(
      (symbol) => symbol.fileId === fileId && symbol.name === 'repeat' && symbol.kind === 'class',
    );

    expect(firstIndex.byFile[fileId]).toEqual(
      expect.objectContaining({
        fileId,
        repo: 'identity-repo',
        filePath: 'src/duplicates.ts',
      }),
    );
    expect(repeatFunctions).toHaveLength(2);
    expect(repeatFunctions.map((symbol) => symbol.symbolId)).toEqual([
      createSymbolId(fileId, 'function', 'repeat', 1),
      createSymbolId(fileId, 'function', 'repeat', 2),
    ]);
    expect(repeatFunctions.map((symbol) => symbol.declarationFingerprint)).toEqual([
      'function:repeat:1',
      'function:repeat:2',
    ]);
    expect(repeatClass).toEqual(
      expect.objectContaining({
        symbolId: createSymbolId(fileId, 'class', 'repeat', 1),
        fileId,
        declarationFingerprint: 'class:repeat:1',
      }),
    );
    expect(secondIndex.symbols).toEqual(firstIndex.symbols);
  });
});
