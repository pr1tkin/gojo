import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

import { getCurrentSearchFreshness, reconcileCurrentGenerationSearchFreshness } from '../indexing/search-freshness.js';
import { getRuntimeDirectory, saveSearchRefreshSnapshot } from '../indexing/generation-store.js';
import { buildSearchRepoFingerprints } from '../indexing/search-fingerprint.js';
import { listRepositories } from '../repositories.js';
import type { SearchRefreshSnapshot } from '../indexing/types.js';
import type { AppConfig } from '../types.js';
import {
  SearchHelperError,
  validateSearchHelper,
} from '../search/helpers.js';
import type { RuntimeLogger } from './types.js';

let managedWebserver:
  | {
      process: ChildProcess;
      baseUrl: string;
    }
  | undefined;

function isLocalSearchEndpoint(baseUrl: string): boolean {
  const url = new URL(baseUrl);
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

function deriveListenAddress(baseUrl: string): string {
  const url = new URL(baseUrl);
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const host = url.hostname === '127.0.0.1' || url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
  return `${host}:${port}`;
}

async function isSearchEndpointReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(baseUrl);
    return response.status < 500;
  } catch {
    return false;
  }
}

function buildSnapshotId(): string {
  const now = new Date();
  return `${now.toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}-${process.pid}`;
}

function buildReadySnapshot(
  repoFingerprints: Awaited<ReturnType<typeof buildSearchRepoFingerprints>>,
): SearchRefreshSnapshot {
  const refreshedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    fingerprintContractVersion: 1,
    snapshotId: buildSnapshotId(),
    status: 'ready',
    refreshedAt,
    aggregateFingerprint: repoFingerprints.aggregateFingerprint,
    repoFingerprints: repoFingerprints.repoFingerprints,
    details: 'Gojo runtime synchronized the packaged Zoekt index successfully.',
  };
}

function buildFailedSnapshot(errorMessage: string): SearchRefreshSnapshot {
  return {
    schemaVersion: 1,
    fingerprintContractVersion: 1,
    snapshotId: buildSnapshotId(),
    status: 'failed',
    refreshedAt: new Date().toISOString(),
    repoFingerprints: [],
    details: 'Gojo runtime could not refresh the packaged Zoekt index.',
    error: errorMessage,
  };
}

function runProcess(
  executable: string,
  args: string[],
  logger: RuntimeLogger | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      logger?.info(`[search-helper] ${chunk.toString().trim()}`);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      const line = chunk.toString().trim();
      stderr += line;
      logger?.warn(`[search-helper] ${line}`);
    });
    child.once('error', (error) => reject(error));
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(stderr || `helper exited with status ${code ?? 'unknown'}`),
      );
    });
  });
}

