import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import type {
  BuildMetadata,
  BuildPlatform,
  BuildArch,
  HelperPackagingMode,
  PackagingMode,
} from '../../types.js';
import { PRODUCT_NAME } from './constants.js';
import { resolvePackageRootFromEnv } from './packageRootResolver.js';
import { resolveVersionMetadata } from './versionResolver.js';

function normalizePlatform(platform: NodeJS.Platform): BuildPlatform {
  if (platform === 'linux' || platform === 'darwin') {
    return platform;
  }

  if (platform === 'win32') {
    return 'windows';
  }

  return 'unknown';
}

function normalizeArch(arch: string): BuildArch {
  if (arch === 'x64' || arch === 'arm64') {
    return arch;
  }

  return 'unknown';
}

function resolvePackagingMode(env: NodeJS.ProcessEnv): PackagingMode {
  return env.GOJO_PACKAGED === 'true' ? 'release' : 'dev';
}

function findExecutableOnPath(commandName: string): string | null {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(locator, [commandName], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (result.status !== 0) {
    return null;
  }

  const firstLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine ?? null;
}

function fileExists(candidatePath: string): boolean {
  try {
    return fs.statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

function resolveExistingPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveHelperCandidates(env: NodeJS.ProcessEnv): {
  webserver: string | null;
  indexer: string | null;
  helperPackaging: HelperPackagingMode;
} {
  const packageRoot = resolvePackageRootFromEnv(env);
  const helperDirectoryCandidates = [
    env.GOJO_SEARCH_HELPERS_DIR?.trim() || null,
    path.join(packageRoot, 'helper'),
    path.join(packageRoot, 'bin', 'search'),
  ].filter((value): value is string => value !== null);
  const packagedWebserver = resolveExistingPath(
    helperDirectoryCandidates.flatMap((directory) => [
      path.join(directory, 'zoekt-webserver'),
      path.join(directory, 'zoekt-webserver.exe'),
    ]),
  );
  const packagedIndexer = resolveExistingPath(
    helperDirectoryCandidates.flatMap((directory) => [
      path.join(directory, 'zoekt-git-index'),
      path.join(directory, 'zoekt-git-index.exe'),
    ]),
  );
  const envWebserver = env.GOJO_ZOEKT_WEBSERVER_PATH?.trim() || null;
  const envIndexer = env.GOJO_ZOEKT_GIT_INDEX_PATH?.trim() || null;
  const pathWebserver = findExecutableOnPath(process.platform === 'win32' ? 'zoekt-webserver.exe' : 'zoekt-webserver');
  const pathIndexer = findExecutableOnPath(process.platform === 'win32' ? 'zoekt-git-index.exe' : 'zoekt-git-index');

  const packagedDetected = packagedWebserver !== null || packagedIndexer !== null;
  if (packagedDetected) {
    return {
      webserver: packagedWebserver,
      indexer: packagedIndexer,
      helperPackaging: 'bundled',
    };
  }

  if (envWebserver || envIndexer || pathWebserver || pathIndexer) {
    return {
      webserver: envWebserver ?? pathWebserver,
      indexer: envIndexer ?? pathIndexer,
      helperPackaging: 'external',
    };
  }

  return {
    webserver: null,
    indexer: null,
    helperPackaging: 'unknown',
  };
}

export function validateBuildMetadata(metadata: BuildMetadata): void {
  if (!metadata.productName.trim()) {
    throw new Error('Build metadata is invalid: productName is required.');
  }

  if (!metadata.version.trim()) {
    throw new Error('Build metadata is invalid: version is required.');
  }

  if (!metadata.gitSha.trim()) {
    throw new Error('Build metadata is invalid: gitSha is required.');
  }

  if (!metadata.buildTimestamp.trim()) {
    throw new Error('Build metadata is invalid: buildTimestamp is required.');
  }

  if (!['linux', 'darwin', 'windows', 'unknown'].includes(metadata.platform)) {
    throw new Error(`Build metadata is invalid: platform "${metadata.platform}" is unsupported.`);
  }

  if (!['x64', 'arm64', 'unknown'].includes(metadata.arch)) {
    throw new Error(`Build metadata is invalid: arch "${metadata.arch}" is unsupported.`);
  }

  if (!['dev', 'release'].includes(metadata.packagingMode)) {
    throw new Error(`Build metadata is invalid: packagingMode "${metadata.packagingMode}" is unsupported.`);
  }

  if (!['bundled', 'external', 'unknown'].includes(metadata.helperPackaging)) {
    throw new Error(
      `Build metadata is invalid: helperPackaging "${metadata.helperPackaging}" is unsupported.`,
    );
  }
}

export function getBuildMetadata(env: NodeJS.ProcessEnv = process.env): BuildMetadata {
  const version = resolveVersionMetadata(env);
  const helperCandidates = resolveHelperCandidates(env);
  const helperPaths = [helperCandidates.webserver, helperCandidates.indexer].filter(
    (value): value is string => value !== null,
  );

  const metadata: BuildMetadata = {
    productName: PRODUCT_NAME,
    version: version.version,
    gitSha: version.gitSha,
    buildTimestamp: version.buildTimestamp,
    platform: normalizePlatform(process.platform),
    arch: normalizeArch(process.arch),
    packagingMode: resolvePackagingMode(env),
    helperPackaging: helperCandidates.helperPackaging,
    helperPaths,
    isDev: resolvePackagingMode(env) === 'dev',
  };

  validateBuildMetadata(metadata);
  return metadata;
}
