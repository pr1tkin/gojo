# Architecture

## Overview

RepoRadar is a local code-intelligence stack for coding agents and developers.

It combines:

- Zoekt for repository-scale search
- Tree-sitter for TypeScript and TSX symbol extraction
- generation-based persisted MCP artifacts with stable `fileId` and `symbolId`
- deterministic file-level import and re-export graph construction
- additive UI structure and prop-surface signals
- conservative analysis for impact, ownership, and change planning
- internal pattern intelligence for similarity, clustering, and precedent discovery
- MCP tools exposed over stdio for agent-facing workflows

RepoRadar does not attempt full semantic program understanding. It provides
practical, graph-aware retrieval and conservative planning support for real
repository work.

## Runtime Services

RepoRadar runs as three services plus a shared repository mount:

- `zoekt`
  - serves indexed full-text search over HTTP on port `6070`
  - reads index shards from `/data/index`
- `zoekt-indexer`
  - scans `/repos`
  - builds and refreshes Zoekt shards in `/data/index`
  - writes search freshness snapshots to `/data/coordination/zoekt-refresh-state.json`
  - runs either continuously with `INDEX_INTERVAL_SECONDS` or once with `INDEX_ONCE=true`
- `mcp-server`
  - runs over stdio
  - reads repositories from `/repos`
  - publishes generation-scoped artifacts under `/app/.data`
  - writes search refresh requests to `/app/.data/coordination/search-refresh-request.json`
  - serves MCP tools backed by the published generation

## Compose Persistence Model

The current `docker-compose.yml` uses Docker named volumes for runtime state:

- `mcp-server-data:/app/.data`
- `refresh-coordination:/app/.data/coordination`
- `zoekt-index:/data/index`

Those mounts have different jobs:

- `mcp-server-data`
  - current generation pointer
  - generation directories and artifacts
  - health snapshots
  - refresh failure history and maintenance state
- `refresh-coordination`
  - MCP search refresh requests
  - Zoekt refresh snapshots
- `zoekt-index`
  - Zoekt shard storage

A bind mount such as `/absolute/path:/app/.data` is not the same runtime mode.
Use it only when you explicitly want a debug or inspection-oriented setup.
The normal Compose runtime should use the named volumes above.

## Layered Architecture

```text
Agent / MCP Client
        |
        v
    MCP Tools
        |
        v
  Orchestrator Layer
        |
        +-------------------+-------------------+-------------------+
        |                   |                   |                   |
        v                   v                   v                   v
   Search Layer       Structure Layer       Graph Layer       Analysis Layer
        |                   |                   |                   |
        v                   v                   v                   v
      Zoekt        Tree-sitter + Symbol   Import / Export    Impact / Ownership /
                    Index + UI Signals    Relationships      Change Planning

                 Internal Pattern Intelligence
      extraction -> fingerprints -> similarity -> clustering -> precedents
```

RepoRadar is easiest to think about as a progressive stack:

`Search -> Structure -> Graph -> Impact -> Ownership -> Planning`

UI structure and pattern intelligence are additive capabilities built on the
same published generation.

## Layer Responsibilities

### Search Layer

The search layer is Zoekt-backed full-text retrieval.

It is used for:

- fast repository-wide search
- candidate discovery when exact file or symbol context is not yet known
- low-level search-oriented MCP tools

Zoekt does not own symbol, graph, or planning state. Its freshness relative to
the current MCP generation is tracked explicitly through coordination markers.

### Structure Layer

The structure layer is built from Tree-sitter parsing plus persisted file
metadata.

Current structured data includes:

- stable `fileId`
- stable `symbolId`
- generation-scoped file manifests and refresh state
- symbol names, kinds, and export markers
- file-level import and export metadata
- JSX and TSX composition signals
- JSX and TSX prop-surface signals
- symbol frequency statistics
- deterministic pattern candidates

Published artifacts live under:

- `/app/.data/current-generation.json`
- `/app/.data/current-health.json`
- `/app/.data/generations/<generationId>/index-generation.json`
- `/app/.data/generations/<generationId>/symbol-index.json`
- `/app/.data/generations/<generationId>/ui-composition.json`
- `/app/.data/generations/<generationId>/ui-props.json`
- `/app/.data/generations/<generationId>/ui-semantics.json`
- `/app/.data/generations/<generationId>/pattern-candidates.json`
- `/app/.data/generations/<generationId>/change-summary.json`
- `/app/.data/generations/<generationId>/consistency-report.json` when generated

### Graph Layer

The graph layer builds deterministic file-level relationships from indexed
import and export metadata.

Current graph capabilities:

- local import edges
- re-export edges
- relative import resolution
- `tsconfig` and `jsconfig` alias resolution
- repo-root `baseUrl` local import resolution

Edge creation stays conservative:

- create an edge only when exactly one indexed local target resolves
- prefer missing edges over incorrect guesses

The persisted graph snapshot lives at:

