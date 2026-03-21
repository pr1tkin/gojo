import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import type { AppConfig, SearchRuntimeMode } from '../types.js';

export type SearchHelperKind = 'webserver' | 'indexer';
export type SearchHelperSource = 'packaged' | 'env_override' | 'dev_fallback';
export type SearchHelperErrorCode =
  | 'missing_search_helper'
  | 'invalid_search_helper'
  | 'search_helper_startup_failed'
  | 'search_index_sync_failed';

interface SearchHelperManifest {
  schemaVersion?: number;
  zoektRef?: string;
  helpers?: {
    webserver?: string;
    indexer?: string;
  };
}

export interface ResolvedSearchHelper {
  kind: SearchHelperKind;
  executable: string;
  source: SearchHelperSource;
  mode: SearchRuntimeMode;
  expectedVersion?: string;
}

export interface SearchHelperValidationResult {
  helper: ResolvedSearchHelper;
  available: boolean;
  executable: boolean;
  version?: string;
  expectedVersion?: string;
  warnings: string[];
}

export class SearchHelperError extends Error {
  readonly code: SearchHelperErrorCode;
  readonly helper: SearchHelperKind;
  readonly suggestions: string[];

  constructor(
    code: SearchHelperErrorCode,
    helper: SearchHelperKind,
    message: string,
    suggestions: string[] = [],
  ) {
    super(message);
    this.name = 'SearchHelperError';
    this.code = code;
    this.helper = helper;
    this.suggestions = suggestions;
  }
}

function getHelperExecutableName(kind: SearchHelperKind): string {
  if (kind === 'webserver') {
    return process.platform === 'win32' ? 'zoekt-webserver.exe' : 'zoekt-webserver';
  }

  return process.platform === 'win32' ? 'zoekt-git-index.exe' : 'zoekt-git-index';
}

function getHelperEnvOverride(kind: SearchHelperKind): string | undefined {
  return kind === 'webserver'
    ? process.env.GOJO_ZOEKT_WEBSERVER_PATH?.trim()
    : process.env.GOJO_ZOEKT_GIT_INDEX_PATH?.trim();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolveCommandOnPath(commandName: string): Promise<string | null> {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';

  return new Promise<string | null>((resolve) => {
    const child = spawn(locator, [commandName], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let stdout = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.once('error', () => resolve(null));
    child.once('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      const firstLine = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      resolve(firstLine ?? null);
    });
  });
}

async function loadManifest(config: AppConfig): Promise<SearchHelperManifest | null> {
  try {
    const content = await fs.readFile(config.search.helperManifestPath, 'utf8');
    return JSON.parse(content) as SearchHelperManifest;
  } catch {
    return null;
  }
}

async function getPackagedCandidate(config: AppConfig, kind: SearchHelperKind): Promise<string | null> {
  const candidate = config.search.helperBinaries[kind];
  return (await fileExists(candidate)) ? candidate : null;
}

async function getDevFallbackCandidate(kind: SearchHelperKind): Promise<string | null> {
  const directPath = process.env.GOJO_SEARCH_HELPERS_DIR?.trim()
    ? path.join(process.env.GOJO_SEARCH_HELPERS_DIR.trim(), getHelperExecutableName(kind))
    : null;

  if (directPath && (await fileExists(directPath))) {
    return directPath;
  }

  return resolveCommandOnPath(getHelperExecutableName(kind));
}

export async function resolveSearchHelper(
  config: AppConfig,
  kind: SearchHelperKind,
): Promise<ResolvedSearchHelper> {
  const manifest = await loadManifest(config);
  const packagedCandidate = await getPackagedCandidate(config, kind);

  if (packagedCandidate) {
    return {
      kind,
      executable: packagedCandidate,
      source: 'packaged',
      mode: config.search.mode,
      expectedVersion: manifest?.zoektRef,
    };
  }

  const envOverride = getHelperEnvOverride(kind);
  if (envOverride) {
    return {
      kind,
      executable: envOverride,
      source: 'env_override',
      mode: config.search.mode,
      expectedVersion: manifest?.zoektRef,
    };
  }

  if (config.search.mode === 'development') {
    const devFallback = await getDevFallbackCandidate(kind);

    if (devFallback) {
      return {
        kind,
        executable: devFallback,
        source: 'dev_fallback',
        mode: config.search.mode,
        expectedVersion: manifest?.zoektRef,
      };
    }
  }

  throw new SearchHelperError(
    'missing_search_helper',
    kind,
    `Search helper not found for ${kind}. This Gojo installation is incomplete.`,
    [
      'Reinstall Gojo so the bundled search helpers are present.',
      'If you are working locally in development mode, set GOJO_ZOEKT_WEBSERVER_PATH or GOJO_ZOEKT_GIT_INDEX_PATH, or make the helpers available on PATH.',
    ],
  );
}

function runHelperCommand(
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      resolve({
        exitCode: null,
        stdout,
        stderr,
        timedOut: true,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut: false,
      });
    });
  });
}

export async function validateSearchHelper(
  config: AppConfig,
  kind: SearchHelperKind,
): Promise<SearchHelperValidationResult> {
  const helper = await resolveSearchHelper(config, kind);
  const warnings: string[] = [];

  try {
    const probe = await runHelperCommand(helper.executable, ['-version'], 5000);
    const combinedOutput = `${probe.stdout}\n${probe.stderr}`.trim();

    if (probe.timedOut) {
      warnings.push('version probe timed out; helper will be treated as executable but version could not be confirmed');
    } else if (probe.exitCode !== 0) {
      warnings.push('version probe returned a non-zero status; helper will be treated as executable but version could not be confirmed');
    }

    return {
      helper,
      available: true,
      executable: true,
      version: combinedOutput || undefined,
      expectedVersion: helper.expectedVersion,
      warnings,
    };
  } catch (error) {
    throw new SearchHelperError(
      'invalid_search_helper',
      kind,
      `Search helper for ${kind} is not executable: ${error instanceof Error ? error.message : String(error)}`,
      [
        'Reinstall Gojo so the packaged search helpers are restored.',
        'If you are developing locally, verify the helper path override or PATH entry points to a working executable.',
      ],
    );
  }
}
