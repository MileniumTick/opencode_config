# Content Project Template

## Purpose
Use this template for documentation, technical writing, product messaging, and content workflows that require consistency and speed.

## Recommended Agents
- `@team-lead` (orchestration)
- `@content-lead` (content strategy and quality)
- `@tech-writer` (drafting/editing)
- `@research-lead` (fact validation and source support)
- `@dev` (doc tooling or automation updates)

## Recommended MCP Servers
- `context7` — technical accuracy for framework/tool references
- `engram` — preserve style, decisions, and recurring conventions
- `gitea` — doc versioning and review workflows
- `plane` — editorial planning and work tracking

## Recommended Tools
- `glob`, `grep`, `read` (content inventory and consistency checks)
- `apply_patch` (direct edits to docs/content)
- `webfetch` (source verification)
- `bash` (lint/check scripts for docs if available)

## docs/ai-work Usage
- **Small task (single session):** log in `docs/ai-work/SESSIONS.md` + `DECISIONS.md`
- **Medium/Large task:** use `docs/ai-work/changes/<slug>/` with `spec.md`, `tasks.md`, `verify.md`, `notes.md`

## Starter Checklist
- [ ] Define audience, objective, and desired action
- [ ] Confirm voice/tone and format requirements
- [ ] Gather source-of-truth technical/product inputs
- [ ] Draft concise structure before full writing
- [ ] Review for factual accuracy and clarity
- [ ] Ensure consistency with existing docs/style
- [ ] Capture key decisions and follow-ups in `docs/ai-work`
