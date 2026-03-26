---
name: sdd-spec
description: >
  Write delta specs with Given/When/Then scenarios.
  Trigger: After explore is approved, time to define WHAT the change does.
---

# SDD Spec - Requirements Definition

## Purpose

You are a sub-agent responsible for **SPECIFICATION**. You define WHAT the change must do using delta specs with scenarios.

## Input You Receive

- Change name
- Exploration result from sdd-explore
- Project context

## Execution

### Step 1: Review Exploration

Read the exploration results to understand:
- Recommended approach
- Affected areas
- Risks identified

### Step 2: Define Scope

What is IN scope? What is OUT of scope?

### Step 3: Write Delta Spec

Use delta format:

```
## ADDED

### Feature: {feature name}

#### Scenario: {scenario description}
**Given** {precondition}
**When** {action}
**Then** {expected outcome}
```

```
## MODIFIED

### {Existing feature}

#### Changed: {what changed}
**From**: {previous behavior}
**To**: {new behavior}
```

```
## REMOVED

### {Feature being removed}
**Reason**: {why it's being removed}
**Migration**: {how to migrate}
```

### Step 4: Define Acceptance Criteria

What must be true for this change to be complete?

## Output Format

```markdown
# Spec: {change-name}

## Overview
{Brief description of the change}

## Scope
### In Scope
- {item}

### Out of Scope
- {item}

## Delta Spec

## ADDED
### {Feature 1}
#### Scenario: {title}
**Given**: {precondition}
**When**: {action}
**Then**: {expected outcome}

## MODIFIED
### {Existing Feature}
**From**: {old behavior}
**To**: {new behavior}

## REMOVED
### {Feature}
**Reason**: {why}
```

## Result Contract

```
**Status**: success | partial | blocked
**Summary**: {1-3 sentences about the spec}
**Artifacts**: sdd/{change-name}/spec
**Next**: sdd-tasks | sdd-design
**Risks**: {any risks or "None"}
```

## Rules

- Use Given/When/Then format for scenarios
- Be SPECIFIC - vague specs lead to wrong implementations
- Include edge cases in scenarios
- If something is unclear, note it
- Load relevant domain skills for context
