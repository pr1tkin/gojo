# Gojo Product Surface

## Purpose
Gojo exposes one complete product-facing CLI surface through `gojo`.
The runtime, storage model, and packaged search helper strategy all live behind that single surface.

## Official CLI Commands
- `gojo version`: report product name and version from the product identity resolver.
- `gojo index [repo-path]`: bootstrap or rebuild repo state.
- `gojo refresh [repo-path]` or `gojo refresh --repo <repo>`: reconcile an indexed repo.
- `gojo explore <target> --repo <repo>`: inspect indexed repo state.
- `gojo health --repo <repo>`: explain readiness and the next corrective action.
- `gojo mcp serve`: start the runtime-owned MCP server.

## Product boundary
Official entrypoints:
- `gojo`
- `gojo mcp serve`

Not supported:
- `server.ts`
- direct `node server.ts` startup
- legacy workspace-local `.data` fallback
- Docker-first product guidance

## Storage Layout
Gojo resolves product paths centrally through `src/product/environment.ts`.

Directories:
- `configDir`: product configuration and future user-managed settings.
- `dataDir`: persistent runtime data root.
- `indexesDir`: published generations, generation metadata, and index-backed artifacts such as symbol index, code graph, UI composition, and pattern outputs.
- `cacheDir`: derived caches that can be regenerated.
- `logDir`: persisted product logs.
- `runtimeDir`: coordination markers, transient runtime state, and future locks or pid files.
- `tempDir`: atomic write staging and other temporary files.
- `searchHelpersDir`: packaged helper binary location for Zoekt-related executables.

Current policy:
- all published artifacts read and write through `dataDir` and `indexesDir`
- all coordination and temporary state read and write through `runtimeDir` and `tempDir`
- legacy workspace-local `.data` is rejected with a clear product error

## Legacy cutoff
If Gojo is started in a workspace that still contains `.data`, startup fails fast with:

```text
Legacy .data directory detected. This Gojo version no longer supports legacy storage. Please migrate or re-index.
```

Gojo does not silently read or write legacy paths.

## Search Packaging Strategy
Gojo uses the packaging strategy `bundled_helper_binaries` for search.

Meaning:
- the product surface remains a single `gojo` command
- packaged releases ship Zoekt helper binaries alongside the product runtime
- the runtime resolves helper locations through `config.search.helperBinaries`

## Dev-only artifacts
Repository Docker artifacts remain only for development:
- `docker-compose.yml`
- `mcp-server/Dockerfile`
- `.env.example`

They support local infrastructure debugging and do not change the official product surface.
