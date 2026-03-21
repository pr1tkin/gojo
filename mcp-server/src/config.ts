import path from 'node:path';

import {
  ensureProductDirectories,
  resolveDefaultReposRoot,
  resolveProductIdentity,
  resolveProductPathsForEnvironment,
  resolveSearchRuntimeConfig,
} from './product/environment.js';
import type { AppConfig, NodeEnv } from './types.js';

const DEFAULT_NODE_ENV: NodeEnv = 'development';
const DEFAULT_PORT = 3000;
const DEFAULT_INCLUDE_INTERNAL_TOOLS = false;

function parseNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'development' || value === 'test' || value === 'production') {
    return value;
  }

  return DEFAULT_NODE_ENV;
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return DEFAULT_PORT;
  }

  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return DEFAULT_PORT;
  }

  return port;
}

function normalizePath(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return path.resolve(normalized ? normalized : fallback);
}

function normalizeUrl(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;

  try {
    return new URL(candidate).toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const productIdentity = resolveProductIdentity(env);
  const productPaths = resolveProductPathsForEnvironment(env);
  ensureProductDirectories(productPaths);
  const search = resolveSearchRuntimeConfig(env);
  return {
    nodeEnv: parseNodeEnv(env.NODE_ENV),
    port: parsePort(env.PORT),
    reposRoot: normalizePath(env.REPOS_ROOT, resolveDefaultReposRoot(process.cwd(), env)),
    zoektBaseUrl: normalizeUrl(env.ZOEKT_BASE_URL, search.baseUrl),
    search,
    includeInternalTools: parseBooleanFlag(env.GOJO_INCLUDE_INTERNAL_TOOLS, DEFAULT_INCLUDE_INTERNAL_TOOLS),
    product: {
      identity: productIdentity,
      paths: productPaths,
    },
  };
}
