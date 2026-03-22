import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { getBuildMetadata } from '../../mcp-server/src/internal/product/buildMetadata.ts';
import type { BuildMetadata } from '../../mcp-server/src/types.ts';
import {
  assertExecutable,
  copyDirectory,
  copyFile,
  copyProductionNodeModules,
  createVersionSnapshot,
  ensureCleanDirectory,
  getArtifactPath,
  getArtifactStagingRoot,
  getMcpServerRoot,
  getRepoRoot,
  getReleaseBaseEnv,
  getReleaseVersionDirectory,
  stableStringify,
  writeLauncherScript,
  writeRuntimePackageManifest,
  type ReleaseAssemblyResult,
} from './shared.ts';

function resolveSourceLicensePath(repoRoot: string): string {
  const markdownLicense = path.join(repoRoot, 'LICENSE.md');
  if (fs.existsSync(markdownLicense)) {
    return markdownLicense;
  }

  return path.join(repoRoot, 'LICENSE');
}

function createArtifactMetadataEnv(
  baseEnv: NodeJS.ProcessEnv,
  artifactRoot: string,
  sourceMetadata: BuildMetadata,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    GOJO_PACKAGED: 'true',
    GOJO_PACKAGE_ROOT: artifactRoot,
    GOJO_SEARCH_HELPERS_DIR: path.join(artifactRoot, 'helper'),
    GOJO_VERSION: sourceMetadata.version,
    GOJO_GIT_SHA: sourceMetadata.gitSha,
    GOJO_BUILD_TIMESTAMP: sourceMetadata.buildTimestamp,
  };
}

function assertBundledHelpers(metadata: BuildMetadata): void {
  if (metadata.helperPackaging !== 'bundled') {
    throw new Error(
      `Release artifact metadata is invalid: expected bundled helpers, received ${metadata.helperPackaging}.`,
    );
  }

  if (metadata.helperPaths.length === 0) {
    throw new Error('Release artifact metadata is invalid: no helper paths were resolved.');
  }
}

export async function assembleReleaseArtifact(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReleaseAssemblyResult> {
  const repoRoot = getRepoRoot();
  const mcpServerRoot = getMcpServerRoot();
  const releaseBaseEnv = getReleaseBaseEnv(env);
  const sourceMetadata = getBuildMetadata(releaseBaseEnv);

  if (sourceMetadata.helperPaths.length < 2) {
    throw new Error(
      'Release assembly requires helper binaries to be resolvable before packaging. Set GOJO_ZOEKT_WEBSERVER_PATH and GOJO_ZOEKT_GIT_INDEX_PATH or provide packaged helpers.',
    );
  }

  for (const helperPath of sourceMetadata.helperPaths) {
    assertExecutable(helperPath);
  }

  const versionDirectory = getReleaseVersionDirectory(sourceMetadata);
  const artifactRoot = getArtifactStagingRoot(sourceMetadata, env);
  const artifactPath = getArtifactPath(sourceMetadata);
  await ensureCleanDirectory(artifactRoot);
  await fsp.mkdir(path.join(artifactRoot, 'helper'), { recursive: true });
  await fsp.mkdir(path.join(artifactRoot, '.runtime', 'node_modules'), { recursive: true });

  await writeLauncherScript(path.join(artifactRoot, 'gojo'));
  await copyDirectory(path.join(mcpServerRoot, 'dist'), path.join(artifactRoot, '.runtime', 'dist'));
  await writeRuntimePackageManifest(path.join(artifactRoot, '.runtime', 'package.json'));
  await copyProductionNodeModules(
    mcpServerRoot,
    path.join(artifactRoot, '.runtime', 'node_modules'),
  );

  const helperFiles: string[] = [];
  for (const helperPath of sourceMetadata.helperPaths) {
    const destination = path.join(artifactRoot, 'helper', path.basename(helperPath));
    await copyFile(helperPath, destination, true);
    assertExecutable(destination);
    helperFiles.push(destination);
  }

  const helperManifestPath = path.join(mcpServerRoot, 'bin', 'search', 'manifest.json');
  if (fs.existsSync(helperManifestPath)) {
    await copyFile(helperManifestPath, path.join(artifactRoot, 'helper', 'manifest.json'));
  }

  await copyFile(path.join(repoRoot, 'README.md'), path.join(artifactRoot, 'README.md'));
  await copyFile(resolveSourceLicensePath(repoRoot), path.join(artifactRoot, 'LICENSE'));

  const artifactMetadata = getBuildMetadata(
    createArtifactMetadataEnv(releaseBaseEnv, artifactRoot, sourceMetadata),
  );
  assertBundledHelpers(artifactMetadata);
  await fsp.writeFile(
    path.join(artifactRoot, 'VERSION'),
    stableStringify(createVersionSnapshot(artifactMetadata)),
    'utf8',
  );

  await fsp.mkdir(versionDirectory, { recursive: true });

  return {
    artifactName: path.basename(artifactPath),
    artifactPath,
    artifactRoot,
    versionDirectory,
    helperFiles,
    metadata: artifactMetadata,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assembleReleaseArtifact()
    .then((result) => {
      process.stdout.write(`${stableStringify(result)}\n`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
