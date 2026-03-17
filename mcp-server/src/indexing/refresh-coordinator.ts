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
  startedAt: string;
  heartbeatAt: string;
}

interface RefreshLockHandle {
  scopeKey: string;
  lockPath: string;
  metadataPath: string;
  ownerId: string;
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

interface RefreshCoordinatorOptions {
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  testHooks?: RefreshCoordinatorTestHooks;
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

async function clearRefreshPending(reposRoot: string): Promise<void> {
  await fs.rm(getRefreshPendingFilePath(reposRoot), { force: true });
}

async function consumeRefreshPending(reposRoot: string): Promise<boolean> {
  const filePath = getRefreshPendingFilePath(reposRoot);

  try {
    await fs.access(filePath);
  } catch {
    return false;
  }

  await fs.rm(filePath, { force: true });
  return true;
}

async function acquireRefreshLock(
  reposRoot: string,
  logger: Pick<Console, 'info' | 'warn' | 'error'>,
): Promise<RefreshLockHandle> {
  const scopeKey = createScopeKey(reposRoot);
  const lockPath = getRefreshLockFilePath(reposRoot);
  const metadataPath = getLockMetadataPath(lockPath);
  const ownerId = `${process.pid}-${randomUUID()}`;
  let waitLogged = false;

  await fs.mkdir(getRefreshLockRootDirectory(), { recursive: true });

  for (;;) {
    try {
      await fs.mkdir(lockPath);
      const metadata = createLockMetadata(ownerId, reposRoot);
      await writeLockMetadata(metadataPath, metadata);

      const heartbeat = setInterval(() => {
        void writeLockMetadata(metadataPath, {
          ...metadata,
          heartbeatAt: new Date().toISOString(),
        }).catch(() => undefined);
      }, REFRESH_LOCK_HEARTBEAT_MS);

      logger.info(`[refresh-lock] reposRoot=${path.resolve(reposRoot)} action=lock-acquired owner=${ownerId}`);

      return {
        scopeKey,
        lockPath,
        metadataPath,
        ownerId,
        release: async () => {
          clearInterval(heartbeat);
          await fs.rm(lockPath, { recursive: true, force: true });
          logger.info(`[refresh-lock] reposRoot=${path.resolve(reposRoot)} action=lock-released owner=${ownerId}`);
        },
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
          `[refresh-lock] reposRoot=${path.resolve(reposRoot)} action=stale-lock-recovered lockPath=${lockPath}`,
        );
        await fs.rm(lockPath, { recursive: true, force: true });
        continue;
      }

      if (!waitLogged) {
        logger.info(
          `[refresh-lock] reposRoot=${path.resolve(reposRoot)} action=lock-busy owner=${metadata?.ownerId ?? 'unknown'} lockPath=${lockPath}`,
        );
        waitLogged = true;
      }

      await wait(REFRESH_LOCK_WAIT_MS);
    }
  }
}

export async function runSingleFlightRefresh<TResult>(
  reposRoot: string,
  runner: () => Promise<TResult>,
  options: RefreshCoordinatorOptions = {},
): Promise<TResult> {
  const logger = options.logger ?? console;
  const scopeKey = createScopeKey(reposRoot);
  const existingFlight = localRefreshFlights.get(scopeKey) as LocalRefreshFlight<TResult> | undefined;

  if (existingFlight) {
    if (existingFlight.phase === 'running') {
      existingFlight.pendingRequested = true;
      await markRefreshPending(reposRoot);
      logger.info(
        `[refresh-lock] reposRoot=${path.resolve(reposRoot)} action=follow-up-scheduled reason=active-refresh`,
      );
    } else {
      logger.info(
        `[refresh-lock] reposRoot=${path.resolve(reposRoot)} action=join-waiting-refresh`,
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
    let iteration = 0;

    try {
      for (;;) {
        iteration += 1;
        const lockHandle = await acquireRefreshLock(reposRoot, logger);

        try {
          flight.phase = 'running';
          flight.pendingRequested = false;
          await clearRefreshPending(reposRoot);
          logger.info(
            `[refresh-lock] reposRoot=${path.resolve(reposRoot)} action=refresh-start iteration=${iteration}`,
          );
          await options.testHooks?.onSingleFlightRunStart?.({ iteration, reposRoot: path.resolve(reposRoot) });
          const result = await runner();
          const pendingFromMarker = await consumeRefreshPending(reposRoot);
          const hadFollowUpRequest = flight.pendingRequested || pendingFromMarker;
          await options.testHooks?.onSingleFlightRunComplete?.({
            iteration,
            reposRoot: path.resolve(reposRoot),
            hadFollowUpRequest,
          });

          if (hadFollowUpRequest) {
            flight.phase = 'waiting';
            flight.pendingRequested = false;
            logger.info(
              `[refresh-lock] reposRoot=${path.resolve(reposRoot)} action=follow-up-refresh-start iteration=${iteration + 1}`,
            );
            continue;
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
