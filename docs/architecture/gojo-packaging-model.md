# Gojo Packaging Model

## Current packaging model
Gojo targets a single product-facing command with packaged runtime dependencies.

Current model:
- one official user-facing command: `gojo`
- runtime-owned capability execution behind that surface
- packaged runtime state directories for config, data, cache, logs, and runtime files
- bundled helper binaries for search where Gojo still depends on Zoekt processes

This is still a transitional model. It is a single product surface, not strict single-executable purity.

## What "single binary" means today
For Gojo today, the product promise is:
- the user installs one Gojo distribution
- the user runs one primary command: `gojo`
- required runtime helpers are bundled inside that distribution when they are still necessary
- the runtime, not the CLI, owns helper discovery and startup

Known transitional compromises:
- Zoekt remains process-based rather than embedded as a TypeScript library
- MCP lifecycle is still startup-snapshot based
- `server.ts` still exists as a compatibility shim
- there is not yet a general supervisor layer for multiple long-running helpers

## Helper packaging model
Gojo now formalizes search helper packaging as `bundled_helper_binaries`.

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

Current repository-backed layout for local validation:
```text
mcp-server/
  dist/
  bin/
    search/
      manifest.json
```

The helper manifest records:
- schema version
- packaging strategy
- pinned Zoekt ref
- expected helper names

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

## Dev vs packaged behavior
Search runtime mode is controlled by:
- `GOJO_RUNTIME_MODE=packaged|development`
- otherwise defaults to `development` unless `GOJO_PACKAGED=true` is set

### Packaged mode
Packaged mode is strict.

Behavior:
- helper discovery must succeed from the packaged layout or explicit override
- helper startup failures are treated as product errors
- `gojo mcp serve` fails fast with an incomplete-installation error if bundled helpers are missing
- `index` and `refresh` treat search sync failures as command failures rather than silent degradation

### Development mode
Development mode remains permissive.

Behavior:
- Gojo may use an already-running external Zoekt endpoint
- missing helpers do not block MCP startup if the user is intentionally working without managed search helpers
- search sync may remain stale when helper binaries are unavailable, preserving current local workflows without claiming packaged completeness

## Runtime ownership
Runtime-owned search logic now lives in:
- `src/runtime/search-service.ts`
- `src/search/helpers.ts`

Responsibilities:
- resolve helper binaries
- validate helper executability
- probe helper version when possible
- build Zoekt search indexes during refresh/index flows
- start the Zoekt webserver for runtime-owned MCP serving when appropriate
- write refreshed search snapshot markers for readiness reconciliation

This keeps helper lifecycle out of the CLI layer.

## Product path and state layout
Gojo resolves product paths through the product environment layer.

Relevant directories:
- `configDir`: user or install configuration
- `dataDir`: persistent runtime data root
- `indexesDir`: Gojo generation artifacts and search index directory
- `cacheDir`: regenerable caches
- `logDir`: persisted logs
- `runtimeDir`: transient runtime state and coordination markers
- `tempDir`: temporary files for atomic writes
- `searchHelpersDir`: packaged helper binary directory

Search-specific locations:
- `config.search.indexDirectory` -> `indexesDir/search`
- search coordination marker -> `runtimeDir/coordination/zoekt-refresh-state.json`

## Version compatibility
Compatibility is currently ensured through a pragmatic contract:
- packaged helper manifest pins a Zoekt ref
- runtime probes helper executability with `-version` when possible
- if version output is unavailable, runtime degrades to executable validation plus manifest expectation

This is enough for release preparation, but not yet a full helper compatibility policy.

## What remains for release-pipeline work
Still deferred:
- assembling real release archives with helper binaries included
- signing or checksumming helper artifacts
- verifying helper version compatibility during release builds
- helper supervision beyond the current managed webserver process
- removing the legacy `server.ts` compatibility entrypoint
