# Operations

## Prerequisites

- Docker with Compose support
- one or more local Git repositories under [`repos/`](../repos)
- Node.js and npm if you want to run the MCP server outside Docker

Optional:

- a browser for the Zoekt UI at `http://localhost:6070`
- an MCP-capable client for stdio integration
- a Bash-compatible shell for [`scripts/index-repos.sh`](../scripts/index-repos.sh)

## Start The Stack

```powershell
docker compose up -d --build
```

Useful checks:

```powershell
docker compose config
docker compose logs zoekt
docker compose logs zoekt-indexer
docker compose logs mcp-server
```

## Repository Layout

- place repositories directly under `repos/`
- first-level symlinks are supported if they resolve correctly
- only first-level entries are indexed

Example:

```bash
mkdir -p repos
ln -s /path/to/my-project repos/my-project
```

## Indexing

Zoekt indexing is handled by `zoekt-indexer`.

- runs automatically on startup
- repeats every `INDEX_INTERVAL_SECONDS`
- default interval is `300`
- skips broken symlinks, non-directories, and non-Git entries

Run a one-shot reindex:

```bash
./scripts/index-repos.sh
```

The MCP-side symbol index and code graph are persisted under `mcp-server/.data/`.

## MCP Runtime

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
- `find_symbol`, `find_references`, `find_related_files`, and `explore_component` work best when `/repos` and `/app/.data` are both available

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

## Manual MCP-Side Index Build

If you do not start the MCP server with `BUILD_SYMBOL_INDEX_ON_STARTUP=true`, build the symbol index manually:

```powershell
cd mcp-server
npx tsx src/symbol-index/indexer.ts
```

Then rebuild the code graph in the same environment:

```powershell
@'
import { buildCodeGraph } from './dist/graph/build-graph.js';
import { saveCodeGraph } from './dist/graph/store.js';
const graph = await buildCodeGraph();
await saveCodeGraph(graph);
'@ | node --input-type=module -
```

In container-based setups, make sure indexing runs in the same environment that provides `/repos` and `/app/.data`.

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

`explore_component` returns a structured component or symbol context instead of a raw primitive lookup.

`search_patterns` returns heuristic precedent matches for a file, symbol, or component so agents can inspect similar implementations before generating or refactoring code.

## Validation Checklist

1. Open `http://localhost:6070` and confirm Zoekt responds.
2. Check `docker compose logs zoekt-indexer` for an indexing pass.
3. Verify `search_code` returns results from an indexed repository.
4. Verify `open_file` can read a known file under `/repos/<repo-name>`.
5. Verify `list_symbols` works on a known `.ts` or `.tsx` file.
6. Verify `find_symbol`, `find_references`, and `find_related_files` after the symbol index exists.
7. Verify `explore_component` returns a structured result for a known symbol such as `ArticleContent` or `Button`.
8. Verify `search_patterns` returns explainable heuristic matches for a known symbol such as `Button` or `Layout`.

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

### Windows note

`scripts/index-repos.sh` is Bash-only. On Windows, run it through Git Bash, WSL, or another Bash-compatible shell.

For system structure, see [Architecture](./architecture.md). For test scope, see [Testing](./testing.md).