async function waitForSearchEndpoint(baseUrl: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isSearchEndpointReachable(baseUrl)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for Zoekt at ${baseUrl}`);
}

function isMissingHelperError(error: unknown): error is SearchHelperError {
  return error instanceof SearchHelperError && error.code === 'missing_search_helper';
}

export async function synchronizeSearchIndexes(
  config: AppConfig,
  reposRoot: string,
  logger?: RuntimeLogger,
): Promise<{
  snapshot: SearchRefreshSnapshot;
  validation: Awaited<ReturnType<typeof validateSearchHelper>>;
}> {
  try {
    const validation = await validateSearchHelper(config, 'indexer');
    await fs.mkdir(config.search.indexDirectory, { recursive: true });

    const repositories = await listRepositories(reposRoot);
    const gitRepositories = repositories.filter((repository) => repository.isGitRepository);

    if (gitRepositories.length === 0) {
      throw new SearchHelperError(
        'search_index_sync_failed',
        'indexer',
        `No Git repositories were found under ${reposRoot}; Gojo cannot build a Zoekt index for search.`,
        ['Index a Git-backed repository or configure search differently for development.'],
      );
    }

    for (const repository of gitRepositories) {
      logger?.info(`[search-helper] indexing repo=${repository.id}`);
      await runProcess(
        validation.helper.executable,
        ['-index', config.search.indexDirectory, repository.rootPath],
        logger,
      );
    }

    const fingerprints = await buildSearchRepoFingerprints(reposRoot);
    const snapshot = buildReadySnapshot(fingerprints);
    await saveSearchRefreshSnapshot(snapshot);
    await reconcileCurrentGenerationSearchFreshness(logger);

    return {
      snapshot,
      validation,
    };
  } catch (error) {
    if (config.search.mode === 'development' && isMissingHelperError(error)) {
      const snapshotPath = path.join(getRuntimeDirectory(), 'coordination', 'zoekt-refresh-state.json');

      await fs.rm(snapshotPath, { force: true }).catch(() => undefined);
      await reconcileCurrentGenerationSearchFreshness(logger).catch(() => undefined);
      logger?.warn(`[search-helper] ${error.message}`);

      return {
        snapshot: {
          schemaVersion: 1,
          fingerprintContractVersion: 1,
          snapshotId: buildSnapshotId(),
          status: 'failed',
          refreshedAt: new Date().toISOString(),
          repoFingerprints: [],
          details: 'Gojo runtime is running without managed Zoekt helpers in development mode.',
          error: error.message,
        },
        validation: {
          helper: {
            kind: 'indexer',
            executable: 'unresolved',
            source: 'dev_fallback',
            mode: config.search.mode,
          },
          available: false,
          executable: false,
          expectedVersion: undefined,
          warnings: [error.message],
        },
      };
    }

    const snapshot = buildFailedSnapshot(
      error instanceof Error ? error.message : String(error),
    );
    await saveSearchRefreshSnapshot(snapshot).catch(() => undefined);
    await reconcileCurrentGenerationSearchFreshness(logger).catch(() => undefined);

    throw error;
  }
}

export async function ensureSearchWebserver(
  config: AppConfig,
  logger?: RuntimeLogger,
): Promise<{
  managed: boolean;
  reachable: boolean;
  validation?: Awaited<ReturnType<typeof validateSearchHelper>>;
}> {
  if (await isSearchEndpointReachable(config.search.baseUrl)) {
    return { managed: Boolean(managedWebserver), reachable: true };
  }

  if (!isLocalSearchEndpoint(config.search.baseUrl)) {
    if (config.search.mode === 'development') {
      logger?.warn(
        `[search-helper] external search endpoint ${config.search.baseUrl} is unreachable; runtime will not attempt to start a local helper`,
      );
      return { managed: false, reachable: false };
    }

    throw new SearchHelperError(
      'search_helper_startup_failed',
      'webserver',
      `Configured search endpoint ${config.search.baseUrl} is unreachable and cannot be started locally.`,
      ['Verify the Gojo search endpoint configuration or reinstall the packaged helpers.'],
    );
  }

  let validation: Awaited<ReturnType<typeof validateSearchHelper>>;

  try {
    validation = await validateSearchHelper(config, 'webserver');
  } catch (error) {
    if (config.search.mode === 'development' && isMissingHelperError(error)) {
      logger?.warn(`[search-helper] ${error.message}`);
      return { managed: false, reachable: false };
    }

    throw error;
  }
  await fs.mkdir(config.search.indexDirectory, { recursive: true });

  if (managedWebserver?.process.exitCode === null && managedWebserver.baseUrl === config.search.baseUrl) {
    await waitForSearchEndpoint(config.search.baseUrl, 5000);
    return { managed: true, reachable: true, validation };
  }

  const child = spawn(
    validation.helper.executable,
    ['-listen', deriveListenAddress(config.search.baseUrl), '-index', config.search.indexDirectory],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  child.stdout.on('data', (chunk: Buffer | string) => {
    logger?.info(`[search-helper] ${chunk.toString().trim()}`);
  });
  child.stderr.on('data', (chunk: Buffer | string) => {
    logger?.warn(`[search-helper] ${chunk.toString().trim()}`);
  });
  child.once('exit', () => {
    if (managedWebserver?.process === child) {
      managedWebserver = undefined;
    }
  });
  child.once('error', (error) => {
    logger?.error(`[search-helper] webserver failed to start: ${error instanceof Error ? error.message : String(error)}`);
  });

  managedWebserver = {
    process: child,
    baseUrl: config.search.baseUrl,
  };

  try {
    await waitForSearchEndpoint(config.search.baseUrl, 5000);
  } catch (error) {
    child.kill();
    managedWebserver = undefined;
    throw new SearchHelperError(
      'search_helper_startup_failed',
      'webserver',
      `Search helper started but Gojo could not confirm Zoekt is reachable at ${config.search.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      ['Reinstall Gojo or verify the packaged search helpers are present and executable.'],
    );
  }

  return {
    managed: true,
    reachable: true,
    validation,
  };
}

export async function inspectSearchRuntime(config: AppConfig): Promise<{
  endpointReachable: boolean;
  webserverHelperAvailable: boolean;
  indexerHelperAvailable: boolean;
  mode: AppConfig['search']['mode'];
  helperWarnings: string[];
  expectedVersion?: string;
  actualVersion?: string;
}> {
  const endpointReachable = await isSearchEndpointReachable(config.search.baseUrl);
  const helperWarnings: string[] = [];
  let webserverHelperAvailable = false;
  let indexerHelperAvailable = false;
  let expectedVersion: string | undefined;
  let actualVersion: string | undefined;

  try {
    const webserverValidation = await validateSearchHelper(config, 'webserver');
    webserverHelperAvailable = webserverValidation.available;
    expectedVersion = webserverValidation.expectedVersion;
    actualVersion = webserverValidation.version;
    helperWarnings.push(...webserverValidation.warnings);
  } catch (error) {
    helperWarnings.push(error instanceof Error ? error.message : String(error));
  }

  try {
    const indexerValidation = await validateSearchHelper(config, 'indexer');
    indexerHelperAvailable = indexerValidation.available;
    expectedVersion = expectedVersion ?? indexerValidation.expectedVersion;
    helperWarnings.push(...indexerValidation.warnings);
  } catch (error) {
    helperWarnings.push(error instanceof Error ? error.message : String(error));
  }

  return {
    endpointReachable,
    webserverHelperAvailable,
    indexerHelperAvailable,
    mode: config.search.mode,
    helperWarnings: [...new Set(helperWarnings)],
    expectedVersion,
    actualVersion,
  };
}

export async function getSearchReadinessSignal(_config: AppConfig): Promise<string> {
  const freshness = await getCurrentSearchFreshness();

  if (!freshness) {
    return 'unknown';
  }

  return freshness.status;
}
