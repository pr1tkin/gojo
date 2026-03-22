# Gojo CLI Experience

## Purpose

This document describes the Phase 9 CLI experience layer on top of the runtime-backed `gojo` surface.

Scope:
- human-readable command output
- failure rendering
- recovery guidance
- missing-index handling

Out of scope:
- packaging
- release distribution
- automatic indexing semantics

## Human Output Philosophy

The CLI should feel like a tool, not a JSON dump.

Default human output should:
- lead with a clear result headline
- summarize the outcome immediately
- group findings, warnings, related entities, and signals
- include suggested next commands only when they are useful

Rendering remains in the CLI layer.
The runtime still returns surface-neutral responses.

## Failure Rendering Philosophy

User-facing failures should answer three questions:
- what failed
- why it failed
- what the user can do next

The CLI uses a small structured error model to keep:
- human output actionable
- JSON output machine-usable

This applies especially to recoverable failures.

## Missing-Index Handling Policy

Current policy:
- Gojo does not silently auto-index during `explore`
- Gojo does not mutate repo state unless the user explicitly asks it to
- when symbol index data is missing, the CLI renders a recovery-oriented failure

The expected recovery path is explicit:
- run `gojo index`
- retry the original command
- optionally inspect readiness with `gojo health`

## JSON Failure Behavior

When `--json` is present, CLI failures emit structured error data instead of pretty text.

The error object includes:
- error code
- title
- reason
- how-to-fix steps
- suggested commands

This keeps automation and future shell integrations viable.

## Deferred Semantics

Still intentionally deferred:
- automatic indexing flags such as `--ensure-index`
- final `index` vs `refresh` semantics
- full response alignment with Phase 8.X public tool normalization
- richer repo identity handling beyond the current Phase 9 MVP
