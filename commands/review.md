---
description: Run a multi-agent code review on current changes or a specific branch
---

Perform a structured code review by delegating to specialized agents in parallel. The argument is optional — if provided, it should be a branch name or commit range.

**Usage:**
- `/review` → review changes vs HEAD (current branch)
- `/review feature/my-branch` → review changes in that branch vs main

## Execution Plan

Delegate the following tasks **in parallel**:

### 1. @exploration — Code Analysis
Investigate the changed files and provide:
- Summary of what changed and why
- Architecture impact (new patterns, breaking contracts, coupling introduced)
- Complexity assessment (cyclomatic complexity, dependency depth)
- Dead code or unreachable paths introduced

### 2. @security — Security Review
Scan the changes for:
- OWASP Top 10 vulnerabilities
- Hardcoded secrets, tokens, credentials
- Insecure dependencies or imports
- Authentication/authorization regressions
- SQL injection, XSS, CSRF vectors

### 3. @qa — Quality Review
Validate:
- Test coverage for changed code (are new paths tested?)
- TypeScript type safety / linting issues
- Missing edge cases in business logic
- Performance regressions (N+1 queries, unnecessary re-renders, blocking calls)

## Output Format

After collecting results from all three agents, consolidate into this report:

```
## Code Review Report

### Summary
[2-3 sentences describing the change]

### Code Quality      [✅ / ⚠️ / ❌]
[key findings from @exploration and @qa]

### Security          [✅ / ⚠️ / ❌]
[key findings from @security]

### Test Coverage     [✅ / ⚠️ / ❌]
[coverage impact from @qa]

### Action Items
| Priority | Issue | File | Line |
|----------|-------|------|------|
| HIGH     | ...   | ...  | ...  |
| MEDIUM   | ...   | ...  | ...  |
| LOW      | ...   | ...  | ...  |

### Verdict
- ✅ APPROVED — ready to merge
- ⚠️ APPROVED WITH COMMENTS — address action items before merge
- ❌ CHANGES REQUIRED — must fix HIGH priority items before proceeding
```
