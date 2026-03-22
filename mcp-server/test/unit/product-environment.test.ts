import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LegacyStorageError,
  resolveProductPathsForEnvironment,
} from '../../src/product/environment.js';

async function createTempDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gojo-product-environment-test-'));
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

describe('product environment', () => {
  it('fails fast when a legacy workspace storage directory is present', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);
    await fs.mkdir(path.join(tempRoot, '.data'), { recursive: true });

    const legacyEnv = {
      ...process.env,
      GOJO_HOME: undefined,
      GOJO_CONFIG_DIR: undefined,
      GOJO_DATA_DIR: undefined,
      GOJO_INDEXES_DIR: undefined,
      GOJO_CACHE_DIR: undefined,
      GOJO_LOG_DIR: undefined,
      GOJO_RUNTIME_DIR: undefined,
      GOJO_TEMP_DIR: undefined,
    };

    expect(() => resolveProductPathsForEnvironment(legacyEnv)).toThrow(LegacyStorageError);
    expect(() => resolveProductPathsForEnvironment(legacyEnv)).toThrow(
      `Legacy .data directory detected at ${path.join(tempRoot, '.data')}`,
    );
  });

  it('resolves product storage through data, indexes, cache, and runtime directories only', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const paths = resolveProductPathsForEnvironment({
      ...process.env,
      GOJO_HOME: path.join(tempRoot, 'custom-home'),
      GOJO_PACKAGE_ROOT: path.join(tempRoot, 'package-root'),
      GOJO_DATA_DIR: undefined,
      GOJO_INDEXES_DIR: undefined,
      GOJO_CONFIG_DIR: path.join(tempRoot, 'config-root', 'gojo'),
      GOJO_CACHE_DIR: path.join(tempRoot, 'cache-root', 'gojo'),
      GOJO_LOG_DIR: path.join(tempRoot, 'state-root', 'gojo', 'logs'),
      GOJO_RUNTIME_DIR: path.join(tempRoot, 'state-root', 'gojo', 'runtime'),
      GOJO_TEMP_DIR: path.join(tempRoot, 'state-root', 'gojo', 'runtime', 'tmp'),
    });

    expect(paths.dataDir).toBe(path.join(tempRoot, 'custom-home', 'data'));
    expect(paths.indexesDir).toBe(path.join(tempRoot, 'custom-home', 'data', 'indexes'));
    expect(paths.cacheDir).toBe(path.join(tempRoot, 'cache-root', 'gojo'));
    expect(paths.runtimeDir).toBe(path.join(tempRoot, 'state-root', 'gojo', 'runtime'));
    expect(paths.tempDir).toBe(path.join(tempRoot, 'state-root', 'gojo', 'runtime', 'tmp'));
  });

  it('uses GOJO_HOME as the default base for runtime state on Linux when no per-dir overrides are set', async () => {
    const tempRoot = await createTempDirectory();
    tempDirectories.push(tempRoot);
    process.chdir(tempRoot);

    const paths = resolveProductPathsForEnvironment({
      ...process.env,
      GOJO_HOME: path.join(tempRoot, 'isolated-home'),
      GOJO_PACKAGE_ROOT: path.join(tempRoot, 'package-root'),
      GOJO_DATA_DIR: undefined,
      GOJO_INDEXES_DIR: undefined,
      GOJO_CONFIG_DIR: undefined,
      GOJO_CACHE_DIR: undefined,
      GOJO_LOG_DIR: undefined,
      GOJO_RUNTIME_DIR: undefined,
      GOJO_TEMP_DIR: undefined,
      XDG_CONFIG_HOME: path.join(tempRoot, 'xdg-config'),
      XDG_DATA_HOME: path.join(tempRoot, 'xdg-data'),
      XDG_CACHE_HOME: path.join(tempRoot, 'xdg-cache'),
      XDG_STATE_HOME: path.join(tempRoot, 'xdg-state'),
    });

    expect(paths.configDir).toBe(path.join(tempRoot, 'isolated-home', 'config'));
    expect(paths.dataDir).toBe(path.join(tempRoot, 'isolated-home', 'data'));
    expect(paths.cacheDir).toBe(path.join(tempRoot, 'isolated-home', 'cache'));
    expect(paths.logDir).toBe(path.join(tempRoot, 'isolated-home', 'logs'));
    expect(paths.runtimeDir).toBe(path.join(tempRoot, 'isolated-home', 'runtime'));
    expect(paths.tempDir).toBe(path.join(tempRoot, 'isolated-home', 'runtime', 'tmp'));
  });
});
