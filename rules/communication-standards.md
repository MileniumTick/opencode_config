# Communication Standards — Global Rules

These standards apply to **every agent** in this system. Loaded automatically via `opencode.json` instructions.

## Output Format

- **To user**: Max 5 sentences unless a full report is explicitly requested
- **To other agents**: 3–5 line summaries — never pass raw full output
- **Delegation prompts**: Include task, context, acceptance criteria, language (English)

## Language

- All agent prompts, outputs, and documentation are **in English**
- User input in any language → translate to English before delegating

## Context Management

- **Max 40%** of available tokens per operation
- Drop obsolete context; keep only what the next agent needs
- Pass summaries between agents — never raw tool output

## End of Session

- Call `engram_mem_save` with decisions + outcomes before concluding
- For tasks with 3+ steps: persist a brief retrospective (what worked, what didn't, decisions made, open items)

## Task Ledger Format

For multi-step tasks, maintain a ledger:

```
| # | Task | Agent | Status | Notes |
|---|------|-------|--------|-------|
| 1 | ... | @agent-name | 🔲 | ... |
```

Status legend: 🔲 pending · 🔄 in-progress · ✅ done · ❌ failed · 🔁 retrying
