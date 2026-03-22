import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ProductIdentity, ProductPaths, SearchRuntimeConfig, SearchRuntimeMode } from '../types.js';
import { PRODUCT_NAME } from '../internal/product/constants.js';
import { resolvePackageRootFromEnv } from '../internal/product/packageRootResolver.js';
import { resolveProductIdentity as resolveResolvedProductIdentity } from '../internal/product/productIdentityResolver.js';

export class LegacyStorageError extends Error {
  constructor(legacyPath: string) {
    super(
      `Legacy .data directory detected at ${legacyPath}. This Gojo version no longer supports legacy storage. Please migrate or re-index.`,
    );
    this.name = 'LegacyStorageError';
  }
}

function resolveStateBaseDir(env: NodeJS.ProcessEnv): string {
  if (process.platform === 'win32') {
    return path.resolve(
      env.LOCALAPPDATA ||
        env.APPDATA ||
        path.join(os.homedir(), 'AppData', 'Local'),
      'Gojo',
    );
  }

  return path.resolve(
    env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    PRODUCT_NAME,
  );
}

function resolveDefaultHomeDir(env: NodeJS.ProcessEnv): string {
  if (env.GOJO_HOME?.trim()) {
    return path.resolve(env.GOJO_HOME.trim());
  }

  if (process.platform === 'win32') {
    return resolveStateBaseDir(env);
  }

  return path.resolve(
    env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
    PRODUCT_NAME,
  );
}

function detectLegacyWorkspaceDataDir(): string | null {
  const legacyWorkspaceDataDir = path.resolve(process.cwd(), '.data');

  if (fs.existsSync(legacyWorkspaceDataDir) && fs.statSync(legacyWorkspaceDataDir).isDirectory()) {
    return legacyWorkspaceDataDir;
  }

  return null;
}

function resolveDefaultDataDir(env: NodeJS.ProcessEnv, homeDir: string): string {
  if (env.GOJO_DATA_DIR?.trim()) {
    return path.resolve(env.GOJO_DATA_DIR.trim());
  }

  const legacyWorkspaceDataDir = detectLegacyWorkspaceDataDir();
  if (legacyWorkspaceDataDir) {
    throw new LegacyStorageError(legacyWorkspaceDataDir);
  }

  return path.join(homeDir, 'data');
}

function resolveProductPaths(env: NodeJS.ProcessEnv, packageRoot: string): ProductPaths {
  const homeDir = resolveDefaultHomeDir(env);
  const stateBaseDir = resolveStateBaseDir(env);
  const usesExplicitHome = Boolean(env.GOJO_HOME?.trim());

  const configDir = path.resolve(
    env.GOJO_CONFIG_DIR?.trim() ||
      (usesExplicitHome
        ? path.join(homeDir, 'config')
        : process.platform === 'win32'
          ? path.join(homeDir, 'config')
          : path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), PRODUCT_NAME)),
  );
  const dataDir = path.resolve(resolveDefaultDataDir(env, homeDir));
  const indexesDir = path.resolve(env.GOJO_INDEXES_DIR?.trim() || path.join(dataDir, 'indexes'));
  const cacheDir = path.resolve(
    env.GOJO_CACHE_DIR?.trim() ||
      (usesExplicitHome
        ? path.join(homeDir, 'cache')
        : process.platform === 'win32'
          ? path.join(homeDir, 'cache')
          : path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), PRODUCT_NAME)),
  );
  const logDir = path.resolve(
    env.GOJO_LOG_DIR?.trim() || (usesExplicitHome ? path.join(homeDir, 'logs') : path.join(stateBaseDir, 'logs')),
  );
  const runtimeDir = path.resolve(
    env.GOJO_RUNTIME_DIR?.trim() ||
      (usesExplicitHome ? path.join(homeDir, 'runtime') : path.join(stateBaseDir, 'runtime')),
  );
  const tempDir = path.resolve(env.GOJO_TEMP_DIR?.trim() || path.join(runtimeDir, 'tmp'));
  const searchHelpersDir = path.resolve(
    env.GOJO_SEARCH_HELPERS_DIR?.trim() || path.join(packageRoot, 'bin', 'search'),
  );

  return {
    packageRoot,
    homeDir,
    configDir,
    dataDir,
    indexesDir,
    cacheDir,
    logDir,
    runtimeDir,
    tempDir,
    searchHelpersDir,
  };
}

