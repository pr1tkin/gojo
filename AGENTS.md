# AGENTS.md

## Project goal
This repository provides a local code-search stack for local repositories using:
- Zoekt for fast indexed code search
- Tree-sitter for syntax-aware symbol extraction
- an MCP server exposing tools for coding agents

## Architecture source of truth
Read `docs/architecture.md` first before making changes.

## Rules
- Keep diffs scoped to the requested milestone
- Do not introduce unrelated refactors
- Prefer simple, explicit code over abstractions
- Keep Docker setup minimal and reproducible
- Use TypeScript in the MCP server
- Explain assumptions briefly before coding if something is unclear
- After changes, summarize what was implemented and which files changed

## Validation
- Run install/build commands where possible
- If something cannot be executed, say so explicitly
- Do not claim something works unless it was actually verified