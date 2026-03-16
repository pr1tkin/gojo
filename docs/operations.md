# Operations

## Purpose

This document covers the practical runtime workflow for RepoRadar:

- how to place repositories under `repos/`
- how to start the stack
- how to build the MCP server
- how to refresh search and code-intelligence artifacts
- how to validate that the public MCP tools are working

## Prerequisites

- Docker with Compose support
- one or more local Git repositories under [`repos/`](../repos)
- Node.js and npm if you want to run the MCP server outside Docker

Optional:

- a browser for the Zoekt UI at `http://localhost:6070`
- an MCP-capable client for stdio integration
- a Bash-compatible shell for [`scripts/index-repos.sh`](../scripts/index-repos.sh)

## Repository Layout

Place repositories directly under `repos/`.

Rules:

- only first-level entries are indexed
- first-level symlinks are supported if they resolve correctly
- non-Git directories and broken symlinks are skipped by the indexer

Example:

```bash
mkdir -p repos
ln -s /path/to/my-project repos/my-project
```

## Start The Stack

```powershell
docker compose up -d --build
```

This starts:

- `zoekt` for search on `http://localhost:6070`
- `zoekt-indexer` for periodic indexing of `repos/`
- `mcp-server` for MCP tool execution over stdio

Useful checks:

```powershell
docker compose config
docker compose logs zoekt
docker compose logs zoekt-indexer
docker compose logs mcp-server
```

## Indexing

### Zoekt indexing

Zoekt indexing is handled by `zoekt-indexer`.

Behavior:

- runs automatically on startup
- repeats every `INDEX_INTERVAL_SECONDS`
- default interval is `300`

Run a one-shot reindex:

```bash
./scripts/index-repos.sh
```

### MCP-side symbol index and graph

The MCP server persists code-intelligence artifacts under `mcp-server/.data/`.

Key files:

- `mcp-server/.data/symbol-index.json`
- `mcp-server/.data/code-graph.json`

If you do not start the MCP server with automatic symbol-index building, build the symbol index manually:

```powershell
cd mcp-server
npx tsx src/symbol-index/indexer.ts
```

Then rebuild the code graph in the same environment:

```powershell
node --input-type=module -e "import { buildCodeGraph } from './dist/graph/build-graph.js'; import { saveCodeGraph } from './dist/graph/store.js'; const graph = await buildCodeGraph(); await saveCodeGraph(graph);"
```

Use the same environment for repository access and persistence. In practice that means the same `/repos` mount and the same `/app/.data` location.

## Run The MCP Server Locally

From `mcp-server/`:

```powershell
npm install
npm run build
npm run test
npm run start
```

Use `npm run dev` for a TypeScript development loop.

## MCP Runtime Notes

### Compose-managed MCP server

The Compose file includes an `mcp-server` service that mounts `./repos` and depends on `zoekt`.

### IDE-started MCP container

If your IDE starts the MCP server with `docker run`, that container does not inherit Compose mounts automatically. It must be given:

- a `/repos` mount
- access to the Compose network if it should reach `http://zoekt:6070`
- an optional `/app/.data` mount if you want symbol-index and graph persistence

Example:

```bash
docker run --rm -i \
  --network mcp-code-search_default \
  -v /absolute/path/to/repos:/repos:ro \
  -v /absolute/path/to/mcp-server/.data:/app/.data \
  mcp-code-search-mcp-server
```

This matters because:

- `search_code` needs Zoekt connectivity
- `open_file` and `list_symbols` need `/repos`
- higher-level tools work best when `/repos` and `/app/.data` are both available

## Public MCP Tools

Current public tools:

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

High-level workflow summary:

- `explore_component`
  - entry-point component and symbol exploration
- `search_patterns`
  - heuristic precedent discovery and similar implementation search
- `collect_refactor_context`
  - bounded refactor impact surface assembly
- `analyze_symbol`
  - structured symbol analysis with safer usage summaries

For tool details, see [Tools](./tools.md).

## Quick Validation Checklist

1. Open `http://localhost:6070` and confirm Zoekt responds.
2. Check `docker compose logs zoekt-indexer` for an indexing pass.
3. Verify `search_code` returns results from an indexed repository.
4. Verify `open_file` can read a known file under `/repos/<repo-name>`.
5. Verify `list_symbols` works on a known `.ts` or `.tsx` file.
6. Verify `find_symbol`, `find_references`, and `find_related_files` after the symbol index exists.
7. Verify `explore_component` returns a structured result for a known symbol such as `ArticleContent` or `Button`.
8. Verify `search_patterns` returns explainable heuristic matches for a known symbol such as `Button` or `Layout`.
9. Verify `collect_refactor_context` returns importing/imported files and nearby context for a known component or route file.
10. Verify `analyze_symbol` returns a role summary and usage summary for a known symbol such as `ButtonProps` or `formatDate`.

## Troubleshooting

### No search results

- confirm the repository is a Git repository directly under `repos/`
- confirm indexing completed in `docker compose logs zoekt-indexer`
- confirm Zoekt is reachable at `http://localhost:6070`

### File or symbol tools fail

- confirm the MCP runtime has `/repos` mounted
- this is common when an IDE starts a separate `docker run` container

### Context tools fail or return empty results

- confirm the symbol index exists at `/app/.data/symbol-index.json`
- confirm the graph exists at `/app/.data/code-graph.json`
- rebuild both if needed

### `explore_component` returns no result

- confirm the symbol exists in indexed `.ts` or `.tsx` files
- add a `repo` filter if the name is ambiguous
- rebuild the symbol index and graph after repository changes

### `search_patterns` returns weak or empty matches

- confirm the target file or symbol exists in indexed `.ts` or `.tsx` files
- add a `repo` filter to keep the search inside the expected repository
- remember that `search_patterns` is heuristic precedent search, not semantic similarity

### `collect_refactor_context` returns a thin result

- confirm the target file exists in the graph-backed symbol index
- rebuild the symbol index and graph after repository changes
- remember that the tool reports bounded file-level impact context, not full semantic impact analysis

### `analyze_symbol` seems conservative

- remember that usage summaries distinguish file-level proxy usage from verified symbol-level references when full symbol-reference data is unavailable
- add a `repo` filter or `file` hint when the symbol name is ambiguous

### Windows note

`scripts/index-repos.sh` is Bash-only. On Windows, run it through Git Bash, WSL, or another Bash-compatible shell.

For system structure, see [Architecture](./architecture.md). For test scope, see [Testing](./testing.md).
