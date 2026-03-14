# Testing

## Philosophy

The project uses focused unit tests for the `mcp-server` codebase. The aim is to verify core navigation and safety logic directly, without depending on Docker, a live MCP client, or a running Zoekt instance.

The suite prioritizes:

- repository discovery and symlink handling
- safe file access and traversal protection
- Zoekt request construction and result normalization
- Tree-sitter parsing and symbol extraction
- compiler-backed TypeScript precision behavior
- thin public tool-handler contracts

## Running Tests

From `mcp-server/`:

```powershell
npm install
npm run test
npm run test:coverage
```

Vitest configuration lives in [`mcp-server/vitest.config.ts`](/C:/workspace/mcp-code-search/mcp-server/vitest.config.ts). Unit tests run from [`mcp-server/test/unit`](/C:/workspace/mcp-code-search/mcp-server/test/unit).

## What Is Covered

Current direct coverage includes:

- `config.ts`
- `files.ts`
- `repositories.ts`
- `zoekt-client.ts`
- `formatters.ts`
- `tree-sitter.ts`
- `symbols.ts`
- TypeScript precision modules:
  - `tsconfig-discovery.ts`
  - `project-loader.ts`
  - `references.ts`
  - fallback behavior for compiler precision
- tool-layer behavior for:
  - `search_code`
  - `open_file`
  - `list_symbols`
  - compiler-aware `find_symbol`
  - compiler-aware `find_references` fallback behavior

Fixtures live under [`mcp-server/test/fixtures`](/C:/workspace/mcp-code-search/mcp-server/test/fixtures), including a small real TypeScript project for compiler-backed tests.

## Coverage Overview

The current suite was re-run during the final Phase 2 audit.

Useful highlights:

- `config.ts`: 100%
- `files.ts`: 97.53%
- `repositories.ts`: 96%
- `zoekt-client.ts`: 100%
- `formatters.ts`: 100%
- `tree-sitter.ts`: 100%
- `symbols.ts`: 95.23%
- `tsconfig-discovery.ts`: 96.25%
- `project-loader.ts`: 93.75%
- `references.ts`: 91.27%

Some coverage totals remain lower than those individual modules suggest because the repo intentionally does not try to unit-test every thin entrypoint or every persisted-index helper in this phase.

## Intentionally Out Of Scope

The suite still does not attempt to cover:

- Docker or Compose integration behavior
- end-to-end MCP stdio client sessions
- live Zoekt indexing/search container integration
- polling timing behavior for the indexer
- complete cross-platform filesystem behavior for every symlink edge case
- performance benchmarking

`server.ts` remains intentionally outside the unit-test target because it is thin MCP SDK bootstrap code.
