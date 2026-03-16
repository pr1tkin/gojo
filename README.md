# RepoRadar

RepoRadar is a local code-intelligence stack for AI coding agents and developers.

It combines fast code search, syntax-aware symbol extraction, a deterministic import graph, ranking, and structured MCP tools so an agent can ask for repository context instead of reconstructing it from raw text search.

Short version: RepoRadar provides graph-aware code search, code intelligence, semantic code navigation primitives, and refactor context for local repositories.

## Why RepoRadar Exists

Large codebases are difficult for LLMs and human developers for the same reasons:

- raw search results are noisy
- structural relationships are hidden behind imports, barrels, and project layout
- relevant context is spread across files, symbols, and feature folders
- context windows are limited

RepoRadar addresses that problem with lightweight, structured code intelligence:

- Zoekt for graph-based code search entry points and fast retrieval
- Tree-sitter for symbol extraction
- a persisted symbol index with stable `fileId` and `symbolId`
- a deterministic import/export graph
- ranking and context assembly for agent-ready results
- MCP tools that expose high-level workflows

The result is a practical layer of developer tooling for LLMs and local repositories. It is surprisingly close in spirit to how modern code-intelligence systems such as Sourcegraph Cody work internally, while staying smaller, more explicit, and easier to inspect.

## What The System Does

RepoRadar is designed to support structured agent workflows such as:

- understanding an unfamiliar codebase
- exploring component structure and nearby files
- finding repository precedents before generating code
- preparing safer refactors
- understanding a symbol's role and surrounding usage context

Current high-level MCP tools:

- `explore_component` for component and symbol exploration
- `search_patterns` for heuristic precedent discovery
- `collect_refactor_context` for refactor impact surface assembly
- `analyze_symbol` for structured symbol analysis

The MCP server also exposes lower-level tools such as `search_code`, `open_file`, `list_symbols`, `find_symbol`, `find_references`, and `find_related_files`.

## Architecture Overview

```text
Search
  Zoekt

Structure
  Tree-sitter
  Symbol Index
  Stable fileId / symbolId

Code Graph
  Import / Export relationships
  Deterministic local resolution

Retrieval
  Ranking
  Context Assembly
  Orchestrator Services

Agent Interface
  MCP tools
    explore_component
    search_patterns
    collect_refactor_context
    analyze_symbol
```

### Layer summary

- `Search layer`
  - Zoekt-backed full-text retrieval over indexed repositories
- `Symbol layer`
  - Tree-sitter parsing, persisted symbol metadata, stable identities, export markers, and symbol frequency stats
- `Graph layer`
  - deterministic file-level import and re-export relationships, including relative and conservative alias/baseUrl resolution
- `Ranking + context`
  - related-file selection, candidate ordering, and explainable context assembly
- `Orchestrator services`
  - high-level flows composed from the underlying layers
- `MCP tools`
  - the public interface exposed to agents and developer clients

For the full system breakdown, see [docs/architecture.md](./docs/architecture.md).

## Why this is useful for AI coding agents

AI coding agents are much more effective when they can work from structured signals instead of raw text search alone.

RepoRadar helps by surfacing:

- symbol identity and export status
- graph relationships between files
- ranked related files and neighboring context
- refactor context before a change

Practical examples:

- `Example 1 - Understanding a component`
  - `explore_component` helps an agent identify the main file, related files, and exported surface of a component quickly.
- `Example 2 - Finding precedents`
  - `search_patterns` helps an agent discover similar implementations elsewhere in the repository before generating code.
- `Example 3 - Preparing a refactor`
  - `collect_refactor_context` helps estimate the blast radius of a change by surfacing imports, importers, and nearby files.
- `Example 4 - Understanding a symbol`
  - `analyze_symbol` helps determine a symbol's role, whether it is local or exported, and what surrounding context matters.

## Agent Workflow Example

A typical repository exploration flow looks like this:

1. `explore_component`
   - find the primary file, exported symbols, and most relevant neighboring files for a component or symbol
2. `search_patterns`
   - discover similar implementations and repository precedents before generating or changing code
3. `collect_refactor_context`
   - inspect importers, imports, graph neighbors, and nearby bundle files before a refactor
4. `analyze_symbol`
   - understand what a symbol is, whether it is exported, how local or shared it appears, and what nearby context matters

This keeps an agent anchored in repository structure instead of raw text matches.

## MCP Tools

### `explore_component`

Entry-point component exploration for file structure and dependencies.

Returns structured context such as:

- resolved primary file and symbol
- related files
- defined symbols
- exported symbols
- a concise exploration summary

### `search_patterns`

