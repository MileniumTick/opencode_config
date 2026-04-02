# Research Project Template

## Purpose
Use this template for structured investigations: competitive analysis, technical discovery, feasibility studies, and option comparison.

## Recommended Agents
- `@team-lead` (orchestration)
- `@research-lead` (research framing and synthesis)
- `@exploration` (codebase/system investigation)
- `@product-owner` / `@business-analyst` (requirements and value framing)
- `@tech-writer` (final report clarity)

## Recommended MCP Servers
- `context7` — authoritative framework/tool documentation
- `engram` — preserve findings and rationale across sessions
- `gitea` — link findings to repo artifacts/issues
- `plane` — track research questions and deliverables

## Recommended Tools
- `webfetch` (external references and primary sources)
- `glob`, `grep`, `read` (internal evidence gathering)
- `apply_patch` (research notes/report updates)
- `bash` (light validation commands where relevant)

## docs/ai-work Usage
- **Small task (single session):** capture findings in `docs/ai-work/SESSIONS.md` + `DECISIONS.md`
- **Medium/Large task:** create `docs/ai-work/changes/<slug>/` and use `spec.md` (questions/scope), `tasks.md`, `verify.md`, `notes.md`

## Starter Checklist
- [ ] Define the core research question and decision to support
- [ ] Set explicit scope boundaries and exclusions
- [ ] Collect internal and external evidence sources
- [ ] Compare options with clear criteria and tradeoffs
- [ ] Validate assumptions and highlight unknowns
- [ ] Document decisions and rationale in `docs/ai-work`
- [ ] Produce concise recommendations and next actions
