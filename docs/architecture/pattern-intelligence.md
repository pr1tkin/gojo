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

## Pattern Similarity And Clustering

Phase 7.3 adds deterministic similarity scoring and same-kind clustering for
`PatternCandidate` records.

Similarity operates only on normalized `PatternFingerprint` fields:

- pattern kind
- structural signal overlap
- supporting import overlap
- export shape
- symbol role
- optional UI signal overlap
- optional async signal overlap

The comparison does not inspect raw code bodies. This keeps similarity deterministic,
incremental-index friendly, and aligned with the existing pattern store.

Current clustering is intentionally simple:

- only patterns of the same `PatternKind` are compared
- similarity uses weighted overlap across normalized fingerprint fields
- clusters form when similarity passes a stable threshold and the shared-signal
  evidence is strong enough
- each cluster records:
  - `clusterId`
  - representative pattern
  - size
  - dominant structural signals

The similarity layer also supports nearest-neighbor lookup for a single pattern.
Phase 7.4 will use this substrate for precedent discovery and pattern-based
navigation.

### Similarity Refinement

The first refinement pass keeps the same fingerprint schema but tightens how broad
pattern families are compared.

Current calibration adds:

- stronger gating for high-volume kinds such as `component`, `hook`, and
  `async-data-flow`
- more weight on supporting import overlap
- a small representativeness adjustment that favors exported, richer patterns over
  minimal local helpers
- a small same-file penalty for nearest-neighbor ranking so local helpers do not
  dominate precedent candidates

These adjustments remain deterministic and do not change pattern extraction or the
stored fingerprint shape.

### Symbol-Aware Similarity

The next refinement pass adds a lightweight symbol-name similarity signal on top of
the existing fingerprint-based comparison.

Current behavior:

- symbol names are tokenized deterministically from camelCase, PascalCase, and
  underscore-separated names
- similarity compares normalized name-token overlap
- name similarity is used conservatively for kinds where naming carries structural
  meaning:
  - `component`
  - `hook`
  - `async-data-flow`
  - `utility-export`
- strong name-family matches receive a small boost, while generic same-kind matches
  without import or name overlap are less likely to cluster together

This remains deterministic and lightweight. It does not add embeddings, fuzzy NLP, or
change the stored fingerprint schema.

Pattern similarity and clustering remain internal services. There is no MCP exposure
yet.

## Planned Follow-Up Phases

Phase 7.4 adds precedent discovery and retrieval workflows on top of the stored
pattern corpus and similarity layer.

## Non-Goals In Step 7.3

This step does not implement:

- pattern MCP tools
- precedent discovery APIs
- agent-facing interfaces

Similarity and clustering remain internal until precedent retrieval is in place.

## Precedent Discovery

Phase 7.4 adds an internal `PrecedentDiscoveryService` for retrieving the best
existing implementations for a symbol, pattern, or file.

Current behavior:

- starts from the symbol or pattern's extracted `PatternCandidate` records
- retrieves nearest same-kind neighbors through `PatternSimilarityService`
- enriches candidates with indexed symbol and graph context
- filters identical-symbol matches and de-emphasizes same-file precedents
- ranks candidates with a deterministic `precedentScore`

Current precedent scoring uses:

- similarity score as the primary signal
- exported symbol bonus
- cross-file bonus
- usage-frequency bonus from the symbol index
- small graph-context bonuses for imported or re-exported files
- small path-family bonus

Returned candidates include:

- symbol and pattern identifiers
- file path
- pattern kind
- raw similarity score
- final precedent score
- explicit reason signals

This remains internal-only. There is still no MCP precedent tool, no code
generation layer, and no refactor automation.