Heuristic repository precedent discovery.

Returns:

- resolved target
- ranked similar files or components
- explainable matching reasons
- symbol and export summaries for the matches

### `collect_refactor_context`

Refactor impact surface assembly.

Returns:

- the primary file
- importing and imported files
- graph neighbors
- ranked related files
- nearby directory or bundle-family files
- counts that help estimate local impact

### `analyze_symbol`

Structured symbol analysis.

Returns:

- the primary symbol and file
- symbol kind and export status
- a grounded role summary
- nearby and sibling symbols
- importing/imported file context
- usage summary fields that distinguish file-level proxy usage from verified symbol-level references when reference data is unavailable

A fuller tool reference is available in [docs/tools.md](./docs/tools.md).

## Example

```text
explore_component("ArticleContent", { "repo": "example-news-app" })
```

Example result summary:

```text
Primary file:
src/app/articles/[id]/ArticleContent.tsx

Related files:
src/app/_components/articleHeaderText/ArticleHeaderText.tsx
src/app/_components/text/Text.tsx
src/app/articles/[id]/page.tsx
src/app/_components/metadata/footer/Footer.tsx
src/app/_components/metadata/podcast/Podcast.tsx

Exported symbols:
ArticleContent
ArticleContentProps
```

An agent can use this result to open the main implementation, inspect nearby collaborators, understand the exported surface, and start a scoped implementation or refactor with better context.

## Quickstart

### 1. Clone the repository

```bash
git clone <repo-url> reporadar
cd reporadar
```

### 2. Add repositories to index

RepoRadar expects local Git repositories under `./repos`.

```bash
mkdir repos
ln -s /path/to/my-project repos/my-project
```

Only first-level entries under `repos/` are indexed.

### 3. Start the search stack

```bash
docker compose up -d --build
```

This starts:

- `zoekt` on `http://localhost:6070`
- `zoekt-indexer` for periodic repository indexing
- `mcp-server` for MCP tool execution over stdio

### 4. Build the MCP server locally

```bash
cd mcp-server
npm install
npm run build
npm run test
```

Run the server directly:

```bash
npm run start
```

### 5. Call tools from an MCP client or agent

Once the MCP server is running in an MCP-capable client, the current high-level workflows are:

- `explore_component("Button")`
- `search_patterns({ "name": "Button", "mode": "component" })`
- `collect_refactor_context({ "name": "Button", "mode": "component" })`
- `analyze_symbol({ "name": "ButtonProps" })`

For runtime details, see [docs/operations.md](./docs/operations.md).

## Example Use Cases

- `Understanding an unfamiliar codebase`
  - start with `explore_component`, then inspect related files and symbols
- `Finding implementation precedents`
  - use `search_patterns` to find similar repository-local implementations before writing code
- `Preparing a safe refactor`
  - use `collect_refactor_context` to inspect importers, imports, and nearby files
- `Exploring symbol usage`
  - use `analyze_symbol` to understand whether a symbol is local, exported, feature-level, or broadly shared

## Project Structure

- `mcp-server/`
  - TypeScript MCP server, symbol indexing, graph logic, ranking, context assembly, and orchestrator services
- `zoekt/`
  - Zoekt container image and indexing entrypoint
- `repos/`
  - local repositories mounted into the stack
- `scripts/`
  - helper scripts such as one-shot indexing
- `docs/`
  - architecture, operations, testing, and tool documentation

## Development Workflow

Typical local workflow:

1. add or update repositories under `repos/`
2. start the stack with `docker compose up -d --build`
3. build and test the MCP server from `mcp-server/`
4. validate tool behavior against a real repository

## Testing

From `mcp-server/`:

```bash
npm run test
npm run test:coverage
npm run build
```

The test suite focuses on deterministic indexing, graph behavior, orchestrator services, and MCP tool contracts. It does not claim full end-to-end runtime coverage.

Details: [docs/testing.md](./docs/testing.md)

## Contributing

Contributions should keep the project explicit and technically honest.

Current principles:

- prefer simple, inspectable code over heavy abstraction
- keep graph and ranking behavior explainable
- avoid overstating semantic understanding
- keep public MCP tools practical and bounded

## Roadmap

Near-term roadmap:

- impact analysis for clearer change blast-radius estimation
- symbol ownership and API boundary detection
- change planning and patch-planning support for agents
- deeper reference-analysis context
- incremental index refresh
- `.jsx` indexing support
- deeper cross-repo graph capabilities

## Documentation

- [Architecture](./docs/architecture.md)
- [Tools](./docs/tools.md)
- [Operations](./docs/operations.md)
- [Testing](./docs/testing.md)

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
