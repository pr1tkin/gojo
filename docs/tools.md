# 🧰 Tools

> The tool surface is intentionally small, but it is no longer flat.

---

## 🥇 Primary Tool

### `build_change_context`

The default entry point for most agent workflows.

Use it when the agent wants a bundled answer to the whole question:

- what this target is
- what similar implementations already exist
- what else may be affected
- whether a plan is justified already

Think of it as the high-level API.

---

## 🥈 Specialist Tools

These tools remain public, stable, and fully usable.

They exist for agents that need precise control over one part of the workflow.

### `explore_component`
Inspect structure, role, dependencies, UI context, and ambiguity.

### `find_precedents`
Inspect reusable implementation peers and precedent families.

### `collect_refactor_context`
Inspect nearby files, graph neighbors, and likely coordinated change surfaces.

### `plan_change`
Turn grounded context into an ordered edit/review sequence.

---

## 🧠 Why this split?

Because Gojo now has two valid operating modes:

- **default workflow mode** → start with `build_change_context`
- **precision mode** → pick the specialist tool that matches the exact question

That keeps the entry surface clearer without taking flexibility away.

---

## 🔒 Internal Tools

Hidden behind:

```bash
GOJO_INCLUDE_INTERNAL_TOOLS=true
```

Includes:

- `search_code`
- `open_file`
- `list_symbols`
- `find_symbol`
- `find_references`
- `find_related_files`
- `analyze_symbol`
- `search_patterns`

These are internal building blocks and expert/debug tools, not the default agent surface.

---

## ⚙️ Response Design

All public tools use the same normalized response contract.

That means agents can expect:

- the same top-level envelope
- compact evidence
- consistent diagnostics
- reusable next actions
- mode-stable shaping across `agent` and `debug`

---

## 🧭 Recommended Flow

```text
Default path:
build_change_context

Specialist path:
explore_component
→ find_precedents
→ collect_refactor_context
→ plan_change
```

---

## 🧪 Debug Strategy

1. start with the primary tool unless the task is clearly narrow
2. switch to a specialist tool when you need precision
3. use debug mode before reaching for internal tools
4. use internal tools only when the public surface is not enough

---

## 🎯 Principle

> Fewer entry points. Sharper specialist tools. Better agents.