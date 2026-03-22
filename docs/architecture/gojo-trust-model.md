# Gojo Trust Model

## Purpose

Gojo exposes trust as a product signal, not a hidden implementation detail.

The trust model exists to keep `explore` and `health` aligned on the same runtime state so the CLI does not overstate result quality.

## Core fields

Runtime responses now carry:

- `trust_level`: `high`, `medium`, `low`, or `degraded`
- `confidence`: the current result confidence using the same qualitative scale
- `readiness_state`: `ready`, `stale`, `inconsistent`, or `unknown`
- `result_kind`: `exact`, `inferred`, `heuristic`, or `exploratory`
- `coverage`: `complete`, `partial`, or `stale`
- `coverage_signals`: concise qualifiers such as `ambiguous_match`, `name_collision_risk`, or `missing_graph_evidence`
- `evidence_types`: the main evidence families used for the answer, such as `symbol_index`, `related_files`, or `runtime_health`

These fields are emitted in both human output and `--json` output.

## Result kinds

### `exact`

The primary result is grounded directly in indexed structure.

Examples:

- resolved symbol definition with one clear primary match
- authoritative runtime health state
- published generation state after index or refresh

### `inferred`

The result is useful and grounded, but Gojo had to choose between plausible candidates or rely on proxy structure.

Examples:

- same-name wrapper and service candidates remain
- a ranked primary target was selected from multiple viable symbol matches

### `heuristic`

The result is a useful lead, but Gojo cannot present it as exact truth.

Examples:

- no clean primary symbol match
- only weak structural or name-based grounding is available

### `exploratory`

The output is intentionally broad context rather than a bounded truth claim.

Examples:

- nearby implementation context
- broader precedent or navigation surfaces

## Coverage

### `complete`

The answer is backed by the currently published runtime state without a known coverage downgrade.

### `partial`

The answer is still usable, but part of the evidence is bounded, broadened, ambiguous, or incomplete.

Typical causes:

- related-file navigation is not the same as exact dependency truth
- same-name candidates remain
- graph-safe workflow coverage is degraded

### `stale`

The answer is grounded in a valid published generation, but freshness is behind current repo or search state.

## Readiness states

### `ready`

The current generation is present and health reports the system is usable.

Typical conditions:

- published generation exists
- required artifacts are present
- search freshness is ready
- no blocking consistency problems
- no known repo drift for the scoped repo

### `stale`

The runtime can answer, but the answer may be based on older or partially refreshed data.

Typical conditions:

- search freshness is `stale-search`
- search freshness is unknown or delayed for an otherwise valid published generation
- repair is recommended
- degraded health state
- repo-scoped filesystem drift is detected after indexing

### `inconsistent`

The published generation is materially broken or contradictory.

Typical conditions:

- required artifacts are missing
- consistency checks failed
- health reports `inconsistent`

### `unknown`

Gojo cannot establish a trustworthy readiness state.

Typical conditions:

- no published generation exists
- generation metadata is unreadable
- required state inputs are absent before a trustworthy published generation can be established

## Trust level mapping

The current mapping is intentionally simple.

- `healthy` health state -> `readiness_state=ready`, `trust_level=high`, `confidence=high`
- `degraded`, `repair-recommended`, `stale-search` -> `readiness_state=stale`, `trust_level=medium`, `confidence=medium`
- `inconsistent` -> `readiness_state=inconsistent`, `trust_level=degraded`, `confidence=low`
- `unknown` -> `readiness_state=unknown`, `trust_level=low`, `confidence=low`

Important invariant:

- once a valid published generation exists, search freshness problems degrade trust to `stale`
- they do not erase published-generation truth and turn the runtime into `unknown`

Additional downgrade rules:

- if health says the system is not suitable for agent workflows, a nominally high trust result is reduced
- if repo-scoped filesystem drift is detected after the last index build, readiness is downgraded to `stale`

## Explore behavior

`ExploreComponent` now derives trust from runtime health rather than only from symbol resolution quality.

That means:

- exact symbol resolution no longer implies `high` trust by itself
- ambiguity still lowers trust
- stale search or repo drift adds warnings and reduces trust
- inconsistent health prevents `explore` from presenting a strong trust signal
- related files are surfaced as navigation context, not silently presented as exact direct consumers
- same-name candidate collisions now surface as `result_kind=inferred` with explicit coverage signals

## Health behavior

`RunHealthChecks` remains the source of readiness truth.

It now uses the same trust/readiness fields as other runtime responses and can include repo-scoped drift warnings when a repo target is supplied.

`health`, `explore`, `index`, and `refresh` all read from the same health-derived readiness/trust contract. They may differ in warnings or result-specific confidence, but not in the underlying readiness truth.

Health, index, and refresh use `result_kind=exact` because they are reporting product state, not ranking a target. Their coverage can still degrade to `partial` or `stale` when runtime conditions warrant it.

## Repo drift handling

Gojo does not implement live filesystem watching yet.

Current behavior is conservative and repo-scoped:

- when a repo path is available, Gojo compares source file mtimes against the current generation `createdAt`
- if a source file is newer than the current generation, Gojo reports stale index data
- this is surfaced as a warning and a readiness downgrade

## Logging and product output

CLI product output must be readable without runtime log noise.

Current policy:

- normal CLI runs use a silent runtime logger
- `--debug` enables the stderr logger
- runtime responses remain the source for product output

## Intentionally not covered yet

This phase does not implement:

- live file watching
- canonical repo registry trust propagation
- numeric trust scoring
- per-artifact freshness scores beyond the existing health summary
- automatic re-index or refresh behavior
