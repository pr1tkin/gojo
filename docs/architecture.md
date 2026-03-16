# Architecture

## Overview

RepoRadar is a local code-intelligence stack for repository exploration.

It combines:

- Zoekt for full-text search
- Tree-sitter for TypeScript and TSX symbol extraction
- a persisted symbol index with stable file and symbol identities
- a file-level import/export graph
- ranking and context assembly layers
- orchestrator services
- an MCP tool layer

The current public high-level MCP tools are `explore_component`, `search_patterns`, `collect_refactor_context`, and `analyze_symbol`.

## Runtime Services

RepoRadar runs as three runtime services plus a shared repository mount:

- `zoekt`
  - serves indexed full-text search over HTTP on port `6070`
  - reads index data from `/data/index`
- `zoekt-indexer`
  - scans `/repos`
  - builds and refreshes Zoekt indexes in `/data/index`
  - uses `INDEX_INTERVAL_SECONDS`, default `300`
- `mcp-server`
  - runs over stdio
  - reads repositories from `/repos`
  - persists local MCP-side data in `/app/.data`
  - exposes MCP tools to clients

## Layered Architecture

```text
Agent / Copilot
    |
    v
MCP Tools
    |
    v
Orchestrator Services
    |
    +-------------------+-------------------+-------------------+
    |                   |                   |                   |
    v                   v                   v                   v
 Search              Symbols             Graph              Ranking
    |                   |                   |                   |
    v                   v                   v                   v
 Zoekt           Tree-sitter +        Import/Export       Context
                 Symbol Index         Relationships       Selection
```

## Layer Responsibilities

### MCP Tool Layer

The MCP tool layer is the public interface exposed over stdio.

Current tools:

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

`explore_component`, `search_patterns`, `collect_refactor_context`, and `analyze_symbol` are the current high-level public tools. They return structured exploration, refactor, or symbol-analysis results rather than low-level raw lookup results.

### Orchestrator Services

The orchestrator layer turns graph, symbol, and ranking data into useful exploration flows.

Current public-facing internal services:

- `getFileExplorationContext(...)`
- `getSymbolExplorationContext(...)`
- `getPatternMatchesForFile(...)`
- `getPatternMatchesForSymbol(...)`
- `getPatternMatchesForComponent(...)`
- `getRefactorContextForFile(...)`
- `getRefactorContextForSymbol(...)`
- `getRefactorContextForComponent(...)`
- `getAnalyzeSymbolContext(...)`

These services feed the `explore_component`, `search_patterns`, `collect_refactor_context`, and `analyze_symbol` adapters.

### Context Assembly Layer

The context layer assembles:

- ranked related files
- neighboring files
- defined symbols
- exported symbols

It does not perform indexing or graph construction directly. It composes existing graph and symbol data into agent-ready bundles.

### Ranking Layer

The ranking layer prioritizes:

- symbol candidates
- related files
- reference candidates
- heuristic pattern matches

It keeps selection explainable by attaching scoring reasons.

### Graph Layer

The graph layer builds file-level relationships from indexed import/export metadata.

Current graph capabilities:

- deterministic file import edges
- deterministic re-export edges
- relative import resolution
- deterministic `tsconfig` / `jsconfig` alias resolution
- deterministic repo-root `baseUrl` local import resolution

Edge creation stays conservative:

- create an edge only when exactly one indexed local target resolves
- prefer missing edges over incorrect guesses

### Symbol Layer

The symbol layer is built from Tree-sitter parsing plus persisted file metadata.

Current symbol index data includes:

- stable `fileId`
- stable `symbolId`
- symbol names and kinds
- exported markers
- file-level import/export metadata
- aggregate symbol frequency statistics

Persisted files:

- `mcp-server/.data/symbol-index.json`
- `mcp-server/.data/code-graph.json`

### Search Layer

Zoekt handles repository-scale full-text search.

It is used for:

- raw code search
- fallback exploration paths where text retrieval is still useful

Zoekt does not parse syntax and does not maintain symbol or graph relationships.

## Data Flow

