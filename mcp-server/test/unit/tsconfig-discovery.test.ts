import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  discoverRepositoryTsconfigs,
  discoverTsconfigForFile,
} from '../../src/typescript/tsconfig-discovery.js';

async function createTempDirectory(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('tsconfig discovery', () => {
  it('prefers the nearest tsconfig for a file inside nested directories', async () => {
    const repositoryRoot = await createTempDirectory('reporadar-tsconfig-');
    tempDirectories.push(repositoryRoot);

    await writeFile(path.join(repositoryRoot, 'tsconfig.json'), '{"compilerOptions":{}}');
    await writeFile(path.join(repositoryRoot, 'packages', 'app', 'tsconfig.json'), '{"compilerOptions":{}}');
    const filePath = path.join(repositoryRoot, 'packages', 'app', 'src', 'feature.ts');
    await writeFile(filePath, 'export const feature = true;\n');

    const discovered = await discoverTsconfigForFile(repositoryRoot, filePath);

    expect(discovered).toBe(path.join(repositoryRoot, 'packages', 'app', 'tsconfig.json'));
  });

  it('returns null when no tsconfig exists inside the repository boundary', async () => {
    const repositoryRoot = await createTempDirectory('reporadar-tsconfig-');
    tempDirectories.push(repositoryRoot);

    const filePath = path.join(repositoryRoot, 'src', 'feature.ts');
    await writeFile(filePath, 'export const feature = true;\n');

    const discovered = await discoverTsconfigForFile(repositoryRoot, filePath);

    expect(discovered).toBeNull();
  });

  it('returns null for files outside the repository root', async () => {
    const repositoryRoot = await createTempDirectory('reporadar-tsconfig-root-');
    const outsideRoot = await createTempDirectory('reporadar-tsconfig-outside-');
    tempDirectories.push(repositoryRoot, outsideRoot);

    await writeFile(path.join(repositoryRoot, 'tsconfig.json'), '{"compilerOptions":{}}');
    const outsideFile = path.join(outsideRoot, 'src', 'feature.ts');
    await writeFile(outsideFile, 'export const feature = true;\n');

    const discovered = await discoverTsconfigForFile(repositoryRoot, outsideFile);

    expect(discovered).toBeNull();
  });

  it('discovers repository tsconfig files and keeps shallow configs first', async () => {
    const repositoryRoot = await createTempDirectory('reporadar-tsconfig-');
    tempDirectories.push(repositoryRoot);

    const rootConfig = path.join(repositoryRoot, 'tsconfig.json');
    const packageConfig = path.join(repositoryRoot, 'packages', 'app', 'tsconfig.json');
    await writeFile(rootConfig, '{"compilerOptions":{}}');
    await writeFile(packageConfig, '{"compilerOptions":{}}');

    const discovered = await discoverRepositoryTsconfigs(repositoryRoot);

    expect(discovered).toEqual([rootConfig, packageConfig]);
  });
});
