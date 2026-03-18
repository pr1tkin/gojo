import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { analyzeSymbolToolDefinition, runAnalyzeSymbolTool } from './tools/analyze-symbol.js';
import {
  collectRefactorContextToolDefinition,
  runCollectRefactorContextTool,
} from './tools/collect-refactor-context.js';
import { exploreComponentToolDefinition, runExploreComponentTool } from './tools/explore-component.js';
import { planChangeToolDefinition, runPlanChangeTool } from './tools/plan-change.js';
import { loadConfig } from './config.js';
import { cleanupGenerationDebris } from './indexing/generation-debris.js';
import { stderrLogger } from './logging.js';
import { buildSymbolIndex } from './symbol-index/indexer.js';
import { runSearchPatternsTool, searchPatternsToolDefinition } from './tools/search-patterns.js';
import { findRelatedFilesToolDefinition, runFindRelatedFilesTool } from './tools/find-related-files.js';
import { findSymbolToolDefinition, runFindSymbolTool } from './tools/find-symbol.js';
import { findReferencesToolDefinition, runFindReferencesTool } from './tools/find-references.js';
import { runListSymbolsTool, listSymbolsToolDefinition } from './tools/list-symbols.js';
import { openFileToolDefinition, runOpenFileTool } from './tools/open-file.js';
import { runSearchCodeTool, searchCodeToolDefinition } from './tools/search-code.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const shouldBuildSymbolIndex = process.env.BUILD_SYMBOL_INDEX_ON_STARTUP === 'true';
  await cleanupGenerationDebris({ logger: stderrLogger, applyDeletes: true });

  const server = new McpServer({
    name: 'local-code-search',
    version: '0.1.0',
  });

  server.registerTool(
    exploreComponentToolDefinition.name,
    {
      title: exploreComponentToolDefinition.title,
      description: exploreComponentToolDefinition.description,
      inputSchema: exploreComponentToolDefinition.inputSchema,
    },
    async (input) => runExploreComponentTool(input),
  );

  server.registerTool(
    analyzeSymbolToolDefinition.name,
    {
      title: analyzeSymbolToolDefinition.title,
      description: analyzeSymbolToolDefinition.description,
      inputSchema: analyzeSymbolToolDefinition.inputSchema,
    },
    async (input) => runAnalyzeSymbolTool(input),
  );

  server.registerTool(
    planChangeToolDefinition.name,
    {
      title: planChangeToolDefinition.title,
      description: planChangeToolDefinition.description,
      inputSchema: planChangeToolDefinition.inputSchema,
    },
    async (input) => runPlanChangeTool(input),
  );

  server.registerTool(
    collectRefactorContextToolDefinition.name,
    {
      title: collectRefactorContextToolDefinition.title,
      description: collectRefactorContextToolDefinition.description,
      inputSchema: collectRefactorContextToolDefinition.inputSchema,
    },
    async (input) => runCollectRefactorContextTool(input),
  );

  server.registerTool(
    searchPatternsToolDefinition.name,
    {
      title: searchPatternsToolDefinition.title,
      description: searchPatternsToolDefinition.description,
      inputSchema: searchPatternsToolDefinition.inputSchema,
    },
    async (input) => runSearchPatternsTool(input),
  );

  server.registerTool(
    searchCodeToolDefinition.name,
    {
      title: searchCodeToolDefinition.title,
      description: searchCodeToolDefinition.description,
      inputSchema: searchCodeToolDefinition.inputSchema,
    },
    async (input) => runSearchCodeTool(config.zoektBaseUrl, input),
  );

  server.registerTool(
    openFileToolDefinition.name,
    {
      title: openFileToolDefinition.title,
      description: openFileToolDefinition.description,
      inputSchema: openFileToolDefinition.inputSchema,
    },
    async (input) => runOpenFileTool(config.reposRoot, input),
  );

  server.registerTool(
    listSymbolsToolDefinition.name,
    {
      title: listSymbolsToolDefinition.title,
      description: listSymbolsToolDefinition.description,
      inputSchema: listSymbolsToolDefinition.inputSchema,
    },
    async (input) => runListSymbolsTool(config.reposRoot, input),
  );

  server.registerTool(
    findSymbolToolDefinition.name,
    {
      title: findSymbolToolDefinition.title,
      description: findSymbolToolDefinition.description,
      inputSchema: findSymbolToolDefinition.inputSchema,
    },
    async (input) => runFindSymbolTool(config.reposRoot, input),
  );

  server.registerTool(
    findReferencesToolDefinition.name,
    {
      title: findReferencesToolDefinition.title,
      description: findReferencesToolDefinition.description,
      inputSchema: findReferencesToolDefinition.inputSchema,
    },
    async (input) => runFindReferencesTool(config.reposRoot, config.zoektBaseUrl, input),
  );

  server.registerTool(
    findRelatedFilesToolDefinition.name,
    {
      title: findRelatedFilesToolDefinition.title,
      description: findRelatedFilesToolDefinition.description,
      inputSchema: findRelatedFilesToolDefinition.inputSchema,
    },
    async (input) => runFindRelatedFilesTool(input),
  );

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
