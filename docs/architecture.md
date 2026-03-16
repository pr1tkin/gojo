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
        +-------------------+-------------------+-------------------+-------------------+
        |                   |                   |                   |                   |
        v                   v                   v                   v                   v
   Search Layer        Symbol Layer        Graph Layer        Analysis Layer     Ranking + Context
        |                   |                   |                   |                   |
        v                   v                   v                   v                   v
      Zoekt         Tree-sitter +        Import / Export    Impact / Ownership   Candidate ordering,
                    Symbol Index         Relationships      / Change Planning     related files, summaries
```

RepoRadar is easiest to think about as a progressive stack:

`Search -> Structure -> Graph -> Impact -> Ownership -> Planning`

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
- additive JSX / TSX UI composition signals
- additive JSX / TSX prop surface signals
- aggregate symbol frequency statistics

Persisted files:

- `mcp-server/.data/symbol-index.json`
- `mcp-server/.data/code-graph.json`
- `mcp-server/.data/ui-composition.json`
- `mcp-server/.data/ui-props.json`

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

### Analysis Layer

The analysis layer derives higher-level change understanding from the indexed graph.

It currently provides:

- impact analysis
- ownership and API-boundary approximation
- change planning and refactor safety estimation

This layer remains heuristic and conservative. It is designed to improve practical agent workflows, not to provide full semantic guarantees.

RepoRadar also persists additive UI-structure signals from JSX and TSX component composition and prop usage. These signals capture parent-child rendering relationships plus coarse prop-surface data such as which prop names are passed at usage sites and what broad value kinds they use. They are stored separately and are not yet used to change impact-analysis, ownership-analysis, refactor-context, or change-planning behavior.

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
- `planSymbolChange(...)`

These services compose the underlying layers rather than reimplementing them.

The internal impact-analysis service now also adds result summarization for large blast-radius cases. This summary is derived from the existing direct and transitive impact sets and does not change impact detection or traversal depth.

Impact analysis is used to answer:

- which files or symbols are directly connected to a change
- whether the blast radius stays local or expands across features
- which entry surfaces or feature clusters appear in the downstream path

The internal ownership-analysis service adds heuristic symbol ownership and API-boundary approximation. It reuses the existing symbol index, import/export metadata, and graph relationships, and returns conservative classifications backed by explicit export-surface, path-boundary, usage-fanout, and barrel-entry signals.

Ownership analysis is used to answer:

- whether a symbol looks internal, feature-bounded, shared, or surface-like
- whether a file acts like an API or framework entry boundary
- whether a change likely touches implementation details or shared surfaces

Recent refinement work improved ownership classification calibration for local helpers, feature-local exports, and framework entry surfaces while keeping the same explainable heuristic signal model.

The latest refinement improves ownership conflict resolution for barrel-exported shared surfaces so reusable symbols exposed through index-style entry files are less likely to collapse to unknown while local helper protection stays intact.

The internal change-planning service adds ownership-aware refactor safety estimation. It combines existing impact analysis and ownership analysis to produce conservative scope and risk classification plus an ordered edit/review plan for agent workflows. It does not generate patches or claim semantic refactor completeness.

Change planning is used to answer:

- what is the safest expected scope of a change
- which files should be edited first
- which files are likely review-only
- whether a change should be treated as local, feature-bounded, shared-surface, or broad-shared

Recent refinement work improved edit vs review separation and plan precision for local helpers and framework entry surfaces while keeping the same ownership-aware planning architecture.

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
- `plan_change`

The higher-level tools are built on top of the orchestrator layer and return structured results rather than raw primitives.

RepoRadar now also supports agent-facing change planning workflows that estimate safe refactor scope and ordered edit/review plans based on impact analysis and API-boundary detection. These plans remain conservative and explainable; they do not claim automatic safe refactors or semantic rename support.

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

### `plan_change`

Purpose:

- expose safe-change planning as an agent-facing workflow

Builds on:

- impact analysis
- ownership and API-boundary analysis
- graph-derived dependency ordering
- existing orchestrator composition

Returns:

- conservative change scope
- conservative risk level
- explicit planning signals
- primary edit files
- secondary edit files
- review files
- ordered edit/review steps

This is planning support, not automatic refactoring or patch generation.

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
                  +---------------+---------------+-------------------+
                  |                               |                   |
                  v                               v                   v
             symbol / graph                  ranking / context    analysis services
                  |                               |                   |
                  +---------------+---------------+-------------------+
                                  |
                                  v
                      structured agent-ready result
```

For planning-oriented workflows, the internal flow is:

```text
target resolution
  -> impact analysis
  -> ownership analysis
  -> change planning
  -> MCP result
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
- impact analysis and blast-radius estimation
- ownership and API-boundary approximation
- ordered change planning for safer refactor workflows
- public MCP tools for component exploration, precedent search, refactor context, symbol analysis, and change planning

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
