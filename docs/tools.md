# Tools

## Overview

Gojo now exposes two tool classes:

1. public core tools
2. internal or advanced tools

The MCP server registers only the public core tools by default.

Internal tools are available only when the server is started with:

```bash
GOJO_INCLUDE_INTERNAL_TOOLS=true
```

That separation is enforced at registration time, not just documented.

## Public Core Tools

These are the recommended agent entry points.

### `explore_component`

Purpose:

- understand the structure and context of a component, file, or symbol

Use it for:

- first-pass understanding
- UI context
- related file discovery

### `find_precedents`

Purpose:

- find the strongest reusable implementation precedents

Use it for:

- implementation lookup
- family discovery
- precedent-guided edits

### `collect_refactor_context`

Purpose:

- assemble bounded impact context before a change

Use it for:

- importer and dependency context
- neighboring runtime files
- refactor preparation

### `plan_change`

Purpose:

- generate a conservative edit and review plan

Use it for:

- change scoping
- risk-aware sequencing
- edit and review order

## Internal And Advanced Tools

These tools remain supported, but they are not part of the default agent tool
surface:

- `search_code`
- `open_file`
- `list_symbols`
- `find_symbol`
- `find_references`
- `find_related_files`
- `analyze_symbol`
- `search_patterns`

When exposed through `GOJO_INCLUDE_INTERNAL_TOOLS=true`, their tool metadata is
prefixed with:

- `[INTERNAL] Not intended for direct agent use`

They are intended for:

- debugging
- product evaluation
- expert workflows
- low-level inspection when the core tools are not enough

## Recommended Workflow

A normal workflow should stay inside the public surface:

1. `explore_component`
2. `find_precedents`
3. `collect_refactor_context`
4. `plan_change`

This keeps the agent on top of Gojo's strongest abstractions instead of
manually orchestrating low-level primitives.

## Deprecation Guidance

Low-level tools are still supported.

They are not removed, but they are no longer the recommended interface for
standard agent workflows.
