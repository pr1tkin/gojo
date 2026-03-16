# Tools

## Overview

RepoRadar exposes a small set of MCP tools on top of a layered code-intelligence stack:

`Search -> Structure -> Graph -> Impact -> Ownership -> Planning`

The public tools are designed for agent-assisted repository understanding and safe refactor planning. They return structured context instead of raw search output whenever possible.

High-level public tools:

- `explore_component`
- `search_patterns`
- `analyze_symbol`
- `collect_refactor_context`
- `plan_change`

RepoRadar also includes lower-level support tools such as `search_code`, `open_file`, `list_symbols`, `find_symbol`, `find_references`, and `find_related_files`.

## `explore_component`

Purpose:

- entry-point repository exploration for a component, file, or symbol

Typical use cases:

- identify the main implementation file
- inspect nearby collaborators
- understand what a file exports

Input:

- `name`
- optional `repo`
- optional `limit`
- optional `relatedLimit`

Output summary:

- primary file and symbol
- related files
- defined symbols
- exported symbols
- optional `uiHierarchy` summary with:
  - rendered child components
  - parent components that render the target
  - commonly observed prop names
- concise exploration summary

Example:

```text
explore_component("AudioHero")
```

## `search_patterns`

Purpose:

- find repository-local precedents and structurally similar implementations

Typical use cases:

- look for existing implementations to imitate
- compare feature bundles or similar components
- ground code generation in repository conventions

Input:

- `name`
- optional `repo`
- optional `mode`
- optional `limit`

Output summary:

- resolved target
- ranked matches
- explainable reasons for each match
- symbol and export summaries for matched files

Example:

```text
search_patterns({ "name": "AudioHero", "mode": "component" })
```

## `analyze_symbol`

Purpose:

- explain a symbol's identity, role, and usage shape

Typical use cases:

- determine whether a symbol is local or exported
- inspect nearby symbols and surrounding context
- understand whether a symbol looks feature-local or broadly shared

Input:

- `name`
- optional `repo`
- optional `file`
- optional `limit`

Output summary:

- primary symbol and file
- symbol kind and export status
- role summary
- importing and imported file context
- nearby and sibling symbols
- usage summary

Example:

```text
analyze_symbol({ "name": "AudioHero", "file": "src/app/_components/audio/AudioHero.tsx" })
```

## `collect_refactor_context`

Purpose:

- assemble bounded refactor context before a change

Typical use cases:

- inspect what depends on a target
- inspect what the target depends on
- collect nearby files before editing

Input:

- `name`
- optional `repo`
- optional `mode`
- optional `limit`

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
collect_refactor_context({ "name": "AudioHero", "mode": "component" })
```

## `plan_change`

Purpose:

- expose the planning layer as an agent-facing workflow

Typical use cases:

- estimate the safest expected scope of a change
- separate likely edit targets from review-only files
- understand change risk before modifying code
- follow an ordered edit and review sequence

Input:

- `symbol`
- optional `filePath`
- optional `repo`
- optional `mode`

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

`plan_change` does not rewrite code or guarantee refactor safety. It exposes a conservative plan built from impact analysis, ownership detection, and graph signals.

Example:

```text
plan_change({ "symbol": "AudioHero", "filePath": "src/app/_components/audio/AudioHero.tsx" })
```

## Typical Workflow

A practical high-level workflow is:

1. `explore_component`
   - find the main implementation and nearby collaborators
2. `search_patterns`
   - find repository precedents
3. `analyze_symbol`
   - clarify symbol role and usage
4. `collect_refactor_context`
   - inspect bounded dependency context
5. `plan_change`
   - estimate safe scope, risk, and ordered edit/review steps

## Lower-Level Tools

RepoRadar also exposes lower-level MCP primitives:

- `search_code`
- `open_file`
- `list_symbols`
- `find_symbol`
- `find_references`
- `find_related_files`

These are useful when an agent needs direct retrieval rather than a higher-level workflow result.

## Scope And Limits

RepoRadar tools are intentionally practical and bounded.

They do not claim:

- full semantic program understanding
- compiler-complete rename or refactor support
- full reference completeness
- automatic safe refactors
- guaranteed correctness of all change plans

They are designed to provide conservative, explainable code intelligence for real repository workflows.
