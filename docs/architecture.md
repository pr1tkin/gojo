# Architecture

RepoRadar is a local search stack built from three runtime services and one shared repository mount.

## Runtime Services

- `zoekt`
  - serves indexed full-text search over HTTP on port `6070`
  - reads index data from `/data/index`
- `zoekt-indexer`
  - scans `/repos`
  - builds and refreshes Zoekt indexes in `/data/index`
  - uses `INDEX_INTERVAL_SECONDS`, default `300`
- `mcp-server`
  - runs over stdio
  - exposes MCP tools for search, file access, and symbol navigation
  - reads repositories from `/repos`

## Repository And Index Storage

- `./repos`
  - host directory for local Git repositories
  - first-level symlinks are supported if they resolve correctly in the runtime
- `zoekt-index`
  - Docker named volume shared by `zoekt` and `zoekt-indexer`
- `mcp-server/.data/symbol-index.json`
  - persisted MCP-side symbol index used by symbol and related-file tooling

## Compose Layout

The current `docker-compose.yml` defines:

- `zoekt`
  - build context `./zoekt`
  - command `zoekt-webserver -listen :6070 -index /data/index`
  - mounts `./repos:/repos:ro`
  - mounts `zoekt-index:/data/index`
  - publishes `6070:6070`
- `zoekt-indexer`
  - build context `./zoekt`
  - command `/usr/local/bin/index-repos.sh`
  - mounts `./repos:/repos:ro`
  - mounts `zoekt-index:/data/index`
- `mcp-server`
  - build context `./mcp-server`
  - mounts `./repos:/repos:ro`
  - depends on `zoekt`

## Tool Surface

`mcp-server/src/server.ts` currently registers:

- `search_code`
- `open_file`
- `list_symbols`
- `find_symbol`
- `find_references`
- `find_related_files`

## Data Flow

### Indexing

```text
repos/ -> zoekt-indexer -> zoekt-index volume -> zoekt
```

1. Repositories are placed under `./repos`.
2. `zoekt-indexer` scans the first-level entries under `/repos`.
3. Valid Git repositories are indexed into `/data/index`.
4. Zoekt serves those indexes over HTTP.

Indexing is automatic on startup and repeats on a polling interval. It is not watcher-based.

### Search And Navigation

```text
MCP client -> mcp-server -> zoekt
                    |
                    +-> /repos
                    +-> symbol-index.json
```

- `search_code` queries Zoekt over HTTP.
- `open_file` resolves repository-scoped paths safely under `/repos`.
- `list_symbols` parses `.ts` and `.tsx` files with Tree-sitter.
- `find_symbol`, `find_references`, and `find_related_files` use the persisted symbol index and may use TypeScript project context when available.

## Service Boundaries

### Zoekt

- Handles indexed full-text search only
- Does not parse syntax trees
- Does not manage repository discovery for MCP tools

### Zoekt Indexer

- Handles repository scanning and periodic indexing
- Skips broken symlinks, non-directories, and non-Git entries
- Does not expose a public network service

### MCP Server

- Handles stdio MCP requests
- Reads files and symbols from `/repos`
- Calls Zoekt for full-text search
- Does not expose an HTTP API in the current implementation
- Does not maintain its own full-text search engine

## Runtime Notes

- The main deployment model is Docker Compose.
- An IDE can also start the MCP server separately with `docker run`, but that container must explicitly mount `/repos` and any desired `/app/.data` persistence.
- End-to-end runtime validation is still mostly manual; unit coverage lives in the `mcp-server` test suite.

For setup and troubleshooting, see [`operations.md`](./operations.md). For test scope, see [`testing.md`](./testing.md).
