# 🧰 Tools

> The tool surface is intentionally **small**.

---

## 🎯 Core Tools (Public)

### explore_component
Understand structure, dependencies, role.

### find_precedents
Find best implementation examples.

### collect_refactor_context
Understand impact.

### plan_change
Generate safe changes.

---

## 🧠 Why only these?

They already combine:

- search
- graph
- ranking
- trust

---

## 🔒 Internal Tools

Hidden behind:

```bash
GOJO_INCLUDE_INTERNAL_TOOLS=true
```

Includes:

- search_code
- open_file
- list_symbols
- find_symbol
- find_references
- find_related_files
- analyze_symbol
- search_patterns

---

## ⚙️ Response Design

- small outputs
- shared context
- trust signals
- short reasoning

---

## 🧭 Recommended Flow

```text
explore_component
→ find_precedents
→ collect_refactor_context
→ plan_change
```

---

## 🧪 Debug Strategy

1. try debug mode
2. inspect reasoning
3. use internal tools only if needed

---

## 🎯 Principle

> Fewer tools → better agents.
