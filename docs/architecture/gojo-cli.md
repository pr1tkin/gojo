# Gojo CLI

## Purpose

The Gojo CLI is the first product-facing surface built on top of the Phase 9 runtime core.

The CLI is responsible only for:
- argument parsing
- flag parsing
- runtime invocation
- output rendering
- exit code handling

It is not responsible for:
- engine logic
- capability execution
- response generation

Those remain in the runtime layer.

## Phase 9 MVP Commands

Implemented MVP commands:
- `gojo index`
- `gojo refresh`
- `gojo explore <target>`
- `gojo health`
- `gojo mcp serve`

## Runtime Mapping

The CLI routes through `RuntimeHost` only:

- `gojo index` -> `IndexRepo`
- `gojo refresh` -> `RefreshRepo`
- `gojo explore` -> `ExploreComponent`
- `gojo health` -> `RunHealthChecks`
- `gojo mcp serve` -> `ServeMCP`

This establishes the product path:

CLI -> RuntimeHost -> Runtime handlers -> existing engine logic

## Global Flags

Phase 9 MVP global flags:
- `--repo`
- `--json`
- `--debug`

These are translated into runtime execution context and request data where applicable.

## Repo Targeting Model

Gojo now distinguishes between:
- `RepoPath`
  - filesystem path
  - always valid input for `gojo index <path>`
- `RepoId`
  - logical identifier such as `dlf-web`
  - used for insight commands after repo resolution

CLI resolution rule:
- if `--repo <value>` points to an existing path, treat it as `RepoPath`
- otherwise treat it as `RepoId` and resolve it to a path when possible

This resolution happens in the CLI layer before the runtime host is called.

## Output Model

Default output is human-readable plain text.

When `--json` is used, the CLI prints the runtime response envelope directly.

Rendering stays in the CLI layer so the runtime response remains surface-neutral.

## Long-Running Commands

`gojo mcp serve` is the first long-running CLI command.

The CLI invokes the runtime capability and the runtime uses the MCP adapter from `server.ts`.
The command is long-running because the MCP transport stays active after startup.

## Deferred

Intentionally deferred from this MVP:
- broader insight command surface
- full argument schema system
- richer formatting or ANSI styling
- watch mode
- multi-repo orchestration
- full response alignment with the Phase 8.X public tool normalization layer
