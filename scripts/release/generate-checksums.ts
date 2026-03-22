import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import {
  getChecksumsPath,
  stableStringify,
} from './shared.ts';

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(filePath);

  return new Promise<string>((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

export async function generateChecksums(
  artifactPaths: string[],
  outputPath?: string,
): Promise<{ outputPath: string; entries: Array<{ filename: string; sha256: string }> }> {
  if (artifactPaths.length === 0) {
    throw new Error('Checksum generation requires at least one release artifact path.');
  }

  const normalizedArtifactPaths = [...artifactPaths]
    .map((artifactPath) => path.resolve(artifactPath))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));

  for (const artifactPath of normalizedArtifactPaths) {
    if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
      throw new Error(`Release artifact is missing: ${artifactPath}`);
    }
  }

  const targetOutputPath =
    outputPath ?? getChecksumsPath(path.dirname(normalizedArtifactPaths[0]));
  const entries = await Promise.all(
    normalizedArtifactPaths.map(async (artifactPath) => ({
      filename: path.basename(artifactPath),
      sha256: await sha256File(artifactPath),
    })),
  );

  const body = `${entries.map((entry) => `${entry.sha256}  ${entry.filename}`).join('\n')}\n`;
  await fsp.mkdir(path.dirname(targetOutputPath), { recursive: true });
  await fsp.writeFile(targetOutputPath, body, 'utf8');

  return {
    outputPath: targetOutputPath,
    entries,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const artifactPaths = process.argv.slice(2);
  generateChecksums(artifactPaths)
    .then((result) => {
      process.stdout.write(stableStringify(result));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
