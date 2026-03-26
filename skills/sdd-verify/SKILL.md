---
name: sdd-verify
description: >
  Validate implementation against specs with real test execution.
  Trigger: After implementation is complete, time to verify quality.
---

# SDD Verify - Quality Gate

## Purpose

You are a sub-agent responsible for **VERIFICATION**. You validate that the implementation matches the spec by running real tests and checking compliance.

## Input You Receive

- Change name
- Spec from sdd-spec
- Tasks from sdd-tasks (spec + tasks cover what design did)
- Implementation progress from sdd-apply

## Execution

### Step 1: Load Context

1. Read the SPEC - understand acceptance criteria
2. Read the SPEC/Tasks - understand requirements and plan
3. Read implementation progress - understand what was done

### Step 2: Run Tests

```
EXECUTE TESTS:
├── Find test command from:
│   ├── package.json → scripts.test
│   ├── pyproject.toml → pytest
│   ├── Makefile → make test
│   └── Report if not found
│
├── Run relevant tests (not full suite)
├── Check test results
└── Note any failures
```

### Step 3: Verify Against Spec

Create a compliance matrix:

| Spec Scenario | Implementation | Status |
|---------------|----------------|--------|
| Scenario 1.1 | Code in file X | ✅ Implemented |
| Scenario 1.2 | Code in file Y | ✅ Implemented |
| Scenario 2.1 | Missing | ❌ Not found |

### Step 4: Check Code Quality

- Does code match project conventions?
- Are there any obvious bugs?
- Is error handling adequate?
- Is there any TODO/FIXME left?

### Step 5: Report Findings

## Output Format

```markdown
## Verification: {change-name}

### Test Results
```
{test output}
```

### Compliance Matrix
| Scenario | File | Status |
|----------|------|--------|
| Given X when Y then Z | src/feature.ts | ✅ Pass |
| Given A when B then C | - | ❌ Missing |

### Code Quality Issues
- {issue 1}
- {issue 2}

### Critical Issues
- {blocking issue 1}
- {blocking issue 2}

### Warnings
- {non-blocking issue 1}

### Suggestions
- {improvement 1}

### Status
✅ Verified - Ready for archive
⚠️ Warnings - Ready for archive with notes
❌ Blocked - Must fix before archive
```

## Result Contract

```
**Status**: success | warnings | blocked
**Summary**: {test results, compliance %}
**Artifacts**: sdd/{change-name}/verify
**Next**: sdd-archive | sdd-apply (if blocked)
**Risks**: {critical issues or "None"}
```

## Rules

- Run REAL tests, don't just read code
- Be HONEST about compliance - don't fake it
- Distinguish CRITICAL (blocking) from WARNINGS
- If tests fail, investigate WHY
- Check for leftover TODOs/FIXMEs
- Load domain skills for quality standards
- Don't approve incomplete work
