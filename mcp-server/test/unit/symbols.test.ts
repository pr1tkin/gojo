import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listSymbolsForFile } from '../../src/symbols.js';

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
