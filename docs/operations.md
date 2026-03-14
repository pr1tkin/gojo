# Operations Guide

## Prerequisites

- Docker with Compose support
- one or more local Git repositories under [`repos/`](../repos)
- Node.js and npm if you want to build or run the MCP server outside Docker

Optional:

- a browser for the Zoekt UI at `http://localhost:6070`
- an MCP-capable client for stdio integration
- a Bash-compatible shell for [`scripts/index-repos.sh`](../scripts/index-repos.sh)

## Start The Stack

Start everything:

```powershell
docker compose up -d --build
```

Validate the Compose configuration:

```powershell
docker compose config
```

View service logs:

```powershell
docker compose logs zoekt
docker compose logs zoekt-indexer
docker compose logs mcp-server
```

## Repository Layout

- Place repositories directly under `repos/`.
- First-level symlinks are supported if they resolve correctly in your host and Docker runtime.
- Only first-level entries are indexed.

Example:

```bash
mkdir -p repos
ln -s /path/to/my-project repos/my-project
```

## Indexing

Indexing is handled by `zoekt-indexer`.

- it runs automatically on startup
- it repeats every `INDEX_INTERVAL_SECONDS`
- the default interval is `300`
- it skips broken symlinks, non-directories, and non-Git entries

Run a one-shot reindex:

```bash
./scripts/index-repos.sh
```

The helper script builds `zoekt-indexer` and runs it once with `INDEX_ONCE=true`.

## MCP Runtime Options

### Compose-managed MCP server

The Compose file includes an `mcp-server` service that mounts `./repos` and depends on `zoekt`.

### IDE-started MCP container

If your IDE starts the MCP server with `docker run`, that container does not inherit Compose mounts automatically. It must be given:

- a `/repos` mount
- access to the Compose network if it should reach `http://zoekt:6070`
- an optional `/app/.data` mount if you want symbol-index persistence

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
- `find_symbol`, `find_references`, and `find_related_files` work best when `/repos` and the symbol index are both available

## Build And Test

From `mcp-server/`:

```powershell
npm install
npm run build
npm run test
npm run test:coverage
```

Run the MCP server locally over stdio:

```powershell
cd mcp-server
npm run start
```

The MCP server does not expose an HTTP API.

## Manual Symbol Index Build

If you do not start the MCP server with `BUILD_SYMBOL_INDEX_ON_STARTUP=true`, build the symbol index manually:

```powershell
cd mcp-server
npx tsx src/symbol-index/indexer.ts
```

In container-based setups, make sure the symbol index is built in the same environment that provides `/repos` and `/app/.data`.

## Validation Checklist

1. Open `http://localhost:6070` and confirm Zoekt responds.
2. Check `docker compose logs zoekt-indexer` for an indexing pass.
3. Verify `search_code` returns results from an indexed repository.
4. Verify `open_file` can read a known file under `/repos/<repo-name>`.
5. Verify `list_symbols` works on a known `.ts` or `.tsx` file.
6. Verify `find_symbol`, `find_references`, and `find_related_files` after the symbol index exists.

## Troubleshooting

### No search results

- confirm the repository is a Git repository directly under `repos/`
- confirm indexing has completed in `docker compose logs zoekt-indexer`
- confirm Zoekt is reachable at `http://localhost:6070`

### File tools fail but search works

- confirm the MCP runtime has `/repos` mounted
- this is common when an IDE starts a separate `docker run` container

### Symbol tools fail

- confirm the MCP runtime can read `/repos`
- confirm the symbol index exists at `/app/.data/symbol-index.json` in container workflows
- rebuild the symbol index if needed

### Reindex after repository changes

- wait for the next polling interval
- or run:

```bash
./scripts/index-repos.sh
```

### Windows note

`scripts/index-repos.sh` is Bash-only. On Windows, run it through Git Bash, WSL, or another Bash-compatible shell.

For runtime details, see [`architecture.md`](./architecture.md). For test scope, see [`testing.md`](./testing.md).
