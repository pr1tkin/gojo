# Testing

## Purpose

This document describes the current validation workflow for gojo.

It focuses on:

- fast local verification for development
- evaluation-driven refinement against the real stack
- focused follow-up checks after targeted changes
- refresh fault-injection and recovery validation

For runtime setup, see [Operations](./operations.md). For system design, see
[Architecture](./architecture.md).

## Current Testing Model

gojo uses a mix of:

- unit tests for deterministic logic and tool contracts
- focused real-system checks against the running stack when behavior depends on runtime coordination
- standalone evaluation reports stored under `docs/evaluations/`

Evaluation reports are intentionally kept out of the main documentation flow.
They are working records, not user-facing reference docs.

## Day-To-Day Development Workflow

From `mcp-server/`:

```powershell
npm install
npm run test
npm run build
```

Use `npm run test:coverage` when you need broader coverage inspection rather
than routine iteration.

## What To Validate First

Use local unit tests for:

- deterministic indexing and graph logic
- search fingerprint and coordination derivation
- orchestration services
- MCP tool wrappers and schemas
- conservative analysis behavior
- pattern extraction and integrity checks
- refresh lifecycle, fault injection, and consistency behavior

Primary test directory:

- `mcp-server/test/unit`

## Focused Real-System Checks

Use focused runtime checks when the change depends on the real containerized
stack rather than isolated module behavior.

Typical examples:

- verifying Compose volume behavior
- validating one-shot Zoekt runs with `INDEX_ONCE=true`
- checking coordination marker behavior across `mcp-server` and `zoekt-indexer`
- confirming health or freshness interpretation after recovery scenarios
- validating a high-level MCP workflow against a mounted repository

Prefer narrow checks over full end-to-end reruns when the change is local and
the affected behavior is obvious.

## Fault Injection And Recovery Validation

Phase 6 introduced refresh fault-injection and recovery validation for the MCP
refresh lifecycle.

Relevant environment variables:

- `FAULT_INJECTION_STAGE`
- `FAULT_INJECTION_MODE`
- `FAULT_INJECTION_TARGET`
- `REPORADAR_FAULT_INJECTION_STAGE`
- `REPORADAR_FAULT_INJECTION_MODE`
- `REPORADAR_FAULT_INJECTION_TARGET`

Supported stages include:

- `before-snapshot`
- `after-snapshot`
- `after-change-detection`
- `rebuild-symbols`
- `rebuild-graph`
- `rebuild-patterns`
- `persist-artifacts`
- `before-commit`
- `coordination-update`
- `consistency-maintenance`

Supported modes include:

- `throw`
- `crash`
- `partial-write`
- `skip-step`

Example:

```powershell
$env:FAULT_INJECTION_STAGE='before-commit'
$env:FAULT_INJECTION_MODE='throw'
npm run test -- refresh-fault-injection
```

Use these only for hardening and recovery validation, not normal development.

## When To Re-Run A Full Evaluation

Use a broader evaluation pass when changes affect:

- refresh lifecycle semantics
- search freshness or coordination logic
- trust or consistency interpretation
- cross-layer orchestration behavior
- multiple MCP workflows at once

Also use a full evaluation when a targeted fix changes assumptions that earlier
reports were based on.

## When Focused Re-Checks Are Enough

Use focused re-checks when the change is clearly bounded, for example:

- a single tool schema or formatter
- a localized ranking rule
- a documentation-aligned runtime command fix
- a recovery fix that only changes one stage or marker path

In those cases, prefer:

- the relevant unit tests
- one or two runtime checks that exercise the affected path
- a quick build verification

## Example Commands

Full local unit suite:

```powershell
npm run test
```

Build verification:

```powershell
npm run build
```

Targeted examples:

```powershell
npm run test -- cross-index-refresh.test.ts
npm run test -- coordination-marker-resilience.test.ts
npm run test -- refresh-fault-injection.test.ts
npm run test -- consistency-maintenance.test.ts
npm run test -- impact-analysis.service.test.ts
npm run test -- plan-change.tool.test.ts
```

## What This Documentation Does Not Do

This document does not try to catalog every historical test flow.

It intentionally avoids over-documenting:

- obsolete pre-hardening workflows
- manual steps that are no longer part of normal refinement
- direct links to specific evaluation reports under `docs/evaluations/`

## Scope Limits

gojo validation does not claim:

- Docker-perfect end-to-end coverage for every environment
- compiler-complete semantic correctness
- guaranteed correctness of all heuristic planning outputs
- exhaustive performance benchmarking

The goal is confidence in the real implemented system, with honest limits and
fast feedback for continued refinement.
