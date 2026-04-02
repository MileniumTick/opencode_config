---
description: Run full OpenCode configuration health checks (JSON, agents, tools, plugins, docs)
---

Run a comprehensive health check of this OpenCode configuration.

## Checks to Perform

1. **Config JSON validity**
   - Validate `opencode.json` syntax
   - Validate all root `*.json` files

2. **Agent system integrity**
   - Count agent files in `agents/`
   - Verify required core agents exist:
     - `team-lead.md`
     - `backend-lead.md`
     - `frontend-lead.md`
     - `data-lead.md`
     - `security-lead.md`
     - `qa.md`
     - `dev.md`
   - Verify expanded non-coding agents exist:
     - `finance-lead.md`, `market-analyst.md`
     - `data-science-lead.md`, `data-analyst.md`
     - `content-lead.md`, `tech-writer.md`
     - `research-lead.md`

3. **Custom tools integrity**
   - Verify tools exist:
     - `tools/project-docs.ts`
     - `tools/market-data.ts`
     - `tools/send-alert.ts`
     - `tools/generate-report.ts`
   - Check each tool imports from `@opencode-ai/plugin`

4. **Plugin integrity**
   - Verify plugins exist:
     - `plugins/rtk.ts`
     - `plugins/project-docs-autolog.ts`

5. **Documentation integrity**
   - Verify required docs exist:
     - `AGENTS.md`
     - `CONTRIBUTING.md`
     - `DECISIONS.md`
     - `OBSERVABILITY.md`
   - Verify `AGENTS.md` includes key sections:
     - Agent Inventory
     - Routing Table
     - Project Documentation Convention
     - Custom Tools

6. **Rules & instructions integrity**
   - Verify rule files exist:
     - `rules/security-standards.md`
     - `rules/self-doubt-protocol.md`
     - `rules/communication-standards.md`
   - Verify `opencode.json` has `instructions` referencing those files

7. **MCP config integrity**
   - Verify MCP entries exist:
     - `context7`, `engram`, `gitea`, `plane`
     - `brave-search`, `firecrawl`

## Output Format

Return a health report:

```markdown
## OpenCode Health Report

### Summary
- Total checks: X
- Passed: X
- Failed: X
- Status: HEALTHY ✅ | NEEDS ATTENTION ⚠️

### Detailed Checks
| Category | Check | Status | Notes |
|----------|-------|--------|-------|
| Config | opencode.json valid | ✅ | ... |

### Action Items
- [ ] Fix ...
```

If any check fails, include exact file/path and suggested fix.
```
