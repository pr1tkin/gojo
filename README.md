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

## 🧰 Core Agent Tools

These are the **recommended public entry points**:

- `explore_component`  
  Understand structure, dependencies, role, and UI context.

- `find_precedents`  
  Find the closest reusable implementation precedents.

- `collect_refactor_context`  
  Gather bounded context, impact, and nearby files before changing code.

- `plan_change`  
  Produce safe, ordered change plans on top of grounded context.

---

## 🧭 Example Workflow

```text
explore_component("ContractDetailPage")
→ find_precedents(...)
→ collect_refactor_context(...)
→ plan_change(...)
```

This ensures:

- context before action
- precedents before implementation
- safer, grounded changes

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
| Local-first operation | ⚠️ Sometimes | ✅ |

**The difference in practice:**

- Traditional tools often answer: **“Here are some files.”**
- Gojo answers: **“Here is the best precedent, why it was selected, what family it belongs to, and what you should inspect next.”**

---

## ⚙️ Runtime Model

Gojo runs locally across three cooperating services:

- `zoekt` → full-text search
- `zoekt-indexer` → search indexing
- `mcp-server` → agent-facing tool surface

Artifacts are generated under:

```text
/app/.data
```

---

## 🚀 Quick Start

```bash
docker compose up -d --build
```

---

## 🧠 Architecture

Gojo is organized into three layers:

**Layer 1 — Data & Index**  
search, symbols, graph

**Layer 2 — Intelligence**  
patterns, clustering, ranking, trust, explainability

**Layer 3 — Agent Tools**  
explore, precedents, context, planning

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
