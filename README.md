# RepoRadar

RepoRadar is a local code-intelligence stack designed for coding agents.

It sits between raw code search and compiler-driven refactoring systems.

RepoRadar indexes repositories, extracts symbols and relationships, builds a deterministic code graph, and uses structural pattern intelligence to help an agent:

- understand repository structure
- compare existing implementations
- find strong internal precedents
- estimate safe change scope
- plan conservative edits

Instead of pretending to fully understand a program like a compiler, RepoRadar focuses on **practical repository intelligence** that works across real-world codebases.

The system combines:

- indexed search (Zoekt)
- syntax-aware symbol extraction (Tree-sitter)
- deterministic code graphs
- impact and ownership analysis
- change-planning workflows
- internal pattern similarity and precedent discovery

All exposed through **agent-oriented MCP tools**.

## System Architecture

```text
                AI Agent / Copilot
                        │
                        ▼
                   MCP Tools
     ┌───────────────────────────────────┐
     │ explore_component                 │
     │ search_patterns                   │
     │ analyze_symbol                    │
     │ collect_refactor_context          │
     │ plan_change                       │
     └───────────────────────────────────┘
                        │
                        ▼
                 Orchestrator Layer
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
    Search Layer   Structure Layer   Graph Layer
      (Zoekt)        (Tree-sitter)    (imports/exports)

                        ▼
                 Analysis Layer
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
     Impact         Ownership        Planning

                        ▼
             Internal Pattern Intelligence
        extraction → fingerprints → similarity
              → clustering → precedents
```

## Architecture Summary

RepoRadar uses a layered analysis model:

`Search -> Structure -> Graph -> Impact -> Ownership -> Planning`

Supporting that stack are two internal capability groups:

- UI structure signals for JSX and TSX composition and prop usage
- pattern intelligence for structural pattern extraction, similarity, and
  precedent discovery

These capabilities enrich the system without turning it into a compiler-backed
refactoring engine.

## Capabilities

- indexed repository search with Zoekt
- Tree-sitter symbol extraction with stable `fileId` and `symbolId`
- deterministic import and re-export graph construction
- ranked related-file and context assembly
- blast-radius estimation for direct and transitive dependents
- ownership and API-boundary approximation
- conservative change planning with ordered edit and review targets
- JSX and TSX UI hierarchy signals for exploration workflows
- internal pattern extraction, similarity, clustering, and precedent discovery
- agent-oriented retrieval through MCP tools

## MCP Tools

High-level agent workflows:

- `explore_component`
  - resolve a component or symbol and inspect related context
- `search_patterns`
  - find structurally related files and implementation precedents
- `analyze_symbol`
  - explain symbol role, export shape, and usage context
- `collect_refactor_context`
  - assemble bounded dependency context before editing
- `plan_change`
  - estimate safe change scope, risk, and ordered edit/review steps

RepoRadar also exposes lower-level retrieval tools such as `search_code`,
`open_file`, `list_symbols`, `find_symbol`, `find_references`, and
`find_related_files`.

## Example Workflow

```text
explore_component("AudioHero")
analyze_symbol("AudioHero")
collect_refactor_context("AudioHero")
plan_change("AudioHero")
```

Outcome:

- grounded symbol and file context
- likely collaborators and nearby structure
- conservative blast-radius and ownership hints
- safe change scope
- likely edit targets
- likely review targets
- ordered edit and review guidance

## Quick Start

### 1. Add repositories

RepoRadar expects local Git repositories under `./repos`.

```bash
mkdir repos
ln -s /path/to/my-project repos/my-project
```

### 2. Start the stack

```bash
docker compose up -d --build
```

This starts:

- `zoekt`
- `zoekt-indexer`
- `mcp-server`

### 3. Build and test the MCP server

```bash
cd mcp-server
npm install
npm run build
npm run test
```

### 4. Run the MCP server

```bash
npm run start
```

### 5. Call MCP tools

```text
explore_component("Button")
search_patterns({ "name": "Button", "mode": "component" })
analyze_symbol({ "name": "Button" })
collect_refactor_context({ "name": "Button", "mode": "component" })
plan_change({ "symbol": "Button", "filePath": "src/components/Button.tsx" })
```

## Documentation

- [Architecture](./docs/architecture.md)
- [Pattern Intelligence](./docs/architecture/pattern-intelligence.md)
- [Tools](./docs/tools.md)
- [Operations](./docs/operations.md)
- [Testing](./docs/testing.md)

## Repository Layout

- `mcp-server/`
  - MCP server, indexers, graph logic, orchestrator services, and tools
- `zoekt/`
  - Zoekt image and indexing entrypoint
- `repos/`
  - local repositories mounted into the stack
- `docs/`
  - architecture and operational documentation

## Boundaries

RepoRadar does not claim:

- compiler-complete semantic understanding
- guaranteed safe refactors
- automatic patch generation
- full runtime UI dependency analysis

It aims to be useful, conservative, and explainable.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
