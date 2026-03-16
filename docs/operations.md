# Operations

## Purpose

This document explains how to run RepoRadar locally.

It focuses on:

- environment requirements
- repository indexing
- MCP server startup
- basic operational checks
- troubleshooting

For system design, see [Architecture](./architecture.md). For tool behavior, see [Tools](./tools.md).

## Environment Requirements

Required:

- Docker with Compose support
- one or more local Git repositories under `repos/`

Optional:

- Node.js and npm for local `mcp-server` development
- a browser for the Zoekt UI at `http://localhost:6070`
- an MCP-capable client for stdio integration
- a Bash-compatible shell for `scripts/index-repos.sh`

## Repository Layout

Place repositories directly under `repos/`.

Rules:

- only first-level entries are indexed
- first-level symlinks are supported if they resolve correctly
- non-Git directories and broken symlinks are skipped

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

- `zoekt`
- `zoekt-indexer`
- `mcp-server`

Useful checks:

```powershell
docker compose config
docker compose logs zoekt
docker compose logs zoekt-indexer
docker compose logs mcp-server
```

## Indexing Repositories

RepoRadar uses two kinds of indexing:

- Zoekt indexing for search
- MCP-side indexing for structure and graph analysis

### Zoekt Indexing

Zoekt indexing is handled by `zoekt-indexer`.

Behavior:

- runs automatically on startup
- refreshes periodically
- uses `INDEX_INTERVAL_SECONDS`
- default interval is `300`

Run a one-shot reindex:

```bash
./scripts/index-repos.sh
```

### MCP-Side Symbol Index And Graph

The MCP server persists code-intelligence artifacts under `mcp-server/.data/`.

Key files:

- `mcp-server/.data/symbol-index.json`
- `mcp-server/.data/code-graph.json`

Manual build sequence:

```powershell
cd mcp-server
npx tsx src/symbol-index/indexer.ts
npm run build
node --input-type=module -e "import { buildCodeGraph } from './dist/graph/build-graph.js'; import { saveCodeGraph } from './dist/graph/store.js'; const graph = await buildCodeGraph(); await saveCodeGraph(graph);"
```

Use the same environment for repository access and persistence. In practice that means the same `repos/` mount and the same `mcp-server/.data/` directory.

## Run The MCP Server Locally

From `mcp-server/`:

```powershell
npm install
npm run build
npm run test
npm run start
```

For local TypeScript development:

```powershell
npm run dev
```

## Public MCP Workflows

Current high-level workflows:

- `explore_component`
- `search_patterns`
- `analyze_symbol`
- `collect_refactor_context`
- `plan_change`

Typical sequence:

1. explore a target
2. inspect symbol role
3. collect local dependency context
4. request a safe change plan

## Basic Validation Checklist

1. Open `http://localhost:6070` and confirm Zoekt responds.
2. Check `docker compose logs zoekt-indexer` for an indexing pass.
3. Verify the MCP-side index exists:
   - `mcp-server/.data/symbol-index.json`
   - `mcp-server/.data/code-graph.json`
4. Verify `search_code` returns results from an indexed repository.
5. Verify `explore_component` returns a structured result for a known symbol.
6. Verify `analyze_symbol` returns a symbol role summary.
7. Verify `collect_refactor_context` returns importer/imported file context.
8. Verify `plan_change` returns scope, risk, and ordered edit/review steps.

## MCP Runtime Notes

### Compose-Managed MCP Server

The Compose file includes an `mcp-server` service that mounts `./repos` and depends on `zoekt`.

### IDE-Started MCP Container

If an IDE starts the MCP server separately with `docker run`, that container does not inherit Compose mounts automatically.

It must be given:

- a `/repos` mount
- access to the Compose network if it should reach Zoekt
- an optional `/app/.data` mount if you want symbol-index and graph persistence

Example:

```bash
docker run --rm -i \
  --network mcp-code-search_default \
  -v /absolute/path/to/repos:/repos:ro \
  -v /absolute/path/to/mcp-server/.data:/app/.data \
  mcp-code-search-mcp-server
```

## Troubleshooting

### No Search Results

- confirm the repository is a Git repository directly under `repos/`
- confirm Zoekt indexing completed
- confirm Zoekt is reachable at `http://localhost:6070`

### File Or Symbol Tools Fail

- confirm the MCP runtime has access to `repos/`
- confirm the symbol index and graph were built in the same environment

### Planning Or Context Tools Return Thin Results

- confirm both MCP-side artifacts exist:
  - `mcp-server/.data/symbol-index.json`
  - `mcp-server/.data/code-graph.json`
- rebuild them after repository changes
- remember that planning and ownership remain conservative and heuristic

### `plan_change` Seems Conservative

- that is expected for ambiguous or surface-sensitive cases
- planning is intended to estimate safe scope, not guarantee refactor correctness

### Windows Note

`scripts/index-repos.sh` is Bash-only. On Windows, run it through Git Bash, WSL, or another Bash-compatible shell.
