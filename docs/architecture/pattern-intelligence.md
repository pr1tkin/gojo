# Pattern Intelligence

## Purpose

Phase 7 introduces an internal substrate for pattern intelligence in RepoRadar.

This substrate exists to support later phases that will:

- extract structural pattern candidates
- compare pattern fingerprints
- retrieve repository precedents

Step 7.1 does not extract patterns yet. It only establishes stable internal models, storage, and indexing boundaries so future phases can build on the existing architecture without reshaping the pipeline.

## Design Constraints

Pattern intelligence in RepoRadar is designed to remain:

- deterministic-first
- graph-aware
- language-aware
- incremental-index friendly

The substrate is aligned with existing repository primitives such as:

- `fileId`
- `symbolId`
- import and export metadata
- graph relationships
- ranking signals

## PatternCandidate

`PatternCandidate` is the core internal record.

It captures a single extracted structural pattern and anchors it to the existing repository model.

Current fields:

- `patternId`
- `kind`
- `repoId`
- `fileId`
- `symbolId?`
- `name`
- `language`
- `startLine`
- `endLine`
- `signals`
- `fingerprint`
- `supportingImports`
- `relatedSymbolIds`
- `confidence`
- `createdAt`

The model is intentionally lightweight. It is built to survive future extraction refinements without changing its basic identity or storage role.

## PatternKind

`PatternKind` is the central taxonomy for high-level structural pattern categories.

Initial kinds:

- `component`
- `hook`
- `async-data-flow`
- `list-rendering`
- `conditional-rendering`
- `form-handling`
- `api-handler`
- `utility-export`
- `test-suite`
- `storybook-story`
- `service-layer`
- `data-access`

The taxonomy is extensible. Future phases can add more kinds without changing the storage model.

## PatternSignal

`PatternSignal` represents small structural observations that support a candidate.

Example signal types:

- `react-function-component`
- `uses-hooks`
- `async-function`
- `map-rendering`
- `conditional-render`
- `error-boundary`
- `form-state`
- `api-request`
- `db-access`
- `test-describe-block`
- `storybook-meta`

Signals are intended to remain:

- lightweight
- explicit
- composable into fingerprints

## PatternFingerprint

`PatternFingerprint` is the comparable representation for a pattern candidate.

It records stable structural dimensions such as:

- `patternKind`
- `structuralSignals`
- `importSet`
- `exportShape`
- `symbolRole`
- `uiSignals?`
- `asyncSignals?`

The fingerprint is designed for future similarity scoring. Step 7.1 does not compare fingerprints yet, but it defines the shape that later phases will rely on.

## PatternRepository

`PatternRepository` is the internal storage boundary for pattern candidates.

Current responsibilities:

- `registerPatternCandidate(...)`
- `getPatternsForFile(...)`
- `getPatternsForSymbol(...)`
- `listPatternsByKind(...)`
- `getPatternById(...)`

Patterns are stored in a dedicated persisted artifact:

- `mcp-server/.data/pattern-candidates.json`

This keeps the substrate separate from the symbol index, code graph, and UI-structure artifacts while still following the same storage conventions.

## Indexing Lifecycle

The existing indexing pipeline now includes a placeholder pattern stage:

- `runPatternExtractionStage(...)`

Current behavior:

- the stage exists
- the stage is deterministic
- the stage returns an empty pattern set

This preserves the pipeline shape needed for later phases without changing any current analysis behavior.

## Planned Follow-Up Phases

Phase 7.2 will add pattern extraction.

Phase 7.3 will add pattern similarity scoring.

Phase 7.4 will add precedent discovery and retrieval workflows.

## Non-Goals In Step 7.1

This step does not implement:

- pattern extraction logic
- pattern similarity
- clustering
- pattern search
- MCP exposure
- tool integration

The substrate is internal-only until extracted candidates, similarity logic, and precedent retrieval are all in place.
