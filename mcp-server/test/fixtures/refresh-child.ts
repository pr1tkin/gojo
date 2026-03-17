import fs from 'node:fs/promises';
import path from 'node:path';

import { refreshIndexes } from '../../src/indexing/refresh.js';

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function waitForFile(filePath: string): Promise<void> {
  for (;;) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      await wait(50);
    }
  }
}

async function signalAndMaybePause(signalFile: string | undefined, releaseFile: string | undefined): Promise<void> {
  if (signalFile) {
    await fs.mkdir(path.dirname(signalFile), { recursive: true });
    await fs.writeFile(signalFile, 'ready', 'utf8');
  }

  if (process.env.REPORADAR_CHILD_CRASH_ON_SIGNAL === 'true') {
    process.exit(86);
  }

  if (releaseFile) {
    await waitForFile(releaseFile);
  }
}

async function main(): Promise<void> {
  const reposRoot = process.argv[2];
  const resultFile = process.argv[3];

  if (!reposRoot || !resultFile) {
    throw new Error('Expected reposRoot and resultFile arguments.');
  }

  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };

  const result = await refreshIndexes(reposRoot, {
    logger,
    testHooks: {
      onSingleFlightRunStart: async ({ iteration }) => {
        if (iteration !== 1) {
          return;
        }

        if (process.env.REPORADAR_CHILD_HOLD_ON_START === 'true') {
          await signalAndMaybePause(
            process.env.REPORADAR_CHILD_SIGNAL_FILE,
            process.env.REPORADAR_CHILD_RELEASE_FILE,
          );
        }
      },
      afterManifestScanned: async ({ hasPreviousGeneration }) => {
        if (!hasPreviousGeneration) {
          return;
        }

        if (process.env.REPORADAR_CHILD_HOLD_AFTER_MANIFEST === 'true') {
          await signalAndMaybePause(
            process.env.REPORADAR_CHILD_SIGNAL_FILE,
            process.env.REPORADAR_CHILD_RELEASE_FILE,
          );
        }
      },
    },
  });

  await fs.mkdir(path.dirname(resultFile), { recursive: true });
  await fs.writeFile(
    resultFile,
    JSON.stringify(
      {
        generationId: result.diagnostics.generationId,
        status: result.diagnostics.status,
      },
      null,
      2,
    ),
    'utf8',
  );
}

main().catch(async (error) => {
  const resultFile = process.argv[3];

  if (resultFile) {
    await fs.mkdir(path.dirname(resultFile), { recursive: true });
    await fs.writeFile(
      resultFile,
      JSON.stringify(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  process.exit(1);
});
