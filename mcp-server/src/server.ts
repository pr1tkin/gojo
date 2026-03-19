import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { cleanupGenerationDebris } from './indexing/generation-debris.js';
import { stderrLogger } from './logging.js';
import { buildSymbolIndex } from './symbol-index/indexer.js';
import { registerGojoTools } from './tool-registry.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const shouldBuildSymbolIndex = process.env.BUILD_SYMBOL_INDEX_ON_STARTUP === 'true';
  await cleanupGenerationDebris({ logger: stderrLogger, applyDeletes: true });

  const server = new McpServer({
    name: 'local-code-search',
    version: '0.1.0',
  });

  registerGojoTools(server, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (shouldBuildSymbolIndex) {
    stderrLogger.info('Startup index refresh scheduled in background.');
    void buildSymbolIndex(config.reposRoot).catch((error: unknown) => {
      stderrLogger.error('Background startup index refresh failed.', error);
    });
  }
}

main().catch((error: unknown) => {
  stderrLogger.error('Failed to start MCP server.', error);
  process.exit(1);
});
