# ⚙️ Operations

> If Gojo feels wrong, it's usually **indexing, freshness, or health**.

---

## 🚀 Product Start

Official product entrypoints:

- `gojo`
- `gojo mcp serve`

Repository-local example:

```bash
cd mcp-server
npm run build
node dist/gojo.js health
node dist/gojo.js mcp serve
```

## 🧰 Dev Stack

Docker Compose is retained for development and infrastructure debugging only.

```bash
docker compose up -d --build
docker compose logs zoekt
docker compose logs zoekt-indexer
docker compose logs mcp-server
```

---

## 🧠 How Gojo actually works

There are **two independent pipelines**:

### 1. Search (Zoekt)

- full-text index
- runs on interval
- separate freshness

### 2. Structure (MCP)

- symbols
- graph
- UI signals
- patterns
- trust

---

## 🔁 Structural Refresh

Outputs:

```
<gojo-data>/current-generation.json
<gojo-data>/current-health.json
```

---

## 💾 Persistence

Volumes:

- mcp-server-data
- zoekt-index
- refresh-coordination

---

## 🧪 Modes

### Normal Mode

Only core tools exposed.

### Debug Mode

```bash
GOJO_INCLUDE_INTERNAL_TOOLS=true
```

---

## 🧪 Debugging Responses

```json
{ "detail": "debug" }
```

---

## ❤️ Health Model

Check:

```
<gojo-data>/current-health.json
```

States:

- healthy
- degraded
- inconsistent
- unknown

---

## 🔍 Common Issues

### Search outdated

- run `gojo refresh --repo <repo>`
- check health
- check dev-stack logs only if you are debugging the Compose environment

### MCP weak output

- check /repos mount
- check health
- rerun refresh

### Wrong tool surface

- check GOJO_INCLUDE_INTERNAL_TOOLS

---

## 🧭 Validation Flow

Always test via:

1. explore_component
2. find_precedents
3. collect_refactor_context
4. plan_change

---

## 🪟 Windows Note

Use:

- Git Bash
- WSL

---

## 🎯 Principle

> If you debug with internal tools first, you're doing it wrong.

Always start from the **public surface**.