### Indexing

```text
repos/ -> zoekt-indexer -> zoekt-index volume -> zoekt
repos/ -> mcp-server symbol indexing -> symbol-index.json -> code-graph.json
```

1. Repositories are placed under `./repos`.
2. `zoekt-indexer` scans and refreshes Zoekt indexes.
3. The MCP server builds a persisted symbol index from repository files.
4. The MCP server builds a code graph from the persisted symbol index.

### Exploration

```text
MCP client -> high-level MCP tools
                    |
                    v
            Orchestrator services
                    |
        +-----------+-----------+-----------+
        |                       |           |
        v                       v           v
    Symbol context          File context   Refactor context
        |                       |           |
        +-----------+-----------+-----------+
                    |
                    v
      ranked related files + heuristic pattern matches + impact surface
```

## `explore_component`

Purpose:

- explore the structure and context of a component or symbol in a repository

Current output shape includes:

- resolved primary symbol
- resolved primary file
- related files
- defined symbols
- exported symbols
- structured summary
- ambiguity details when multiple candidates exist

This matters because it gives agents a practical starting point for:

- code navigation
- architecture discovery
- component understanding
- refactor planning

## `search_patterns`

Purpose:

- find similar implementations and repository precedents using heuristic pattern discovery

Current output shape includes:

- resolved primary target
- ranked pattern matches
- explainable scoring reasons
- defined symbols for matched files
- exported symbols for matched files

This matters because it gives agents a practical way to:

- inspect similar implementations before generating code
- find repository-local precedent for refactors
- compare file neighborhoods and export surfaces without claiming deep semantic understanding

## `collect_refactor_context`

Purpose:

- assemble refactor impact context for a file, component, or symbol

Current output shape includes:

- resolved primary file
- exported symbols
- importing files
- imported files
- graph neighbors
- ranked related files
- nearby directory or bundle-family files
- ambiguity notes when symbol resolution is not unique

This matters because it gives agents a practical way to:

- estimate what surrounding code must be understood before a change
- identify direct dependents and local impact surface
- plan scoped refactors without claiming full semantic impact analysis

## `analyze_symbol`

Purpose:

- assemble structured symbol analysis for a file-level or exported symbol

Current output shape includes:

- resolved primary symbol and file
- symbol kind and exported status
- a grounded role summary
- importing and imported files
- graph neighbors
- ranked related files
- nearby and sibling symbols from the defining file
- usage summary fields that distinguish file-level proxy usage from verified symbol-level references when references are unavailable

This matters because it gives agents a practical way to:

- identify what a symbol is in repository context
- understand whether it is local, feature-level, or part of a broader boundary
- gather nearby files and symbols without claiming full semantic program understanding
- interpret importer counts safely as file-level proxy usage when symbol-level references are not available

## Repository And Storage Layout

- `./repos`
  - host directory for local Git repositories
  - first-level symlinks are supported if they resolve correctly
- `zoekt-index`
  - Docker named volume shared by `zoekt` and `zoekt-indexer`
- `mcp-server/.data/symbol-index.json`
  - persisted symbol index
- `mcp-server/.data/code-graph.json`
  - persisted import/export graph snapshot

## Compose Layout

The current `docker-compose.yml` defines:

- `zoekt`
  - serves Zoekt search over `6070`
- `zoekt-indexer`
  - performs periodic indexing of `/repos`
- `mcp-server`
  - runs the MCP server over stdio
  - mounts `/repos`
  - depends on `zoekt`

## Boundaries

### Zoekt

- full-text search only
- no syntax parsing
- no symbol graph ownership

### MCP Server

- stdio MCP protocol handling
- symbol indexing
- graph building
- ranking
- context assembly
- orchestrator services
- MCP tool exposure

### Not In Scope Today

- broad public tool-surface redesign
- incremental refresh
- `.jsx` symbol indexing
- speculative package or workspace inference
- deeper cross-repo symbol graph inference

## Related Documents

- [README](../README.md)
- [Operations](./operations.md)
- [Testing](./testing.md)
