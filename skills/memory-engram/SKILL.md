---
name: memory-engram
description: Engram persistent memory protocol - how to save and retrieve context across sessions
---

# Engram — Persistent Memory Protocol

## Overview

Engram is a persistent memory system that survives across sessions and compactions. Use it to remember decisions, discoveries, and context.

## When to Save (Mandatory)

Call `mem_save` immediately after:
- Bug fix completed
- Architecture or design decision made
- Non-obvious discovery about the codebase
- Configuration change or environment setup
- Pattern established (naming, structure, convention)
- User preference or constraint learned

## mem_save Format

```typescript
mem_save({
  title: "Verb + what — short, searchable",
  type: "bugfix | decision | architecture | discovery | pattern | config | preference",
  scope: "project" | "personal",
  topic_key: "optional stable key like architecture/auth-model",
  content: {
    What: "One sentence — what was done",
    Why: "What motivated it (user request, bug, performance, etc.)",
    Where: "Files or paths affected",
    Learned: "Gotchas, edge cases, things that surprised you"
  }
})
```

## When to Search

When the user asks to recall something:
1. First call `mem_context` — checks recent session history (fast, cheap)
2. If not found, call `mem_search` with relevant keywords
3. If you find a match, use `mem_get_observation` for full content

Also search proactively when:
- Starting work on something that might have been done before
- The user's first message references past work
- Context seems missing

## Session Close Protocol

Before ending a session, call `mem_session_summary`:

```typescript
mem_session_summary({
  Goal: "What we were working on this session",
  Instructions: "User preferences or constraints discovered",
  Discoveries: ["Technical findings, gotchas"],
  Accomplished: ["Completed items with key details"],
  NextSteps: ["What remains for the next session"],
  RelevantFiles: ["path/to/file — description"]
})
```

## After Compaction

If you see "FIRST ACTION REQUIRED" in context:
1. Call `mem_session_summary` with compacted content
2. Then call `mem_context` to recover additional context
3. Only then continue working