# Architecture

## Overview

RepoRadar is a local code-intelligence stack for AI coding agents and developers.

It combines:

- Zoekt for repository-scale code search
- Tree-sitter for TypeScript and TSX symbol extraction
- a persisted symbol index with stable `fileId` and `symbolId`
- structured import/export metadata and symbol frequency statistics
- a deterministic file-level code graph
- ranking and context assembly layers
- orchestrator services
- MCP tools for high-level agent workflows

RepoRadar does not attempt full semantic program understanding. It provides practical, graph-aware code navigation and structured context retrieval for real repositories.

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
  - persists MCP-side data in `/app/.data`
  - exposes MCP tools to clients

## Layered Architecture

```text
Agent / MCP Client
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
   Search Layer        Symbol Layer        Graph Layer       Ranking + Context
        |                   |                   |                   |
        v                   v                   v                   v
      Zoekt         Tree-sitter +        Import / Export      Candidate ordering,
                    Symbol Index         Relationships        related files, summaries
```

## Layer Responsibilities

### Search Layer

The search layer is Zoekt-backed full-text retrieval.

It is used for:

- fast repository-wide search
- candidate discovery when exact file or symbol context is not yet known
- low-level search-oriented MCP tools

Zoekt does not parse syntax and does not own symbol or graph relationships.

### Symbol Layer

The symbol layer is built from Tree-sitter parsing plus persisted file metadata.

Current symbol data includes:

- stable `fileId`
- stable `symbolId`
- symbol names and kinds
- export markers
- file-level import/export metadata
- aggregate symbol frequency statistics

Persisted files:

- `mcp-server/.data/symbol-index.json`
- `mcp-server/.data/code-graph.json`

### Graph Layer

The graph layer builds file-level relationships from indexed import/export metadata.

Current graph capabilities:

- deterministic file import edges
- deterministic re-export edges
- relative import resolution
- deterministic `tsconfig` and `jsconfig` alias resolution
- deterministic repo-root `baseUrl` local import resolution

Edge creation stays conservative:

- create an edge only when exactly one indexed local target resolves
- prefer missing edges over incorrect guesses

### Ranking And Context Layer

The ranking and context layers prioritize and assemble repository context.

They provide:

- symbol candidate ordering
- related-file selection
- heuristic pattern matching signals
- explainable scoring reasons
- concise structured summaries for tools

This layer does not index files or build the graph. It composes data from the search, symbol, and graph layers into agent-ready results.

### Orchestrator Services

The orchestrator layer turns indexed data into practical workflows.

Current internal services include:

- `getFileExplorationContext(...)`
- `getSymbolExplorationContext(...)`
- `getPatternMatchesForFile(...)`
- `getPatternMatchesForSymbol(...)`
- `getPatternMatchesForComponent(...)`
- `getRefactorContextForFile(...)`
- `getRefactorContextForSymbol(...)`
- `getRefactorContextForComponent(...)`
- `getAnalyzeSymbolContext(...)`
- `analyzeSymbolOwnership(...)`

These services compose the underlying layers rather than reimplementing them.

The internal impact-analysis service now also adds result summarization for large blast-radius cases. This summary is derived from the existing direct and transitive impact sets and does not change impact detection or traversal depth.

The internal ownership-analysis service adds heuristic symbol ownership and API-boundary approximation. It reuses the existing symbol index, import/export metadata, and graph relationships, and returns conservative classifications backed by explicit export-surface, path-boundary, usage-fanout, and barrel-entry signals.

Recent refinement work improved ownership classification calibration for local helpers, feature-local exports, and framework entry surfaces while keeping the same explainable heuristic signal model.

The latest refinement improves ownership conflict resolution for barrel-exported shared surfaces so reusable symbols exposed through index-style entry files are less likely to collapse to unknown while local helper protection stays intact.

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

The higher-level tools are built on top of the orchestrator layer and return structured results rather than raw primitives.

## How The Public Tools Build On The Stack

### `explore_component`

Purpose:

- understand the structure and context of a component or symbol in a repository

Builds on:

- symbol resolution
- graph-derived neighboring files
- ranking of related files
- file-level defined and exported symbols

Returns:

- resolved primary symbol and file
- related files
- defined symbols
- exported symbols
- a concise exploration summary

### `search_patterns`

Purpose:

- discover repository precedents and structurally similar implementations

Builds on:

- symbol and file resolution
- graph neighbor signals
- naming and file-family heuristics
- explainable ranking signals

Returns:

- resolved target
- ranked matches
- reasons for each match
- symbol and export summaries for the matched files

This is heuristic pattern discovery, not deep semantic similarity.

### `collect_refactor_context`

Purpose:

- assemble a bounded refactor impact surface for a file, component, or symbol

Builds on:

- direct importers and imports
- direct re-export chains
- graph neighbors
- related-file ranking
- nearby same-directory or bundle-family files

Returns:

- the primary file
- importing and imported files
- graph neighbors
- related files
- nearby files
- summary counts that help estimate local impact

This is refactor context assembly, not full impact analysis.

### `analyze_symbol`

Purpose:

- explain a symbol's identity, role, and surrounding usage context

Builds on:

- symbol resolution
- export status and symbol kind
- file-level graph relationships
- related-file ranking
- nearby and sibling symbols in the defining file

Returns:

- the primary symbol and file
- symbol kind and export status
- a grounded role summary
- nearby and sibling symbols
- importer and import context
- usage summary fields that distinguish file-level proxy usage from verified symbol-level references when reference data is unavailable

This is structured symbol analysis, not full reference completeness or call-graph understanding.

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

### Retrieval And Analysis

```text
MCP client -> MCP tools -> orchestrator services
                                  |
                  +---------------+---------------+
                  |                               |
                  v                               v
             symbol / graph                  ranking / context
                  |                               |
                  +---------------+---------------+
                                  |
                                  v
                      structured agent-ready result
```

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

### In Scope Today

- code search
- symbol extraction and persisted symbol metadata
- deterministic local graph construction
- explainable ranking and context assembly
- public MCP tools for component exploration, precedent search, refactor context, and symbol analysis

### Not In Scope Today

- full semantic program analysis
- full reference completeness
- call-graph analysis
- broad speculative package or workspace inference
- incremental refresh
- `.jsx` symbol indexing
- deeper cross-repo graph inference

## Related Documents

- [README](../README.md)
- [Tools](./tools.md)
- [Operations](./operations.md)
- [Testing](./testing.md)
