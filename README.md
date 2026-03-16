# RepoRadar

Code intelligence stack for agent-assisted repository understanding and safe refactor planning.

RepoRadar sits between simple code search and full compiler-backed refactoring systems. It combines fast search, syntax-aware indexing, a deterministic repository graph, and agent-facing MCP workflows so an agent can understand a codebase and plan safer changes without pretending to have perfect semantic knowledge.

## Why This Project Exists

There is a practical gap between:

- simple search tools that return raw text matches
- full semantic compilers and refactoring engines that are expensive, language-specific, and often too heavy for general repository understanding

RepoRadar focuses on the middle ground:

- repository graph analysis
- blast-radius detection
- API boundary approximation
- agent-assisted refactor planning

The goal is not full semantic understanding. The goal is useful, conservative, explainable code intelligence for real repositories.

## Problem

Large repositories are hard to navigate with raw search alone.

- search results are noisy
- symbol roles are hidden behind imports and barrel files
- architectural boundaries are implied by folder structure and usage patterns
- change risk is difficult to judge before editing

RepoRadar helps an agent answer questions like:

- what is this symbol and where does it matter?
- which files are structurally related?
- how broad is the likely blast radius?
- is this symbol internal, shared, or part of a surface?
- what is the safest order for a change?

## Architecture Overview

```text
Agent / Copilot
      |
      v
MCP Server
  |- explore_component
  |- search_patterns
  |- analyze_symbol
  |- collect_refactor_context
  `- plan_change
      |
      v
Local Intelligence Layer
  |- Zoekt search
  |- Tree-sitter
  |- Symbol index
  |- Code graph
  |- Impact analysis
  |- Ownership detection
  `- Change planning
```

## Architecture Summary

RepoRadar is built as a layered pipeline:

`Search -> Structure -> Graph -> Impact -> Ownership -> Planning`

- `Search`
  - Zoekt-backed repository search for fast candidate retrieval
- `Structure`
  - Tree-sitter symbol extraction with persisted `fileId` and `symbolId`
- `Graph`
  - deterministic import and re-export relationships with conservative local resolution
- `Impact`
  - bounded blast-radius estimation for direct and transitive dependents
- `Ownership`
  - heuristic API-boundary and shared-vs-internal classification
- `Planning`
  - scope, risk, and ordered edit/review planning for safer changes

For the full system breakdown, see [docs/architecture.md](./docs/architecture.md).

## Capabilities

- semantic-style code search grounded in repository structure
- structural symbol extraction with stable identities
- repository graph analysis over imports and re-exports
- ranked related-file and context assembly
- blast-radius detection for direct and transitive impact
- API boundary approximation using ownership heuristics
- ordered refactor planning with edit and review targets
- agent-oriented code navigation through MCP tools

## MCP Tools

High-level agent workflows:

- `explore_component`
  - understand a component or symbol in repository context
- `search_patterns`
  - find precedents and structurally similar implementations
- `analyze_symbol`
  - explain a symbol's role, usage shape, and surrounding context
- `collect_refactor_context`
  - assemble import, importer, and nearby-file context before a change
- `plan_change`
  - estimate safe change scope, risk, and ordered edit/review steps

Lower-level support tools are also available for search, file access, symbol listing, references, and related-file discovery.

## Example Workflow

Typical agent workflow:

```text
explore_component("AudioHero")
analyze_symbol("AudioHero")
collect_refactor_context("AudioHero")
plan_change("AudioHero")
```

Outcome:

- a grounded view of the symbol and its collaborators
- likely blast radius
- likely ownership or API-boundary role
- safe change scope
- primary edit targets
- review targets
- conservative risk estimation

## Quick Start

### 1. Add repositories

RepoRadar expects local Git repositories under `./repos`.

```bash
mkdir repos
ln -s /path/to/my-project repos/my-project
```

### 2. Start the stack

```bash
docker compose up -d --build
```

This starts:

- `zoekt`
- `zoekt-indexer`
- `mcp-server`

### 3. Build the MCP server locally

```bash
cd mcp-server
npm install
npm run build
npm run test
```

### 4. Run the MCP server

```bash
npm run start
```

### 5. Call MCP tools

Example workflow from an MCP-capable client:

```text
explore_component("Button")
search_patterns({ "name": "Button", "mode": "component" })
analyze_symbol({ "name": "Button" })
collect_refactor_context({ "name": "Button", "mode": "component" })
plan_change({ "symbol": "Button", "filePath": "src/app/_components/button/Button.tsx" })
```

## What `plan_change` Adds

`plan_change` is the first agent-facing planning workflow built on top of the internal analysis stack.

It exposes:

- change scope
- change risk
- planning signals
- primary edit files
- secondary edit files
- review files
- ordered edit/review steps

It does not generate patches, rewrite code, or guarantee safe refactors.

## Repository Layout

- `mcp-server/`
  - MCP server, symbol indexing, graph logic, orchestrator services, and tools
- `zoekt/`
  - Zoekt image and indexing entrypoint
- `repos/`
  - local repositories mounted into the stack
- `docs/`
  - architecture, tools, operations, and testing documentation

## Documentation

- [Architecture](./docs/architecture.md)
- [Tools](./docs/tools.md)
- [Operations](./docs/operations.md)
- [Testing](./docs/testing.md)

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
