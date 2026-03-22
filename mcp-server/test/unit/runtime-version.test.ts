import { describe, expect, it } from 'vitest';

import { getProductVersionHandler } from '../../src/runtime/handlers.js';

describe('runtime version handler', () => {
  it('returns the release-grade machine payload for gojo version --json', async () => {
    const response = await getProductVersionHandler.execute(
      {},
      {
        executionContext: {
          debug: false,
          outputMode: 'json',
        },
        dependencies: {
          config: {
            product: {
              identity: {
                name: 'gojo',
                version: 'v1.2.3',
                packagingModel: 'single_surface_with_packaged_runtime',
              },
              buildMetadata: {
                productName: 'gojo',
                version: 'v1.2.3',
                gitSha: 'abcdef1234567890abcdef1234567890abcdef12',
                buildTimestamp: '2026-03-22T10:00:00.000Z',
                platform: 'linux',
                arch: 'x64',
                packagingMode: 'release',
                helperPackaging: 'bundled',
                helperPaths: ['/opt/gojo/helper/zoekt-webserver', '/opt/gojo/helper/zoekt-git-index'],
                isDev: false,
              },
              paths: {
                packageRoot: '/opt/gojo',
                homeDir: '/tmp/gojo',
                configDir: '/tmp/gojo/config',
                dataDir: '/tmp/gojo/data',
                indexesDir: '/tmp/gojo/data/indexes',
                cacheDir: '/tmp/gojo/cache',
                logDir: '/tmp/gojo/logs',
                runtimeDir: '/tmp/gojo/runtime',
                tempDir: '/tmp/gojo/runtime/tmp',
                searchHelpersDir: '/opt/gojo/helper',
              },
            },
          } as never,
        },
      },
    );

    expect(response.summary.text).toBe('gojo v1.2.3');
    expect(response.machine_payload).toEqual({
      product: 'gojo',
      version: 'v1.2.3',
      git_sha: 'abcdef1234567890abcdef1234567890abcdef12',
      build_timestamp: '2026-03-22T10:00:00.000Z',
      platform: 'linux',
      arch: 'x64',
      packaging_mode: 'release',
      helper: {
        mode: 'bundled',
        paths: ['/opt/gojo/helper/zoekt-webserver', '/opt/gojo/helper/zoekt-git-index'],
        detected: true,
      },
      is_dev: false,
    });
  });
});
