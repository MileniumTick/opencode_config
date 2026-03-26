---
name: sdd-init
description: >
  Initialize project context, detect stack, build skill registry.
  Trigger: First time working on a project or when context is lost.
---

# SDD Init - Project Bootstrap

## Purpose

Initialize project context for SDD workflow. Detect the tech stack, load relevant skills, and prepare for task execution.

## Execution

### Step 1: Detect Project Stack

Read project files to detect technology stack:

```
DETECT FROM:
├── package.json         → Node/TypeScript/Bun
├── pyproject.toml       → Python
├── go.mod               → Go
├── Cargo.toml           → Rust
├── composer.json        → PHP
├── pom.xml / build.gradle → Java/Kotlin
└── Dockerfile           → Containerized
```

### Step 2: Load Domain Skills

Based on detected stack, auto-load relevant skills:

| Stack | Skills to Load |
|-------|----------------|
| React/Next.js | `frontend-react`, `tanstack-query`, `tanstack-router`, `vercel-react` |
| Node/Elysia | `backend-elysia`, `elysiajs` |
| PostgreSQL | `drizzle-orm`, `postgresql-optimization`, `sql-optimization` |
| Python | `python-best-practices` |
| Testing | `vitest`, `playwright-best-practices`, `testing-workflow` |
| Auth | `better-auth-best-practices` |
| UI | `ui-ux-pro-max`, `tailwind-design-system` |

### Step 3: Save Project Context

Save to memory (if available):

```
mem_save(
  title: "sdd-init/{project-name}",
  topic_key: "sdd-init/{project-name}",
  type: "config",
  content: "## Project Context\n\n### Stack\n- {detected stack}\n\n### Skills Loaded\n- {list of skills}\n\n### Conventions\n- {any conventions found}"
)
```

Also create `.atl/skill-registry.md` in project root:

```markdown
# Skill Registry: {project-name}

## Stack
- {stack}

## Domain Skills
| Domain | Skill | Path |
|--------|-------|------|
| Frontend | React | ~/.agents/skills/frontend-react |
| Backend | Elysia | ~/.agents/skills/backend-elysia |

## Commands
- `/sdd-new <name>` - Start new feature
- `/sdd-continue` - Continue next phase
- `/sdd-apply` - Implement tasks
- `/sdd-verify` - Verify quality
```

### Step 4: Report

## Output Format

```markdown
## Init Complete: {project-name}

### Detected Stack
- Runtime: {Node/Bun/Python/etc}
- Framework: {React/Elysia/Django/etc}
- Database: {PostgreSQL/MongoDB/etc}
- Testing: {Vitest/Playwright/etc}

### Skills Loaded
- ✅ {skill}
- ✅ {skill}

### Conventions Found
- {convention file}: {what it contains}

### Ready For
- Quick tasks: Use quick-delegate
- Features: /sdd-new {feature-name}
```

## Result Contract

```
**Status**: success | blocked
**Summary**: {project initialized, N skills loaded}
**Artifacts**: sdd-init/{project}
**Next**: quick-delegate | sdd-explore
**Risks**: {any or "None"}
```

## Rules

- Always detect stack BEFORE loading skills
- Save context to memory for persistence
- Create skill-registry.md for project
- If stack unclear, ask user
- Load MINIMUM skills needed, not all
