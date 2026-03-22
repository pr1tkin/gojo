import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import {
  DEV_VERSION_FALLBACK_PREFIX,
  UNKNOWN_BUILD_TIMESTAMP,
  UNKNOWN_GIT_SHA,
} from './constants.js';
import { resolvePackageRootFromEnv } from './packageRootResolver.js';

export interface VersionResolution {
  version: string;
  gitSha: string;
  shortSha: string;
  buildTimestamp: string;
  source: 'env_override' | 'packaged_snapshot' | 'git_tag' | 'dev_fallback';
}

function runGit(args: string[], cwd: string): string | null {
  const result = spawnSync('git', ['-c', 'safe.directory=*', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (result.status !== 0) {
    return null;
  }

  const output = result.stdout.trim();
  return output.length > 0 ? output : null;
}

function resolveGitSha(packageRoot: string): string {
  return runGit(['rev-parse', 'HEAD'], packageRoot) ?? UNKNOWN_GIT_SHA;
}

function resolveShortSha(gitSha: string): string {
  return gitSha === UNKNOWN_GIT_SHA ? UNKNOWN_GIT_SHA : gitSha.slice(0, 7);
}

function resolveTaggedVersion(packageRoot: string): string | null {
  const output = runGit(['tag', '--points-at', 'HEAD'], packageRoot);

  if (!output) {
    return null;
  }

  return (
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(line))
      .sort()[0] ?? null
  );
}

function resolveBuildTimestamp(packageRoot: string): string {
  return runGit(['log', '-1', '--format=%cI', 'HEAD'], packageRoot) ?? UNKNOWN_BUILD_TIMESTAMP;
}

function resolveVersionSnapshot(
  packageRoot: string,
): { version: string; gitSha: string; buildTimestamp: string } | null {
  const snapshotPath = path.join(packageRoot, 'VERSION');
  if (!fs.existsSync(snapshotPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as Partial<{
      version: string;
      gitSha: string;
      buildTimestamp: string;
    }>;

    if (
      typeof parsed.version === 'string' &&
      parsed.version.trim() &&
      typeof parsed.gitSha === 'string' &&
      parsed.gitSha.trim() &&
      typeof parsed.buildTimestamp === 'string' &&
      parsed.buildTimestamp.trim()
    ) {
      return {
        version: parsed.version.trim(),
        gitSha: parsed.gitSha.trim(),
        buildTimestamp: parsed.buildTimestamp.trim(),
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveVersionMetadata(env: NodeJS.ProcessEnv = process.env): VersionResolution {
  const packageRoot = resolvePackageRootFromEnv(env);
  const envVersion = env.GOJO_VERSION?.trim();
  const envGitSha = env.GOJO_GIT_SHA?.trim();
  const envBuildTimestamp = env.GOJO_BUILD_TIMESTAMP?.trim();

  if (envVersion && envGitSha && envBuildTimestamp) {
    return {
      version: envVersion,
      gitSha: envGitSha,
      shortSha: resolveShortSha(envGitSha),
      buildTimestamp: envBuildTimestamp,
      source: 'env_override',
    };
  }

  if (env.GOJO_PACKAGED === 'true') {
    const snapshot = resolveVersionSnapshot(packageRoot);
    if (snapshot) {
      return {
        version: snapshot.version,
        gitSha: snapshot.gitSha,
        shortSha: resolveShortSha(snapshot.gitSha),
        buildTimestamp: snapshot.buildTimestamp,
        source: 'packaged_snapshot',
      };
    }
  }

  const gitSha = resolveGitSha(packageRoot);
  const shortSha = resolveShortSha(gitSha);
  const taggedVersion = resolveTaggedVersion(packageRoot);

  return {
    version: taggedVersion ?? `${DEV_VERSION_FALLBACK_PREFIX}${shortSha}`,
    gitSha,
    shortSha,
    buildTimestamp: resolveBuildTimestamp(packageRoot),
    source: taggedVersion ? 'git_tag' : 'dev_fallback',
  };
}
