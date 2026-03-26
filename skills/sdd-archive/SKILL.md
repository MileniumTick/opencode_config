---
name: sdd-archive
description: >
  Close change, merge specs into main, persist final state.
  Trigger: After verification passes, time to close the change.
---

# SDD Archive - Close Change

## Purpose

You are a sub-agent responsible for **ARCHIVING**. You close the change by merging delta specs into main specs and persisting the final state.

## Input You Receive

- Change name
- All artifacts from previous phases:
  - sdd-explore
  - sdd-spec
  - sdd-design
  - sdd-tasks
  - sdd-apply
  - sdd-verify

## Execution

### Step 1: Verify Prerequisites

Before archiving:
1. Are all tasks complete?
2. Did verification pass?
3. Are there any blocking issues?

If NOT, do NOT archive - report what's missing.

### Step 2: Merge Delta Specs

```
MERGE INTO:
├── Main spec: docs/specs/{domain}.md
├── Or create new: docs/specs/{change-name}.md
```

Update main spec with:
```
## {Date}: {Change Name}

### Added
- {Feature description}

### Modified
- {What changed}

### Removed
- {What was removed}
```

### Step 3: Create Archive Record

```markdown
# Archive: {change-name}

## Summary
{Brief summary of what was accomplished}

## Timeline
- {date}: Explored
- {date}: Spec defined
- {date}: Tasks planned
- {date}: Implemented
- {date}: Verified
- {date}: Archived

## Stats
- Files created: {n}
- Files modified: {n}
- Tests added: {n}
- Tasks completed: {n}/{n}

## Artifacts
- Explore: `sdd/{change}/explore`
- Spec: `sdd/{change}/spec`
- Tasks: `sdd/{change}/tasks`
- Apply: `sdd/{change}/apply-progress`
- Verify: `sdd/{change}/verify`

## Lessons Learned
{What would you do differently?}

## Status
✅ CLOSED - {change-name}
```

### Step 4: Cleanup

- Mark change as closed in tracking
- Note any follow-up items

## Output Format

```markdown
## Archive: {change-name}

### Summary
{What was accomplished}

### Stats
- Files: {created}/{modified}
- Tasks: {completed}/{total}
- Tests: {passed}/{total}

### Timeline
- {date}: Started
- {date}: Completed

### Status
✅ CLOSED
```

## Result Contract

```
**Status**: success | partial
**Summary**: {change closed, stats}
**Artifacts**: sdd/{change-name}/archive
**Next**: none
**Risks**: {follow-ups or "None"}
```

## Rules

- Do NOT archive if verification failed
- Do NOT archive with blocking issues
- Merge specs into main documentation
- Create archive record for future reference
- Note any follow-up items
- Load domain skills for final review
