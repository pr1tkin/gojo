import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { cleanupGenerationDebris } from '../indexing/generation-debris.js';
import { buildSymbolIndex } from '../symbol-index/indexer.js';
import { registerGojoTools } from '../tool-registry.js';
import { createRuntimeResponse } from './response.js';
import type {
  RuntimeHandlerContext,
  ServeMCPRequest,
  ServeMCPResponse,
} from './types.js';

export async function serveMcpRuntime(
  context: RuntimeHandlerContext,
  request: ServeMCPRequest,
): Promise<ServeMCPResponse> {
  const config = context.dependencies.config;
  const logger = context.dependencies.logger;
  const shouldBuildSymbolIndex = process.env.BUILD_SYMBOL_INDEX_ON_STARTUP === 'true';
  const productIdentity = config.product.identity;

  await cleanupGenerationDebris({ logger, applyDeletes: true });

  const server = new McpServer({
    name: productIdentity.name,
    version: productIdentity.version,
  });

  const registrations = registerGojoTools(server, config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (shouldBuildSymbolIndex) {
    logger?.info('Startup index refresh scheduled in background.');
    void buildSymbolIndex(config.reposRoot).catch((error: unknown) => {
      logger?.error('Background startup index refresh failed.', error);
    });
  }

  return createRuntimeResponse({
    capability: 'ServeMCP',
    executionMode: 'long_running',
    summary: {
      title: 'MCP serving active',
      text: `Gojo MCP startup completed and is actively serving over ${request.transport ?? 'stdio'}.`,
    },
    findings: [
      {
        id: 'mcp-startup',
        title: 'Startup complete',
        summary: 'The MCP transport is connected and the runtime is now serving requests.',
      },
      {
        id: 'mcp-tools',
        title: 'Tools registered',
        summary: `${registrations.length} MCP tools are available through the runtime-owned server.`,
      },
      {
        id: 'product-identity',
        title: 'Product identity',
        summary: `${productIdentity.name} ${productIdentity.version} is serving with packaging model ${productIdentity.packagingModel}.`,
      },
    ],
    relatedEntities: [
      {
        kind: 'service',
        name: 'mcp',
      },
      {
        kind: 'process',
        name: 'stdio-transport',
      },
    ],
    signals: [
      {
        name: 'transport',
        value: request.transport ?? 'stdio',
        importance: 'high',
      },
      {
        name: 'lifecycle',
        value: 'serving',
        importance: 'high',
      },
      {
        name: 'registered_tools',
        value: registrations.length,
        importance: 'medium',
      },
    ],
    warnings: shouldBuildSymbolIndex
      ? ['Background symbol indexing was scheduled during MCP startup.']
      : [],
    details: {
      startupPhase: 'startup_complete',
      lifecycle: 'serving',
      productIdentity,
      toolNames: registrations.map((registration) => registration.definition.name),
    },
    machinePayload: {
      transport: request.transport ?? 'stdio',
      status: 'serving',
      lifecycle: 'startup_complete',
    },
    trustLevel: 'high',
    readinessState: 'ready',
    confidence: 'high',
    trust: 'high',
  });
}
