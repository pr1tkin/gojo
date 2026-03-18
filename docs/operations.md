# Operations

## Purpose

This document explains how to run, inspect, and recover the current gojo
stack.

It focuses on:

- the real Docker Compose runtime
- one-shot versus polling indexing
- persistence and coordination state
- practical health and freshness checks
- common operational gotchas

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

Compose-managed persistence uses named volumes:

- `mcp-server-data:/app/.data`
- `refresh-coordination:/app/.data/coordination`
- `zoekt-index:/data/index`

Useful checks:

```powershell
docker compose config
docker compose logs zoekt
docker compose logs zoekt-indexer
docker compose logs mcp-server
```

## Indexing Modes

gojo has two indexing systems that move at different speeds:

- `mcp-server` publishes generation-scoped structure, graph, UI, pattern, and health state
- `zoekt-indexer` builds and refreshes Zoekt search shards

### Zoekt Polling Mode

In the normal Compose runtime, `zoekt-indexer` loops forever.

Behavior:

- performs an indexing pass on startup
- sleeps for `INDEX_INTERVAL_SECONDS` between passes
- default interval is `300`
- writes the latest snapshot to `/data/coordination/zoekt-refresh-state.json`

### Zoekt One-Shot Mode

For explicit evaluation or recovery runs, use one-shot mode.

One-shot runs must set:

- `INDEX_ONCE=true`

Example:

```powershell
docker compose run --rm --no-deps -e INDEX_ONCE=true zoekt-indexer
```

The helper script does this for you:

```bash
./scripts/index-repos.sh
```

If you change `zoekt/index-repos.sh` or the Zoekt image contents, rebuild the
image before expecting new behavior:

```powershell
docker compose build zoekt-indexer
docker compose run --rm --no-deps -e INDEX_ONCE=true zoekt-indexer
```

### MCP Refresh Behavior

The MCP server publishes a new generation under `/app/.data/generations/`.
It does not update artifacts in place.

Practical flow:

1. scan repositories and compute the manifest delta
2. if nothing changed, keep the current generation and recompute freshness and health
3. if files changed, stage a new generation directory
4. persist artifacts and `index-generation.json`
5. publish `current-generation.json`
6. write or update coordination markers for Zoekt freshness
7. recompute health and optionally run consistency maintenance

A failed refresh does not replace the current published generation.

## Persistence And Coordination State

### MCP State

Compose stores MCP state in `mcp-server-data:/app/.data`.

Key files and directories:

- `/app/.data/current-generation.json`
- `/app/.data/current-health.json`
- `/app/.data/generations/<generationId>/index-generation.json`
- `/app/.data/generations/<generationId>/symbol-index.json`
- `/app/.data/generations/<generationId>/code-graph.json`
- `/app/.data/generations/<generationId>/ui-composition.json`
- `/app/.data/generations/<generationId>/ui-props.json`
- `/app/.data/generations/<generationId>/ui-semantics.json`
- `/app/.data/generations/<generationId>/pattern-candidates.json`
- `/app/.data/generations/<generationId>/change-summary.json`
- `/app/.data/generations/<generationId>/consistency-report.json` when generated
- `/app/.data/maintenance/refresh-failures/`

### Coordination State

Compose stores shared search coordination in `refresh-coordination` mounted at:

- `/app/.data/coordination` in `mcp-server`
- `/data/coordination` in `zoekt-indexer`

Key files:

- `search-refresh-request.json`
- `zoekt-refresh-state.json`

These markers coordinate MCP generations with Zoekt snapshots. They do not make
the system transactional; they make freshness and trust explicit.

## Health, Consistency, And Recovery

### How To Read Health

`/app/.data/current-health.json` is the current summary of whether the published
generation should be trusted.

Use it to interpret:

- whether a generation is healthy, degraded, inconsistent, or unknown
- whether search is ready or still catching up
- whether a refresh failed recently
- whether consistency maintenance repaired or still recommends fixes

### How To Read Search Freshness

