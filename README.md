# 👁️ Gojo

> Throughout heaven and earth, I alone see everything.

Gojo is a local-first code intelligence engine that gives agents and developers  
**complete visibility into complex codebases**.

It combines search, symbol analysis, graph reasoning, and pattern intelligence  
into a single system — designed for **understanding, not just lookup**.

---

## ✨ What makes Gojo different?

Most tools show you files.

Gojo shows you:

- what matters
- how things connect
- what will break if you change something

> You’re not debugging anymore — you’re seeing.

---

## ⚡ Core Capabilities

- 🔍 High-performance repository search (Zoekt)
- 🧠 Syntax-aware symbol extraction (Tree-sitter)
- 🕸️ Deterministic code graph from imports & exports
- 📊 Pattern intelligence & precedent discovery
- 🤖 Agent-oriented workflows and context assembly
- ⚙️ Local-first, Docker-based architecture

---

## 🧠 One Query → Full Context

Instead of asking:

- where is this defined?
- who uses it?
- what depends on it?

Gojo answers all of them in one coherent view.

---

## 🔌 Example Workflow

```ts
const component = await explore_component({
  symbol: "WorkspaceCasesExportActions"
})

const symbol = await analyze_symbol({
  symbolId: component.symbolId
})

const patterns = await search_patterns({
  query: "export modal pattern"
})
```

---

## 🧩 Recommended Agent Flow

Before changing code:

1. explore_component
2. analyze_symbol
3. search_patterns
4. collect_refactor_context
5. plan_change

> Prefer understanding over guessing.

---

## 🏗️ Runtime Model

Gojo runs as three coordinated services against the same `repos/` mount:

### 🔍 zoekt
- serves indexed search over HTTP (`:6070`)
- reads shards from `/data/index`

### 🛠️ zoekt-indexer
- scans `/repos`
- writes search shards to `/data/index`
- maintains freshness state

### 🧠 mcp-server
- runs over stdio
- builds structured repository model
- publishes artifacts under `/app/.data/generations/<generationId>/`
- coordinates search refresh via marker files

Gojo separates:
- search (Zoekt)
- structure (MCP server)

and synchronizes them through fingerprints and coordination files.

---

## 🚀 Quick Start

```bash
docker compose up -d --build
```

Mount your repositories → start exploring immediately.

---

## 🧠 Architecture Philosophy

> Code understanding should be structured, not guessed.

Gojo combines:

- Search (Zoekt)
- Syntax (Tree-sitter)
- Graph (dependencies & relationships)
- Patterns (real-world precedents)
- Orchestration (agent workflows)

---

## 🧲 Positioning

Gojo is a lightweight, modular alternative to systems like Sourcegraph Cody —  
focused on clarity, composability, and agent-first workflows.

---

## ⚠️ Status

Actively evolving toward:

- better coverage
- smarter ranking
- deeper agent workflows

---

## 💡 Vision

> No blind spots. No guesswork. Just understanding.

Gojo aims to become the foundation layer for intelligent coding agents.

---

## Documentation

- [Architecture](./docs/architecture.md)
- [Pattern Intelligence](./docs/architecture/pattern-intelligence.md)
- [Operations](./docs/operations.md)
- [Testing](./docs/testing.md)
- [Tools](./docs/tools.md)

## License

- [LICENSE.md](./LICENSE.md)
