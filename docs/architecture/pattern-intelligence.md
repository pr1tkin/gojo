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

The existing indexing pipeline now includes a deterministic pattern stage:

- `runPatternExtractionStage(...)`

Current behavior:

- the stage runs after symbol extraction and import/export metadata collection
- the stage inspects indexed files, symbols, and imports
- the stage emits `PatternCandidate` records when rule-based detector evidence is strong
- the stage persists results in `mcp-server/.data/pattern-candidates.json`

The stage remains conservative. Files without strong detector evidence simply emit no pattern candidates.

## Deterministic Pattern Extraction

Phase 7.2 activates the first rule-based extraction pass for TypeScript and TSX files.

Initial detectors:

- `ReactComponentDetector`
- `CustomHookDetector`
- `AsyncDataFlowDetector`
- `ListRenderingDetector`
- `ConditionalRenderingDetector`
- `UtilityExportDetector`
- `TestSuiteDetector`
- `StorybookStoryDetector`
- `ApiHandlerDetector`

These detectors combine:

- Tree-sitter node shape
- indexed symbol metadata
- file import/export metadata
- path conventions where the signal is strong

Example detector behavior:

- React component detection requires a TSX file, an uppercase function-like symbol, and JSX return structure
- custom hook detection requires a `useX` function name plus hook calls
- async data flow detection requires async/await plus API-style request or explicit error handling
- list and conditional rendering detection require JSX plus `map(...)`, ternary, or `&&` rendering
- test and Storybook detection require known imports, filename conventions, or stable export shapes
- API handler detection requires route-like file placement and handler naming conventions such as `GET` or `POST`

Recent detector calibration tightened several high-noise cases without changing the underlying pattern model:

- Storybook detection now prefers explicit story files or real meta exports and excludes config/setup files
- API handler detection now requires stronger function-like route evidence instead of path or naming alone
- React component detection now supports wrapped component forms such as `forwardRef(...)` and `memo(...)`
- a narrow framework-specific exception covers file-based UI surfaces such as `not-found.tsx`
- rendering-pattern extraction is slightly more conservative for clearly non-component JSX helpers

## Signals And Fingerprints In Extraction

Extracted candidates are supported by small structural signals such as:

- `react-function-component`
- `jsx-return`
- `uses-hooks`
- `custom-hook`
- `async-function`
- `api-request`
- `error-handling`
- `map-rendering`
- `conditional-render`
- `named-export`
- `route-handler`
- `test-describe-block`
- `storybook-meta`

Each emitted candidate also receives a normalized `PatternFingerprint` containing:

- pattern kind
- structural signal set
- supporting import set
- export shape
- symbol role
- optional UI and async signal subsets

The fingerprint is designed for later similarity and precedent-retrieval work. Phase 7.2 only emits and stores it.

## Emission And Deduplication

Each detector emits at most one pattern candidate per symbol and pattern-kind combination.

Deduplication uses:

- `symbolId` when available, otherwise `fileId`
- `PatternKind`
- normalized structural signal set

This keeps extraction deterministic and compatible with future incremental indexing work.

## Planned Follow-Up Phases

Phase 7.3 will add pattern similarity scoring.

Phase 7.4 will add precedent discovery and retrieval workflows.

## Non-Goals In Step 7.2

This step does not implement:

- pattern similarity
- clustering
- pattern search
- MCP exposure
- tool integration

The substrate is internal-only until extracted candidates, similarity logic, and precedent retrieval are all in place.
