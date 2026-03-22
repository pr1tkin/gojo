import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type { BuildMetadata } from '../../mcp-server/src/types.ts';
import {
  getReleaseManifestPath,
  getTempExtractionDirectory,
  loadVersionFile,
  runCommand,
  stableStringify,
} from './shared.ts';

export interface ReleaseManifestArtifact {
  filename: string;
  platform: string;
  arch: string;
  size: number;
  checksum: string;
}

export interface ReleaseManifest {
  product: string;
  version: string;
  gitSha: string;
  buildTimestamp: string;
  packagingMode: string;
  helperPackaging: string;
  helperFilenames: string[];
  artifacts: ReleaseManifestArtifact[];
}

function parseChecksumsFile(checksumsPath: string): Map<string, string> {
  if (!fs.existsSync(checksumsPath)) {
    throw new Error(`Checksums file is missing: ${checksumsPath}`);
  }

  const content = fs.readFileSync(checksumsPath, 'utf8');
  const map = new Map<string, string>();
  for (const line of content.split(/\r?\n/).filter((entry) => entry.trim().length > 0)) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) {
      throw new Error(`Invalid checksum entry: ${line}`);
    }

    map.set(match[2], match[1]);
  }

  return map;
}

async function inspectArtifact(
  artifactPath: string,
): Promise<{ metadata: BuildMetadata; helperFiles: string[]; size: number }> {
  const extractionDirectory = getTempExtractionDirectory();

  try {
    runCommand('tar', ['-xzf', artifactPath, '-C', extractionDirectory]);
    const metadata = loadVersionFile(path.join(extractionDirectory, 'VERSION'));
    const helperFiles = fs
      .readdirSync(path.join(extractionDirectory, 'helper'))
      .sort()
      .filter((entry) => entry !== 'manifest.json');

    return {
      metadata,
      helperFiles,
      size: fs.statSync(artifactPath).size,
    };
  } finally {
    await fsp.rm(extractionDirectory, { recursive: true, force: true });
  }
}

export async function writeReleaseManifest(
  artifactPaths: string[],
  checksumsPath: string,
  outputPath?: string,
): Promise<{ outputPath: string; manifest: ReleaseManifest }> {
  if (artifactPaths.length === 0) {
    throw new Error('Release manifest generation requires at least one release artifact.');
  }

  const normalizedArtifactPaths = [...artifactPaths]
    .map((artifactPath) => path.resolve(artifactPath))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
  const checksumMap = parseChecksumsFile(checksumsPath);

  const inspected = await Promise.all(normalizedArtifactPaths.map((artifactPath) => inspectArtifact(artifactPath)));
  const firstMetadata = inspected[0].metadata;
  const helperFilenames = Array.from(
    new Set(inspected.flatMap((entry) => entry.helperFiles)),
  ).sort();

  for (const { metadata } of inspected) {
    if (
      metadata.productName !== firstMetadata.productName ||
      metadata.version !== firstMetadata.version ||
      metadata.gitSha !== firstMetadata.gitSha ||
      metadata.buildTimestamp !== firstMetadata.buildTimestamp
    ) {
      throw new Error('Release artifacts do not share a consistent metadata snapshot.');
    }
  }

  const artifacts: ReleaseManifestArtifact[] = normalizedArtifactPaths.map((artifactPath, index) => {
    const filename = path.basename(artifactPath);
    const checksum = checksumMap.get(filename);
    if (!checksum) {
      throw new Error(`Checksum entry is missing for ${filename}.`);
    }

    return {
      filename,
      platform: inspected[index].metadata.platform,
      arch: inspected[index].metadata.arch,
      size: inspected[index].size,
      checksum,
    };
  });

  const manifest: ReleaseManifest = {
    product: firstMetadata.productName,
    version: firstMetadata.version,
    gitSha: firstMetadata.gitSha,
    buildTimestamp: firstMetadata.buildTimestamp,
    packagingMode: firstMetadata.packagingMode,
    helperPackaging: firstMetadata.helperPackaging,
    helperFilenames,
    artifacts,
  };

  const targetOutputPath =
    outputPath ?? getReleaseManifestPath(path.dirname(normalizedArtifactPaths[0]));
  await fsp.mkdir(path.dirname(targetOutputPath), { recursive: true });
  await fsp.writeFile(targetOutputPath, stableStringify(manifest), 'utf8');

  return {
    outputPath: targetOutputPath,
    manifest,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [checksumsPath, ...artifactPaths] = process.argv.slice(2);

  if (!checksumsPath || artifactPaths.length === 0) {
    process.stderr.write('Usage: write-release-manifest.ts <checksums-path> <artifact> [artifact...]\n');
    process.exitCode = 1;
  } else {
    writeReleaseManifest(artifactPaths, checksumsPath)
      .then((result) => {
        process.stdout.write(stableStringify(result));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      });
  }
}
