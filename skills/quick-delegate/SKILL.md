---
name: quick-delegate
description: >
  Fast delegation to domain skills for small tasks.
  Auto-detects stack and routes to the right skill.
---

# Quick Delegate - Fast Task Routing

## Purpose

For small tasks that don't need full SDD workflow, quickly delegate to the appropriate domain skill.

## Decision Matrix

Auto-detect which skill to use:

| Task Type | Trigger Words | Skill |
|-----------|---------------|-------|
| Create AGENTS.md | "create agents", "agents.md", "agent config" | `create-agentsmd` |
| Create README | "create readme", "new project readme" | `create-readme` |
| Frontend component | "component", "button", "modal", "UI" | `frontend-react` |
| Frontend state | "state", "store", "atom", "query" | `tanstack-query-best-practices` |
| Frontend routing | "route", "page", "navigation" | `tanstack-router-best-practices` |
| Frontend performance | "performance", "optimize", "bundle" | `vercel-react-best-practices` |
| Backend API | "endpoint", "route", "api", "handler" | `backend-elysia` |
| Backend patterns | "elysia", "plugin", "middleware" | `elysiajs` |
| Database schema | "schema", "table", "migration" | `drizzle-orm` |
| Database query | "query", "select", "join", "optimize" | `postgresql-optimization` |
| SQL query | "sql", "query", "select" | `sql-optimization` |
| Auth | "auth", "login", "oauth", "session" | `better-auth-best-practices` |
| Testing unit | "test", "unit", "spec" | `vitest` |
| Testing e2e | "e2e", "playwright", "cypress" | `playwright-best-practices` |
| Docker | "docker", "container", "deploy" | `docker-openserve` |
| Code review | "review", "refactor", "clean" | `sql-code-review` o `postgresql-code-review` |
| UI/UX | "design", "style", "animation" | `ui-ux-pro-max` |
| CSS/Tailwind | "css", "tailwind", "style" | `tailwind-design-system` |
| Python | "python", "py", "dataclass" | `python-best-practices` |
| Refactor code | "refactor", "improve", "cleanup" | `refactor` |
| Architecture | "architecture", "pattern", "clean" | `architecture-patterns` |
| Find skill | "find skill", "which skill", "need skill" | `find-skills` |

## Execution

### Step 1: Analyze Task

Quickly understand:
- What is the user asking for?
- What domain does it belong to?

### Step 2: Route to Skill

Use the matrix above to select the best skill.

### Step 3: Delegate

Call the skill:
```
skill(name="[detected-skill]")
```

### Step 4: Synthesize Result

Return a summary to the orchestrator:
```
**Status**: success | blocked
**Summary**: {what was done}
**Files**: {any files created/modified}
**Next**: none (task complete)
```

## When to Use Quick Delegate

✅ DO:
- Single file changes
- Bug fixes
- Small features
- Questions
- Code reviews
- Adding tests

❌ DON'T:
- Multi-file features
- Architectural changes
- Full-stack features
- Refactors affecting many files

For those → use full SDD workflow

## Result Contract

```
**Status**: success | blocked
**Summary**: {what was accomplished in 1-2 sentences}
**Files**: {files changed or "None"}
**Next**: none | sdd-new (if task is too large)
**Risks**: {any concerns or "None"}
```

## Example Flows

### Example 1: Fix bug
```
User: "Fix the login redirect bug"
→ Analyze: Bug fix, auth related
→ Route: skill(name="better-auth-best-practices")
→ Execute: Fix the issue
→ Return: Summary
```

### Example 2: Add component
```
User: "Add a Modal component"
→ Analyze: Frontend, UI component
→ Route: skill(name="frontend-react")
→ Execute: Create component
→ Return: Summary
```

### Example 3: Too large
```
User: "Add OAuth to the app"
→ Analyze: Large feature, multi-file
→ Return: "This requires SDD workflow. Should I start /sdd-new oauth-login?"
```
