# RepoRadar

RepoRadar is a local code-intelligence engine that provides structured repository context for LLM agents and developers.

It combines:

- Zoekt full-text search
- Tree-sitter symbol extraction
- a persisted symbol index with stable `fileId` and `symbolId`
- an import/export graph with conservative local resolution
- ranking and context assembly layers
- orchestrator flows
- MCP tools, including `explore_component`, `search_patterns`, `collect_refactor_context`, and `analyze_symbol`

## Project Overview

RepoRadar helps agents work on real repositories where raw search alone is not enough.

It turns local codebases into structured navigation and exploration data:

- search finds candidate code quickly
- symbol indexing identifies files and declarations
- graph analysis connects imports and re-exports
- ranking surfaces the most useful files and symbols first
- orchestrator flows assemble agent-ready context bundles
- MCP tools expose those flows to clients

The current high-level MCP tools are `explore_component`, `search_patterns`, `collect_refactor_context`, and `analyze_symbol`.

## Why This Project Exists

Large repositories are difficult for LLM agents because:

- context windows are limited
- search results are noisy
- structural relationships are hidden behind imports, barrels, and project layout

RepoRadar exists to provide structured repository intelligence instead of forcing agents to reconstruct architecture from raw text search.

The goal is reliable agent workflows on real codebases:

- code navigation
- architecture discovery
- component exploration
- refactor planning
- scoped implementation work

## Architecture Overview

```text
Agent / Copilot
    |
    v
MCP Tools
    |
    v
Orchestrator
    |
    +-------------------+-------------------+
    |                   |                   |
    v                   v                   v
 Search              Graph              Symbols
    |                   |                   |
    v                   v                   v
 Zoekt           Import/Export      Tree-sitter +
                 Graph              Symbol Index
```

### Layer Roles

- `MCP Tools`
  - public stdio tool surface for agents and developer clients
  - includes low-level tools and the first high-level tool, `explore_component`
- `Orchestrator`
  - composes ranking, graph, and symbol context into practical flows
- `Search`
  - Zoekt-backed full-text retrieval
- `Graph`
  - file-level import and re-export relationships built from indexed metadata
- `Symbols`
  - Tree-sitter extraction plus persisted symbol and file relations

## Runtime Architecture

RepoRadar runs as three runtime services plus a shared repository mount:

- `zoekt`
  - serves indexed full-text search on port `6070`
- `zoekt-indexer`
  - scans `repos/` and refreshes Zoekt indexes
- `mcp-server`
  - serves MCP tools over stdio
  - reads repositories from `/repos`
  - persists MCP-side data in `mcp-server/.data`

Key persisted artifacts:

- `mcp-server/.data/symbol-index.json`
- `mcp-server/.data/code-graph.json`

## MCP Tools

Current public MCP tools:

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

### `explore_component`

`explore_component` explores the structure and context of a component or symbol inside a repository.

It returns a structured bundle including:

- resolved primary file
- resolved primary symbol
- related files
- defined symbols
- exported symbols
- a concise exploration summary

Why this matters:

- LLM agents can start from a ranked, structured component context instead of raw search results
- developers can inspect local architecture faster
- refactor planning becomes easier because important neighbors are already surfaced

### `search_patterns`

`search_patterns` finds similar implementations and repository precedents using heuristic pattern discovery.

It returns a structured bundle including:

- the resolved primary target
- ranked pattern matches
- file-level explanations for why each match was selected
- defined and exported symbols for the matched files

Why this matters:

- agents can find examples to imitate before generating code
- refactors can start from concrete precedent files instead of raw search results
- teams can inspect how a repository usually structures similar features

### `collect_refactor_context`

`collect_refactor_context` assembles refactor impact context for a file, component, or symbol.

It returns a structured bundle including:

- the resolved primary file
- exported and defined symbols
- importing and imported files
- graph neighbors
- ranked related files
- nearby directory or bundle-family files

Why this matters:

- agents can see likely impact surface before changing code
- developers can identify direct dependents and supporting files quickly
- refactor planning becomes more reliable without requiring deep semantic analysis

### `analyze_symbol`

`analyze_symbol` assembles structured symbol analysis for a file-level or exported symbol.

It returns a structured bundle including:

- the resolved primary symbol and file
- symbol kind and export status
- a grounded role summary
- importing and imported files
- graph neighbors and ranked related files
- nearby and sibling symbols in the defining file
- a usage summary that distinguishes file-level proxy counts from verified symbol-level references

Why this matters:

- agents can identify what a symbol is and where it sits in repository structure
- developers can inspect whether a symbol is local, feature-level, or part of a broader boundary
- symbol understanding becomes faster without claiming full semantic program analysis or full reference completeness

## Example

Example query:

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

An agent can use this to:

- inspect the main component file
- identify the most relevant collaborators immediately
- understand the exported surface
- start a targeted refactor or implementation change without manual graph reconstruction

## Quick Start

### Docker Compose

```bash
git clone <repo-url> reporadar
cd reporadar
mkdir repos
# add or symlink repositories under repos/
docker compose up -d --build
```

Example repository link:

```bash
ln -s /path/to/my-project repos/my-project
```

### Local MCP Server Build

From `mcp-server/`:

```bash
npm install
npm run build
npm run test
```

## Repository Layout

- `mcp-server/`
  - TypeScript MCP server, symbol index, graph, ranking, and orchestrator layers
- `zoekt/`
  - Zoekt image and indexing entrypoint
- `repos/`
  - local repositories mounted into the stack
- `docs/`
  - current architecture, operations, and testing docs
- `scripts/`
  - helper scripts such as one-shot indexing

## Documentation

Current docs:

- [Architecture](./docs/architecture.md)
- [Operations](./docs/operations.md)
- [Testing](./docs/testing.md)


## Roadmap

Next capabilities:

- reference-analysis context
- incremental index refresh
- JSX indexing support
- deeper cross-repo symbol graphs

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
