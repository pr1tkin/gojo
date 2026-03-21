import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { cleanupGenerationDebris } from './indexing/generation-debris.js';
import { stderrLogger } from './logging.js';
import { createRuntimeResponse } from './runtime/index.js';
import { buildSymbolIndex } from './symbol-index/indexer.js';
import { registerGojoTools } from './tool-registry.js';
import type {
  RuntimeHandlerContext,
  ServeMCPRequest,
  ServeMCPResponse,
} from './runtime/index.js';

export async function startMcpServer(
  context: RuntimeHandlerContext,
  request: ServeMCPRequest,
): Promise<ServeMCPResponse> {
  const config = context.dependencies.config;
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

  return createRuntimeResponse({
    capability: 'ServeMCP',
    executionMode: 'long_running',
    summary: {
      title: 'MCP server started',
      text: `Gojo MCP server is serving over ${request.transport ?? 'stdio'}.`,
    },
    findings: [
      {
        id: 'mcp-server',
        title: 'Transport connected',
        summary: 'The MCP transport is active and owned by the runtime host.',
      },
    ],
    relatedEntities: [
      {
        kind: 'service',
        name: 'mcp',
      },
    ],
    signals: [
      {
        name: 'transport',
        value: request.transport ?? 'stdio',
        importance: 'high',
      },
    ],
    machinePayload: {
      transport: request.transport ?? 'stdio',
      status: 'started',
    },
    confidence: 'high',
    trust: 'high',
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  await startMcpServer(
    {
      executionContext: {
        debug: false,
        outputMode: 'human',
      },
      dependencies: {
        config,
        logger: stderrLogger,
      },
    },
    { transport: 'stdio' },
  );
}

main().catch((error: unknown) => {
  stderrLogger.error('Failed to start MCP server.', error);
  process.exit(1);
});
