# Gojo Product Surface

## Purpose
Gojo now exposes one complete product-facing CLI surface through `gojo`. Phase 9.P2 closes the remaining product gaps by adding `gojo version`, finishing the product storage layout migration, and defining the packaged search dependency strategy.

## Official CLI Commands
- `gojo version`: report product name and version from the product identity resolver. Human output is `gojo v<version>`. `--json` returns `{ "name": "gojo", "version": "..." }`.
- `gojo index [repo-path]`: bootstrap or rebuild a repo when Gojo state is missing, unknown, or inconsistent.
- `gojo refresh [repo-path]` or `gojo refresh --repo <repo>`: reconcile a repo that already has usable Gojo state but is stale.
- `gojo explore <target> --repo <repo>`: inspect indexed repo state while reflecting current readiness and trust.
- `gojo health --repo <repo>`: explain current readiness state and the next corrective action.
- `gojo mcp serve`: start the runtime-owned MCP server as a long-running command.

## Version Behavior
Version metadata comes from the product identity resolver in this order:
1. `GOJO_VERSION`
2. `package.json`
3. internal fallback only if neither source is available

This keeps the CLI, runtime, and future release artifacts aligned on one version source.

## Storage Layout
Gojo now resolves product paths centrally through `src/product/environment.ts`.

Directories:
- `configDir`: product configuration and future user-managed settings.
- `dataDir`: persistent runtime data root. Existing workspaces may continue using a legacy local `.data` directory as a compatibility fallback.
- `indexesDir`: published generations, generation metadata, and index-backed artifacts such as symbol index, code graph, UI composition, and pattern outputs.
- `cacheDir`: reserved for derived caches that can be regenerated.
- `logDir`: reserved for persisted product logs.
- `runtimeDir`: coordination markers, transient runtime state, and future locks or pid files.
- `tempDir`: atomic write staging and other temporary files.
- `searchHelpersDir`: packaged helper binary location for Zoekt-related executables.

Current migration policy:
- new index artifact writes go to `indexesDir`
- new coordination/runtime writes go to `runtimeDir`
- legacy `.data` reads remain supported where existing workspaces still depend on older files
- `cacheDir` and `logDir` are created eagerly so later release work can use them without redefining the product layout

## Search Packaging Strategy
Gojo now uses the transitional packaging strategy `bundled_helper_binaries` for search.

Meaning:
- the product surface remains a single `gojo` command
- packaged releases are expected to ship Zoekt helper binaries alongside the product runtime
- the runtime resolves helper locations through `config.search.helperBinaries` instead of hardcoded dev paths

This is a transitional but packaging-realistic model. It avoids claiming strict single-executable purity while still preserving one installable product surface.

## Search Boundary
Search assumptions are now centralized in product/runtime configuration:
- `config.search.baseUrl`: runtime-controlled Zoekt HTTP endpoint
- `config.search.packagingStrategy`: packaging contract for search dependencies
- `config.search.helperBinaryDir` and `config.search.helperBinaries`: packaged helper resolution for the webserver and indexer binaries

What is still deferred:
- supervising Zoekt as a runtime-owned service
- shipping actual release bundles for helper binaries
- non-stdio or remote search deployment modes

## Product Completeness Status
The CLI surface is intentionally minimal but complete for release preparation:
- version
- index
- refresh
- explore
- health
- mcp serve

The remaining work is release-pipeline work, not command-surface design.
