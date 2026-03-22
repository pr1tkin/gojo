# Gojo Surface Consolidation

## Official entrypoints
Gojo is CLI-first.

Official product entrypoints:
- `gojo`
- `gojo mcp serve`

The intended user story is:
- install one Gojo product surface
- run all product commands through `gojo`
- use `gojo mcp serve` as the MCP entry

## Removed transitional entrypoints
Removed from the product and repository surface:
- `mcp-server/src/server.ts`
- direct `node server.ts` startup guidance
- workspace-local `.data` compatibility behavior

## Dev-only artifacts that remain
### `docker-compose.yml`
Retained for development and infrastructure debugging only.
It is not the primary product entrypoint.

### `mcp-server/Dockerfile`
Retained for development/container compatibility.
It starts the official MCP surface via `gojo mcp serve`.

### `.env.example`
Retained only for the dev Compose stack.

## Result
The codebase now has one public product story:
- `gojo` is the command surface
- `gojo mcp serve` is the only MCP startup surface
- product storage is runtime-owned and does not read legacy workspace-local state
