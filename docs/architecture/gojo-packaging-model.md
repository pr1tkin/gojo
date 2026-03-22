# Gojo Packaging Model

## Current packaging model
Gojo ships as a single product surface: `gojo`.

The runtime owns packaged dependencies and state resolution behind that surface:
- one official user-facing command family: `gojo`
- runtime-owned capability execution behind the CLI
- packaged runtime state directories for config, data, indexes, cache, logs, and runtime files
- bundled helper binaries for search while Zoekt remains process-based

This is packaging-ready, not single-executable purity.

## Product surface
Official entrypoints:
- `gojo`
- `gojo mcp serve`

Removed from the product surface:
- `server.ts`
- direct Node startup guidance
- Docker-first startup guidance

## Helper packaging model
Gojo formalizes search helper packaging as `bundled_helper_binaries`.

Expected distribution layout:
```text
<gojo-dist>/
  bin/
    gojo
    search/
      manifest.json
      zoekt-webserver(.exe)
      zoekt-git-index(.exe)
  data/
  runtime/
  cache/
  logs/
```

Repository-backed layout for local validation:
```text
mcp-server/
  dist/
  bin/
    search/
      manifest.json
```

## Helper resolution logic
Search helper resolution is centralized in `src/search/helpers.ts`.

Resolution order:
1. packaged helper location under `config.search.helperBinaries`
2. environment override:
   - `GOJO_ZOEKT_WEBSERVER_PATH`
   - `GOJO_ZOEKT_GIT_INDEX_PATH`
3. development fallback only:
   - helper path under `GOJO_SEARCH_HELPERS_DIR`
   - executable discovered on `PATH`

The CLI does not participate in helper discovery.

## Product state layout
Gojo resolves product paths through `src/product/environment.ts`.

Relevant directories:
- `configDir`: product configuration
- `dataDir`: persistent runtime data root
- `indexesDir`: published generations and index-backed artifacts
- `cacheDir`: regenerable caches
- `logDir`: persisted logs
- `runtimeDir`: transient runtime state and coordination markers
- `tempDir`: temporary files for atomic writes
- `searchHelpersDir`: packaged helper binary directory

There is no legacy workspace-local storage fallback.
A workspace-local `.data` directory now causes a product error that instructs the user to migrate or re-index.

Search-specific locations:
- `config.search.indexDirectory` -> `indexesDir/search`
- search coordination marker -> `runtimeDir/coordination/zoekt-refresh-state.json`

## Dev containers
Repository Docker artifacts are development-only:
- `docker-compose.yml` is for local stack debugging
- `mcp-server/Dockerfile` exists for dev/container compatibility
- container startup still uses the official command: `gojo mcp serve`

They are not the primary product path.

## Release-pipeline work that remains
Still deferred:
- assembling release archives with helper binaries included
- signing or checksumming helper artifacts
- verifying helper version compatibility during release builds
- helper supervision beyond the current managed webserver process
