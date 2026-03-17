# RepoRadar

RepoRadar is a local code-intelligence stack for coding agents and developers.

It combines:

- Zoekt for repository-scale full-text search
- Tree-sitter for syntax-aware symbol extraction
- generation-based persisted MCP artifacts under `/app/.data`
- deterministic file-level graph construction from imports and exports
- conservative impact, ownership, and planning workflows
- MCP tools exposed over stdio for agent-facing repository work

RepoRadar is practical rather than compiler-complete. It aims to provide fast,
explainable repository context for real codebases without claiming semantic
refactor guarantees.

## Runtime Model

RepoRadar runs as three services against the same `repos/` mount:

- `zoekt`
  - serves indexed search over HTTP on port `6070`
  - reads Zoekt shards from `/data/index`
- `zoekt-indexer`
  - scans `/repos`
  - writes Zoekt shards to `/data/index`
  - writes search freshness snapshots to `/data/coordination/zoekt-refresh-state.json`
- `mcp-server`
  - runs over stdio
  - scans `/repos`
  - publishes generation-scoped MCP artifacts under `/app/.data/generations/<generationId>/`
  - writes search refresh requests to `/app/.data/coordination/search-refresh-request.json`

The MCP server owns the structured repository model. Zoekt owns search shards.
They are coordinated through shared fingerprints and marker files rather than a
single shared transaction.

## Quick Start

### 1. Add repositories

RepoRadar indexes first-level Git repositories under `./repos`.

```bash
mkdir -p repos
ln -s /path/to/repo-alpha repos/repo-alpha
ln -s /path/to/repo-beta repos/repo-beta
```

### 2. Start the stack

```powershell
docker compose up -d --build
```

This uses the current Compose runtime layout:

- `mcp-server-data:/app/.data`
- `refresh-coordination:/app/.data/coordination`
- `zoekt-index:/data/index`

### 3. Check the services

```powershell
docker compose logs zoekt
docker compose logs zoekt-indexer
docker compose logs mcp-server
```

Open `http://localhost:6070` to confirm Zoekt is serving search.

### 4. Build and run the MCP server locally

From `mcp-server/`:

```powershell
npm install
npm run build
npm run test
npm run start
```

This is useful for local MCP development. For containerized runtime behavior,
prefer the Compose-managed service and its named volumes.

## MCP Tool Surface

High-level workflows:

- `explore_component`
- `search_patterns`
- `analyze_symbol`
- `collect_refactor_context`
- `plan_change`

Lower-level tools:

- `search_code`
- `open_file`
- `list_symbols`
- `find_symbol`
- `find_references`
- `find_related_files`

Example workflow:

```text
explore_component("LandingHero")
analyze_symbol({ "name": "LandingHero" })
collect_refactor_context({ "name": "LandingHero", "mode": "component" })
plan_change({ "symbol": "LandingHero", "filePath": "src/components/LandingHero.tsx" })
```

## Documentation

- [Architecture](./docs/architecture.md)
- [Operations](./docs/operations.md)
- [Tools](./docs/tools.md)
- [Testing](./docs/testing.md)
- [Pattern Intelligence](./docs/architecture/pattern-intelligence.md)

## Repository Layout

- `mcp-server/`
  - MCP server, refresh pipeline, indexing, orchestration, and tools
- `zoekt/`
  - Zoekt image and indexing entrypoint
- `repos/`
  - local repositories mounted into the stack
- `docs/`
  - architecture, operations, testing, and tool reference docs

## Boundaries

RepoRadar does not claim:

- compiler-complete semantic understanding
- guaranteed safe refactors
- automatic patch generation
- runtime-complete UI dependency analysis
- cross-repo semantic inference beyond the mounted repositories

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
