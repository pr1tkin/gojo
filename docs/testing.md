# Testing

## Philosophy

The project uses focused unit tests for the `mcp-server` codebase.

The aim is to verify:

- safe repository and file access
- Zoekt request construction and result formatting
- Tree-sitter parsing and symbol extraction
- symbol-index persistence and querying
- graph construction and local-resolution behavior
- ranking and context assembly
- orchestrator services
- MCP tool contracts, including `explore_component`, `search_patterns`, `collect_refactor_context`, and `analyze_symbol`

The suite does not try to replace Docker integration tests or a live MCP client session.

## Running Tests

From `mcp-server/`:

```powershell
npm install
npm run test
npm run test:coverage
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
- ranking behavior for symbols, related files, and references
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

That means the tests focus on:

- public input schema acceptance
- predictable structured output
- safe degradation for missing or ambiguous results
- delegation to existing internal layers rather than duplicated logic

For `explore_component`, the current tests cover:

- known component exploration
- repo filtering
- ambiguous names
- missing names
- repo filters that remove all candidates

For `search_patterns`, the current tests cover:

- component-style pattern discovery
- repo filtering
- stable ranking
- safe handling of missing targets
- explainable ranking signals

For `collect_refactor_context`, the current tests cover:

- component refactor context assembly
- file-based refactor context assembly
- symbol-based ambiguity handling
- safe handling of unresolved targets
- stable ordering of nearby and related files

For `analyze_symbol`, the current tests cover:

- exported symbol analysis
- local helper analysis
- file-filtered ambiguity resolution
- safe handling of missing symbols
- grounded role summary generation

## What Is Intentionally Out Of Scope

The unit suite does not attempt to cover:

- Docker or Compose integration behavior
- end-to-end MCP stdio sessions
- live Zoekt indexing/search container integration
- polling timing behavior for the indexer
- full cross-platform filesystem behavior for every symlink edge case
- performance benchmarking

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

## Current Validation Strategy

Use unit tests for:

- correctness of deterministic indexing and graph behavior
- stable public tool contracts
- safe failure modes

Use manual runtime checks for:

- Docker Compose startup
- Zoekt availability
- end-to-end MCP client integration
- exploration quality on real repositories

For runtime and environment setup, see [Operations](./operations.md). For the live system structure, see [Architecture](./architecture.md).
