# Finance Project Template

## Purpose
Use this template for market analysis, trading research, screening pipelines, and portfolio decision support.

## Recommended Agents
- `@team-lead` (orchestration)
- `@finance-lead` (domain strategy)
- `@market-analyst` (screening and market interpretation)
- `@data-analyst` (data processing and metrics)
- `@dev` (automation/scripts)

## Recommended MCP Servers
- `context7` — library/API docs for analytics tooling
- `engram` — track hypotheses, decisions, and postmortems
- `gitea` — version and review research code
- `plane` — manage analysis tasks and cadence

## Recommended Tools
- `webfetch` (public data/news retrieval when needed)
- `glob`, `grep`, `read` (locate and inspect project assets)
- `apply_patch` (update analysis scripts/docs)
- `bash` (run scripts, checks, reproducible workflows)

## docs/ai-work Usage
- **Small task (single session):** log outcomes in `docs/ai-work/SESSIONS.md` + `DECISIONS.md`
- **Medium/Large task:** use `docs/ai-work/changes/<slug>/` for hypothesis/spec, tasking, validation, and notes

## Starter Checklist
- [ ] Define instrument universe, timeframe, and objective
- [ ] Document data sources and key assumptions
- [ ] Specify evaluation metrics and risk constraints
- [ ] Build/review reproducible analysis steps
- [ ] Validate outputs for consistency and obvious bias
- [ ] Record decisions and caveats in `docs/ai-work`
- [ ] Summarize actionable findings with confidence level
