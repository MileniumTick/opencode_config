# Skill Registry

## Project: opencode

**Last Updated:** 2026-04-08

## Local Skills (opencode project)

| Skill | Location | Description |
|-------|----------|-------------|
| sdd-init | `skills/sdd-init/SKILL.md` | Bootstrap SDD context in any project |
| sdd-explore | `skills/sdd-explore/SKILL.md` | Investigate codebase and think through ideas |
| sdd-propose | `skills/sdd-propose/SKILL.md` | Create change proposals from explorations |
| sdd-spec | `skills/sdd-spec/SKILL.md` | Write detailed specifications from proposals |
| sdd-design | `skills/sdd-design/SKILL.md` | Create technical design from proposals |
| sdd-tasks | `skills/sdd-tasks/SKILL.md` | Break down specs and designs into tasks |
| sdd-apply | `skills/sdd-apply/SKILL.md` | Implement code changes from task definitions |
| sdd-verify | `skills/sdd-verify/SKILL.md` | Validate implementation against specs |
| sdd-archive | `skills/sdd-archive/SKILL.md` | Archive completed change artifacts |
| sdd-onboard | `skills/sdd-onboard/SKILL.md` | Guided walkthrough of SDD workflow |
| skill-creator | `skills/skill-creator/SKILL.md` | Create new AI agent skills |
| skill-registry | `skills/skill-registry/SKILL.md` | Scan and update skill registry |
| go-testing | `skills/go-testing/SKILL.md` | Go testing patterns (Gentleman.Dots) |
| issue-creation | `skills/issue-creation/SKILL.md` | GitHub issue creation workflow |
| branch-pr | `skills/branch-pr/SKILL.md` | PR creation workflow |
| judgment-day | `skills/judgment-day/SKILL.md` | Parallel adversarial review protocol |

## Shared Conventions

| File | Purpose |
|------|---------|
| `skills/_shared/openspec-convention.md` | File-based persistence (openspec mode) |
| `skills/_shared/engram-convention.md` | Engram persistence conventions |
| `skills/_shared/sdd-phase-common.md` | Common SDD phase patterns |
| `skills/_shared/skill-resolver.md` | Auto-load skills based on context |

## Project Configuration

- **Config File:** `opencode.json`
- **Tech Stack:** Bun runtime, TypeScript (minimal)
- **Persistence Backend:** Engram (MCP enabled)
- **SDD Mode:** engram (no openspec directory)