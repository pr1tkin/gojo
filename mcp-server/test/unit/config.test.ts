import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('returns the expected defaults when environment values are missing', () => {
    const config = loadConfig({});

    expect(config).toEqual({
      nodeEnv: 'development',
      port: 3000,
      reposRoot: path.resolve('/repos'),
      zoektBaseUrl: 'http://zoekt:6070',
      includeInternalTools: false,
    });
  });

  it('parses valid explicit environment values', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PORT: '4567',
      REPOS_ROOT: './repos',
      ZOEKT_BASE_URL: 'http://localhost:6070/',
    });

    expect(config).toEqual({
      nodeEnv: 'test',
      port: 4567,
      reposRoot: path.resolve('./repos'),
      zoektBaseUrl: 'http://localhost:6070',
      includeInternalTools: false,
    });
  });

  it('falls back to defaults for invalid node environment and port values', () => {
    const config = loadConfig({
      NODE_ENV: 'staging',
      PORT: '70000',
    });

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
  });

  it('normalizes blank or invalid path and URL inputs back to defaults', () => {
    const config = loadConfig({
      REPOS_ROOT: '   ',
      ZOEKT_BASE_URL: 'not a url',
    });

    expect(config.reposRoot).toBe(path.resolve('/repos'));
    expect(config.zoektBaseUrl).toBe('http://zoekt:6070');
  });

  it('accepts production mode and trims valid URLs without a trailing slash', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      ZOEKT_BASE_URL: '  http://zoekt.internal:7000/  ',
    });

    expect(config.nodeEnv).toBe('production');
    expect(config.port).toBe(8080);
    expect(config.zoektBaseUrl).toBe('http://zoekt.internal:7000');
  });

  it('parses the internal tool exposure flag', () => {
    expect(loadConfig({ GOJO_INCLUDE_INTERNAL_TOOLS: 'true' }).includeInternalTools).toBe(true);
    expect(loadConfig({ GOJO_INCLUDE_INTERNAL_TOOLS: 'false' }).includeInternalTools).toBe(false);
  });
});
