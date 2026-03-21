import { loadConfig } from './config.js';
import { silentLogger, stderrLogger } from './logging.js';
import { RuntimeHost } from './runtime/index.js';

// Transitional compatibility entrypoint.
// Packaged product builds should target the `gojo` CLI surface and let the runtime
// own service startup through `ServeMCP`.

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
