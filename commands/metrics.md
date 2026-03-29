---
description: Read the agent metrics log and produce a per-agent summary report
---

Read `~/.config/opencode/logs/agent-metrics.jsonl` and produce a structured Markdown report of
agent activity. If the file does not exist or is empty, explain the logging convention instead.

## Execution Steps

1. **Check for the log file:**
   ```bash
   ls -lh ~/.config/opencode/logs/agent-metrics.jsonl
   ```
   - If the file does **not exist** or is **empty**, output the "No Data Yet" message (see below)
     and stop.

2. **Read the log file:**
   ```bash
   cat ~/.config/opencode/logs/agent-metrics.jsonl
   ```

3. **Parse each line** as a JSON object. Skip any lines that are not valid JSON (warn the user
   if more than 5 lines are unparseable).

4. **Compute the following metrics** across all valid entries:

   **Summary-level:**
   - Total tasks (count of all entries)
   - Overall success rate (entries where `status == "success"` / total, as %)
   - Total retries (sum of all `retries` fields)
   - Total estimated tokens in (sum of all `tokens_in`)
   - Total estimated tokens out (sum of all `tokens_out`)

   **Per-agent (group by `agent` field):**
   - Task count
   - Success % (success entries / total entries for this agent)
   - Average latency in ms (mean of `duration_ms`)
   - Total retries
   - Total tokens (sum of `tokens_in + tokens_out`)

   **Recent failures (last 5 entries where `status != "success"`, sorted by `ts` descending):**
   - Timestamp, agent, task description, error message

   **Top 5 slowest tasks (all entries, sorted by `duration_ms` descending, take top 5):**
   - Duration (ms), agent, task description

5. **Render the report** using the format below.

---

## Output Format

Produce the following Markdown report. Replace all `[...]` placeholders with computed values.

```markdown
## Agent Metrics Report

_Generated from `~/.config/opencode/logs/agent-metrics.jsonl`_
_Log entries analyzed: [N]_ | _Token counts are estimates._

---

### Summary

| Metric | Value |
|--------|-------|
| Total tasks | [N] |
| Success rate | [X]% |
| Total retries | [N] |
| Est. tokens in | [N] |
| Est. tokens out | [N] |

---

### Per-Agent Stats

| Agent | Tasks | Success% | Avg Latency (ms) | Total Retries | Total Tokens |
|-------|-------|----------|-----------------|---------------|-------------|
| [agent] | [N] | [X]% | [N] | [N] | [N] |

_(sorted by total tasks descending)_

---

### Recent Failures

_(Last 5 failures — most recent first)_

| Timestamp | Agent | Task | Error |
|-----------|-------|------|-------|
| [ts] | [agent] | [task] | [error] |

_(No recent failures ✅ — if there are none)_

---

### Top 5 Slowest Tasks

| Duration (ms) | Agent | Task |
|--------------|-------|------|
| [N] | [agent] | [task] |
```

---

## No Data Yet Message

If the log file does not exist or contains no valid entries, output this message:

```
## Agent Metrics — No Data Yet

The metrics log file does not exist at:
  ~/.config/opencode/logs/agent-metrics.jsonl

**To start generating metrics**, agents must be configured to append log entries after each
completed task. See OBSERVABILITY.md for the full logging convention.

**Quick start:**
1. Create the log directory:
   mkdir -p ~/.config/opencode/logs

2. Agents with bash access append entries using:
   echo '{"ts":"...","session":"unknown","agent":"agent-name","task":"...","status":"success","duration_ms":0,"retries":0,"tokens_in":0,"tokens_out":0,"error":null}' >> ~/.config/opencode/logs/agent-metrics.jsonl

3. Run /metrics again after completing a few tasks.

For the full schema, rotation policy, and privacy guidelines, see OBSERVABILITY.md.
```

---

## Notes

- Token counts (`tokens_in`, `tokens_out`) are **estimates** — not exact values. OpenCode does
  not expose precise token counts for all providers. Treat totals as rough indicators only.
- If a line in the log is not valid JSON, skip it silently and include a warning at the top of
  the report: `⚠️ Skipped [N] unparseable lines.`
- The report is generated from the **current** log file only (no rotated archives). To include
  historical data, manually concatenate rotated files first.
