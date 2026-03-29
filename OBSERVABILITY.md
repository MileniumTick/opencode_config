# OBSERVABILITY.md — Agent Structured Logging Convention

This document defines the **structured logging protocol** that every agent in this system MUST follow
when completing a task. The goal is local-first observability: no cloud dependencies, no external
services — just a local JSONL file that the `/metrics` command can read and summarize.

> **Referenced from:** `AGENTS.md` → Active Integrations → Observability

---

## 1. Purpose

Agents operate asynchronously and across sessions. Without a logging convention we cannot answer:

- Which agents are slowest or most failure-prone?
- How many retries are happening in practice?
- What is the estimated token cost of each delegation?
- Which tasks fail repeatedly and why?

This logging protocol captures four key dimensions per completed task:

| Dimension | Field(s) | Why It Matters |
|-----------|----------|----------------|
| **Latency** | `duration_ms` | Identifies slow agents or runaway tasks |
| **Retry count** | `retries` | Reveals fragile integrations or unstable LLM calls |
| **Token estimates** | `tokens_in`, `tokens_out` | Rough cost attribution per agent |
| **Success/failure** | `status`, `error` | Tracks reliability over time |

---

## 2. Log File Location

```
~/.config/opencode/logs/agent-metrics.jsonl
```

- **Format:** One JSON object per line (JSONL / newline-delimited JSON)
- **Mode:** Append-only — never overwrite existing entries
- **Encoding:** UTF-8
- **Directory:** Create if it does not exist:
  ```bash
  mkdir -p ~/.config/opencode/logs
  ```

---

## 3. Log Entry Schema

Every agent appends **one entry per completed task** (success, failure, or partial).

```json
{
  "ts": "2026-03-29T14:23:01Z",
  "session": "abc123",
  "agent": "backend-lead",
  "task": "Fix auth bug in login route",
  "status": "success",
  "duration_ms": 4200,
  "retries": 0,
  "tokens_in": 1240,
  "tokens_out": 380,
  "error": null
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ts` | string | ✅ | ISO 8601 UTC timestamp when the task **completed** (e.g., `"2026-03-29T14:23:01Z"`) |
| `session` | string | ✅ | OpenCode session ID — use `$SESSION_ID` env var if available, otherwise `"unknown"` |
| `agent` | string | ✅ | Agent name as defined in `AGENTS.md` (e.g., `"backend-lead"`, `"dev"`, `"qa"`) |
| `task` | string | ✅ | Short description of the task — first 80 characters of the delegation message |
| `status` | string | ✅ | One of: `"success"` · `"failure"` · `"partial"` |
| `duration_ms` | number | ✅ | Wall-clock milliseconds from task start to completion |
| `retries` | number | ✅ | Number of retry attempts; `0` means the first attempt succeeded |
| `tokens_in` | number | ✅ | Estimated prompt tokens for this task (use model-provided value if available; else `0`) |
| `tokens_out` | number | ✅ | Estimated completion tokens for this task (use model-provided value if available; else `0`) |
| `error` | string\|null | ✅ | Error message string if `status != "success"`; `null` otherwise |

### Status Values

| Value | Meaning |
|-------|---------|
| `"success"` | Task completed fully as requested |
| `"failure"` | Task could not be completed; agent halted with an error |
| `"partial"` | Task partially completed; some sub-tasks succeeded, others failed |

---

## 4. How Agents Emit Logs

Agents with `bash` access append to the log file using a single `echo` command. The log directory
must exist before writing (create it if needed).

### Bash one-liner (copy-paste template)

```bash
echo '{"ts":"2026-03-29T14:23:01Z","session":"unknown","agent":"agent-name","task":"Short task description (max 80 chars)","status":"success","duration_ms":0,"retries":0,"tokens_in":0,"tokens_out":0,"error":null}' >> ~/.config/opencode/logs/agent-metrics.jsonl
```

### Step-by-step instructions for agents

