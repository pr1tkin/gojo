import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const RELEASE_REPOSITORY = 'pr1tkin/gojo';
const RELEASES_API_URL = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
const INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/${RELEASE_REPOSITORY}/main/scripts/install/install.sh`;
const REQUEST_TIMEOUT_MS = 5000;

export interface ReleaseTarget {
  platform: 'linux' | 'darwin';
  arch: 'x64' | 'arm64';
}

export interface LatestReleaseInfo {
  version: string;
  artifactName: string;
  downloadUrl: string;
  platform: ReleaseTarget['platform'];
  arch: ReleaseTarget['arch'];
}

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  assets?: GitHubReleaseAsset[];
}

function mapReleaseTarget(): ReleaseTarget {
  if (process.platform !== 'linux' && process.platform !== 'darwin') {
    throw new Error(`Unsupported platform for Gojo release upgrades: ${process.platform}`);
  }

  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    throw new Error(`Unsupported architecture for Gojo release upgrades: ${process.arch}`);
  }

  return {
    platform: process.platform,
    arch: process.arch,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'gojo-cli',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub API request failed with status ${response.status}.`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url: string): Promise<string> {
  if (url.startsWith('file://')) {
    return fs.readFile(new URL(url), 'utf8');
  }

  if (url.startsWith('/')) {
    return fs.readFile(url, 'utf8');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/plain',
        'User-Agent': 'gojo-cli',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to download installer script with status ${response.status}.`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchLatestReleaseInfo(): Promise<LatestReleaseInfo> {
  const target = mapReleaseTarget();
  const release = await fetchJson<GitHubReleaseResponse>(RELEASES_API_URL);
  const version = release.tag_name?.trim();

  if (!version) {
    throw new Error('Latest Gojo release did not include a tag_name.');
  }

  const artifactName = `gojo-${version}-${target.platform}-${target.arch}.tar.gz`;
  const asset = release.assets?.find((entry) => entry.name === artifactName);

  if (!asset?.browser_download_url) {
    throw new Error(`Latest Gojo release does not include ${artifactName}.`);
  }

  return {
    version,
    artifactName,
    downloadUrl: asset.browser_download_url,
    platform: target.platform,
    arch: target.arch,
  };
}

export interface UpgradeResult {
  currentVersion: string;
  latestVersion: string;
  installDir: string;
  updated: boolean;
  installerOutput?: string;
}

function runInstallerScript(script: string, installDir: string, targetVersion: string): string {
  const result = spawnSync('bash', ['-s', '--'], {
    input: script,
    encoding: 'utf8',
    env: {
      ...process.env,
      GOJO_INSTALL_DIR: installDir,
      GOJO_SKIP_PATH_HINT: '1',
      GOJO_VERSION: targetVersion,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if ((result.status ?? 1) !== 0) {
    const stderr = result.stderr?.trim() || '(no stderr)';
    throw new Error(`Gojo upgrade failed during installation.\n${stderr}`);
  }

  return result.stdout.trim();
}

export async function upgradeInstalledGojo(
  currentVersion: string,
  installDir: string,
): Promise<UpgradeResult> {
  const latest = await fetchLatestReleaseInfo();

  if (latest.version === currentVersion) {
    return {
      currentVersion,
      latestVersion: latest.version,
      installDir,
      updated: false,
    };
  }

  const installerScript = await fetchText(process.env.GOJO_INSTALL_SCRIPT_URL || INSTALL_SCRIPT_URL);
  const installerOutput = runInstallerScript(installerScript, installDir, latest.version);

  return {
    currentVersion,
    latestVersion: latest.version,
    installDir,
    updated: true,
    installerOutput,
  };
}
