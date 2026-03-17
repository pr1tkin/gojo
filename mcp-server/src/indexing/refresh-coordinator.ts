import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getCoordinationDirectory } from './generation-store.js';

const REFRESH_LOCK_STALE_MS = 30_000;
const REFRESH_LOCK_HEARTBEAT_MS = 1_000;
const REFRESH_LOCK_WAIT_MS = 100;

interface RefreshLockMetadata {
  ownerId: string;
  ownerPid: number;
  ownerHost: string;
  reposRoot: string;
  phase: 'primary' | 'follow-up';
  startedAt: string;
  heartbeatAt: string;
}

interface RefreshLockHandle {
  scopeKey: string;
  lockPath: string;
  metadataPath: string;
  ownerId: string;
  updatePhase: (phase: RefreshLockMetadata['phase']) => Promise<void>;
  release: () => Promise<void>;
}

export interface RefreshCoordinatorTestHooks {
  onSingleFlightRunStart?: (context: { iteration: number; reposRoot: string }) => Promise<void> | void;
  onSingleFlightRunComplete?: (context: {
    iteration: number;
    reposRoot: string;
    hadFollowUpRequest: boolean;
  }) => Promise<void> | void;
}

interface RefreshCoordinatorOptions<TResult> {
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  testHooks?: RefreshCoordinatorTestHooks;
  loadSettledResult?: () => Promise<TResult | null>;
}

interface LocalRefreshFlight<TResult> {
  phase: 'waiting' | 'running';
  pendingRequested: boolean;
  promise: Promise<TResult>;
}

const localRefreshFlights = new Map<string, LocalRefreshFlight<unknown>>();

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function createScopeKey(reposRoot: string): string {
  return createHash('sha256').update(path.resolve(reposRoot)).digest('hex');
}

function getRefreshLockRootDirectory(): string {
  return path.join(getCoordinationDirectory(), 'refresh-locks');
}

export function getRefreshLockFilePath(reposRoot: string): string {
  return path.join(getRefreshLockRootDirectory(), `${createScopeKey(reposRoot)}.lock`);
}

function getRefreshPendingFilePath(reposRoot: string): string {
  return path.join(getRefreshLockRootDirectory(), `${createScopeKey(reposRoot)}.pending.json`);
}

function getLockMetadataPath(lockPath: string): string {
  return path.join(lockPath, 'lock.json');
}

function createLockMetadata(ownerId: string, reposRoot: string): RefreshLockMetadata {
  const now = new Date().toISOString();
  return {
    ownerId,
    ownerPid: process.pid,
    ownerHost: os.hostname(),
    reposRoot: path.resolve(reposRoot),
    phase: 'primary',
    startedAt: now,
    heartbeatAt: now,
  };
}

async function writeLockMetadata(metadataPath: string, metadata: RefreshLockMetadata): Promise<void> {
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
}

async function readLockMetadata(lockPath: string): Promise<RefreshLockMetadata | null> {
  try {
    const content = await fs.readFile(getLockMetadataPath(lockPath), 'utf8');
    return JSON.parse(content) as RefreshLockMetadata;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';

    return code === 'EPERM';
  }
}

function isStaleLock(metadata: RefreshLockMetadata | null): boolean {
  if (!metadata) {
    return true;
  }

  const heartbeatTime = Date.parse(metadata.heartbeatAt);

  if (!Number.isFinite(heartbeatTime)) {
    return true;
  }

  if (Date.now() - heartbeatTime > REFRESH_LOCK_STALE_MS) {
    return true;
  }

  if (metadata.ownerHost === os.hostname() && !isProcessAlive(metadata.ownerPid)) {
    return true;
  }

  return false;
}

async function markRefreshPending(reposRoot: string): Promise<void> {
  const filePath = getRefreshPendingFilePath(reposRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        reposRoot: path.resolve(reposRoot),
        requestedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function hasRefreshPending(reposRoot: string): Promise<boolean> {
  try {
    await fs.access(getRefreshPendingFilePath(reposRoot));
    return true;
  } catch {
    return false;
  }
}

async function clearRefreshPending(reposRoot: string): Promise<void> {
  await fs.rm(getRefreshPendingFilePath(reposRoot), { force: true });
}

async function tryAcquireRefreshLock(
  reposRoot: string,
  logger: Pick<Console, 'info' | 'warn' | 'error'>,
): Promise<{ handle: RefreshLockHandle | null; busyMetadata: RefreshLockMetadata | null }> {
  const scopeKey = createScopeKey(reposRoot);
  const lockPath = getRefreshLockFilePath(reposRoot);
  const metadataPath = getLockMetadataPath(lockPath);
  const ownerId = `${process.pid}-${randomUUID()}`;
  const resolvedReposRoot = path.resolve(reposRoot);

  await fs.mkdir(getRefreshLockRootDirectory(), { recursive: true });

  for (;;) {
    try {
      await fs.mkdir(lockPath);
      let metadata = createLockMetadata(ownerId, reposRoot);
      await writeLockMetadata(metadataPath, metadata);

      const heartbeat = setInterval(() => {
        void writeLockMetadata(metadataPath, {
          ...metadata,
          heartbeatAt: new Date().toISOString(),
        }).catch(() => undefined);
      }, REFRESH_LOCK_HEARTBEAT_MS);

      logger.info(`[refresh-lock] reposRoot=${resolvedReposRoot} action=lock-acquired owner=${ownerId}`);

      return {
        handle: {
          scopeKey,
          lockPath,
          metadataPath,
          ownerId,
          updatePhase: async (phase) => {
            metadata = {
              ...metadata,
              phase,
              heartbeatAt: new Date().toISOString(),
            };
            await writeLockMetadata(metadataPath, metadata);
          },
          release: async () => {
            clearInterval(heartbeat);
            await fs.rm(lockPath, { recursive: true, force: true });
            logger.info(`[refresh-lock] reposRoot=${resolvedReposRoot} action=lock-released owner=${ownerId}`);
          },
        },
        busyMetadata: null,
      };
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: string }).code)
          : '';

      if (code !== 'EEXIST') {
        throw error;
      }

      const metadata = await readLockMetadata(lockPath);

      if (isStaleLock(metadata)) {
        logger.warn(
          `[refresh-lock] reposRoot=${resolvedReposRoot} action=stale-lock-recovered lockPath=${lockPath}`,
        );
        await fs.rm(lockPath, { recursive: true, force: true });
        continue;
      }

      return {
        handle: null,
        busyMetadata: metadata,
      };
    }
  }
}

