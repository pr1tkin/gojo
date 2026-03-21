import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  GojoPackagingModel,
  ProductIdentity,
  ProductPaths,
  SearchRuntimeConfig,
  SearchRuntimeMode,
} from '../types.js';

const PRODUCT_NAME = 'gojo';
const PRODUCT_VERSION_FALLBACK = '1.0.0';
const PACKAGING_MODEL: GojoPackagingModel = 'single_surface_with_packaged_runtime';

function resolvePackageRoot(env: NodeJS.ProcessEnv): string {
  if (env.GOJO_PACKAGE_ROOT?.trim()) {
    return path.resolve(env.GOJO_PACKAGE_ROOT.trim());
  }

  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDirectory, '../..');
}

function readPackageVersion(packageRoot: string, env: NodeJS.ProcessEnv): string {
  if (env.GOJO_VERSION?.trim()) {
    return env.GOJO_VERSION.trim();
  }

  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as { version?: string };
    return packageJson.version?.trim() || PRODUCT_VERSION_FALLBACK;
  } catch {
    return PRODUCT_VERSION_FALLBACK;
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

function resolveDefaultDataDir(env: NodeJS.ProcessEnv, homeDir: string): string {
  if (env.GOJO_DATA_DIR?.trim()) {
    return path.resolve(env.GOJO_DATA_DIR.trim());
  }

  const legacyWorkspaceDataDir = path.resolve(process.cwd(), '.data');
  if (fs.existsSync(legacyWorkspaceDataDir) && fs.statSync(legacyWorkspaceDataDir).isDirectory()) {
    return legacyWorkspaceDataDir;
  }

  return path.join(homeDir, 'data');
}

function resolveProductPaths(env: NodeJS.ProcessEnv, packageRoot: string): ProductPaths {
  const homeDir = resolveDefaultHomeDir(env);
  const stateBaseDir = resolveStateBaseDir(env);

  const configDir = path.resolve(
    env.GOJO_CONFIG_DIR?.trim() ||
      (process.platform === 'win32'
        ? path.join(homeDir, 'config')
        : path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), PRODUCT_NAME)),
  );
  const dataDir = path.resolve(resolveDefaultDataDir(env, homeDir));
  const indexesDir = path.resolve(env.GOJO_INDEXES_DIR?.trim() || path.join(dataDir, 'indexes'));
  const cacheDir = path.resolve(
    env.GOJO_CACHE_DIR?.trim() ||
      (process.platform === 'win32'
        ? path.join(homeDir, 'cache')
        : path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), PRODUCT_NAME)),
  );
  const logDir = path.resolve(env.GOJO_LOG_DIR?.trim() || path.join(stateBaseDir, 'logs'));
  const runtimeDir = path.resolve(env.GOJO_RUNTIME_DIR?.trim() || path.join(stateBaseDir, 'runtime'));
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
  const packageRoot = resolvePackageRoot(env);
  return {
    name: PRODUCT_NAME,
    version: readPackageVersion(packageRoot, env),
    packagingModel: PACKAGING_MODEL,
  };
}

export function resolveProductPathsForEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ProductPaths {
  const packageRoot = resolvePackageRoot(env);
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

  const packageRoot = resolvePackageRoot(env);
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
  const baseUrl = env.ZOEKT_BASE_URL?.trim() || 'http://127.0.0.1:6070';
  const configuredMode = env.GOJO_RUNTIME_MODE?.trim();
  const mode: SearchRuntimeMode =
    configuredMode === 'packaged' || configuredMode === 'development'
      ? configuredMode
      : env.GOJO_PACKAGED === 'true'
        ? 'packaged'
        : 'development';

  return {
    baseUrl: new URL(baseUrl).toString().replace(/\/$/, ''),
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
      identity: ProductIdentity;
      paths: ProductPaths;
    }
  | undefined;

export function getProductEnvironment(): {
  identity: ProductIdentity;
  paths: ProductPaths;
} {
  if (!cachedEnvironment) {
    const paths = resolveProductPathsForEnvironment(process.env);
    ensureProductDirectories(paths);
    cachedEnvironment = {
      identity: resolveProductIdentity(process.env),
      paths,
    };
  }

  return cachedEnvironment;
}
