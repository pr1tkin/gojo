import { loadConfig } from './config.js';
import { silentLogger, stderrLogger } from './logging.js';
import { RuntimeHost } from './runtime/index.js';

// Deprecated compatibility entrypoint.
// Official product entrypoints are:
// - `gojo`
// - `gojo mcp serve`
//
// This file remains only to avoid breaking older local/dev flows while release
// and documentation surfaces consolidate around the CLI-first product story.

async function main(): Promise<void> {
  const config = loadConfig();
  const runtime = new RuntimeHost({
    config,
    logger: silentLogger,
  });

  await runtime.execute(
    'ServeMCP',
    { transport: 'stdio' },
    {
      debug: false,
      outputMode: 'human',
    },
  );
}

main().catch((error: unknown) => {
  stderrLogger.error('Failed to start Gojo MCP runtime.', error);
  process.exit(1);
});
