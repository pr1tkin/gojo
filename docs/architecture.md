# 🧠 Architecture

> Gojo is not a search engine. It is a **code understanding system**.

---

## ⚡ What this means

Gojo is built around a simple idea:

> Agents should not guess — they should operate on **grounded structure**.

The system is designed so that:

- **Layer 1** provides facts
- **Layer 2** provides interpretation
- **Layer 3** provides safe entry points

---

## 🏗️ System Layers

### Layer 1 — Data & Index

The **factual substrate**.

Includes:

- Zoekt full-text search
- Tree-sitter parsing
- symbol extraction (stable identities)
- file-level code graph
- UI structure (composition + props)
- generation health & freshness

Artifacts live under product-owned runtime directories:

```text
<gojo-home>/data
<gojo-home>/data/indexes
<gojo-home>/runtime
<gojo-home>/cache
```

Design principle:

> Missing data is better than wrong data.

---

### Layer 2 — Intelligence

Transforms structure into **agent-usable signals**.

Includes:

- pattern extraction & clustering
- similarity scoring
- precedent discovery
- ranking & trust calibration
- UI completeness signals
- explainability
- response shaping

Important:

> This layer is **not exposed directly**.

It exists to power **better decisions**, not APIs.

---

### Layer 3 — Agent Tools

The **public interface**.

#### 🥇 Primary tool

- `build_change_context`

The default workflow entry point.

#### 🥈 Specialist tools

- `explore_component`
- `find_precedents`
- `collect_refactor_context`
- `plan_change`

These tools already compose:

search + graph + ranking + trust + shaping

Agents should normally start with the primary tool and drop to specialist tools when they need tighter control.

---

## 🔁 Data Flow

```text
repos → indexing → symbols → graph → patterns
      → intelligence → ranking + trust
      → agent tools (MCP)
```

---

## ⚙️ Runtime

Three services:

- zoekt → search
- zoekt-indexer → indexing
- mcp-server → agent interface

---

## 🎯 Design Principles

- **Structure over text**
- **Deterministic over heuristic guesses**
- **Small outputs over verbose dumps**
- **Trust signals over hidden scoring**

---

## 🚫 Non-Goals

Gojo does NOT try to:

- fully understand runtime semantics
- replace compilers
- auto-generate code blindly
- expose every internal primitive

---

## 🧭 Mental Model

> Gojo is a **visibility engine**.

Not a generator.  
Not a search UI.

A system that answers:

- what this is
- how it connects
- what similar things exist
- what happens if you change it

---

## 📚 Related

- [README](../README.md)
- [Operations](./operations.md)
- [Testing](./testing.md)
- [Tools](./tools.md)