async function waitForRefreshSettlement<TResult>(
  reposRoot: string,
  loadSettledResult: (() => Promise<TResult | null>) | undefined,
): Promise<{ settled: boolean; result: TResult | null }> {
  const lockPath = getRefreshLockFilePath(reposRoot);

  for (;;) {
    const metadata = await readLockMetadata(lockPath);

    if (metadata && !isStaleLock(metadata)) {
      await wait(REFRESH_LOCK_WAIT_MS);
      continue;
    }

    if (metadata && isStaleLock(metadata)) {
      return { settled: false, result: null };
    }

    if (await hasRefreshPending(reposRoot)) {
      return { settled: false, result: null };
    }

    const result = loadSettledResult ? await loadSettledResult() : null;
    return {
      settled: result !== null,
      result,
    };
  }
}

export async function runSingleFlightRefresh<TResult>(
  reposRoot: string,
  runner: () => Promise<TResult>,
  options: RefreshCoordinatorOptions<TResult> = {},
): Promise<TResult> {
  const logger = options.logger ?? console;
  const resolvedReposRoot = path.resolve(reposRoot);
  const scopeKey = createScopeKey(reposRoot);
  const existingFlight = localRefreshFlights.get(scopeKey) as LocalRefreshFlight<TResult> | undefined;

  if (existingFlight) {
    if (existingFlight.phase === 'running') {
      existingFlight.pendingRequested = true;
      await markRefreshPending(reposRoot);
      logger.info(
        `[refresh-lock] reposRoot=${resolvedReposRoot} action=follow-up-scheduled reason=active-local-refresh`,
      );
    } else {
      logger.info(
        `[refresh-lock] reposRoot=${resolvedReposRoot} action=join-waiting-refresh`,
      );
    }

    return existingFlight.promise;
  }

  const flight: LocalRefreshFlight<TResult> = {
    phase: 'waiting',
    pendingRequested: false,
    promise: Promise.resolve(undefined as TResult),
  };

  flight.promise = (async () => {
    try {
      for (;;) {
        const { handle: lockHandle, busyMetadata } = await tryAcquireRefreshLock(reposRoot, logger);

        if (!lockHandle) {
          logger.info(
            `[refresh-lock] reposRoot=${resolvedReposRoot} action=refresh-skipped owner=${busyMetadata?.ownerId ?? 'unknown'} phase=${busyMetadata?.phase ?? 'unknown'}`,
          );

          if (busyMetadata?.phase === 'primary') {
            if (!(await hasRefreshPending(reposRoot))) {
              await markRefreshPending(reposRoot);
              logger.info(
                `[refresh-lock] reposRoot=${resolvedReposRoot} action=follow-up-scheduled reason=active-cross-process-refresh`,
              );
            } else {
              logger.info(
                `[refresh-lock] reposRoot=${resolvedReposRoot} action=refresh-coalesced reason=follow-up-already-pending`,
              );
            }
          } else {
            logger.info(
              `[refresh-lock] reposRoot=${resolvedReposRoot} action=refresh-coalesced reason=active-follow-up-refresh`,
            );
          }

          const settlement = await waitForRefreshSettlement(reposRoot, options.loadSettledResult);

          if (settlement.settled && settlement.result !== null) {
            return settlement.result;
          }

          continue;
        }

        try {
          let iteration = 1;
          let result: TResult | null = null;
          flight.phase = 'running';
          flight.pendingRequested = false;
          await clearRefreshPending(reposRoot);
          logger.info(
            `[refresh-lock] reposRoot=${resolvedReposRoot} action=refresh-start iteration=${iteration}`,
          );
          await options.testHooks?.onSingleFlightRunStart?.({ iteration, reposRoot: resolvedReposRoot });
          result = await runner();
          const hadFollowUpRequest = flight.pendingRequested || (await hasRefreshPending(reposRoot));
          await options.testHooks?.onSingleFlightRunComplete?.({
            iteration,
            reposRoot: resolvedReposRoot,
            hadFollowUpRequest,
          });

          if (hadFollowUpRequest) {
            await clearRefreshPending(reposRoot);
            await lockHandle.updatePhase('follow-up');
            flight.pendingRequested = false;
            iteration = 2;
            logger.info(
              `[refresh-lock] reposRoot=${resolvedReposRoot} action=follow-up-refresh-triggered iteration=${iteration}`,
            );
            await options.testHooks?.onSingleFlightRunStart?.({ iteration, reposRoot: resolvedReposRoot });
            result = await runner();
            await options.testHooks?.onSingleFlightRunComplete?.({
              iteration,
              reposRoot: resolvedReposRoot,
              hadFollowUpRequest: false,
            });
            await clearRefreshPending(reposRoot);
          }

          return result;
        } finally {
          await lockHandle.release();
          flight.phase = 'waiting';
        }
      }
    } finally {
      localRefreshFlights.delete(scopeKey);
    }
  })();

  localRefreshFlights.set(scopeKey, flight);
  return flight.promise;
}
