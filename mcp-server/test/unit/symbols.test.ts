import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listSymbolsForFile } from '../../src/symbols.js';
import { createSyntheticDefaultExportName } from '../../src/symbol-index/ids.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'reporadar-symbols-test-'));
}

async function copyFixture(
  fixtureName: string,
  destinationPath: string,
): Promise<void> {
  const fixturePath = path.resolve('test', 'fixtures', fixtureName);
  const content = await fs.readFile(fixturePath, 'utf8');
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, content, 'utf8');
}

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('listSymbolsForFile', () => {
  it('supports JS files and extracts declaration symbols', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'js-repo');
    await copyFixture('hello.js', path.join(repositoryRoot, 'src', 'hello.js'));

    const result = await listSymbolsForFile(reposRoot, 'js-repo/src/hello.js');

    expect(result.filePath).toBe('js-repo/src/hello.js');
    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'UserService',
          kind: 'class',
          filePath: 'js-repo/src/hello.js',
        }),
        expect.objectContaining({
          name: 'getUser',
          kind: 'method',
          filePath: 'js-repo/src/hello.js',
        }),
        expect.objectContaining({
          name: 'greet',
          kind: 'function',
          filePath: 'js-repo/src/hello.js',
        }),
      ]),
    );
  });

  it('supports JSX files and keeps JSX-bearing component declarations in the symbol layer', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'jsx-repo');
    await copyFixture('component.jsx', path.join(repositoryRoot, 'src', 'component.jsx'));

    const result = await listSymbolsForFile(reposRoot, 'jsx-repo/src/component.jsx');

    expect(result.filePath).toBe('jsx-repo/src/component.jsx');
    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Button',
          kind: 'variable',
          filePath: 'jsx-repo/src/component.jsx',
        }),
        expect.objectContaining({
          name: 'renderLabel',
          kind: 'function',
          filePath: 'jsx-repo/src/component.jsx',
        }),
      ]),
    );

    expect(result.symbols.find((symbol) => symbol.name === 'button')).toBeUndefined();
    expect(result.symbols.find((symbol) => symbol.name === 'span')).toBeUndefined();
  });

  it('creates a stable synthetic symbol for anonymous default function exports', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'default-js-repo');
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'factory.js'),
      'export default () => "ok";',
      'utf8',
    );

    const result = await listSymbolsForFile(reposRoot, 'default-js-repo/src/factory.js');

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: createSyntheticDefaultExportName('src/factory.js'),
          kind: 'function',
          filePath: 'default-js-repo/src/factory.js',
          identityDiscriminator: 'default',
        }),
      ]),
    );
  });

  it('creates a stable synthetic symbol for anonymous default class exports in JSX-capable files', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'default-jsx-repo');
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'Widget.jsx'),
      'export default class { render() { return <div />; } }',
      'utf8',
    );

    const result = await listSymbolsForFile(reposRoot, 'default-jsx-repo/src/Widget.jsx');

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: createSyntheticDefaultExportName('src/Widget.jsx'),
          kind: 'class',
          filePath: 'default-jsx-repo/src/Widget.jsx',
          identityDiscriminator: 'default',
        }),
      ]),
    );
  });

  it('does not duplicate named default exports with a synthetic symbol', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'named-default-repo');
    await fs.mkdir(path.join(repositoryRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(repositoryRoot, 'src', 'Button.tsx'),
      'export default function Button(): null { return null; }',
      'utf8',
    );

    const result = await listSymbolsForFile(reposRoot, 'named-default-repo/src/Button.tsx');

    expect(result.symbols.filter((symbol) => symbol.name === 'Button')).toHaveLength(1);
    expect(
      result.symbols.find((symbol) => symbol.name === createSyntheticDefaultExportName('src/Button.tsx')),
    ).toBeUndefined();
  });

  it('extracts expected symbols from a representative TypeScript file', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'test-repo');
    await copyFixture('hello.ts', path.join(repositoryRoot, 'src', 'hello.ts'));

    const result = await listSymbolsForFile(reposRoot, 'test-repo/src/hello.ts');

    expect(result.filePath).toBe('test-repo/src/hello.ts');
    expect(result.symbolCount).toBe(4);
    expect(result.symbols).toEqual(
      expect.arrayContaining([
        {
          name: 'User',
          kind: 'interface',
          filePath: 'test-repo/src/hello.ts',
          startLine: 1,
          endLine: 3,
        },
        {
          name: 'UserService',
          kind: 'class',
          filePath: 'test-repo/src/hello.ts',
          startLine: 5,
          endLine: 9,
        },
        {
          name: 'getUser',
          kind: 'method',
          filePath: 'test-repo/src/hello.ts',
          startLine: 6,
          endLine: 8,
        },
        {
          name: 'greet',
          kind: 'function',
          filePath: 'test-repo/src/hello.ts',
          startLine: 11,
          endLine: 13,
        },
      ]),
    );
  });

  it('supports TSX files and extracts declaration symbols without treating JSX nodes as symbols', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'tsx-repo');
    await copyFixture('component.tsx', path.join(repositoryRoot, 'src', 'component.tsx'));

    const result = await listSymbolsForFile(reposRoot, 'tsx-repo/src/component.tsx');

    expect(result.filePath).toBe('tsx-repo/src/component.tsx');
    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Props',
          kind: 'typeAlias',
          filePath: 'tsx-repo/src/component.tsx',
        }),
        expect.objectContaining({
          name: 'Button',
          kind: 'variable',
          filePath: 'tsx-repo/src/component.tsx',
        }),
        expect.objectContaining({
          name: 'renderLabel',
          kind: 'function',
          filePath: 'tsx-repo/src/component.tsx',
        }),
      ]),
    );

    expect(result.symbols.find((symbol) => symbol.name === 'button')).toBeUndefined();
    expect(result.symbols.find((symbol) => symbol.name === 'span')).toBeUndefined();
  });

  it('rejects unsupported file types', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    const repositoryRoot = path.join(reposRoot, 'test-repo');
    await fs.mkdir(path.join(repositoryRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(repositoryRoot, 'docs', 'README.md'), '# hello', 'utf8');

    await expect(
      listSymbolsForFile(reposRoot, 'test-repo/docs/README.md'),
    ).rejects.toThrow(/unsupported file type/i);
  });

  it('rejects file paths without a repository prefix', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    await expect(listSymbolsForFile(reposRoot, 'hello.ts')).rejects.toThrow(
      /must include the repository directory/i,
    );
  });

  it('rejects unknown repositories clearly', async () => {
    const reposRoot = await createTempDirectory();
    tempDirectories.push(reposRoot);

    await expect(
      listSymbolsForFile(reposRoot, 'missing-repo/src/hello.ts'),
    ).rejects.toThrow(/repository not found/i);
  });
});