- `/app/.data/generations/<generationId>/code-graph.json`

### Analysis Layer

The analysis layer derives higher-level change understanding from the published
structure and graph.

It currently provides:

- impact analysis
- ownership and API-boundary approximation
- change planning and refactor safety estimation

This layer remains heuristic and conservative. It is designed to improve agent
workflows, not to provide semantic guarantees.

### Health, Consistency, And Trust

Phase 6 hardening added explicit health and trust tracking around the published
generation.

Key concepts:

- health
  - the current published generation has a machine-readable summary at
    `/app/.data/current-health.json`
  - it reflects refresh state, search freshness, recent activity, consistency,
    and trust status
- consistency
  - post-publish maintenance can validate the current generation and optionally
    repair conservative state degradations
  - reports are written per generation as `consistency-report.json`
- trust
  - RepoRadar distinguishes between healthy, degraded, inconsistent, and
    unknown states instead of silently assuming artifacts are reliable
  - malformed or missing coordination markers, suspicious artifact regressions,
    and refresh failures degrade trust rather than being hidden

This does not make the system transactional. It makes the current state honest
about what is and is not trustworthy.

### Pattern Intelligence

RepoRadar also includes an internal pattern-intelligence capability that builds
on the published structure artifacts.

It currently provides:

- deterministic pattern extraction for TypeScript and TSX files
- normalized pattern fingerprints
- same-kind similarity scoring
- same-kind clustering
- repository-local precedent discovery

Pattern intelligence remains internal. It does not currently expose a separate
public precedent tool. For the detailed design, see
[Pattern Intelligence](./architecture/pattern-intelligence.md).

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

The higher-level tools compose the published structure, graph, search, and
analysis layers instead of reimplementing them.

## Generation Lifecycle

A refresh is generation-based rather than in-place.

Lifecycle:

1. scan repositories under `/repos` and build a file manifest
2. compare the manifest with the current published generation
3. if nothing changed, keep the current generation and recompute search freshness and health
4. if files changed, stage a new generation directory under `/app/.data/generations/<generationId>/`
5. rebuild symbols and pattern candidates for changed content
6. rebuild graph and UI artifacts conservatively from the updated structure state
7. write generation artifacts and `index-generation.json`
8. write a search refresh request into `/app/.data/coordination/`
9. publish the new current-generation pointer
10. run consistency maintenance when configured or when the change set is high risk
11. recompute current health

If a refresh fails before publish, the prior published generation remains the
active one. Failure history is recorded under `/app/.data/maintenance/`.

## Coordination With Zoekt

The MCP generation and Zoekt search shards are coordinated through shared
fingerprints, not a shared commit.

Flow:

```text
/repos -> mcp-server refresh -> published generation + search refresh request
/repos -> zoekt-indexer -> Zoekt shards + search refresh snapshot
mcp-server health/search freshness -> compare request and snapshot fingerprints
```

Practical meaning:

- MCP can publish a new generation before Zoekt finishes reindexing
- search freshness can therefore be `pending`, `ready`, `stale`, `failed`, or `unknown`
- MCP tools that depend on the structured generation remain usable even when
  search is catching up
- search-oriented answers should be interpreted using the reported freshness,
  not assumed to match the latest generation automatically

The fingerprint contract is deterministic and content-based. It is designed to
avoid drift caused by timestamps or filesystem iteration order.

## Operational Flow

```text
repos/ -> zoekt-indexer -> zoekt-index:/data/index -> zoekt
repos/ -> mcp-server refresh -> /app/.data/generations/<generationId>/
                              -> current-generation.json
                              -> coordination/search-refresh-request.json
zoekt-indexer -> coordination/zoekt-refresh-state.json
mcp-server -> current-health.json + trust/consistency interpretation
```

The normal runtime model is:

- Compose mounts the repositories read-only into all relevant services
- MCP state survives restarts through `mcp-server-data`
- Zoekt shards survive restarts through `zoekt-index`
- coordination markers survive restarts through `refresh-coordination`

## Boundaries

### In Scope Today

- code search
- symbol extraction and persisted symbol metadata
- deterministic local graph construction
- explainable ranking and context assembly
- UI hierarchy and prop-surface exploration signals
- impact analysis and blast-radius estimation
- ownership and API-boundary approximation
- ordered change planning for safer refactor workflows
- internal pattern extraction, similarity, clustering, and precedent discovery
- public MCP tools for exploration, refactor context, symbol analysis, and planning

### Not In Scope Today

- full semantic program analysis
- compiler-complete rename or refactor support
- runtime UI behavior modeling
- automatic code generation from precedents
- public precedent-discovery tooling
- deeper cross-repo semantic inference beyond the mounted repositories

## Related Documents

- [README](../README.md)
- [Operations](./operations.md)
- [Testing](./testing.md)
- [Tools](./tools.md)
- [Pattern Intelligence](./architecture/pattern-intelligence.md)
