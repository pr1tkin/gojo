# RepoRadar

Local code-search stack for AI-assisted development using Zoekt, Tree-sitter, and an MCP server.

## ✨ Features

- Fast full-text search via Zoekt
- Structural symbol extraction via Tree-sitter
- MCP tool interface for AI agents
- Local repository indexing

## 🧠 Architecture

```text
repos/
   ↓
zoekt-indexer
   ↓
zoekt
   ↓
mcp-server (stdio MCP)
```

- `repos/` holds local Git repositories or first-level symlinks to them.
- `zoekt-indexer` builds and refreshes the search index automatically.
- `zoekt` serves indexed full-text search on port `6070`.
- `mcp-server` exposes the MCP tool surface over stdio.

## 🚀 Quickstart

```bash
git clone <repo-url> reporadar
cd reporadar
mkdir repos
# add or link repositories under repos/
docker compose up -d --build
```

Example repository link:

```bash
ln -s /path/to/my-project repos/my-project
```

Indexing runs automatically through the `zoekt-indexer` service. You can also trigger a one-shot reindex with `scripts/index-repos.sh`.

## 🔎 MCP Tools

- `search_code`
- `open_file`
- `list_symbols`
- `find_symbol`
- `find_references`
- `find_related_files`

## 📁 Project Structure

- `mcp-server` - TypeScript MCP server and symbol tooling
- `zoekt` - Zoekt image and indexing entrypoint
- `repos` - local repositories mounted into the stack
- `docs` - architecture, operations, and testing notes
- `scripts` - helper scripts such as manual reindexing

## 📚 Documentation

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/operations.md`](docs/operations.md)
- [`docs/testing.md`](docs/testing.md)

## 📄 License

No license file has been added yet.
