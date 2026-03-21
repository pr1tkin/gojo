# Gojo Surface Consolidation

## Official entrypoints

Gojo is now CLI-first.

Official product entrypoints:

- `gojo`
- `gojo mcp serve`

The intended user story is:

- install one Gojo product surface
- run all product commands through `gojo`
- use `gojo mcp serve` as the official MCP entry

## Deprecated or transitional entrypoints

### `mcp-server/src/server.ts`

`server.ts` is now a deprecated compatibility entrypoint.

It remains only to avoid breaking older local or development flows while the repository and release surfaces consolidate around `gojo`.

It is not part of the official product story.

## Dev-only artifacts that remain

### `docker-compose.yml`

Retained for development and infrastructure debugging only.

It is useful for:

- Zoekt development
- local multi-service debugging
- containerized development workflows

It is not the primary product entrypoint.

### `mcp-server/Dockerfile`

Retained for development/container compatibility.

It now starts the official MCP surface via:

- `node dist/gojo.js mcp serve`

rather than using the legacy server entrypoint directly.

### `.env.example`

Retained only for the dev Compose stack.

## Why Gojo is now CLI-first

The product architecture now has:

- a runtime core
- a unified CLI surface
- runtime-owned MCP startup
- packaging-oriented product identity and path resolution

That makes `gojo` the correct user-facing abstraction and reduces confusion from older dev-first startup paths.

## What was cleaned up in this phase

- official MCP entry clarified as `gojo mcp serve`
- `server.ts` reduced to an explicitly deprecated compatibility shim
- Docker runtime command switched to the official CLI path
- Compose reclassified as development-only
- README and operations guidance updated to stop presenting Compose as the default product path
