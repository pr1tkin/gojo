import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildIndexedSymbols } from '../../src/symbol-index/build-index.js';

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
        name: 'constructor',
        repo: 'prototype-repo',
        filePath: 'src/reserved-names.ts',
      }),
    ]);
    expect(index.byName.toString).toEqual([
      expect.objectContaining({
        name: 'toString',
        repo: 'prototype-repo',
        filePath: 'src/reserved-names.ts',
      }),
    ]);
    expect(Object.getPrototypeOf(index.byName)).toBeNull();
    expect(Object.getPrototypeOf(index.byNameLower)).toBeNull();
  });
});
