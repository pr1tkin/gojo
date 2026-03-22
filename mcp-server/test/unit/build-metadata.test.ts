import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { getBuildMetadata, validateBuildMetadata } from '../../src/internal/product/buildMetadata.js';
import { resolveVersionMetadata } from '../../src/internal/product/versionResolver.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gojo-build-metadata-test-'));
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

async function initializeGitRepo(root: string): Promise<void> {
  git(root, 'init');
  git(root, 'config', 'user.name', 'Gojo Tests');
  git(root, 'config', 'user.email', 'gojo@example.com');
  await fs.writeFile(path.join(root, 'README.md'), 'gojo\n', 'utf8');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'init');
}

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('build metadata', () => {
  it('resolves a tagged release version and bundled helpers from one metadata source', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    await initializeGitRepo(tempRoot);
    git(tempRoot, 'tag', 'v1.2.3');

    const helperDir = path.join(tempRoot, 'helper');
    await fs.mkdir(helperDir, { recursive: true });
    await fs.writeFile(path.join(helperDir, 'zoekt-webserver'), '', 'utf8');
    await fs.writeFile(path.join(helperDir, 'zoekt-git-index'), '', 'utf8');

    const version = resolveVersionMetadata({
      ...process.env,
      GOJO_PACKAGE_ROOT: tempRoot,
    });
    const metadata = getBuildMetadata({
      ...process.env,
      GOJO_PACKAGE_ROOT: tempRoot,
      GOJO_PACKAGED: 'true',
    });

    expect(version.version).toBe('v1.2.3');
    expect(metadata.version).toBe('v1.2.3');
    expect(metadata.packagingMode).toBe('release');
    expect(metadata.helperPackaging).toBe('bundled');
    expect(metadata.helperPaths).toHaveLength(2);
    expect(metadata.isDev).toBe(false);
  });

  it('falls back to a deterministic dev version and external helpers when untagged', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    await initializeGitRepo(tempRoot);

    const webserver = path.join(tempRoot, 'tools', 'zoekt-webserver');
    const indexer = path.join(tempRoot, 'tools', 'zoekt-git-index');
    await fs.mkdir(path.dirname(webserver), { recursive: true });
    await fs.writeFile(webserver, '', 'utf8');
    await fs.writeFile(indexer, '', 'utf8');

    const version = resolveVersionMetadata({
      ...process.env,
      GOJO_PACKAGE_ROOT: tempRoot,
    });
    const metadata = getBuildMetadata({
      ...process.env,
      GOJO_PACKAGE_ROOT: tempRoot,
      GOJO_ZOEKT_WEBSERVER_PATH: webserver,
      GOJO_ZOEKT_GIT_INDEX_PATH: indexer,
    });

    expect(version.version).toMatch(/^0\.0\.0-dev\+[0-9a-f]{7}$/);
    expect(metadata.version).toBe(version.version);
    expect(metadata.gitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(metadata.helperPackaging).toBe('external');
    expect(metadata.helperPaths).toEqual([webserver, indexer]);
    expect(metadata.isDev).toBe(true);
  });

  it('uses packaged VERSION metadata when release artifacts are resolved outside a git checkout', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);

    const helperDir = path.join(tempRoot, 'helper');
    await fs.mkdir(helperDir, { recursive: true });
    await fs.writeFile(path.join(helperDir, 'zoekt-webserver'), '', 'utf8');
    await fs.writeFile(path.join(helperDir, 'zoekt-git-index'), '', 'utf8');
    await fs.writeFile(
      path.join(tempRoot, 'VERSION'),
      JSON.stringify(
        {
          productName: 'gojo',
          version: 'v9.9.9',
          gitSha: '0123456789abcdef0123456789abcdef01234567',
          buildTimestamp: '2026-03-22T00:00:00.000Z',
          platform: 'linux',
          arch: 'x64',
          packagingMode: 'release',
          helperPackaging: 'bundled',
          helperPaths: [],
          isDev: false,
        },
        null,
        2,
      ),
      'utf8',
    );

    const version = resolveVersionMetadata({
      ...process.env,
      GOJO_PACKAGED: 'true',
      GOJO_PACKAGE_ROOT: tempRoot,
    });
    const metadata = getBuildMetadata({
      ...process.env,
      GOJO_PACKAGED: 'true',
      GOJO_PACKAGE_ROOT: tempRoot,
    });

    expect(version.version).toBe('v9.9.9');
    expect(version.gitSha).toBe('0123456789abcdef0123456789abcdef01234567');
    expect(metadata.version).toBe('v9.9.9');
    expect(metadata.gitSha).toBe('0123456789abcdef0123456789abcdef01234567');
    expect(metadata.helperPackaging).toBe('bundled');
    expect(metadata.helperPaths).toHaveLength(2);
  });

  it('fails fast when critical metadata fields are empty', () => {
    expect(() =>
      validateBuildMetadata({
        productName: 'gojo',
        version: '',
        gitSha: 'abc',
        buildTimestamp: '2026-03-22T00:00:00.000Z',
        platform: 'linux',
        arch: 'x64',
        packagingMode: 'dev',
        helperPackaging: 'unknown',
        helperPaths: [],
        isDev: true,
      }),
    ).toThrow('version is required');
  });
});
