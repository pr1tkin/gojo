import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildIndexedSymbols } from '../../src/symbol-index/build-index.js';
import {
  createFileId,
  createSymbolId,
  createSyntheticDefaultExportName,
  createSyntheticDefaultExportSymbolId,
} from '../../src/symbol-index/ids.js';

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
    expect(index.stats.globalByName).toEqual(
      expect.objectContaining({
        constructor: 1,
        toString: 1,
      }),
    );
    expect(index.stats.globalByNameLower).toEqual(
      expect.objectContaining({
        constructor: 1,
        tostring: 1,
      }),
    );
    expect(index.stats.byRepo['prototype-repo']).toEqual(
      expect.objectContaining({
        constructor: 1,
        toString: 1,
      }),
    );
    expect(index.stats.exportedByName).toEqual(
      expect.objectContaining({
        constructor: 1,
        toString: 1,
      }),
    );
    expect(index.stats.byKind.function).toEqual(
      expect.objectContaining({
        constructor: 1,
      }),
    );
    expect(index.stats.byKind.variable).toEqual(
      expect.objectContaining({
        toString: 1,
      }),
    );
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
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'widget.generated.jsx'),
      'export const GeneratedWidget = () => <div />;',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'vendor.min.js'),
      'window.app=function(){return 1}();',
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);

    expect(index.schemaVersion).toBe(4);
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
        expect.objectContaining({ filePath: 'src/widget.generated.jsx' }),
        expect.objectContaining({ filePath: 'src/vendor.min.js' }),
      ]),
    );
    expect(Object.keys(index.byFile)).toEqual([createFileId('generated-repo', 'src/kept.ts')]);
    expect(index.byFile[createFileId('generated-repo', 'src/kept.ts')]).toEqual(
      expect.objectContaining({
        fileId: createFileId('generated-repo', 'src/kept.ts'),
        repo: 'generated-repo',
        filePath: 'src/kept.ts',
        classification: 'source',
        symbolIds: [createSymbolId(createFileId('generated-repo', 'src/kept.ts'), 'function', 'keepMe', 1)],
        symbolNames: ['keepMe'],
        imports: [],
        exports: [
          expect.objectContaining({
            fileId: createFileId('generated-repo', 'src/kept.ts'),
            kind: 'named',
            exportedName: 'keepMe',
            localName: 'keepMe',
          }),
        ],
        importTokens: [],
      }),
    );
    expect(index.stats.globalByName).toEqual({ keepMe: 1 });
    expect(index.stats.globalByNameLower).toEqual({ keepme: 1 });
    expect(index.stats.byRepo['generated-repo']).toEqual({ keepMe: 1 });
    expect(index.stats.exportedByName).toEqual({ keepMe: 1 });
    expect(index.stats.byKind.function).toEqual({ keepMe: 1 });
    expect(index.stats.globalByName).not.toHaveProperty('GeneratedRoute');
    expect(index.stats.globalByName).not.toHaveProperty('GeneratedComponent');
    expect(index.stats.globalByName).not.toHaveProperty('GeneratedWidget');
    expect(index.stats.globalByName).not.toHaveProperty('fromGeneratedDir');
    expect(index.stats.globalByName).not.toHaveProperty('GeneratedTypes');
  });

  it('indexes JS and JSX source files alongside TS and TSX', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'mixed-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'helper.js'),
      [
        'export function helper() {',
        "  return 'ok';",
        '}',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'Button.jsx'),
      [
        'export const Button = ({ label }) => {',
        '  return <button>{label}</button>;',
        '};',
      ].join('\n'),
      'utf8',
    );

    const index = await buildIndexedSymbols(reposRoot);

    expect(Object.keys(index.byFile)).toEqual(
      expect.arrayContaining([
        createFileId('mixed-repo', 'src/helper.js'),
        createFileId('mixed-repo', 'src/Button.jsx'),
      ]),
    );
    expect(index.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'src/helper.js',
          name: 'helper',
          kind: 'function',
        }),
        expect.objectContaining({
          filePath: 'src/Button.jsx',
          name: 'Button',
          kind: 'variable',
        }),
      ]),
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
        classification: 'source',
        symbolIds: [
          createSymbolId(fileId, 'function', 'repeat', 1),
          createSymbolId(fileId, 'function', 'repeat', 2),
          createSymbolId(fileId, 'class', 'repeat', 1),
        ],
        symbolNames: ['repeat'],
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
    expect(firstIndex.stats.globalByName).toEqual({ repeat: 3 });
    expect(firstIndex.stats.globalByNameLower).toEqual({ repeat: 3 });
    expect(firstIndex.stats.byRepo['identity-repo']).toEqual({ repeat: 3 });
    expect(firstIndex.stats.exportedByName).toEqual({ repeat: 3 });
    expect(firstIndex.stats.byKind.function).toEqual({ repeat: 2 });
    expect(firstIndex.stats.byKind.class).toEqual({ repeat: 1 });
  });

  it('creates deterministic synthetic identities for anonymous default exports without duplicating named defaults', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'default-identity-repo');
    await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'anonymous.js'),
      'export default () => "ok";',
      'utf8',
    );
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'Named.tsx'),
      'export default function Named(): null { return null; }',
      'utf8',
    );

    const firstIndex = await buildIndexedSymbols(reposRoot);
    const secondIndex = await buildIndexedSymbols(reposRoot);
    const anonymousFileId = createFileId('default-identity-repo', 'src/anonymous.js');
    const syntheticName = createSyntheticDefaultExportName('src/anonymous.js');
    const anonymousSymbols = firstIndex.symbols.filter((symbol) => symbol.fileId === anonymousFileId);
    const namedSymbols = firstIndex.symbols.filter(
      (symbol) => symbol.fileId === createFileId('default-identity-repo', 'src/Named.tsx'),
    );

    expect(anonymousSymbols).toEqual([
      expect.objectContaining({
        symbolId: createSyntheticDefaultExportSymbolId(anonymousFileId),
        fileId: anonymousFileId,
        name: syntheticName,
        kind: 'function',
        declarationFingerprint: `default:${syntheticName}`,
      }),
    ]);
    expect(firstIndex.byFile[anonymousFileId]).toEqual(
      expect.objectContaining({
        symbolIds: [createSyntheticDefaultExportSymbolId(anonymousFileId)],
        symbolNames: [syntheticName],
        exports: [
          expect.objectContaining({
            kind: 'default',
            localName: syntheticName,
            symbolId: createSyntheticDefaultExportSymbolId(anonymousFileId),
          }),
        ],
      }),
    );
    expect(secondIndex.symbols).toEqual(firstIndex.symbols);
    expect(namedSymbols.filter((symbol) => symbol.name === 'Named')).toHaveLength(1);
    expect(
      namedSymbols.find((symbol) => symbol.name === createSyntheticDefaultExportName('src/Named.tsx')),
    ).toBeUndefined();
  });
});
