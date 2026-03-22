# Gojo CLI

## Purpose
The Gojo CLI is the product-facing surface built on top of the runtime core.

The CLI is responsible only for:
- argument parsing
- flag parsing
- runtime invocation
- output rendering
- exit code handling

It is not responsible for engine logic or MCP startup internals.

## Official commands
- `gojo version`
- `gojo index`
- `gojo refresh`
- `gojo explore <target>`
- `gojo health`
- `gojo mcp serve`

## Runtime mapping
The CLI routes through `RuntimeHost` only:
- `gojo version` -> `GetProductVersion`
- `gojo index` -> `IndexRepo`
- `gojo refresh` -> `RefreshRepo`
- `gojo explore` -> `ExploreComponent`
- `gojo health` -> `RunHealthChecks`
- `gojo mcp serve` -> `ServeMCP`

## Long-running commands
`gojo mcp serve` is the long-running MCP command.
The CLI invokes the runtime capability directly and does not own MCP startup logic.

## Removed compatibility surface
Removed from the CLI story:
- `server.ts`
- direct Node startup guidance
- legacy workspace-local storage fallback
