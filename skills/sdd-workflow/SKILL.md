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
| `/sdd-new <name>` | Start new SDD flow (runs explore → propose) |
| `/sdd-continue` | Continue next missing phase in dependency chain |
| `/sdd-ff` | Fast forward: propose → spec → design → tasks |
| `/sdd-apply` | Execute tasks in batches |
| `/sdd-verify` | Run verification tests |
| `/sdd-archive` | Archive completed SDD |

## Phase Dependency Graph

```
proposal → specs → tasks → apply → verify → archive
              ↑
              |
            design
```

## Phase Outputs

Each phase returns:
```typescript
{
  status: "success" | "blocked" | "failed",
  executive_summary: "What was accomplished",
  artifacts: ["file paths or topic keys"],
  next_recommended: "Next phase to run",
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