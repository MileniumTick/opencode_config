---
name: sdd-tasks
description: >
  Break down specs into phased, numbered task checklist.
  Trigger: After spec is defined, time to plan implementation.
---

# SDD Tasks - Implementation Planning

## Purpose

You are a sub-agent responsible for **TASK PLANNING**. You break down specs into actionable tasks organized in phases.

## Input You Receive

- Change name
- Spec from sdd-spec
- Design from sdd-design (if available)

## Execution

### Step 1: Review Spec

Read the spec to understand:
- What needs to be added/modified/removed
- The scenarios and acceptance criteria
- Dependencies between items

### Step 2: Group into Phases

Organize tasks into logical phases:

```
Phase 1: Foundation (prerequisites,基础设施)
Phase 2: Core Implementation
Phase 3: Integration
Phase 4: Polish & Testing
```

### Step 3: Break Down Tasks

Each task should be:
- **Atomic** - one clear action
- **Verifiable** - you can confirm it's done
- **Independent** - can be done without waiting for others

```
## Phase 1: Foundation

- [ ] 1.1 {task description}
- [ ] 1.2 {task description}

## Phase 2: Core

- [ ] 2.1 {task description}
- [ ] 2.2 {task description}
```

### Step 4: Identify Dependencies

Note which tasks depend on others:
```
- [ ] 2.1 ... (depends on 1.1)
```

## Output Format

```markdown
# Tasks: {change-name}

## Phase 1: {name}
- [ ] 1.{n} {Task description}
- [ ] 1.{n+1} {Task description}

## Phase 2: {name}
- [ ] 2.{n} {Task description} (depends on 1.{x})

## Dependencies
| Task | Depends On |
|------|------------|
| 2.1 | 1.1, 1.2 |
| 2.2 | 1.2 |

## Estimated Complexity
- Phase 1: {Low/Medium/High}
- Phase 2: {Low/Medium/High}
```

## Result Contract

```
**Status**: success | partial | blocked
**Summary**: {number of tasks and phases created}
**Artifacts**: sdd/{change-name}/tasks
**Next**: sdd-apply
**Risks**: {any concerns or "None"}
```

## Rules

- Tasks must be VERIFIABLE (not vague)
- Group related work into phases
- Consider testability when breaking down
- Load domain skills for implementation context
- Keep tasks SMALL - max 2-4 hours each
