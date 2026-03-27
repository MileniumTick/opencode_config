---
name: sdd-workflow
description: Spec-Driven Development workflow commands and phase management
---

# SDD Workflow — Spec-Driven Development

## Overview

SDD is a structured planning layer for substantial changes. Use for features that require multiple files, coordination between frontend/backend, or architectural decisions.

## Commands

| Command | Action |
|---------|--------|
| `/sdd-new <name>` | Start new SDD flow (must land on canonical phases) |
| `/sdd-continue` | Continue next missing phase in dependency chain |
| `/sdd-ff` | Fast forward planning with outputs equivalent to explore/spec/tasks |
| `/sdd-apply` | Execute tasks in batches |
| `/sdd-verify` | Run verification tests |
| `/sdd-archive` | Archive completed SDD |

Canonical command set for this repository:

- `/sdd-init`
- `/sdd-explore <topic>`
- `/sdd-spec <name>`
- `/sdd-tasks`
- `/sdd-apply`
- `/sdd-verify`
- `/sdd-archive`
- `/sdd-new <name>` (shortcut)
- `/sdd-continue` (phase advance)
- `/sdd-ff` (planning fast-forward with equivalent artifacts)

## Phase Dependency Graph

```
init → explore → spec → tasks → apply → verify → archive
```

Normative reference: `specs/contracts/runtime-operating-contract-v1.md` (§3).

## Phase Outputs

Each phase returns:
```typescript
{
  status: "success" | "partial" | "blocked",
  summary: "What was accomplished",
  artifacts: ["file paths or topic keys"],
  next: "Next phase to run",
  risks: ["Known issues or blockers"]
}
```

## When to Use SDD

- New feature affecting multiple files
- Backend + frontend coordination needed
- Architectural changes
- Complex refactors

## When NOT to Use SDD

- Quick fixes (single file)
- Simple questions
- Small bug fixes

## Skill Loading

When in SDD flow, also load:
- `monorepo-bun` — for workspace context
- `contract-typebox` — for schema decisions
- `backend-elysia` or `frontend-react` — as needed
