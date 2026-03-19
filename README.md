# Gojo

Gojo is an agent-first code intelligence engine that helps you understand,
navigate, and modify complex codebases.

It combines repository search, structural indexing, graph reasoning, pattern
intelligence, and planning into a single local-first system designed for coding
agents.

## What Is Gojo?

Gojo is built around a small public tool surface.

Agents should start with high-level workflow tools that reflect Gojo's actual
strengths:

- understand a component or file
- find reusable implementation precedents
- collect bounded refactor context
- plan a safe change

Low-level search and symbol tools still exist, but they are now treated as
internal or advanced tools rather than the default agent interface.

## Core Capabilities

- Understand components, files, and their surrounding structure
- Find strong local precedents for implementation reuse
- Analyze impact and nearby context before a refactor
- Plan safe, ordered changes with explicit risk signals

## Core Agent Tools

- `explore_component`
  - Understand structure, UI context, and role
- `find_precedents`
  - See how similar components, pages, hooks, or stores are implemented
- `collect_refactor_context`
  - Understand impact and surrounding code before a change
- `plan_change`
  - Generate a conservative edit and review plan

These four tools are the public MCP surface by default.

## Internal And Advanced Tools

The following tools remain supported, but they are hidden from the default tool
surface and are not intended for standard agent workflows:

- `search_code`
- `open_file`
- `list_symbols`
- `find_symbol`
- `find_references`
- `find_related_files`
- `analyze_symbol`
- `search_patterns`

To expose internal tools explicitly, start the MCP server with:

```bash
GOJO_INCLUDE_INTERNAL_TOOLS=true
```

Use that mode for debugging, product evaluation, or expert workflows only.

## Recommended Agent Flow

A normal agent workflow is:

1. `explore_component`
2. `find_precedents`
3. `collect_refactor_context`
4. `plan_change`

This is the supported high-level surface.

## Runtime Model

Gojo runs as three coordinated services against the same `repos/` mount:

- `zoekt`
  - serves indexed search over HTTP on `:6070`
- `zoekt-indexer`
  - builds and refreshes Zoekt shards
- `mcp-server`
  - publishes the structured generation under `/app/.data`
  - exposes the public agent tool surface over stdio

## Quick Start

```bash
docker compose up -d --build
```

## Architecture

Gojo is easiest to think about as three layers:

1. low-level primitives
2. intelligence
3. agent tools

Agents should interact with layer 3.

## Documentation

- [Architecture](./docs/architecture.md)
- [Pattern Intelligence](./docs/architecture/pattern-intelligence.md)
- [Operations](./docs/operations.md)
- [Testing](./docs/testing.md)
- [Tools](./docs/tools.md)
- [LICENSE.md](./LICENSE.md)
