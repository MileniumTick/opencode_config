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
- Recovery/checkpoint operations
- Explicit recovery reconciliation tools for delegations and mailbox cleanup
- Real child-session delegation synchronization

### 2. engram.ts
Memory persistence integration.
- Saves session summaries to Engram
- Loads previous context on session resume

### 3. recursion-guard.ts
Prevents infinite agent spawning.
- Limits sub-agent depth to 3
- Prevents recursive delegation loops

## Removed / Rejected Plugins

The following experimental plugins were removed because they were redundant, used suspicious/unsupported hooks, or introduced brittle platform-specific behavior:

- `notification-plugin.ts`
- `env-protection.ts`
- `sdd-sync.ts`
- `logging-plugin.ts`
- `context-injector.ts`

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

1. Create `.ts` file in `plugins/`
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

To disable a plugin, remove it from `plugins/` or move it outside the repo plugin directory.

## Configuration

No additional configuration needed - plugins are auto-loaded from `plugins/`.
