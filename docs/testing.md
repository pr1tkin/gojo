# Testing

## Philosophy

RepoRadar uses focused unit tests for the `mcp-server` codebase.

The goal is to verify the deterministic parts of the code-intelligence stack:

- safe repository and file access
- Zoekt request construction and result formatting
- Tree-sitter parsing and symbol extraction
- symbol-index persistence and querying
- graph construction and deterministic local resolution
- ranking and context assembly
- orchestrator services
- MCP tool contracts for the public workflows

The test suite does not try to simulate a full end-to-end MCP client session or full Docker integration.

## Running Tests

From `mcp-server/`:

```powershell
npm install
npm run test
npm run test:coverage
npm run build
```

Vitest configuration:

- [`mcp-server/vitest.config.ts`](/C:/workspace/repo-radar/mcp-server/vitest.config.ts)

Unit test directory:

- [`mcp-server/test/unit`](/C:/workspace/repo-radar/mcp-server/test/unit)

## What Is Covered

Current direct coverage includes:

- config and environment parsing
- repository discovery
- safe file reads
- Zoekt client behavior
- Tree-sitter parsing and symbol extraction
- symbol-index build, persistence, and querying
- TypeScript project helpers and compiler-backed fallback behavior
- graph build, persistence, query helpers, and deterministic local resolution
- ranking behavior for symbols, related files, references, and heuristic pattern matches
- context assembly
- orchestrator services
- tool-layer behavior for:
  - `search_code`
  - `open_file`
  - `list_symbols`
  - `find_symbol`
  - `find_references`
  - `find_related_files`
  - `explore_component`
  - `search_patterns`
  - `collect_refactor_context`
  - `analyze_symbol`

Fixtures live under:

- [`mcp-server/test/fixtures`](/C:/workspace/repo-radar/mcp-server/test/fixtures)

## Tool-Level Coverage

The public MCP tools are intentionally tested as thin adapters.

That means tool tests focus on:

- public input schema acceptance
- predictable structured output
- safe degradation for missing or ambiguous inputs
- delegation to existing internal layers rather than duplicated logic

### `explore_component`

Current tests cover:

- known component exploration
- repo filtering
- ambiguous names
- missing names
- repo filters that remove all candidates

### `search_patterns`

Current tests cover:

- component-style pattern discovery
- repo filtering
- stable ranking
- safe handling of missing targets
- explainable ranking signals

### `collect_refactor_context`

Current tests cover:

- component refactor context assembly
- file-based refactor context assembly
- symbol-based ambiguity handling
- safe handling of unresolved targets
- stable ordering of nearby and related files

### `analyze_symbol`

Current tests cover:

- exported symbol analysis
- local helper analysis
- file-filtered ambiguity resolution
- safe handling of missing symbols
- grounded role summary generation
- safer usage summary fields for file-level proxy counts versus verified symbol-level references when reference data is unavailable

## What Is Intentionally Out Of Scope

The unit suite does not attempt to cover:

- Docker or Compose integration behavior
- end-to-end MCP stdio sessions
- live Zoekt indexing and search container integration
- polling timing behavior for the indexer
- full cross-platform filesystem behavior for every symlink edge case
- performance benchmarking
- full semantic or reference-complete program analysis

`server.ts` remains lightly tested indirectly because it is mostly MCP SDK bootstrap and tool registration glue.

## Suggested Validation Commands

Targeted examples:

```powershell
npm run test -- graph.build.test.ts graph.store-query.test.ts
npm run test -- orchestrator.service.test.ts
npm run test -- explore-component.tool.test.ts
npm run test -- pattern-service.test.ts search-patterns.tool.test.ts
npm run test -- refactor-context.service.test.ts collect-refactor-context.tool.test.ts
npm run test -- symbol-analysis.service.test.ts analyze-symbol.tool.test.ts
```

Full build verification:

```powershell
npm run build
```

## Validation Strategy

Use unit tests for:

- deterministic indexing and graph correctness
- stable public MCP tool contracts
- explainable ranking behavior
- safe failure modes

Use manual runtime checks for:

- Docker Compose startup
- Zoekt availability
- MCP client integration
- exploration quality on real repositories

For runtime setup, see [Operations](./operations.md). For system structure, see [Architecture](./architecture.md).
