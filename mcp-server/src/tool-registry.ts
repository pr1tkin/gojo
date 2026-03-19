import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runAnalyzeSymbolTool, analyzeSymbolToolDefinition } from './tools/analyze-symbol.js';
import {
  buildChangeContextToolDefinition,
  runBuildChangeContextTool,
} from './tools/build-change-context.js';
import {
  collectRefactorContextToolDefinition,
  runCollectRefactorContextTool,
} from './tools/collect-refactor-context.js';
import { exploreComponentToolDefinition, runExploreComponentTool } from './tools/explore-component.js';
import { findPrecedentsToolDefinition, runFindPrecedentsTool } from './tools/find-precedents.js';
import { runFindReferencesTool, findReferencesToolDefinition } from './tools/find-references.js';
import { findRelatedFilesToolDefinition, runFindRelatedFilesTool } from './tools/find-related-files.js';
import { findSymbolToolDefinition, runFindSymbolTool } from './tools/find-symbol.js';
import { runListSymbolsTool, listSymbolsToolDefinition } from './tools/list-symbols.js';
import { openFileToolDefinition, runOpenFileTool } from './tools/open-file.js';
import { planChangeToolDefinition, runPlanChangeTool } from './tools/plan-change.js';
import { runSearchCodeTool, searchCodeToolDefinition } from './tools/search-code.js';
import { runSearchPatternsTool, searchPatternsToolDefinition } from './tools/search-patterns.js';
import type { AppConfig, ToolVisibility } from './types.js';

export interface ToolDefinitionLike {
  name: string;
  title: string;
  description: string;
  visibility: ToolVisibility;
  inputSchema: any;
}

interface ToolRegistration {
  definition: ToolDefinitionLike;
  register: (server: McpServer, config: AppConfig) => void;
}

export const PUBLIC_TOOL_NAMES = [
  'build_change_context',
  'explore_component',
  'find_precedents',
  'collect_refactor_context',
  'plan_change',
] as const;

export const INTERNAL_TOOL_NAMES = [
  'search_code',
  'open_file',
  'list_symbols',
  'find_symbol',
  'find_references',
  'find_related_files',
  'analyze_symbol',
  'search_patterns',
] as const;

function buildDescription(definition: ToolDefinitionLike): string {
  return definition.visibility === 'public'
    ? `Recommended entry point. ${definition.description}`
    : `[INTERNAL] Not intended for direct agent use. ${definition.description}`;
}

function registerTool(
  server: McpServer,
  definition: ToolDefinitionLike,
  handler: (input: any) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
): void {
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: buildDescription(definition),
      inputSchema: definition.inputSchema,
      _meta: {
        visibility: definition.visibility,
        internal: definition.visibility === 'internal',
        recommendedEntryPoint: definition.visibility === 'public',
      },
    },
    handler,
  );
}

export function getToolRegistrations(): ToolRegistration[] {
  return [
    {
      definition: buildChangeContextToolDefinition,
      register: (server, _config) =>
        registerTool(server, buildChangeContextToolDefinition, async (input) => runBuildChangeContextTool(input)),
    },
    {
      definition: exploreComponentToolDefinition,
      register: (server, _config) =>
        registerTool(server, exploreComponentToolDefinition, async (input) => runExploreComponentTool(input)),
    },
    {
      definition: findPrecedentsToolDefinition,
      register: (server, _config) =>
        registerTool(server, findPrecedentsToolDefinition, async (input) => runFindPrecedentsTool(input)),
    },
    {
      definition: collectRefactorContextToolDefinition,
      register: (server, _config) =>
        registerTool(server, collectRefactorContextToolDefinition, async (input) =>
          runCollectRefactorContextTool(input),
        ),
    },
    {
      definition: planChangeToolDefinition,
      register: (server, _config) =>
        registerTool(server, planChangeToolDefinition, async (input) => runPlanChangeTool(input)),
    },
    {
      definition: searchCodeToolDefinition,
      register: (server, config) =>
        registerTool(server, searchCodeToolDefinition, async (input) => runSearchCodeTool(config.zoektBaseUrl, input)),
    },
    {
      definition: openFileToolDefinition,
      register: (server, config) =>
        registerTool(server, openFileToolDefinition, async (input) => runOpenFileTool(config.reposRoot, input)),
    },
    {
      definition: listSymbolsToolDefinition,
      register: (server, config) =>
        registerTool(server, listSymbolsToolDefinition, async (input) => runListSymbolsTool(config.reposRoot, input)),
    },
    {
      definition: findSymbolToolDefinition,
      register: (server, config) =>
        registerTool(server, findSymbolToolDefinition, async (input) => runFindSymbolTool(config.reposRoot, input)),
    },
    {
      definition: findReferencesToolDefinition,
      register: (server, config) =>
        registerTool(server, findReferencesToolDefinition, async (input) =>
          runFindReferencesTool(config.reposRoot, config.zoektBaseUrl, input),
        ),
    },
    {
      definition: findRelatedFilesToolDefinition,
      register: (server, _config) =>
        registerTool(server, findRelatedFilesToolDefinition, async (input) => runFindRelatedFilesTool(input)),
    },
    {
      definition: analyzeSymbolToolDefinition,
      register: (server, _config) =>
        registerTool(server, analyzeSymbolToolDefinition, async (input) => runAnalyzeSymbolTool(input)),
    },
    {
      definition: searchPatternsToolDefinition,
      register: (server, _config) =>
        registerTool(server, searchPatternsToolDefinition, async (input) => runSearchPatternsTool(input)),
    },
  ];
}

export function getVisibleToolRegistrations(includeInternalTools: boolean): ToolRegistration[] {
  return getToolRegistrations().filter((entry) => includeInternalTools || entry.definition.visibility === 'public');
}

export function registerGojoTools(
  server: McpServer,
  config: AppConfig,
  options: { includeInternalTools?: boolean } = {},
): ToolRegistration[] {
  const registrations = getVisibleToolRegistrations(options.includeInternalTools ?? config.includeInternalTools);
  for (const registration of registrations) {
    registration.register(server, config);
  }
  return registrations;
}
