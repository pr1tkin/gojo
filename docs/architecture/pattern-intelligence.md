# Pattern Intelligence

## Purpose

Pattern intelligence is RepoRadar's internal capability for recognizing,
comparing, and reusing recurring implementation shapes across a repository set.

It supports three related jobs:

- extract deterministic structural patterns from indexed code
- compare those patterns through normalized fingerprints
- surface strong internal precedents for similar symbols or files

This capability is internal. It enriches repository understanding and agent
retrieval workflows, but it is not currently exposed as a dedicated public MCP
tool.

## Design Constraints

Pattern intelligence is designed to remain:

- deterministic-first
- graph-aware
- language-aware
- incremental-index friendly

It reuses existing repository primitives such as:

- `fileId`
- `symbolId`
- import and export metadata
- graph relationships
- symbol frequency signals
- UI structure signals when available

## Pattern Model

### `PatternCandidate`

`PatternCandidate` is the core internal record.

It captures one extracted structural pattern and anchors it to the existing
repository model.

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

The model is intentionally lightweight. It is built to tolerate detector and
scoring refinement without changing its identity or storage role.

### `PatternKind`

`PatternKind` is the high-level taxonomy for extracted structural categories.

Current kinds:

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

The taxonomy is extensible, but the current implementation keeps the category
set small and explicit.

### `PatternSignal`

`PatternSignal` represents small structural observations that support a
candidate.

Examples:

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

Signals are intended to remain:

- lightweight
- explicit
- composable into fingerprints

### `PatternFingerprint`

`PatternFingerprint` is the normalized comparison surface for a pattern.

Current fields include:

- `patternKind`
- `structuralSignals`
- `importSet`
- `exportShape`
- `symbolRole`
- `uiSignals?`
- `asyncSignals?`
- `responsibilitySignals?`

Fingerprints are used for similarity scoring, clustering, and precedent
ranking. Comparisons operate on this normalized data rather than raw code
bodies.

## Extraction

Pattern extraction is a deterministic indexing stage that runs after symbol and
import/export metadata collection.

Current behavior:

- inspects indexed files, symbols, and imports
- applies rule-based TypeScript and TSX detectors
- emits `PatternCandidate` records only when evidence is strong enough
- persists results to `/app/.data/generations/<generationId>/pattern-candidates.json`

The stage stays conservative. Files without strong evidence emit no patterns.

### Current Detectors

RepoRadar currently extracts patterns for detectors such as:

- React components
- custom hooks
- async data-flow helpers
- list rendering
- conditional rendering
- utility exports
- API handlers
- test suites
- Storybook stories

Detector evidence combines:

- Tree-sitter node shape
- indexed symbol metadata
- file import/export metadata
- path conventions where the signal is strong

Extraction is calibrated to avoid common noise cases:

- Storybook config and setup files are excluded from story detection
- API handler detection requires function-like route evidence rather than path
  naming alone
- wrapped components such as `forwardRef(...)` and `memo(...)` are recognized
- narrow framework-specific UI surfaces such as `not-found.tsx` are supported
- rendering-pattern extraction is conservative around local JSX helper noise

### Deduplication

Each detector emits at most one candidate per symbol and pattern-kind
combination.

Deduplication uses:

- `symbolId` when available, otherwise `fileId`
- `PatternKind`
- normalized structural signal set

This keeps extraction deterministic and compatible with incremental indexing.

## Repository And Storage

`PatternRepository` is the internal storage boundary for pattern candidates.

Current responsibilities:

- `registerPatternCandidate(...)`
- `getPatternsForFile(...)`
- `getPatternsForSymbol(...)`
- `listPatternsByKind(...)`
- `getPatternById(...)`

Patterns are stored in:

- `/app/.data/generations/<generationId>/pattern-candidates.json`

Pattern storage remains separate from the symbol index, code graph, and UI
artifacts while following the same persistence conventions.

## Similarity And Clustering

RepoRadar computes deterministic similarity between patterns of the same
`PatternKind`.

