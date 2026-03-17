import fs from 'node:fs/promises';
import path from 'node:path';

import {
  getDataDirectory,
  getGenerationArtifactFilePath,
  getGenerationDirectory,
  getGenerationLifecycleFilePath,
  getGenerationsDirectory,
  getGenerationStateFilePath,
  loadCurrentGenerationPointer,
  loadGenerationLifecycleMarker,
  REQUIRED_GENERATION_ARTIFACT_FILES,
} from './generation-store.js';

export interface GenerationDebrisEntry {
  generationId: string;
  status: 'active-staged' | 'abandoned' | 'committed';
  reason: string;
  directoryPath: string;
}

export interface GenerationDebrisCleanupReport {
  checkedAt: string;
  removed: GenerationDebrisEntry[];
  preserved: GenerationDebrisEntry[];
}

export interface CleanupGenerationDebrisOptions {
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  applyDeletes?: boolean;
  maxStagedAgeMs?: number;
}

const DEFAULT_MAX_STAGED_AGE_MS = 15 * 60 * 1000;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return 'unknown staged-generation cleanup failure';
}

function getMaintenanceDirectory(): string {
  return path.join(getDataDirectory(), 'maintenance', 'abandoned-generations');
}

async function snapshotAbandonedGeneration(entry: GenerationDebrisEntry): Promise<void> {
  const snapshotDirectory = getMaintenanceDirectory();
  await fs.mkdir(snapshotDirectory, { recursive: true });
  await fs.writeFile(
    path.join(snapshotDirectory, `${entry.generationId}.json`),
    JSON.stringify(
      {
        generationId: entry.generationId,
        cleanedAt: new Date().toISOString(),
        reason: entry.reason,
        directoryPath: entry.directoryPath,
        lifecyclePath: getGenerationLifecycleFilePath(entry.generationId),
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function classifyGenerationDirectory(
  generationId: string,
  nowMs: number,
  currentGenerationId: string | null,
  maxStagedAgeMs: number,
): Promise<GenerationDebrisEntry> {
  const directoryPath = getGenerationDirectory(generationId);
  const lifecycle = await loadGenerationLifecycleMarker(generationId).catch(() => null);

  if (lifecycle?.status === 'committed' || generationId === currentGenerationId) {
    return {
      generationId,
      status: 'committed',
      reason:
        lifecycle?.status === 'committed'
          ? 'generation lifecycle marker is committed'
          : 'generation matches the current published pointer',
      directoryPath,
    };
  }

  const stageTimestamp = lifecycle?.updatedAt ?? lifecycle?.createdAt;
  const ageMs = stageTimestamp ? Math.max(0, nowMs - Date.parse(stageTimestamp)) : Number.POSITIVE_INFINITY;
  const stateFileExists = await fileExists(getGenerationStateFilePath(generationId));
  const requiredArtifactChecks = await Promise.all(
    REQUIRED_GENERATION_ARTIFACT_FILES.map((fileName) =>
      fileExists(getGenerationArtifactFilePath(generationId, fileName)),
    ),
  );
  const missingRequiredCount = requiredArtifactChecks.filter((exists) => !exists).length;

  if (lifecycle?.status === 'staged' && ageMs <= maxStagedAgeMs) {
    return {
      generationId,
      status: 'active-staged',
      reason: `generation is still staged and only ${Math.round(ageMs / 1000)}s old`,
      directoryPath,
    };
  }

  if (lifecycle?.status === 'abandoned') {
    return {
      generationId,
      status: 'abandoned',
      reason: lifecycle.reason ?? 'generation lifecycle marker is abandoned',
      directoryPath,
    };
  }

  if (!stateFileExists) {
    return {
      generationId,
      status: 'abandoned',
      reason: 'generation directory is missing index-generation.json and never reached commit',
      directoryPath,
    };
  }

  if (missingRequiredCount > 0 && ageMs > maxStagedAgeMs) {
    return {
      generationId,
      status: 'abandoned',
      reason: `generation is missing ${missingRequiredCount} required artifact(s) and is older than the staged-age threshold`,
      directoryPath,
    };
  }

  return {
    generationId,
    status: 'active-staged',
    reason: 'generation is unpublished but still within the staged-age threshold',
    directoryPath,
  };
}

export async function cleanupGenerationDebris(
  options: CleanupGenerationDebrisOptions = {},
): Promise<GenerationDebrisCleanupReport> {
  const logger = options.logger ?? console;
  const applyDeletes = options.applyDeletes ?? true;
  const maxStagedAgeMs = options.maxStagedAgeMs ?? DEFAULT_MAX_STAGED_AGE_MS;
  const checkedAt = new Date().toISOString();
  const currentPointer = await loadCurrentGenerationPointer();
  const currentGenerationId = currentPointer?.generationId ?? null;
  const entries = await fs.readdir(getGenerationsDirectory(), { withFileTypes: true }).catch(() => []);
  const removed: GenerationDebrisEntry[] = [];
  const preserved: GenerationDebrisEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const classified = await classifyGenerationDirectory(
      entry.name,
      Date.now(),
      currentGenerationId,
      maxStagedAgeMs,
    );

    if (classified.status !== 'abandoned') {
      preserved.push(classified);
      continue;
    }

    if (!applyDeletes) {
      preserved.push(classified);
      continue;
    }

    try {
      await snapshotAbandonedGeneration(classified);
      await fs.rm(classified.directoryPath, { recursive: true, force: true });
      removed.push(classified);
      logger.info(
        `[generation-debris] removed generation=${classified.generationId} reason=${classified.reason}`,
      );
    } catch (error) {
      preserved.push({
        ...classified,
        reason: `${classified.reason}; cleanup failed: ${describeUnknownError(error)}`,
      });
      logger.warn(
        `[generation-debris] failed generation=${classified.generationId} reason=${describeUnknownError(error)}`,
      );
    }
  }

  return {
    checkedAt,
    removed,
    preserved,
  };
}
