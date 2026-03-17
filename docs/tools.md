# Tools

## Overview

RepoRadar exposes a focused MCP toolset on top of the current runtime model:

`Search -> Structure -> Graph -> Impact -> Ownership -> Planning`

The MCP server is the agent-facing entry point. It serves stdio tools backed by
published generation artifacts under `/app/.data`, while search-oriented tools
query Zoekt and interpret freshness through the shared coordination state.

Public tools:

- `search_code`
- `open_file`
- `list_symbols`
- `find_symbol`
- `find_references`
- `find_related_files`
- `explore_component`
- `search_patterns`
- `collect_refactor_context`
- `analyze_symbol`
- `plan_change`

## Lower-Level Retrieval Tools

### `search_code`

Purpose:

- query Zoekt for fast repository-scale search

Notes:

- uses the Zoekt service rather than MCP-persisted structure artifacts
- search results should be interpreted together with the current search freshness state

### `open_file`

Purpose:

- read a file from the mounted repositories

### `list_symbols`

Purpose:

- list symbols discovered in a file or repository context

### `find_symbol`

Purpose:

- resolve symbol candidates from the published symbol index

### `find_references`

Purpose:

- retrieve conservative symbol reference context

### `find_related_files`

Purpose:

- rank nearby or structurally related files for exploration

## High-Level Workflow Tools

### `explore_component`

Purpose:

- entry-point exploration for a component, file, or symbol

Builds on:

- symbol resolution
- related-file ranking
- file-level defined and exported symbols
- optional UI hierarchy aggregation

Output summary:

- primary file and symbol
- related files
- defined symbols
- exported symbols
- optional `uiHierarchy` summary with rendered children, parent components, and observed prop names
- concise exploration summary

Example:

```text
explore_component("LandingHero")
```

### `search_patterns`

Purpose:

- find repository-local precedents and structurally similar implementations

Builds on:

- symbol and file resolution
- graph neighbor signals
- naming and file-family heuristics
- explainable ranking signals

Output summary:

- resolved target
- ranked matches
- reasons for each match
- symbol and export summaries for matched files

Example:

```text
search_patterns({ "name": "LandingHero", "mode": "component" })
```

### `analyze_symbol`

Purpose:

- explain a symbol's identity, role, and surrounding usage context

Builds on:

- symbol resolution
- export status and symbol kind
- file-level graph relationships
- related-file ranking
- nearby and sibling symbols in the defining file

Output summary:

- primary symbol and file
- symbol kind and export status
- role summary
- importing and imported file context
- nearby and sibling symbols
- usage summary

Example:

```text
analyze_symbol({ "name": "LandingHero", "file": "src/components/LandingHero.tsx" })
```

### `collect_refactor_context`

Purpose:

- assemble bounded refactor context before a change

Builds on:

- direct importers and imports
- direct re-export chains
- graph neighbors
- related-file ranking
- nearby same-directory or bundle-family files

Output summary:

- primary file
- importing files
- imported files
- graph neighbors
- related files
- nearby files
- summary counts for local impact

Example:

```text
collect_refactor_context({ "name": "LandingHero", "mode": "component" })
```

### `plan_change`

Purpose:

- expose the planning layer as an agent-facing workflow

Builds on:

- impact analysis
- ownership detection
- graph-derived dependency ordering
- additive UI review hints when available

Output summary:

- target symbol and file
- change scope
- change risk
- planning signals
- primary edit files
- secondary edit files
- review files
- ordered edit and review plan
- compact agent summary

`plan_change` does not rewrite code or guarantee refactor safety.

Example:

```text
plan_change({ "symbol": "LandingHero", "filePath": "src/components/LandingHero.tsx" })
```

## Typical Workflow

A practical workflow is:

1. `explore_component` to resolve the target and nearby structure.
2. `search_patterns` to find local precedents.
3. `analyze_symbol` to understand role and usage.
4. `collect_refactor_context` to bound the dependency surface.
5. `plan_change` to estimate safe scope and review order.

## Practical Limits

RepoRadar tools are intentionally conservative.

They do not claim:

- full semantic program understanding
- compiler-complete rename or refactor support
- complete reference precision in every repository shape
- automatic safe refactors
- guaranteed correctness of every heuristic plan

They are designed to provide useful, explainable repository intelligence over
the currently published MCP generation and the current Zoekt snapshot.
