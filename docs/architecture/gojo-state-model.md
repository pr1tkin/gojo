# Gojo State Model

## Purpose

Gojo exposes a small readiness model so `index`, `explore`, and `health` describe the same system state.

This model is separate from command success. A command can complete successfully while the resulting system state is still `stale`.

## Readiness states

### `ready`

Gojo is ready when all of the following are true:

- a published generation exists
- required runtime artifacts are present
- search freshness is synchronized with the published generation
- no known repo drift is detected for the scoped repo
- health does not report inconsistency

### `stale`

Gojo is stale when artifacts exist, but freshness is behind current state.

Typical causes:

- search freshness is pending, stale, unknown, failed, or otherwise not synchronized
- maintenance recommends rebuild work before relying on results
- repo files changed after the last published generation

### `inconsistent`

Gojo is inconsistent when required runtime data is missing or contradictory.

Typical causes:

- required artifacts are missing from the published generation
- consistency checks failed
- critical runtime metadata is contradictory

### `unknown`

Gojo cannot determine a trustworthy state yet.

Typical causes:

- no published generation exists
- generation metadata is unreadable
- required state inputs for the published generation are absent before a trustworthy generation can be established

## How state is computed

Runtime state is derived from the health subsystem and optional repo-scoped drift detection.

`current-health.json` is the authoritative persisted product state snapshot.

Canonical facts come from:

- current generation pointer
- published generation metadata
- required artifact presence and consistency checks
- search freshness attached to the published generation

Secondary/advisory signals are:

- search coordination markers
- repo-scoped filesystem drift
- maintenance warnings

Advisory signals may degrade `ready` to `stale`, but they must not erase the existence of a valid published generation and turn the system into `unknown`.

Inputs:

- current health summary
- health trust state
- agent workflow suitability
- repo-scoped file drift, when a repo path is available

Outputs:

- `readiness_state`
- `trust_level`
- `confidence`
- product-facing state explanation
- optional recommended corrective action

## Command behavior

### `gojo index`

`index` reports command completion and the resulting readiness state.

This means:

- `index` can complete successfully while still reporting `stale`
- `index` must not imply readiness unless the health-derived state is actually `ready`

### `gojo health`

`health` is the canonical product view of current readiness.

When a repo target is supplied, health output should:

- identify the repo explicitly
- surface repo-specific drift when present
- reduce unrelated global warning noise where possible

### `gojo explore`

`explore` inherits the same readiness model.

Exact symbol resolution does not override stale or inconsistent runtime state.

If `explore` resolves a symbol from a valid published generation, the reported readiness may still be `stale`, but it must not collapse to `unknown`.

## State vs trust

`readiness_state` answers: "is the system ready to rely on right now?"

`trust_level` answers: "how much confidence should the user place in this response?"

The two are linked, but not identical:

- `ready` usually maps to `high` trust
- `stale` usually maps to `medium` trust
- `inconsistent` maps to `degraded` trust
- `unknown` maps to `low` trust

## Deferred work

This phase does not implement:

- a separate `refresh` CLI command and final refresh semantics
- live filesystem watching
- per-artifact freshness scores beyond the shared runtime state
- canonical repo registry state tracking
