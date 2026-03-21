# Gojo Refresh Semantics

## Purpose

Gojo now exposes two product-level maintenance commands:

- `gojo index`
- `gojo refresh`

They are intentionally close in implementation today, but they carry different product meaning.

## `gojo index`

Use `index` when Gojo does not have a usable published state for a repo.

Primary cases:

- first-time bootstrap
- readiness is `unknown`
- readiness is `inconsistent`
- explicit rebuild/recovery is needed

Mental model:

- bootstrap or rebuild Gojo artifacts for a repo

Examples:

- `gojo index ../repos/dlf-web`
- `gojo index --repo dlf-web`

## `gojo refresh`

Use `refresh` when Gojo already has usable repo state, but that state is stale or out of sync.

Primary cases:

- readiness is `stale`
- search freshness is behind the latest published generation
- repo files changed after the last generation and Gojo needs reconciliation

Mental model:

- update an already indexed repo so Gojo catches up to current state

Examples:

- `gojo refresh --repo dlf-web`
- `gojo refresh --repo ../repos/dlf-web`

## Mapping to readiness states

- `unknown` -> prefer `gojo index`
- `inconsistent` -> prefer `gojo index`
- `stale` -> prefer `gojo refresh`
- `ready` -> no corrective command required

## Command loop

The intended product loop is now:

1. `gojo health --repo <repo>` explains current readiness and next action.
2. `gojo index <repo>` bootstraps or rebuilds when state is missing or inconsistent.
3. `gojo refresh --repo <repo>` reconciles stale repo state.
4. `gojo explore <symbol> --repo <repo>` uses current indexed state and reflects readiness honestly.

## Current implementation note

`index` and `refresh` currently reuse the same underlying refresh/index infrastructure.

This is acceptable for Phase 9 because the user-facing semantics are now explicit even though the internal execution path still overlaps.

## Deferred refinement

Still deferred:

- final internal policy split between bootstrap indexing and incremental refresh
- richer repo-specific freshness computation
- search supervisor ownership and full synchronization lifecycle
- separate `doctor` or remediation flows
