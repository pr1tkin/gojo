# 📊 Gojo Benchmarks (v0.2.x)

> Real-world performance, semantic quality, and usefulness — measured on actual repositories.

---

## 🧪 Benchmark Setup

All benchmarks were executed:

- on **Ubuntu (WSL2)**
- with **native Zoekt search helpers**
- using **local-first execution**
- on **fresh runtime environments per repository**

Repositories:

| Repo | Type | Size |
|------|------|------|
| `vercel/next.js` | Large framework | ~28k files |
| `nextjs-monorepo-example` | Real-world app | ~435 files |

---

## ⚡ Performance

### Large repo (`next.js`)

| Command | Latency |
|--------|--------|
| `explore` | ~7–8s |
| `build_change_context` | ~7–8s |
| `plan_change` | ~8–10s |

**Before:** timeouts (~120s)  
**Now:** bounded, usable (~8s)

---

### Monorepo

| Command | Latency |
|--------|--------|
| `explore` | ~2.7–3.0s |
| `build_change_context` | ~3–4s |
| `plan_change` | ~2–4s |

**Target:** <5s → achieved

---

## 🧠 Quality

### Cross-file understanding

- Accurate direct consumers
- API-aware propagation (client → route → service)
- High recall across files
- Clean separation:
  - direct (exact)
  - indirect (inferred)
  - related (exploratory)

---

### Example

```
explore getHostname

Direct consumers:
  packages/next/src/server/api-utils/index.ts
  packages/next/src/server/route-modules/pages-api/module.ts

Related context:
  additional server utilities
```

---

## 🧱 Runtime Correctness

Gojo does not guess its state.

| State | Meaning |
|------|--------|
| `unknown` | no index |
| `ready` | fully usable |
| `degraded` | partial but usable |
| `stale` | needs refresh |

- No false "ready"
- No false "unknown"
- Degraded is surfaced honestly

---

## 📦 Output Contract

All tools return the same structure:

```json
{
  "direct_consumers": {},
  "indirect_consumers": {},
  "related_context": {}
}
```

- no legacy fields
- no hidden fallbacks
- consistent across CLI, JSON, MCP, and agent usage

---

## 🧠 Usefulness

### Real developer tasks

| Task | next.js | monorepo |
|-----|--------|---------|
| Where is this used? | 4/5 | 5/5 |
| What breaks if I change X? | 3/5 | 5/5 |
| Understand component | 3/5 | 4/5 |
| Full change context | 3/5 | 5/5 |

---

## 🔥 Key Result

Gojo now works on real-world large codebases.

---

## ⚖️ Tradeoffs

Gojo intentionally prefers:

**usable + honest**  
over  
**complete + slow**

Large repos use focused mode:

- strong evidence first
- bounded context
- optional planning
- no fake completeness

---

## 📉 Known Limitations

- Some large-repo queries still approach ~8–10s latency
- Certain API-heavy patterns can produce broader context
- Full exhaustive context is intentionally skipped on large repos

---

## 🧾 Verdict

**Strong improvement**

Gojo v0.2.x is:

- fast enough to use interactively
- correct in its reasoning
- honest in its limitations
- consistent across all interfaces

---

## ⭐ Why this matters

Most tools show you code.

Gojo shows you:

- what matters
- how it connects
- what will break

In one pass.
