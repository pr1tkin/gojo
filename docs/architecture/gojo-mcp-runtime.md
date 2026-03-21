# Gojo MCP Runtime Model

## Purpose

MCP serving is now owned by the runtime layer rather than by the CLI surface.

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

The runtime-owned MCP path now lives in `mcp-server/src/runtime/mcp-service.ts`.

`serveMcpRuntime(...)` is responsible for:

1. cleanup before startup
2. MCP server construction
3. Gojo tool registration
4. stdio transport connection
5. optional background symbol index startup work
6. returning the runtime response that represents startup completion and active serving

`ServeMCP` in `runtime/handlers.ts` delegates directly to this runtime service.

## Lifecycle model

`ServeMCP` is a `long_running` runtime capability.

Current lifecycle states exposed in the response:

- startup complete
- serving active

This is represented through:

- `executionMode: long_running`
- response summary and findings
- `machine_payload.status = serving`
- `machine_payload.lifecycle = startup_complete`

Startup failures still surface through the normal runtime error path.

## Surface behavior

`gojo mcp serve` now does not construct or inject MCP startup logic.

The CLI simply:

1. parses `mcp serve`
2. calls `RuntimeHost.execute('ServeMCP', ...)`
3. renders the runtime response
4. keeps the process alive because the capability is long-running

## Legacy entrypoint

`src/server.ts` remains as a thin compatibility entrypoint.

It now creates a `RuntimeHost` and executes `ServeMCP` rather than owning MCP startup itself.

## Deferred work

Still deferred:

- richer serving lifecycle events beyond startup-complete / serving
- alternate transports beyond stdio
- dedicated MCP health/readiness probing while serving
- packaging/runtime supervision concerns for single-binary distribution
