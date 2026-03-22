import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { getBuildMetadata } from '../../mcp-server/src/internal/product/buildMetadata.ts';
import { getReleaseArtifactName } from '../../mcp-server/src/internal/product/releaseContract.ts';
import type { BuildMetadata } from '../../mcp-server/src/types.ts';

export interface ReleaseAssemblyResult {
  artifactName: string;
  artifactPath: string;
  artifactRoot: string;
  versionDirectory: string;
  helperFiles: string[];
  metadata: BuildMetadata;
}

export interface ReleaseValidationResult {
  metadata: BuildMetadata;
  artifactName: string;
  artifactPath: string;
  artifactSizeBytes: number;
  extractedRoot: string;
  helperFiles: string[];
  contents: string[];
  validation: {
    structure: boolean;
    versionCommand: boolean;
    jsonOutput: boolean;
    helpCommand: boolean;
    helperDetection: boolean;
  };
  observations: string[];
}

export interface ReleaseArtifactDetails {
  artifactPath: string;
  filename: string;
  size: number;
  metadata: BuildMetadata;
  helperFiles: string[];
}

export function getRepoRoot(): string {
  if (process.env.GOJO_REPO_ROOT?.trim()) {
    return path.resolve(process.env.GOJO_REPO_ROOT.trim());
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function getMcpServerRoot(): string {
  return path.join(getRepoRoot(), 'mcp-server');
}

export function getReleaseBaseEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    GOJO_PACKAGED: 'true',
    GOJO_PACKAGE_ROOT: getMcpServerRoot(),
  };
}

export function getReleaseVersionDirectory(metadata: BuildMetadata): string {
  return path.join(getRepoRoot(), 'dist', 'release', metadata.version);
}

export function getArtifactRoot(metadata: BuildMetadata): string {
  return path.join(getReleaseVersionDirectory(metadata), 'root');
}

export function getArtifactStagingRoot(
  metadata: BuildMetadata,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configuredRoot = env.GOJO_RELEASE_STAGING_ROOT?.trim();
  if (configuredRoot) {
    return path.join(
      path.resolve(configuredRoot),
      `${metadata.version}-${metadata.platform}-${metadata.arch}`,
    );
  }

  return getArtifactRoot(metadata);
}

export function getArtifactPath(metadata: BuildMetadata): string {
  return path.join(
    getReleaseVersionDirectory(metadata),
    getReleaseArtifactName(metadata.version, metadata.platform, metadata.arch),
  );
}

export function getChecksumsPath(versionDirectory: string): string {
  return path.join(versionDirectory, 'checksums.txt');
}

export function getReleaseManifestPath(versionDirectory: string): string {
  return path.join(versionDirectory, 'release-manifest.json');
}

export function getReleaseNotesPath(versionDirectory: string): string {
  return path.join(versionDirectory, 'release-notes.md');
}

export function getTempExtractionDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gojo-release-validate-'));
}

export function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    allowFailure?: boolean;
  } = {},
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if ((result.status ?? 1) !== 0 && !options.allowFailure) {
    const stderr = result.stderr?.trim() || '(no stderr)';
    throw new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr}`);
  }

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
}

export async function ensureCleanDirectory(directoryPath: string): Promise<void> {
  await fsp.rm(directoryPath, { recursive: true, force: true });
  await fsp.mkdir(directoryPath, { recursive: true });
}

export async function copyDirectory(source: string, destination: string): Promise<void> {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.cp(source, destination, { recursive: true });
}

export async function copyFile(source: string, destination: string, executable = false): Promise<void> {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.copyFile(source, destination);

  if (executable) {
    await fsp.chmod(destination, 0o755);
  }
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function assertExecutable(filePath: string): void {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`Expected executable file at ${filePath}.`);
  }

  if (process.platform !== 'win32' && (stats.mode & 0o111) === 0) {
    throw new Error(`Expected executable permissions on ${filePath}.`);
  }
}

export async function writeLauncherScript(destination: string): Promise<void> {
  const content = `#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export GOJO_PACKAGED=true
export GOJO_PACKAGE_ROOT="$SCRIPT_DIR"
export GOJO_RUNTIME_MODE=packaged
export GOJO_SEARCH_HELPERS_DIR="\${GOJO_SEARCH_HELPERS_DIR:-$SCRIPT_DIR/helper}"
export GOJO_ZOEKT_WEBSERVER_PATH="\${GOJO_ZOEKT_WEBSERVER_PATH:-$SCRIPT_DIR/helper/zoekt-webserver}"
export GOJO_ZOEKT_GIT_INDEX_PATH="\${GOJO_ZOEKT_GIT_INDEX_PATH:-$SCRIPT_DIR/helper/zoekt-git-index}"

exec node "$SCRIPT_DIR/.runtime/dist/gojo.js" "$@"
`;

  await fsp.writeFile(destination, content, 'utf8');
  await fsp.chmod(destination, 0o755);
}

export async function writeRuntimePackageManifest(destination: string): Promise<void> {
  const packageJson = {
    name: 'gojo-runtime',
    private: true,
    type: 'module',
  };

  await fsp.writeFile(destination, stableStringify(packageJson), 'utf8');
}

export async function copyProductionNodeModules(sourceRoot: string, destinationRoot: string): Promise<void> {
  const packageJson = JSON.parse(
    await fsp.readFile(path.join(sourceRoot, 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
  };
  const nodeModulesRoot = path.join(sourceRoot, 'node_modules');
  const queue = Object.keys(packageJson.dependencies ?? {});
  const copiedPackages = new Set<string>();

  while (queue.length > 0) {
    const packageName = queue.shift();
    if (!packageName || copiedPackages.has(packageName)) {
      continue;
    }

    const packageDirectory = path.join(nodeModulesRoot, ...packageName.split('/'));
    if (!fs.existsSync(packageDirectory)) {
      throw new Error(`Missing runtime dependency ${packageName} at ${packageDirectory}.`);
    }

    copiedPackages.add(packageName);
    await copyDirectory(
      packageDirectory,
      path.join(destinationRoot, ...packageName.split('/')),
    );

    const dependencyManifestPath = path.join(packageDirectory, 'package.json');
    if (!fs.existsSync(dependencyManifestPath)) {
      continue;
    }

    const dependencyManifest = JSON.parse(await fsp.readFile(dependencyManifestPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (const dependencyName of Object.keys(dependencyManifest.dependencies ?? {})) {
      if (!copiedPackages.has(dependencyName)) {
        queue.push(dependencyName);
      }
    }

    for (const dependencyName of Object.keys(dependencyManifest.optionalDependencies ?? {})) {
      if (!copiedPackages.has(dependencyName) && fs.existsSync(path.join(nodeModulesRoot, ...dependencyName.split('/')))) {
        queue.push(dependencyName);
      }
    }
  }
}

export function loadVersionFile(versionFilePath: string): BuildMetadata {
  return JSON.parse(fs.readFileSync(versionFilePath, 'utf8')) as BuildMetadata;
}

export function getReleaseArtifactPaths(versionDirectory: string): string[] {
  if (!fs.existsSync(versionDirectory)) {
    return [];
  }

  return fs
    .readdirSync(versionDirectory)
    .filter((entry) => entry.endsWith('.tar.gz'))
    .map((entry) => path.join(versionDirectory, entry))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}
