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

type ToolRole = 'primary' | 'specialist' | 'internal';

export interface ToolDefinitionLike {
  name: string;
  title: string;
  description: string;
  visibility: ToolVisibility;
  role?: ToolRole;
  inputSchema: unknown;
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
  if (definition.visibility === 'internal') {
    return `[INTERNAL] Not intended for direct agent use. ${definition.description}`;
  }

  return definition.role === 'primary'
    ? `Recommended entry point. ${definition.description}`
    : `Specialist tool. ${definition.description}`;
}

function registerTool(
  server: McpServer,
  definition: ToolDefinitionLike,
  handler: (input: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
): void {
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: buildDescription(definition),
      inputSchema: definition.inputSchema as never,
      _meta: {
        visibility: definition.visibility,
        internal: definition.visibility === 'internal',
        role: definition.role ?? (definition.visibility === 'internal' ? 'internal' : 'specialist'),
        recommendedEntryPoint: definition.role === 'primary',
      },
    },
    handler as never,
  );
}

export function getToolRegistrations(): ToolRegistration[] {
  return [
    {
      definition: buildChangeContextToolDefinition,
      register: (server, _config) =>
        registerTool(server, buildChangeContextToolDefinition, async (input) =>
          runBuildChangeContextTool(input as Parameters<typeof runBuildChangeContextTool>[0]),
        ),
    },
    {
      definition: exploreComponentToolDefinition,
      register: (server, _config) =>
        registerTool(server, exploreComponentToolDefinition, async (input) =>
          runExploreComponentTool(input as Parameters<typeof runExploreComponentTool>[0]),
        ),
    },
    {
      definition: findPrecedentsToolDefinition,
      register: (server, _config) =>
        registerTool(server, findPrecedentsToolDefinition, async (input) =>
          runFindPrecedentsTool(input as Parameters<typeof runFindPrecedentsTool>[0]),
        ),
    },
    {
      definition: collectRefactorContextToolDefinition,
      register: (server, _config) =>
        registerTool(server, collectRefactorContextToolDefinition, async (input) =>
          runCollectRefactorContextTool(input as Parameters<typeof runCollectRefactorContextTool>[0]),
        ),
    },
    {
      definition: planChangeToolDefinition,
      register: (server, _config) =>
        registerTool(server, planChangeToolDefinition, async (input) =>
          runPlanChangeTool(input as Parameters<typeof runPlanChangeTool>[0]),
        ),
    },
    {
      definition: searchCodeToolDefinition,
      register: (server, config) =>
        registerTool(server, searchCodeToolDefinition, async (input) =>
          runSearchCodeTool(config.search.baseUrl, input as Parameters<typeof runSearchCodeTool>[1]),
        ),
    },
    {
      definition: openFileToolDefinition,
      register: (server, config) =>
        registerTool(server, openFileToolDefinition, async (input) =>
          runOpenFileTool(config.reposRoot, input as Parameters<typeof runOpenFileTool>[1]),
        ),
    },
    {
      definition: listSymbolsToolDefinition,
      register: (server, config) =>
        registerTool(server, listSymbolsToolDefinition, async (input) =>
          runListSymbolsTool(config.reposRoot, input as Parameters<typeof runListSymbolsTool>[1]),
        ),
    },
    {
      definition: findSymbolToolDefinition,
      register: (server, config) =>
        registerTool(server, findSymbolToolDefinition, async (input) =>
          runFindSymbolTool(config.reposRoot, input as Parameters<typeof runFindSymbolTool>[1]),
        ),
    },
    {
      definition: findReferencesToolDefinition,
      register: (server, config) =>
        registerTool(server, findReferencesToolDefinition, async (input) =>
          runFindReferencesTool(config.reposRoot, config.search.baseUrl, input as Parameters<typeof runFindReferencesTool>[2]),
        ),
    },
    {
      definition: findRelatedFilesToolDefinition,
      register: (server, _config) =>
        registerTool(server, findRelatedFilesToolDefinition, async (input) =>
          runFindRelatedFilesTool(input as Parameters<typeof runFindRelatedFilesTool>[0]),
        ),
    },
    {
      definition: analyzeSymbolToolDefinition,
      register: (server, _config) =>
        registerTool(server, analyzeSymbolToolDefinition, async (input) =>
          runAnalyzeSymbolTool(input as Parameters<typeof runAnalyzeSymbolTool>[0]),
        ),
    },
    {
      definition: searchPatternsToolDefinition,
      register: (server, _config) =>
        registerTool(server, searchPatternsToolDefinition, async (input) =>
          runSearchPatternsTool(input as Parameters<typeof runSearchPatternsTool>[0]),
        ),
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
