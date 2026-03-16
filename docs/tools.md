# Tools

## Overview

RepoRadar exposes a small set of public MCP tools on top of its search, symbol, graph, ranking, and orchestrator layers.

The high-level tools are designed for AI coding agents and developers who need structured repository context rather than raw text search alone.

Current high-level tools:

- `explore_component`
- `search_patterns`
- `collect_refactor_context`
- `analyze_symbol`

RepoRadar also includes lower-level primitives such as `search_code`, `open_file`, `list_symbols`, `find_symbol`, `find_references`, and `find_related_files`.

## `explore_component`

Purpose:

- entry-point component exploration
- file structure and dependency discovery

Use it when you want to answer questions like:

- what file implements this component or symbol?
- what files should I open next?
- what does this file export?

Returns structured context such as:

- resolved primary file
- resolved primary symbol
- related files
- defined symbols
- exported symbols
- a concise exploration summary

This is typically the first high-level tool to call when starting work in an unfamiliar area.

## `search_patterns`

Purpose:

- repository precedent discovery
- similar implementation search

Use it when you want to answer questions like:

- how is this usually done in this repository?
- what existing components or files should I imitate?
- what similar feature bundles already exist?

Returns structured context such as:

- resolved primary target
- ranked pattern matches
- explainable reasons for each match
- symbol and export summaries for the matched files

This is heuristic pattern discovery. It does not claim deep AST or JSX semantic similarity.

## `collect_refactor_context`

Purpose:

- refactor impact surface assembly
- importer and import relationship discovery

Use it when you want to answer questions like:

- if I change this file or component, what else should I inspect first?
- what depends on this target?
- what files does this target directly depend on?

Returns structured context such as:

- primary file
- importing files
- imported files
- graph neighbors
- ranked related files
- nearby directory or bundle-family files
- summary counts for local impact

This is bounded refactor context, not full semantic impact analysis.

## `analyze_symbol`

Purpose:

- structured symbol analysis
- symbol identity, role, and usage context

Use it when you want to answer questions like:

- what is this symbol?
- is it exported or local?
- where is it defined and what nearby symbols matter?
- does it look feature-local or broadly shared?

Returns structured context such as:

- primary symbol and file
- symbol kind and export status
- grounded role summary
- importing and imported file context
- related files
- nearby and sibling symbols
- safer usage summaries that distinguish file-level proxy usage from verified symbol-level references when reference data is unavailable

This is structured symbol analysis, not full semantic or reference-complete program understanding.

## Typical Workflow

A practical sequence for agent-driven repository work is:

1. `explore_component`
   - identify the main implementation file and surrounding collaborators
2. `search_patterns`
   - find repository-local precedents before generating or reshaping code
3. `collect_refactor_context`
   - inspect likely impact surface before editing
4. `analyze_symbol`
   - clarify the role and usage context of specific symbols encountered during the task

## Lower-Level Tools

RepoRadar also exposes lower-level MCP tools for direct inspection:

- `search_code`
- `open_file`
- `list_symbols`
- `find_symbol`
- `find_references`
- `find_related_files`

These are useful for fine-grained retrieval, while the high-level tools package common agent workflows into structured results.

## Scope And Limits

RepoRadar's tool layer is intentionally practical and bounded.

Current tools do not claim:

- full semantic program understanding
- full reference completeness
- call-graph analysis
- deep JSX or UI-structure understanding

They are designed to provide explainable code intelligence for real repository workflows using the signals the system actually has today.
