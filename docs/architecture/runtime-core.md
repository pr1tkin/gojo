# Runtime Core

## Purpose

The runtime core is the internal execution layer between Gojo engine modules and product surfaces.

It exists to give Gojo one shared entry model for:
- future CLI execution
- future MCP execution
- capability routing
- shared response shaping
- lifecycle boundaries

This layer is intentionally:
- independent from CLI parsing
- independent from MCP transport setup
- additive to the current codebase

## Capability Model

The runtime exposes capabilities, not commands.

Implemented in the skeleton:
- `IndexRepo`
- `RefreshRepo`
- `ExploreComponent`
- `RunHealthChecks`
- `ServeMCP`

Typed placeholders are included for:
- `BuildChangeContext`
- `FindPrecedents`
- `ComputeImpact`
- `RunDoctor`
- `TraceFlow`

Each capability has:
- request type
- response type
- execution mode

## Execution Model

The runtime distinguishes between two execution classes:

- one-shot
  - index
  - refresh
  - explore
  - health
- long-running
  - MCP serve
  - future watch/daemon flows

The distinction is encoded in capability definitions and carried in the response envelope.

## Runtime Host

`RuntimeHost` is the central runtime entry.

Responsibilities:
- register capability handlers
- accept typed capability requests
- apply execution context
- route to handlers
- return normalized runtime responses

The host does not:
- parse CLI arguments
- start MCP transport directly
- own heavy engine logic

## Response Model

All handlers return a shared response envelope with:
- `summary`
- `findings`
- `related_entities`
- `signals`
- `warnings`
- `details`
- `machine_payload`
- `confidence`
- `trust`

This is the intended backbone for:
- CLI human rendering
- CLI `--json`
- MCP result payloads

## Relation to Existing System

The runtime skeleton currently adapts existing modules:
- indexing refresh
- health evaluation
- symbol exploration

`ServeMCP` is intentionally implemented as a runtime-level adapter point with dependency injection.
That keeps the runtime reusable while allowing a future MCP surface to attach itself cleanly.

## Not Implemented Yet

Intentionally deferred:
- CLI surface
- MCP adapter migration
- search helper supervision
- runtime-owned config/data-dir abstraction
- full capability coverage for precedents, impact, doctor, trace, and bundled change context
- full reuse of the Phase 8.X normalized tool-response layer inside the runtime envelope

This document describes the Phase 9 skeleton boundary, not the finished product runtime.