1. **Record start time** at the beginning of the task (note wall-clock reference).
2. **Execute the task** normally.
3. **On completion** (success, failure, or partial), compute `duration_ms` from start to now.
4. **Populate all fields** per the schema above.
5. **Sanitize the `task` field** — see Privacy Note in Section 6.
6. **Append** the JSON object using the bash one-liner above.
7. **Ensure the JSON is single-line** — no embedded newlines in any field value.

### Agents without bash access

Agents configured with `"bash": "deny"` (e.g., `@team-lead`, `@product-owner`, `@ui-ux-partner`)
**cannot** write to the log file directly. In these cases:

- The **delegating agent** logs the outcome on behalf of the sub-agent.
- If no parent agent can write, the entry is **silently skipped** — logging failures must never
  block task execution.

---

## 5. Log Rotation Policy

Log rotation is **manual** — there is no automatic rotation daemon. Rotate when the file exceeds
approximately **10 MB**.

### Manual rotation command

```bash
# Rotate: shift existing rotated files down, then move current log to .1
mv ~/.config/opencode/logs/agent-metrics.jsonl.4 ~/.config/opencode/logs/agent-metrics.jsonl.5 2>/dev/null || true
mv ~/.config/opencode/logs/agent-metrics.jsonl.3 ~/.config/opencode/logs/agent-metrics.jsonl.4 2>/dev/null || true
mv ~/.config/opencode/logs/agent-metrics.jsonl.2 ~/.config/opencode/logs/agent-metrics.jsonl.3 2>/dev/null || true
mv ~/.config/opencode/logs/agent-metrics.jsonl.1 ~/.config/opencode/logs/agent-metrics.jsonl.2 2>/dev/null || true
mv ~/.config/opencode/logs/agent-metrics.jsonl    ~/.config/opencode/logs/agent-metrics.jsonl.1
```

### Rotation policy details

| Parameter | Value |
|-----------|-------|
| **Trigger** | File size exceeds ~10 MB |
| **Retained files** | 5 rotated archives (`agent-metrics.jsonl.1` through `agent-metrics.jsonl.5`) |
| **Oldest file** | `.5` is overwritten when a new rotation occurs |
| **Active log** | `agent-metrics.jsonl` (no numeric suffix) |

### Check file size

```bash
ls -lh ~/.config/opencode/logs/agent-metrics.jsonl
```

---

## 6. Privacy Note

**Task descriptions in the `task` field MUST NOT contain:**

- Secrets, API keys, tokens, or passwords
- File contents or code snippets
- User PII (names, emails, IP addresses, account IDs)
- Internal system hostnames or credentials

The `task` field should be a **short, abstract description** of the work performed:

```
✅  "Fix auth bug in login route"
✅  "Refactor database query for performance"
✅  "Review PR #42 for security issues"

❌  "Process user data for alice@example.com"
❌  "Set API_KEY=sk-abc123 in config"
❌  "Read file contents of /etc/passwd"
```

If in doubt, truncate or generalize the description.

---

## 7. Known Limitations

| Limitation | Detail |
|------------|--------|
| **Token counts are estimates** | OpenCode does not expose exact token counts for all providers. Use model-provided values when available; otherwise record `0`. Do not fabricate numbers. |
| **`duration_ms` is wall-clock only** | This measures elapsed real time, not CPU time. Network latency, LLM inference time, and tool execution are all included. |
| **No automatic rotation** | The user must run the rotation commands manually when the file exceeds 10 MB. |
| **Single-machine scope** | Logs are local to the machine running OpenCode. There is no centralized log aggregation. |
| **Bash-denied agents** | Agents without `bash` access cannot write logs. Their tasks may go unrecorded unless a parent agent logs on their behalf. |
| **No schema validation** | Log entries are plain text appended to a file. Malformed JSON will cause parse errors in `/metrics`. Agents must ensure valid JSON. |

---

## Quick Reference

```bash
# View the last 10 log entries
tail -n 10 ~/.config/opencode/logs/agent-metrics.jsonl

# Pretty-print the last entry
tail -n 1 ~/.config/opencode/logs/agent-metrics.jsonl | python3 -m json.tool

# Count total entries
wc -l ~/.config/opencode/logs/agent-metrics.jsonl

# Run the metrics report
# (in the OpenCode TUI, type /metrics)
```
