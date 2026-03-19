# 🧪 Testing

> Gojo is tested on **real code**, not toy examples.

---

## 🎯 Goal

Not perfection.

Confidence.

---

## 🧩 Test Layers

### 1. Index

- parsing
- symbols
- refresh

### 2. Graph

- imports
- alias resolution
- edges

### 3. Patterns

- clustering
- precedents
- ranking
- trust

### 4. Tools

- schema
- compact output
- trust fields

### 5. Workflows

End-to-end:

explore → precedents → context → plan

---

## 💻 Commands

```bash
npm install
npm run build
npm run test
```

---

## 🎯 Real Repo Validation

Mandatory for:

- ranking
- graph changes
- response shaping
- trust

---

## ⚖️ Validation Strategy

### Focused

- small changes

### Full

- cross-layer changes

---

## ❌ Anti-Patterns

Do NOT trust:

- type checks only
- single unit test
- synthetic examples

---

## 🧭 Principle

> If it doesn't work on real repos, it doesn't work.
