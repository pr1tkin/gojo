import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearTypeScriptProjectCache,
  loadTypeScriptProject,
} from '../../src/typescript/project-loader.js';

async function createTempDirectory(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

const tempDirectories: string[] = [];

beforeEach(() => {
  clearTypeScriptProjectCache();
});

afterEach(async () => {
  clearTypeScriptProjectCache();
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('TypeScript project loader', () => {
  it('loads a valid project fixture through the public loader surface', () => {
    const repositoryRoot = path.resolve('test/fixtures/ts-project');
    const tsconfigPath = path.join(repositoryRoot, 'tsconfig.json');

    const context = loadTypeScriptProject(repositoryRoot, tsconfigPath);

    expect(context).not.toBeNull();
    expect(context?.tsconfigPath).toBe(path.resolve(tsconfigPath));
    expect(context?.program.getSourceFiles().some((file) => file.fileName.endsWith('models.ts'))).toBe(
      true,
    );
  });

  it('reuses the cached project context for the same tsconfig path', () => {
    const repositoryRoot = path.resolve('test/fixtures/ts-project');
    const tsconfigPath = path.join(repositoryRoot, 'tsconfig.json');

    const first = loadTypeScriptProject(repositoryRoot, tsconfigPath);
    const second = loadTypeScriptProject(repositoryRoot, tsconfigPath);

    expect(first).toBe(second);
  });

  it('returns null for an invalid tsconfig file', async () => {
    const repositoryRoot = await createTempDirectory('reporadar-project-loader-');
    tempDirectories.push(repositoryRoot);

    const tsconfigPath = path.join(repositoryRoot, 'tsconfig.json');
    await writeFile(tsconfigPath, '{ invalid json');

    const context = loadTypeScriptProject(repositoryRoot, tsconfigPath);

    expect(context).toBeNull();
  });

  it('returns null for an empty project with no matched source files', async () => {
    const repositoryRoot = await createTempDirectory('reporadar-project-loader-');
    tempDirectories.push(repositoryRoot);

    const tsconfigPath = path.join(repositoryRoot, 'tsconfig.json');
    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
        },
        include: ['src/**/*.ts'],
      }),
    );

    const context = loadTypeScriptProject(repositoryRoot, tsconfigPath);

    expect(context).toBeNull();
  });
});
