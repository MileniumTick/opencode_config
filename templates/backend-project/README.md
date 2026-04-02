# Backend Project Template

## Purpose
Use this template for backend/API projects where implementation speed, code quality, and reliability are the primary goals.

## Recommended Agents
- `@team-lead` (orchestration)
- `@backend-lead` (backend architecture and routing)
- `@dev` (implementation)
- `@qa` (test validation)
- `@security-lead` / `@security` (auth, vulnerability checks)

## Recommended MCP Servers
- `context7` — framework/library documentation lookup
- `engram` — persistent memory for decisions and session continuity
- `gitea` — repo operations, PR/issue workflows
- `plane` — task/work item tracking

## Recommended Tools
- `glob`, `grep`, `read` (code discovery)
- `apply_patch` (targeted code edits)
- `bash` (tests, lint, typecheck, build)
- `context7_*` (up-to-date framework docs)

## docs/ai-work Usage
- **Small task (single session):** update `docs/ai-work/SESSIONS.md` + `DECISIONS.md`
- **Medium/Large task:** initialize `docs/ai-work/changes/<slug>/` and maintain `spec.md`, `tasks.md`, `verify.md`, `notes.md`

## Starter Checklist
- [ ] Confirm scope, constraints, and success criteria
- [ ] Identify affected modules and interfaces
- [ ] Add/update tests before or alongside implementation
- [ ] Implement incrementally with small verifiable changes
- [ ] Run lint/typecheck/tests locally
- [ ] Capture decisions and gotchas in `docs/ai-work`
- [ ] Prepare clear PR summary with risks and verification evidence
