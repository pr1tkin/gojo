# Gojo Packaging Model

## Current packaging model

Gojo now targets a **single product-surface binary** with a packaged runtime.

Current model:

- one primary user-facing command: `gojo`
- runtime-owned capability execution behind that command surface
- packaged runtime state directories for config, data, cache, logs, and runtime files
- pragmatic allowance for internal helper processes or external services where the product still needs them

This is not yet a strict "all code and all dependencies inside one immutable executable" model.

The honest current model is:

- **single binary product surface with packaged runtime state and transitional helper/service dependencies**

## What "single binary" means today

For Gojo today, "single binary" means:

- the user installs and invokes one primary executable: `gojo`
- all product commands are entered through that surface
- the runtime core owns capability execution and long-running startup paths
- packaged builds can supply supporting runtime state directories and, where still necessary, helper/service dependencies behind the unified product surface

Known exceptions and transitional compromises:

- Zoekt integration still behaves as an external dependency boundary
- MCP lifecycle is still snapshot-based after startup
- `server.ts` still exists as a compatibility entrypoint
- there is not yet a runtime supervisor layer for multiple long-running services

## Packaging boundaries

The following pieces must be packaged together conceptually:

### Product surface

- `gojo` CLI entrypoint (`src/gojo.ts`)
- command parsing and rendering layer (`src/cli/*`)

### Runtime core

- `RuntimeHost`
- runtime handlers
- runtime MCP service
- shared runtime response and state model

### MCP runtime path

- runtime-owned `ServeMCP`
- MCP tool registry
- MCP transport startup code

### Indexing and analysis runtime

- symbol index
- graph index
- UI composition and props indexes
- pattern index
- health and generation-state management

### Product environment / metadata

- product identity (name, version, packaging model)
- product directory resolver
- config loading defaults

### Transitional helper / dependency boundaries

- Zoekt endpoint / search integration
- any future packaged helper binaries required by search

## Product path and state layout

Gojo now resolves product directories through a central environment layer.

Current directory model:

- `packageRoot`: packaged application root containing runtime code and package metadata
- `homeDir`: base Gojo product home when `GOJO_HOME` is set, otherwise platform default
- `configDir`: product config location
- `dataDir`: runtime data and generation artifacts
- `indexesDir`: reserved product directory for index-oriented packaged layout
- `cacheDir`: cacheable runtime artifacts
- `logDir`: logs for packaged/runtime operation
- `runtimeDir`: transient runtime state
- `tempDir`: temporary runtime files

Current artifact behavior:

- generation artifacts continue to live under `dataDir`
- current runtime health and coordination files also live under `dataDir`
- index-specific and cache-specific separation is now modeled, even if not every subsystem has migrated yet
- when an existing workspace-local `.data` directory is present, Gojo currently reuses it as a compatibility fallback instead of forcing immediate state migration

## Packaging-readiness improvements now implemented

- product identity is resolved centrally from package metadata or environment override
- runtime data directories no longer default to `.data` under the caller's current working directory
- major storage modules now resolve through the product environment layer
- MCP startup reports product identity from the same metadata source used by config
- default repo-root resolution is less container-specific and can fall back to workspace-adjacent `repos/`

## Version and product identity

Product identity is now explicit in code.

Source of truth:

- package metadata version from `mcp-server/package.json`
- optional environment override via `GOJO_VERSION`

This identity is available to runtime code and is already used by the MCP runtime service.

## What remains for release-pipeline work

Still deferred:

- producing distributable binaries/installers
- copying or embedding any helper binaries needed by search
- final install-time OS-specific path conventions
- explicit migration of every storage subsystem into `indexesDir`, `cacheDir`, or `logDir`
- consolidation or retirement of `server.ts`
- release automation and artifact signing
