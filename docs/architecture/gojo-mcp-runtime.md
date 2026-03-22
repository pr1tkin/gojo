# Gojo MCP Runtime Model

## Purpose
MCP serving is owned by the runtime layer rather than by a standalone server entrypoint.

This makes `ServeMCP` a real runtime capability with a clear long-running lifecycle and keeps the CLI limited to command parsing and output rendering.

## Ownership boundary
### Runtime owns
- `ServeMCP` capability execution
- MCP startup orchestration
- transport connection startup
- startup result and serving-state response
- MCP tool registration
- MCP-adjacent startup maintenance such as generation debris cleanup

### Surface owns
- CLI argument parsing
- command invocation through `RuntimeHost`
- human and JSON rendering of the runtime response
- top-level process exit behavior

## Runtime implementation
The runtime-owned MCP path lives in `mcp-server/src/runtime/mcp-service.ts`.

`ServeMCP` in `runtime/handlers.ts` delegates directly to this runtime service.

## Lifecycle model
`ServeMCP` is a `long_running` runtime capability.
Current lifecycle states exposed in the response:
- startup complete
- serving active

## Entry points
Official MCP entry:
- `gojo mcp serve`

Removed entry:
- `src/server.ts`

There is no separate compatibility shim anymore.
