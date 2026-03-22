# 👁️ Gojo

> Throughout heaven and earth, I alone see everything.

![License](https://img.shields.io/badge/license-MIT-blue)
![Local-first](https://img.shields.io/badge/local--first-yes-green)
![Agent-first](https://img.shields.io/badge/agent--first-yes-purple)
![MCP](https://img.shields.io/badge/MCP-ready-black)

Gojo is a **local-first, agent-first code intelligence engine** that gives developers and AI agents **real visibility into complex codebases**.

It doesn’t just show you code.

It shows you:

- what matters
- how things connect
- what will break if you change something

> You’re not debugging anymore — you’re seeing.

---

## ⚡ Above the Fold

**Gojo helps coding agents answer the questions that matter before they write code:**

- **Can I bundle the main context in one pass?** → `build_change_context`
- **What is this thing?** → `explore_component`
- **How has something like this already been built?** → `find_precedents`
- **What else is affected if I touch it?** → `collect_refactor_context`
- **What is the safest way to change it?** → `plan_change`

**Gojo is for understanding-first workflows:**
search → structure → precedents → context → plan

---

## 🔥 Why Gojo?

Most tools help you **search code**.

Gojo helps you:

- **understand it**
- **navigate it**
- **change it safely**

Gojo is built for the moment **before** generation:
when an agent or developer needs grounded context, not guesses.

---

## 🧠 What makes Gojo different?

- **Structural understanding** — not just text search
- **Graph-backed reasoning** — real relationships, not loose proximity
- **Precedent discovery** — find reusable implementation neighbors
- **Agent-first workflows** — compact outputs built for repeated tool use
- **Local-first execution** — your repos, your machine, your control

---

## 🛠️ Core Capabilities

Gojo helps agents:

- understand what a target is
- find the closest reusable precedent
- collect bounded change impact context
- turn grounded context into an edit plan
- bundle those steps when the workflow should stay compact

---

## 🥇 Primary Tool

### `build_change_context`

The default entry point.

Use it when the agent wants the whole picture in one pass:

- target summary
- best precedents
- refactor/change context
- optional plan generation when justified

Example:

```text
build_change_context({
  symbolName: "ContractDetailPage",
  repo: "sample-repo",
  intent: "refactor"
})
```

Use this first when the agent is asking:

- “What should I inspect before changing this?”
- “Give me the bundled context for this target.”
- “Show me the safest path forward without manually chaining tools.”

---

## 🥈 Specialist Tools

These remain fully public and fully usable.

They are the precision tools for agents that need tighter control.

### `explore_component`
Targeted structure inspection.
Use when the agent needs role, dependencies, UI context, or symbol ambiguity details.

### `find_precedents`
Targeted precedent lookup.
Use when the agent already understands the target and needs the best implementation peers.

### `collect_refactor_context`
Targeted impact/context gathering.
Use when the agent needs nearby files, graph neighbors, and likely coordinated change surfaces.

### `plan_change`
Targeted planning.
Use when the agent already has enough context and wants an ordered edit/review sequence.

---

## 🧭 Example Workflow

```text
Default path:
build_change_context("ContractDetailPage")

Fine-grained path:
explore_component("ContractDetailPage")
→ find_precedents(...)
→ collect_refactor_context(...)
→ plan_change(...)
```

This keeps the default path simple without taking precision away from specialist workflows.

---

## 🧪 Example Output (`find_precedents`)

```text
Target: ContractDetailPage
Grounding: strong

Top precedents:
1. CustomerDetailPage
2. ContractEditPage
3. CaseDetailPage

Next step:
→ open CustomerDetailPage first
```

Small. Focused. Actionable.

---

## 🆚 Why not Cody / traditional tools?

Gojo is **not trying to be another chat wrapper over code search**.

It is optimized for **deterministic code intelligence** and **agent grounding**.

| Capability | Traditional code tools | Gojo |
|---|---|---|
| Full-text search | ✅ | ✅ |
| Symbol awareness | ⚠️ Partial | ✅ |
| Code graph grounding | ❌ | ✅ |
| Precedent discovery | ❌ | ✅ |
| Trust / grounding signals | ❌ | ✅ |
| Agent-first response shaping | ❌ | ✅ |
| Bundled workflow context | ❌ | ✅ |
| Local-first operation | ⚠️ Sometimes | ✅ |

**The difference in practice:**

- Traditional tools often answer: **“Here are some files.”**
- Gojo answers: **“Here is the best entry point, the strongest precedent, the likely impact surface, and the next move.”**

---

## ⚙️ Runtime Model

Gojo runs locally across three cooperating services:

- `zoekt` → full-text search
- `zoekt-indexer` → search indexing
- `mcp-server` → agent-facing tool surface

Artifacts are generated under the product runtime directories:

```text
<gojo-home>/data
<gojo-home>/data/indexes
<gojo-home>/runtime
<gojo-home>/cache
```

---

## 🚀 Quick Start

Current official product surface:

- `gojo`
- `gojo mcp serve`

From this repository today, the quickest path is:

```bash
cd mcp-server
npm install
npm run build
npm exec gojo -- health
npm exec gojo -- mcp serve
```

Docker Compose remains available for repository development only. It is not the primary product entrypoint.

---

## 🧱 Architecture

Gojo is organized into three layers:

**Layer 1 — Data & Index**  
search, symbols, graph

**Layer 2 — Intelligence**  
patterns, clustering, ranking, trust, explainability

**Layer 3 — Agent Tools**  
one primary workflow tool + specialist tools for targeted control

Agents should interact with **Layer 3**.

---

## 🔒 Internal / Advanced Tools

Gojo also includes deeper internal tools for debugging and expert workflows.

They are **hidden by default** and are **not part of the standard agent surface**.

Enable them explicitly with:

```bash
GOJO_INCLUDE_INTERNAL_TOOLS=true
```

Examples include:

- `search_code`
- `open_file`
- `list_symbols`
- `find_symbol`
- `find_references`
- `find_related_files`
- `analyze_symbol`
- `search_patterns`

---

## 📚 Documentation

- [Architecture](./docs/architecture.md)
- [Operations](./docs/operations.md)
- [Testing](./docs/testing.md)
- [Tools](./docs/tools.md)

---

## 🧭 Philosophy

> Before you change code, you should understand it.

Understanding means:

- structure
- relationships
- precedents
- impact

Not guesses. Not hallucinations.

---

## ⭐ If this helps you

Give it a star — it helps more people discover Gojo.

---

## 📄 License

See [LICENSE.md](./LICENSE.md)
