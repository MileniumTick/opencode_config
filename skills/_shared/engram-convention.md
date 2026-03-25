---
name: engram-convention
description: Naming conventions for Engram persistent memory
---

# Engram Convention

## Deterministic Format

All Engram observations MUST use the following format:

### Topic Key Format

```
sdd/{change-name}/{artifact-type}
```

### Components

| Component | Description | Rules |
|-----------|-------------|-------|
| `sdd` | Prefix indicating SDD workflow artifact | Always `sdd` |
| `{change-name}` | Identifier for the change | kebab-case, max 64 chars |
| `{artifact-type}` | Type of artifact | See artifact types below |

### Artifact Types

| Type | Description | Example |
|------|-------------|---------|
| `spec` | Specification document | `sdd/oauth-integration/spec` |
| `task-list` | Task breakdown | `sdd/user-auth/task-list` |
| `implementation` | Code implementation | `sdd/api-rate-limit/implementation` |
| `verification` | Test results | `sdd/migration-postgres/verification` |
| `summary` | Session/archive summary | `sdd/refactor-auth/summary` |
| `decision` | Architecture decision | `sdd/choose-state-mgmt/decision` |
| `observation` | Generic observation | `sdd/bug-login/observation` |

## Session ID Format

Sessions follow this pattern:

```
sdd-{change-name}-{timestamp}
```

### Example

```
sdd-oauth-integration-20260115-143022
```

## Two-Step Recovery Protocol

When recovering from context loss or compaction:

### Step 1: Session Context Recovery

```typescript
// First, get recent sessions
const sessions = await mem_context({ limit: 10 })

// Find sessions matching the change name
const relevantSessions = sessions.filter(s =>
  s.id.includes(changeName)
)
```

### Step 2: Artifact Recovery

```typescript
// Then, search for artifacts by topic key
const artifacts = await mem_search({
  query: `sdd/${changeName}`,
  type: 'artifact'
})

// Retrieve full content
for (const artifact of artifacts) {
  const full = await mem_get_observation(artifact.id)
  // Reconstruct context
}
```

## Include Inline Calls

For non-Claude systems, include inline calls to Engram:

### mem_save Prompt Format

When calling from external systems, use this format:

```
ENGRAM_CALL: mem_save
---
title: {title}
type: {artifact-type}
content: |
  **What**: {description}
  **Why**: {motivation}
  **Where**: {file-paths}
  **Learned**: {gotchas}
topic_key: sdd/{change-name}/{artifact-type}
---
```

### Example (GitHub Actions)

```yaml
- name: Save artifact to Engram
  run: |
    curl -X POST "$ENGRAM_API/observations" \
      -H "Authorization: Bearer $ENGRAM_TOKEN" \
      -d '{
        "title": "oauth-implementation-complete",
        "type": "implementation",
        "content": "**What**: OAuth flow implemented\n**Why**: User request\n**Where**: src/auth/*\n**Learned**: None",
        "topic_key": "sdd/oauth-integration/implementation"
      }'
```

### Example (CI/CD)

```bash
# Save decision to Engram
engram-cli save \
  --title "chose-postgres-over-mongodb" \
  --type "decision" \
  --content "**What**: Selected PostgreSQL over MongoDB..." \
  --topic-key "sdd/choose-db/decision"
```

## Best Practices

### DO

- Use consistent change-name across all artifacts for a single change
- Include file paths in **Where** section
- Add **Learned** section with any gotchas
- Use `mem_session_summary` at end of every session

### DON'T

- Use spaces in topic keys (use hyphens)
- Mix change-names within same workflow
- Skip **Learned** section (use "None" if nothing learned)
- Use relative paths (always absolute)

## Engram API Reference

### Available Functions

| Function | Purpose |
|----------|---------|
| `mem_save` | Save observation with topic key |
| `mem_search` | Full-text search across observations |
| `mem_context` | Get recent session context |
| `mem_get_observation` | Retrieve full observation by ID |
| `mem_session_summary` | Save end-of-session summary |
| `mem_session_start` | Register session start |
| `mem_session_end` | Mark session complete |

### Query Patterns

```typescript
// Find all artifacts for a change
const results = await mem_search({
  query: `sdd/${changeName}`,
  limit: 20
})

// Find by type
const specs = await mem_search({
  query: 'spec',
  type: 'artifact'
})

// Recent sessions
const context = await mem_context({ limit: 5 })
```

## Validation

All Engram calls MUST:

1. Use absolute paths (workdir-based)
2. Include topic_key in format `sdd/{change-name}/{type}`
3. Use kebab-case for change-name
4. Specify type from artifact types table
5. Handle API failures gracefully (fallback to filesystem)
