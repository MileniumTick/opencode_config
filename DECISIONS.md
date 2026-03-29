# DECISIONS.md — Architecture Decisions & Change Log

This file records significant architectural decisions, configuration milestones, and resolved gaps.
It is **append-only** — new entries go at the top. Do not edit past entries.

For current system architecture, see [`AGENTS.md`](./AGENTS.md).

---

## [2026-03-29] Merge ORCHESTRATION.md into AGENTS.md

**Branch:** `feat/docs-canonical`

**Decision:** Deleted `ORCHESTRATION.md` and merged its unique content (delegation hierarchy tree, per-level capability summary, error handling specifics, skills table, slash commands reference) into `AGENTS.md` under a new `## Agent System Architecture` section. Eliminates drift risk between two architecture docs and gives contributors a single authoritative reference. Updated all cross-references in `CONTRIBUTING.md` and `DECISIONS.md`. Deleted untracked `opencode.json.bak`.

---

## [2026-03-29] Documentation Consolidation

**Branch:** `feat/docs-canonical`

**Problem:** Three documentation files (`AGENTS.md`, `ANALYSIS.md`, `ORCHESTRATION.md`) had overlapping content, stale gap-tracking, and a key contradiction — `AGENTS.md` described the repo as "config-only (JSON/JSONC)" while the repo's primary artifacts are Markdown agent prompt files.

**Decisions:**
- `AGENTS.md` rewritten as the canonical reference. Now accurately describes the repo as containing JSON config + Markdown agent prompts + slash commands.
- `ANALYSIS.md` converted to this `DECISIONS.md` file (append-only change log, not a mutable gap tracker).
- `CONTRIBUTING.md` created as the onboarding document, referenced from `AGENTS.md`.
- `ORCHESTRATION.md` retained as the architecture deep-dive (diagram, patterns, files list).
- Document reading order established: `AGENTS.md` → `CONTRIBUTING.md` → `ORCHESTRATION.md` → `DECISIONS.md`.

---

## [2026-03-28] System Completion — All Critical Gaps Closed

**Previous state:** ~75% (Spanish, missing domain leads)
**State after this pass:** ~90% (English, all critical gaps closed)

**Completed:**
- Created 7 domain lead agents: `backend-lead`, `frontend-lead`, `data-lead`, `security-lead`, `rust-lead`, `python-lead`, `devops-lead`
- Created `mobile-lead` and `golang-lead` domain lead agents
- Created `team-orchestrator` skill covering Levels 1, 2, and 3 with full routing tables
- Rewrote `team-lead.md` with full 3-level hierarchy, automatic domain routing, Plan-and-Execute pattern, and Task Ledger
- Added `mode: subagent` and relevant skills to all domain lead agent files
- Added domain-specific logic to all domain leads (language/framework awareness, tool preferences)
- Standardized retry protocol across all domain leads (uniform error handling and escalation)
- Added `engram_mem_save` calls to all domain leads for cross-session memory persistence
- Fixed `devops-lead` CI/CD routing bug — incorrect sub-agent delegation path corrected
- Added `tools` blocks to `product-owner.md` and `ui-ux-partner.md` (previously missing)
- Added skills to `ui-ux-partner.md` (`frontend-design`, `ui-ux-pro-max`, `web-design-guidelines`, `tailwind-design-system`)
- Applied tool restrictions in `opencode.json` for all agents — each agent only sees the tools it needs
- Added prompt injection defense directives to `team-lead.md` and worker agents

**Known remaining gaps (as of 2026-03-28, may since be resolved):**
- Real token/cost tracking — no metrics on actual token usage or per-agent cost attribution
- Langfuse or equivalent observability — no external tracing or evaluation framework
- `security.md` bash tools — automated scanners (`npm audit`, `pip-audit`, `trivy`) available but not prescribed in workflow

---

## [2026-03-25] Initial MCP Integration

**Decisions:**
- Selected Gitea MCP (`gitea-mcp`) for self-hosted Git operations at `gitea.istmocenter.com`
- Selected Plane MCP (`plane-mcp-server` via `uvx`) for project management at `plane.intranet.istmocenter.com`
- Selected Engram MCP for cross-session memory persistence
- Selected Context7 (remote) for framework/library documentation lookup
- All secrets stored in `.secrets/` (gitignored), referenced via `{file:.secrets/filename}` pattern
- AI provider: Ollama local with `qwen3:8b-16k` model

---

## Conventions Reference

| Convention | Value |
|------------|-------|
| Language | All documentation and agent prompts **in English** |
| Agent files | `agent/` directory (Markdown with YAML frontmatter) |
| Skills | `~/.agents/skills/` (external, not in this repo) |
| Main config | `opencode.json` |
| Secrets | `.secrets/` directory (gitignored — never commit) |
| Indentation | 2 spaces for all JSON/JSONC files |
| Commit style | Conventional Commits (use `conventional-commit` skill) |
