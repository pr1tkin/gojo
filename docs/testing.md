# Testing

## Philosophy

RepoRadar relies on focused unit tests for the deterministic parts of the
code-intelligence stack.

The test strategy follows the same layered model used throughout the
architecture docs:

`Search -> Structure -> Graph -> Impact -> Ownership -> Planning`

Pattern intelligence is tested alongside that stack because it reuses the same
indexed repository data for extraction, similarity, clustering, and precedent
retrieval.

Tests are intended to verify:

- deterministic indexing and graph behavior
- stable orchestrator service behavior
- conservative analysis outputs
- deterministic pattern-intelligence behavior
- thin MCP tool wrappers

The suite does not try to claim compiler-complete correctness or full runtime
integration coverage.

## Running Tests

From `mcp-server/`:

```powershell
npm install
npm run test
npm run test:coverage
npm run build
```

## Unit Test Layout

Primary test directory:

- `mcp-server/test/unit`

Typical coverage areas:

- search and request formatting
- file and repository access
- Tree-sitter parsing and symbol extraction
- symbol-index persistence and querying
- graph build and query helpers
- ranking and context assembly
- orchestrator services
- pattern extraction and similarity
- precedent discovery
- MCP tool wrappers

## What The Tests Cover

### Symbol Analysis

Tests verify:

- symbol resolution
- export and local-role interpretation
- nearby symbol and file context
- conservative usage summaries

### Impact Analysis

Tests verify:

- direct impact detection
- bounded transitive impact expansion
- confidence and grouping behavior
- conservative blast-radius summaries
- additive UI-aware impact hints when relevant

### Ownership Detection

Tests verify:

- export-surface heuristics
- path and boundary heuristics
- usage fan-out heuristics
- barrel and entry-surface heuristics
- conservative ownership and API-boundary classification
- additive UI-aware ownership signals when available

### Change Planning

Tests verify:

- scope classification
- risk classification
- edit vs review separation
- local helper containment
- framework entry planning
- ordered edit and review steps
- additive UI review hints without edit-target expansion

### Pattern Intelligence

Tests verify:

- deterministic pattern extraction
- detector calibration for common false-positive cases
- stable pattern repository behavior
- deterministic similarity scoring and clustering
- precedent ranking and candidate filtering
- responsibility-aware similarity and precedent refinement

### MCP Tool Wrappers

Tool-level tests verify:

- public input schema acceptance
- stable output structure
- delegation to orchestrator services
- safe behavior for missing or ambiguous inputs

High-level tool wrappers covered in the test suite:

- `explore_component`
- `search_patterns`
- `analyze_symbol`
- `collect_refactor_context`
- `plan_change`

## Example Commands

Run the full test suite:

```powershell
npm run test
```

Build verification:

```powershell
npm run build
```

Targeted examples:

```powershell
npm run test -- impact-analysis.service.test.ts
npm run test -- symbol-ownership.service.test.ts
npm run test -- change-planning.service.test.ts
npm run test -- pattern-similarity.test.ts
npm run test -- precedent-discovery.service.test.ts
npm run test -- plan-change.tool.test.ts
```

## Refresh Fault Injection

For deterministic refresh lifecycle failure testing, `mcp-server` supports
internal fault injection through environment variables.

Supported variables:

- `FAULT_INJECTION_STAGE`
- `FAULT_INJECTION_MODE`
- `FAULT_INJECTION_TARGET`
- `REPORADAR_FAULT_INJECTION_STAGE`
- `REPORADAR_FAULT_INJECTION_MODE`
- `REPORADAR_FAULT_INJECTION_TARGET`

Supported stages:

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

Supported modes:

- `throw`
- `crash`
- `partial-write`
- `skip-step`

Notes:

- disabled by default
- intended for deterministic testing and hardening only
- `FAULT_INJECTION_TARGET` is optional and is used for targeted stages such as
  `persist-artifacts`

Example:

```powershell
$env:FAULT_INJECTION_STAGE='before-commit'
$env:FAULT_INJECTION_MODE='throw'
npm run test -- refresh-fault-injection
```

## What Is Intentionally Out Of Scope

The unit suite does not attempt to cover:

- Docker or Compose integration
- end-to-end MCP stdio sessions
- live Zoekt container integration
- performance benchmarking
- compiler-complete semantic refactors
- guaranteed correctness of all impact, ownership, planning, or precedent
  results

`server.ts` remains lightly tested indirectly because it is mostly MCP SDK
bootstrap and tool registration glue.

## Validation Strategy

Use unit tests for:

- deterministic correctness
- conservative heuristic behavior
- stable MCP tool contracts
- safe failure modes

Use manual runtime checks for:

- Docker Compose startup
- Zoekt availability
- repository indexing
- MCP client integration
- workflow quality on local repositories

For runtime setup, see [Operations](./operations.md). For system design, see
[Architecture](./architecture.md).
