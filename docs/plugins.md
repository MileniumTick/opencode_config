# Plugins Configuration

This document describes the plugins available in the OpenCode agent configuration.

## Overview

Plugins extend the functionality of the orchestrator by hooking into various events. They can:
- React to session events (created, compacted, idle, error)
- Intercept tool execution (before/after)
- Add custom tools
- Inject context into prompts

## Available Plugins

### 1. agent-teams-runtime.ts
Main orchestration plugin for team-based workflows.
- Manages team creation and coordination
- Task distribution across agents
- Delegation tracking
- Git work items synchronization

### 2. engram.ts
Memory persistence integration.
- Saves session summaries to Engram
- Loads previous context on session resume

### 3. recursion-guard.ts
Prevents infinite agent spawning.
- Limits sub-agent depth to 3
- Prevents recursive delegation loops

### 4. notification-plugin.ts
System notifications (macOS).
- `session.idle`: Notifies when session completes
- `session.error`: Notifies on errors
- `session.compacted`: Logs compaction events

### 5. env-protection.ts
Security plugin for protecting sensitive files.
- Blocks reading: `.env`, `.env.*`, `credentials.json`, etc.
- Blocks writing to protected files
- Warns on potentially sensitive files

### 6. sdd-sync.ts
SDD state synchronization.
- Tracks SDD artifacts (proposal.md, spec.md, etc.)
- Logs artifact creation
- Syncs state on session compaction

### 7. logging-plugin.ts
Structured logging for all operations.
- Logs session creation/completion
- Logs tool execution
- Logs errors and compaction

### 8. context-injector.ts
Injects project context into prompts.
- Adds project info to compaction prompts
- Includes security rules and conventions

## Hooks Reference

| Hook | When it fires |
|------|---------------|
| `session.created` | New session starts |
| `session.idle` | Session completes successfully |
| `session.error` | Session encounters error |
| `session.compacted` | Context is being compressed |
| `session.updated` | Session properties change |
| `session.deleted` | Session is deleted |
| `tool.execute.before` | Before a tool runs |
| `tool.execute.after` | After a tool completes |
| `file.edited` | File is modified |
| `message.updated` | Message content changes |
| `permission.asked` | Permission requested |
| `experimental.session.compacting` | Before compaction (custom) |

## Adding Custom Plugins

1. Create `.ts` file in `.config/opencode/plugins/`
2. Export a function matching the Plugin type
3. Return hooks in an object

```typescript
import type { Plugin } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    "session.created": async (input) => {
      // Your code here
    },
  }
}
```

## Disabling Plugins

To disable a plugin, rename the file (e.g., `notification-plugin.ts.bak`) or remove it from the plugins directory.

## Configuration

No additional configuration needed - plugins are auto-loaded from the plugins directory.