# Operations

## Purpose

This document explains how to run RepoRadar locally.

It focuses on:

- environment requirements
- repository indexing
- MCP server startup
- basic operational checks
- troubleshooting

For system design, see [Architecture](./architecture.md). For tool behavior,
see [Tools](./tools.md).

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
ln -s /path/to/repo-alpha repos/repo-alpha
ln -s /path/to/repo-beta repos/repo-beta
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

RepoRadar uses two indexing paths:

- Zoekt indexing for search
- MCP-side indexing for structure, graph, UI, and pattern artifacts

### Zoekt Indexing

Zoekt indexing is handled by `zoekt-indexer`.

Behavior:

- runs automatically on startup
- refreshes periodically
- uses `INDEX_INTERVAL_SECONDS`
- default interval is `300`
- writes the latest Zoekt freshness marker into the shared coordination volume

Run a one-shot reindex:

```bash
./scripts/index-repos.sh
```

### MCP-Side Indexing

The MCP server persists analysis artifacts under `mcp-server/.data/`.

Key files:

- `mcp-server/.data/current-generation.json`
- `mcp-server/.data/generations/<generationId>/index-generation.json`
- `mcp-server/.data/generations/<generationId>/symbol-index.json`
- `mcp-server/.data/generations/<generationId>/code-graph.json`
- `mcp-server/.data/generations/<generationId>/ui-composition.json`
- `mcp-server/.data/generations/<generationId>/ui-props.json`
- `mcp-server/.data/generations/<generationId>/pattern-candidates.json`
- `mcp-server/.data/coordination/search-refresh-request.json`
- `mcp-server/.data/coordination/zoekt-refresh-state.json`

Cross-index freshness note:

- MCP artifact publication and Zoekt indexing are coordinated, not atomically
  transacted
- a newly published MCP generation can report Zoekt as `pending`, `stale`,
  `failed`, or `unknown`
- do not assume `search_code` reflects the same repository state as MCP-side
  graph or symbol data unless search freshness is reported as ready

Manual build sequence:

```powershell
cd mcp-server
npx tsx src/symbol-index/indexer.ts
npm run build
node --input-type=module -e "import { buildCodeGraph } from './dist/graph/build-graph.js'; import { saveCodeGraph } from './dist/graph/store.js'; const graph = await buildCodeGraph(); await saveCodeGraph(graph);"
```

Use the same environment for repository access and persistence. In practice that
means the same `repos/` mount and the same `mcp-server/.data/` directory.

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
4. request a conservative change plan

## Basic Validation Checklist

1. Open `http://localhost:6070` and confirm Zoekt responds.
2. Check `docker compose logs zoekt-indexer` for an indexing pass.
3. Verify the MCP-side artifacts exist:
   - `mcp-server/.data/current-generation.json`
   - `mcp-server/.data/generations/<generationId>/index-generation.json`
   - `mcp-server/.data/coordination/zoekt-refresh-state.json`
4. Verify `search_code` returns results from an indexed repository.
5. Verify search freshness is reported honestly when Zoekt is still catching up.
6. Verify `explore_component` returns a structured result for a known symbol.
7. Verify `analyze_symbol` returns a symbol role summary.
8. Verify `collect_refactor_context` returns importer and imported-file context.
9. Verify `plan_change` returns scope, risk, and ordered edit/review steps.

## MCP Runtime Notes

### Compose-Managed MCP Server

The Compose file includes an `mcp-server` service that mounts `./repos` and
depends on `zoekt`.

### IDE-Started MCP Container

If an IDE starts the MCP server separately with `docker run`, that container
does not inherit Compose mounts automatically.

It must be given:

- a `/repos` mount
- access to the Compose network if it should reach Zoekt
- an optional `/app/.data` mount if you want persisted MCP-side artifacts

Example:

```bash
docker run --rm -i \
  --network repo-radar_default \
  -v /absolute/path/to/repos:/repos:ro \
  -v /absolute/path/to/mcp-server/.data:/app/.data \
  repo-radar-mcp-server
```

## Troubleshooting

### No Search Results

- confirm the repository is a Git repository directly under `repos/`
- confirm Zoekt indexing completed
- confirm Zoekt is reachable at `http://localhost:6070`

### File Or Symbol Tools Fail

- confirm the MCP runtime has access to `repos/`
- confirm the symbol index and graph were built in the same environment

### Context Or Planning Tools Return Thin Results

- confirm the MCP-side artifacts exist:
  - `mcp-server/.data/symbol-index.json`
  - `mcp-server/.data/code-graph.json`
- rebuild them after repository changes
- remember that impact, ownership, and planning remain conservative and
  heuristic

### `plan_change` Seems Conservative

- that is expected for ambiguous or surface-sensitive cases
- planning is intended to estimate safe scope, not guarantee refactor
  correctness

### Windows Note

`scripts/index-repos.sh` is Bash-only. On Windows, run it through Git Bash, WSL,
or another Bash-compatible shell.
