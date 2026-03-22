import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';

function withProductEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    GOJO_DATA_DIR: path.resolve('tmp', 'gojo-config-test', 'data'),
    ...overrides,
  };
}

describe('loadConfig', () => {
  it('returns the expected defaults when environment values are missing', () => {
    const config = loadConfig(withProductEnv());

    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 3000,
      reposRoot: path.resolve('..', 'repos'),
      zoektBaseUrl: 'http://127.0.0.1:6070',
      includeInternalTools: false,
    });
    expect(config.product.paths.dataDir).toBe(path.resolve('tmp', 'gojo-config-test', 'data'));
  });

  it('parses valid explicit environment values', () => {
    const config = loadConfig(withProductEnv({
      NODE_ENV: 'test',
      PORT: '4567',
      REPOS_ROOT: './repos',
      ZOEKT_BASE_URL: 'http://localhost:6070/',
    }));

    expect(config).toMatchObject({
      nodeEnv: 'test',
      port: 4567,
      reposRoot: path.resolve('./repos'),
      zoektBaseUrl: 'http://localhost:6070',
      includeInternalTools: false,
    });
  });

  it('falls back to defaults for invalid node environment and port values', () => {
    const config = loadConfig(withProductEnv({
      NODE_ENV: 'staging',
      PORT: '70000',
    }));

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
  });

  it('normalizes blank or invalid path and URL inputs back to defaults', () => {
    const config = loadConfig(withProductEnv({
      REPOS_ROOT: '   ',
      ZOEKT_BASE_URL: 'not a url',
    }));

    expect(config.reposRoot).toBe(path.resolve('..', 'repos'));
    expect(config.zoektBaseUrl).toBe('http://127.0.0.1:6070');
  });

  it('accepts production mode and trims valid URLs without a trailing slash', () => {
    const config = loadConfig(withProductEnv({
      NODE_ENV: 'production',
      PORT: '8080',
      ZOEKT_BASE_URL: '  http://zoekt.internal:7000/  ',
    }));

    expect(config.nodeEnv).toBe('production');
    expect(config.port).toBe(8080);
    expect(config.zoektBaseUrl).toBe('http://zoekt.internal:7000');
  });

  it('parses the internal tool exposure flag', () => {
    expect(loadConfig(withProductEnv({ GOJO_INCLUDE_INTERNAL_TOOLS: 'true' })).includeInternalTools).toBe(true);
    expect(loadConfig(withProductEnv({ GOJO_INCLUDE_INTERNAL_TOOLS: 'false' })).includeInternalTools).toBe(false);
  });
});
