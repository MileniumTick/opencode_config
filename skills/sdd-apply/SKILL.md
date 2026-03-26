---
name: sdd-apply
description: >
  Implement tasks from the checklist, write actual code following specs.
  Trigger: Time to write code that matches the spec.
---

# SDD Apply - Implementation

## Purpose

You are a sub-agent responsible for **IMPLEMENTATION**. You write actual code following specs and design strictly.

## Input You Receive

- Change name
- Tasks to implement (specific phase/batch)
- Spec from sdd-spec
- Design from sdd-design

## Auto-Detection

Before writing code, detect the project stack:

```
DETECT FROM:
├── package.json → Node/TypeScript stack
├── pyproject.toml → Python stack
├── go.mod → Go stack
├── Cargo.toml → Rust stack
└── Load matching domain skills
```

## Execution

### Step 1: Read Context

Before ANY code:
1. Read the SPEC - understand WHAT it must do
2. Read the DESIGN - understand HOW to structure it
3. Read existing code patterns in affected files

### Step 2: Detect TDD Mode

```
TDD ACTIVE IF:
├── openspec/config.yaml → rules.apply.tdd: true
├── User has tdd/SKILL.md installed
├── Project has test patterns (test/ alongside src/)
└── Default: standard mode
```

### Step 3: Implement (TDD Workflow)

If TDD detected, follow RED → GREEN → REFACTOR:

```
FOR EACH TASK:
├── RED: Write FAILING test first
│   ├── Test describes expected behavior from spec scenarios
│   ├── Run test → confirm it FAILS
│   └── If passes immediately → test is wrong or exists
│
├── GREEN: Write minimum code to pass
│   ├── Implement ONLY what's needed
│   ├── Run test → confirm it PASSES
│   └── Don't add extra functionality
│
├── REFACTOR: Clean up without changing behavior
│   ├── Improve structure, naming
│   ├── Run tests → confirm STILL PASS
│   └── Match project conventions
│
└── Mark task complete [x]
```

### Step 4: Implement (Standard Workflow)

If no TDD:

```
FOR EACH TASK:
├── Read task description
├── Read spec scenarios (acceptance criteria)
├── Read design decisions
├── Write code matching project patterns
├── Mark task complete [x]
└── Note any issues
```

### Step 5: Mark Tasks Complete

Update the tasks artifact:
```markdown
- [x] 1.1 Task description
- [ ] 1.2 Task still pending
```

## Output Format

```markdown
## Implementation: {change-name}

### Completed Tasks
- [x] 1.1 {description}
- [x] 1.2 {description}

### Files Changed
| File | Action | Description |
|------|--------|-------------|
| `path/file.ts` | Created | {what} |
| `path/other.ts` | Modified | {what changed} |

### Tests (if TDD)
| Task | Test File | RED | GREEN | REFACTOR |
|------|-----------|-----|-------|----------|
| 1.1 | test/file.spec.ts | ✅ Failed | ✅ Passed | ✅ Clean |

### Deviations from Spec
{List any places where implementation differs from spec and why}

### Issues Found
{Any problems during implementation}

### Remaining Tasks
- [ ] 2.1 {next task}

### Status
{N}/{total} complete. Ready for next batch / verify
```

## Result Contract

```
**Status**: success | partial | blocked
**Summary**: {X/Y tasks complete, files changed}
**Artifacts**: sdd/{change-name}/apply-progress
**Next**: sdd-apply (next batch) | sdd-verify
**Risks**: {issues found or "None"}
```

## Rules

- ALWAYS read spec BEFORE implementing
- ALWAYS follow design decisions
- ALWAYS match existing code patterns
- If TDD mode: NEVER skip RED (write failing test first)
- Load domain skills from ~/.agents/skills/ and FOLLOW them
- If spec/design is wrong, NOTE IT but implement as specified
- If blocked, STOP and report immediately
- Run relevant tests, not entire suite (for speed)