Search freshness is derived from the MCP refresh request and the latest Zoekt
snapshot.

Interpretation:

- `ready`
  - Zoekt matches the published generation fingerprint
- `pending`
  - MCP has requested a refresh and Zoekt has not caught up yet
- `stale`
  - Zoekt is serving an older snapshot than the published generation
- `failed`
  - the latest Zoekt indexing pass failed
- `unknown`
  - coordination state is missing, unreadable, malformed, or otherwise not trustworthy

### Recovery Expectations

Practical guidance:

- if MCP is healthy but search is `pending` or `stale`, wait for or trigger a Zoekt reindex
- if coordination markers are malformed or missing, rerun a fresh indexing cycle rather than hand-editing files
- if a refresh failed before publish, the previous generation remains active
- if health reports inconsistency, treat pattern/search/planning outputs conservatively until a clean refresh succeeds

## Real Runtime Examples

### Compose Runtime

Normal runtime:

```powershell
docker compose up -d --build
```

### `docker run` Using The Real Named Volumes

If you run `mcp-server` outside Compose but want it to use the same persisted
runtime state, mount the Docker named volumes created by Compose, not an
unrelated host path.

With the default Compose project name, those usually look like:

- `gojo_mcp-server-data`
- `gojo_refresh-coordination`

Example:

```bash
docker run --rm -i \
  --network gojo_default \
  -v /absolute/path/to/repos:/repos:ro \
  -v gojo_mcp-server-data:/app/.data \
  -v gojo_refresh-coordination:/app/.data/coordination \
  gojo-mcp-server
```

Use `docker volume ls` if your Compose project name differs.

### Debug-Oriented Bind Mount Alternative

A bind mount can be useful when you explicitly want to inspect or diff MCP
state on the host.

Example debug-only workflow:

```bash
docker run --rm -i \
  -v /absolute/path/to/repos:/repos:ro \
  -v /absolute/path/to/debug-mcp-data:/app/.data \
  gojo-mcp-server
```

This is a different mode from the Compose runtime. Do not casually mix it with
the named-volume setup if you want comparable persistence and coordination
behavior.

## Basic Validation Checklist

1. Open `http://localhost:6070` and confirm Zoekt responds.
2. Check `docker compose logs zoekt-indexer` for a completed indexing pass.
3. Confirm a published generation exists under `/app/.data/generations/`.
4. Confirm `/app/.data/current-generation.json` and `/app/.data/current-health.json` exist.
5. Confirm coordination markers exist in the shared coordination volume.
6. Verify `search_code` returns results from an indexed repository.
7. Verify `explore_component` and `analyze_symbol` return structured results for a known symbol.
8. Verify `plan_change` returns scope, risk, and ordered edit/review steps.
9. Interpret search answers using freshness state instead of assuming immediate Zoekt parity.

## Troubleshooting

### No Search Results

- confirm the repository is a Git repository directly under `repos/`
- confirm Zoekt indexing completed
- confirm Zoekt is reachable at `http://localhost:6070`
- if you changed Zoekt shell scripts, rebuild the image before retrying

### MCP Tools See Old Or Missing State

- confirm the runtime has access to `/repos`
- confirm the MCP container is using the intended `/app/.data` mount
- confirm you are not accidentally comparing a bind-mounted debug run with the Compose named volume

### Search Freshness Stays `pending` Or `unknown`

- inspect the coordination markers in the shared volume
- rerun a one-shot Zoekt indexing pass with `INDEX_ONCE=true`
- if markers are malformed or missing, prefer a clean reindex over manual edits

### Planning Or Analysis Looks Thin

- confirm the current generation contains `symbol-index.json`, `code-graph.json`, and related artifacts
- rerun the MCP refresh path in the same runtime environment
- remember that impact, ownership, and planning are intentionally conservative

### Windows Note

`scripts/index-repos.sh` is Bash-only. On Windows, run it through Git Bash, WSL,
or another Bash-compatible shell.
