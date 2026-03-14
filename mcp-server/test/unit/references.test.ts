import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearTypeScriptProjectCache } from '../../src/typescript/project-loader.js';
import { findTypeScriptReferences } from '../../src/typescript/references.js';

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

describe('compiler-backed TypeScript references', () => {
  it('finds TypeScript references for a fixture symbol and excludes the definition site', async () => {
    const repository = {
      id: 'ts-project',
      name: 'ts-project',
      rootPath: path.resolve('test/fixtures/ts-project'),
      isGitRepository: false,
    };

    const results = await findTypeScriptReferences(repository, 'UserService');

    expect(results).toEqual(
      expect.arrayContaining([
        {
          symbol: 'UserService',
          repo: 'ts-project',
          filePath: 'src/consumer.ts',
          line: 1,
          snippet: "import { UserService } from './models';",
        },
        {
          symbol: 'UserService',
          repo: 'ts-project',
          filePath: 'src/consumer.ts',
          line: 3,
          snippet: 'export const userService = new UserService();',
        },
      ]),
    );
    expect(results.every((result) => result.symbol === 'UserService')).toBe(true);
    expect(
      results.some((result) => result.filePath === 'src/models.ts' && result.line === 5),
    ).toBe(false);
  });

  it('returns an empty list when no usable tsconfig exists', async () => {
    const repositoryRoot = await createTempDirectory('reporadar-ts-references-');
    tempDirectories.push(repositoryRoot);

    await writeFile(
      path.join(repositoryRoot, 'src', 'models.ts'),
      "export class UserService {}\nconst service = new UserService();\n",
    );

    const results = await findTypeScriptReferences(
      {
        id: 'no-config-project',
        name: 'no-config-project',
        rootPath: repositoryRoot,
        isGitRepository: false,
      },
      'UserService',
    );

    expect(results).toEqual([]);
  });
});
