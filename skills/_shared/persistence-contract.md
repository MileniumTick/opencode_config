---
name: persistence-contract
description: Contract for cross-session persistence in agent workflows
---

# Persistence Contract

## Mode Resolution Rules

Persistence mode is resolved in the following priority order:

1. **Environment Variable** — `PERSISTENCE_MODE` env var
2. **Project Config** — `.opencode.json` or `opencode.json` in project root
3. **Global Config** — `~/.config/opencode/persistence.json`
4. **Default** — `hybrid`

### Resolution Algorithm

```
function resolvePersistenceMode(): PersistenceMode {
  const envMode = process.env.PERSISTENCE_MODE
  if (envMode && VALID_MODES.includes(envMode)) {
    return envMode
  }

  const projectConfig = readProjectConfig()
  if (projectConfig?.persistence?.mode) {
    return projectConfig.persistence.mode
  }

  const globalConfig = readGlobalConfig()
  if (globalConfig?.persistence?.mode) {
    return globalConfig.persistence.mode
  }

  return 'hybrid'
}
```

## Persistence Modes

### 1. `engram`
- Primary: Engram memory system
- Fallback: None (fails if Engram unavailable)
- Use when: Full semantic memory across sessions required

### 2. `openspec`
- Primary: Filesystem artifacts in `.atl/` directory
- Fallback: None
- Use when: Pure filesystem-based tracking preferred

### 3. `hybrid` (DEFAULT)
- Primary: Engram if available
- Fallback: `.atl/` filesystem
- Use when: Best of both worlds, resilient to failures

### 4. `none`
- No cross-session persistence
- Use when: Testing or ephemeral environments

## Sub-Agent Context Protocol

When delegating to sub-agents, the orchestrator MUST include:

```typescript
interface DelegationContext {
  session_id: string        // Unique per-orchestration session
  persistence_mode: PersistenceMode
  artifact_base: string     // e.g., ".atl"
  change_name: string      // Current change identifier
  engram_available: boolean // Whether Engram is accessible
}
```

### Context Propagation

```
Orchestrator → Sub-Agent:
  - Pass full context in initial prompt
  - Include artifact paths for writes
  - Specify persistence mode preference

Sub-Agent → Orchestrator:
  - Return artifacts with explicit paths
  - Include mem_save calls if using Engram
  - Follow Result Contract for all responses
```

## Fallback Chain

The complete fallback chain for artifact persistence:

```
1. Engram (if mode: engram OR hybrid AND available)
   ↓ (if fails or unavailable)
2. .atl/ directory (if mode: openspec OR hybrid)
   ↓ (if fails or unavailable)
3. Memory-only (session only)
   ↓ (if mode: none)
4. No persistence (error logged)
```

### Fallback Selection Logic

```typescript
function selectPersistenceBackend(
  mode: PersistenceMode,
  engramAvailable: boolean
): PersistenceBackend {
  if (mode === 'none') {
    return { type: 'none' }
  }

  if (mode === 'engram' && engramAvailable) {
    return { type: 'engram' }
  }

  if (mode === 'openspec') {
    return { type: 'filesystem', path: '.atl/' }
  }

  // hybrid (default)
  if (engramAvailable) {
    return { type: 'engram' }
  }

  return { type: 'filesystem', path: '.atl/' }
}
```

## Artifact Storage Conventions

### Engram Storage

- **Topic Key Format**: `sdd/{change-name}/{artifact-type}`
- **Session ID Format**: `sdd-{change-name}-{timestamp}`
- **Observation Type**: `artifact`

### Filesystem Storage

- **Base Path**: `.atl/`
- **Structure**: See `openspec-convention.md`

## Validation Requirements

All persistence operations MUST validate:

1. **Write Validation**
   - Directory exists or can be created
   - Write permissions available
   - Path is absolute (no relative paths)

2. **Read Validation**
   - File/directory exists
   - Read permissions available
   - Content is parseable (if applicable)

3. **Mode Validation**
   - Mode is one of: `engram`, `openspec`, `hybrid`, `none`
   - Required backends are accessible

## Error Handling

| Error | Action |
|-------|--------|
| Engram unavailable + mode:engram | Fail with error |
| Filesystem write fails | Try Engram if hybrid |
| Both unavailable | Log error, continue with memory-only |
| Invalid mode | Default to `hybrid` |

## Configuration File Format

### Global (~/.config/opencode/persistence.json)

```json
{
  "persistence": {
    "mode": "hybrid",
    "engram": {
      "enabled": true,
      "project": "opencode"
    },
    "filesystem": {
      "base": ".atl"
    }
  }
}
```

### Project (.opencode.json)

```json
{
  "persistence": {
    "mode": "hybrid",
    "changeBase": ".atl/changes"
  }
}
```