Similarity operates on normalized fingerprint fields such as:

- structural signal overlap
- supporting import overlap
- export shape
- symbol role
- optional UI signal overlap
- optional async signal overlap
- optional responsibility overlap

Raw code bodies are not compared.

### Similarity Scoring

The current similarity model uses weighted overlap plus several refinements that
help broad pattern families stay useful:

- stronger gating for high-volume kinds such as `component`, `hook`, and
  `async-data-flow`
- increased weight for import-set overlap
- a small representativeness adjustment that favors exported, richer patterns
  over minimal local helpers
- a same-file penalty for nearest-neighbor ranking so helpers do not dominate
  exported-symbol precedents
- symbol-name token similarity for kinds where naming carries structural meaning
- a small family boost when symbol-name similarity is strong
- small penalties when explicit responsibilities diverge

The result is a stable similarity score in the range `0.0` to `1.0`.

### Clustering

Clustering is intentionally simple and same-kind only.

Current behavior:

- only patterns with the same `PatternKind` are compared
- clusters form when similarity passes a stable threshold and shared evidence is
  strong enough
- each cluster records:
  - `clusterId`
  - `patternKind`
  - `memberPatternIds`
  - `representativePatternId`
  - `size`
  - `dominantSignals`

Cluster assignments are computed deterministically from the current pattern
corpus. They are used internally for inspection and precedent-quality work.

## Responsibility Signals

Responsibility signals add a lightweight approximation of what a symbol is doing
inside a broad structural family.

Current examples include:

- components:
  - `layout-component`
  - `ui-control`
  - `ui-select`
  - `ui-modal`
- hooks:
  - `query-hook`
  - `store-hook`
  - `dom-hook`
- async and service helpers:
  - `fetch-helper`
  - `service-crud`
- tests:
  - `test-component`
  - `test-hook`
  - `test-service`

These signals are derived from deterministic naming, import, path, and JSX
heuristics. They do not rely on NLP, embeddings, or runtime analysis.

Current use:

- similarity gives additional weight to responsibility overlap
- broad same-kind matches are penalized slightly when responsibilities diverge
- precedent ranking can favor candidates with matching responsibilities

Responsibility signals remain additive metadata. They refine ranking without
changing the core taxonomy.

## Precedent Discovery

`PrecedentDiscoveryService` retrieves strong internal examples for a symbol,
pattern, or file.

Current entrypoints include:

- `findPrecedentsForSymbol(...)`
- `findPrecedentsForPattern(...)`
- `findPrecedentsForFile(...)`

Current behavior:

- starts from extracted `PatternCandidate` records
- retrieves nearest same-kind neighbors through `PatternSimilarityService`
- enriches candidates with symbol and graph context
- filters identical-symbol matches
- de-emphasizes same-file precedents without banning them
- ranks candidates with a deterministic `precedentScore`

Precedent scoring currently combines:

- similarity score as the primary signal
- exported symbol bonus
- cross-file bonus
- usage-frequency bonus from the symbol index
- small graph-context bonuses for imported and re-exported files
- small path-family bonus
- responsibility-match bonus when applicable

Returned precedent candidates include:

- symbol and pattern identifiers
- file path
- pattern kind
- raw similarity score
- final precedent score
- explicit reason signals

This service remains internal. There is no public precedent MCP tool and no code
-generation layer built on top of it.

## Debugging And Inspection

The current implementation supports lightweight debug inspection for:

- pattern counts per file during extraction
- cluster membership and dominant signals
- precedent ranking explanations and reason signals

These are internal engineering aids rather than public interfaces.

## Boundaries

Pattern intelligence does not currently provide:

- public MCP pattern tools
- semantic embeddings
- LLM-based similarity
- clustering across incompatible pattern kinds
- automatic code generation
- automatic refactor planning from precedents

It is a deterministic internal capability that improves precedent discovery and
repository understanding while staying compatible with the rest of the indexed
stack.