export function ensureProductDirectories(paths: ProductPaths): void {
  const requiredDirectories = [
    paths.homeDir,
    paths.configDir,
    paths.dataDir,
    paths.indexesDir,
    paths.cacheDir,
    paths.logDir,
    paths.runtimeDir,
    paths.tempDir,
  ];

  for (const directory of requiredDirectories) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

export function resolveProductIdentity(env: NodeJS.ProcessEnv = process.env): ProductIdentity {
  return resolveResolvedProductIdentity(env).identity;
}

export function resolveProductPathsForEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ProductPaths {
  const packageRoot = resolvePackageRootFromEnv(env);
  return resolveProductPaths(env, packageRoot);
}

export function resolveDefaultReposRoot(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const cwdRepos = path.resolve(cwd, 'repos');
  if (fs.existsSync(cwdRepos) && fs.statSync(cwdRepos).isDirectory()) {
    return cwdRepos;
  }

  const packageRoot = resolvePackageRootFromEnv(env);
  const packageSiblingRepos = path.resolve(packageRoot, '..', 'repos');
  if (fs.existsSync(packageSiblingRepos) && fs.statSync(packageSiblingRepos).isDirectory()) {
    return packageSiblingRepos;
  }

  return path.resolve('/repos');
}

export function resolveSearchRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): SearchRuntimeConfig {
  const paths = resolveProductPathsForEnvironment(env);
  const configuredBaseUrl = env.ZOEKT_BASE_URL?.trim();
  let baseUrl = 'http://127.0.0.1:6070';

  if (configuredBaseUrl) {
    try {
      baseUrl = new URL(configuredBaseUrl).toString().replace(/\/$/, '');
    } catch {
      baseUrl = 'http://127.0.0.1:6070';
    }
  }
  const configuredMode = env.GOJO_RUNTIME_MODE?.trim();
  const mode: SearchRuntimeMode =
    configuredMode === 'packaged' || configuredMode === 'development'
      ? configuredMode
      : env.GOJO_PACKAGED === 'true'
        ? 'packaged'
        : 'development';

  return {
    baseUrl,
    mode,
    packagingStrategy: 'bundled_helper_binaries',
    helperBinaryDir: paths.searchHelpersDir,
    helperManifestPath: path.join(paths.searchHelpersDir, 'manifest.json'),
    indexDirectory: path.join(paths.indexesDir, 'search'),
    helperBinaries: {
      webserver: path.join(paths.searchHelpersDir, process.platform === 'win32' ? 'zoekt-webserver.exe' : 'zoekt-webserver'),
      indexer: path.join(paths.searchHelpersDir, process.platform === 'win32' ? 'zoekt-git-index.exe' : 'zoekt-git-index'),
    },
  };
}

let cachedEnvironment:
  | {
      cacheKey: string;
      identity: ProductIdentity;
      paths: ProductPaths;
    }
  | undefined;

function createEnvironmentCacheKey(env: NodeJS.ProcessEnv): string {
  return JSON.stringify({
    cwd: process.cwd(),
    GOJO_PACKAGE_ROOT: env.GOJO_PACKAGE_ROOT ?? '',
    GOJO_VERSION: env.GOJO_VERSION ?? '',
    GOJO_HOME: env.GOJO_HOME ?? '',
    GOJO_CONFIG_DIR: env.GOJO_CONFIG_DIR ?? '',
    GOJO_DATA_DIR: env.GOJO_DATA_DIR ?? '',
    GOJO_INDEXES_DIR: env.GOJO_INDEXES_DIR ?? '',
    GOJO_CACHE_DIR: env.GOJO_CACHE_DIR ?? '',
    GOJO_LOG_DIR: env.GOJO_LOG_DIR ?? '',
    GOJO_RUNTIME_DIR: env.GOJO_RUNTIME_DIR ?? '',
    GOJO_TEMP_DIR: env.GOJO_TEMP_DIR ?? '',
    GOJO_SEARCH_HELPERS_DIR: env.GOJO_SEARCH_HELPERS_DIR ?? '',
    XDG_CONFIG_HOME: env.XDG_CONFIG_HOME ?? '',
    XDG_DATA_HOME: env.XDG_DATA_HOME ?? '',
    XDG_CACHE_HOME: env.XDG_CACHE_HOME ?? '',
    XDG_STATE_HOME: env.XDG_STATE_HOME ?? '',
    LOCALAPPDATA: env.LOCALAPPDATA ?? '',
    APPDATA: env.APPDATA ?? '',
  });
}

export function getProductEnvironment(): {
  identity: ProductIdentity;
  paths: ProductPaths;
} {
  const cacheKey = createEnvironmentCacheKey(process.env);

  if (!cachedEnvironment || cachedEnvironment.cacheKey !== cacheKey) {
    const paths = resolveProductPathsForEnvironment(process.env);
    ensureProductDirectories(paths);
    cachedEnvironment = {
      cacheKey,
      identity: resolveProductIdentity(process.env),
      paths,
    };
  }

  return cachedEnvironment;
}
