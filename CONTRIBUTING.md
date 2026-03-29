# CONTRIBUTING.md — Contributor & Onboarding Guide

Welcome. This guide explains how to work in the OpenCode agent orchestration config repository.

**Read order:** [`AGENTS.md`](./AGENTS.md) → this file → [`DECISIONS.md`](./DECISIONS.md)

---

## File Structure

```
opencode/
├── agent/                  # Agent system prompts (Markdown + YAML frontmatter)
│   ├── team-lead.md        # Level 1 orchestrator
│   ├── backend-lead.md     # Level 2 domain leads
│   ├── frontend-lead.md
│   ├── data-lead.md
│   ├── security-lead.md
│   ├── rust-lead.md
│   ├── python-lead.md
│   ├── devops-lead.md
│   ├── mobile-lead.md
│   ├── golang-lead.md
│   ├── qa.md               # Level 2/3 quality worker
│   ├── dev.md              # Level 3 workers
│   ├── exploration.md
│   ├── security.md
│   ├── product-owner.md
│   └── ui-ux-partner.md
│
├── commands/               # Custom OpenCode TUI slash commands
│   ├── commit.md           # /commit — conventional commit generator
│   └── review.md           # /review — multi-agent code review
│
├── .secrets/               # API keys and tokens (gitignored — NEVER commit)
│   ├── gitea-token
│   ├── plane-api-key
│   └── plane-workspace-slug
│
├── opencode.json           # Main config: MCP servers, AI provider, agent permissions
├── package.json            # NPM dependencies (MCP server packages)
│
├── AGENTS.md               # START HERE — canonical reference (includes full architecture)
├── CONTRIBUTING.md         # This file — onboarding guide
└── DECISIONS.md            # Append-only change log and architecture decision record
```

### What goes where

| I want to… | Edit this file |
|-----------|----------------|
| Change an agent's behavior or instructions | `agent/<agent-name>.md` |
| Change what tools an agent can use | `agent/<agent-name>.md` frontmatter AND `opencode.json` `agent` block |
| Add/change an MCP server connection | `opencode.json` `mcp` block |
| Change the AI model or provider | `opencode.json` `provider` block |
| Add a new slash command | `commands/<command-name>.md` |
| Update architecture documentation | `AGENTS.md` (hierarchy, patterns, error handling all live there now) |
| Record a significant decision | `DECISIONS.md` (add at the top) |

---

## Document Hierarchy

| Document | Purpose | When to read |
|----------|---------|--------------|
| `AGENTS.md` | Canonical overview: what the repo is, all agents, behavioral rules, full hierarchy diagram, orchestration patterns | First — always |
| `CONTRIBUTING.md` | File structure, how to add agents/skills, change permissions | Before making changes |
| `DECISIONS.md` | Change log and architecture decision record | To understand why things are the way they are |

---

## Adding a New Agent

1. **Create the agent file** in `agent/`:

   ```markdown
   ---
   description: >-
     One-sentence description of what this agent does and when to use it.
   mode: subagent
   permission:
     edit: deny          # or allow for worker agents
     bash:
       "*": ask
       "git log*": allow
       "git diff*": allow
   ---

   You are the **[Agent Name]** — [role description].

   ## Critical Rules
   ...
   ```

2. **Add tool permissions** in `opencode.json` under the `agent` block:

   ```json
   "my-new-agent": {
     "permission": {
       "edit": "deny",
       "bash": {
         "*": "ask",
         "grep *": "allow"
       }
     }
   }
   ```

3. **Update `AGENTS.md`** — add a row to the Agent Inventory table and the delegation hierarchy tree.

4. **Wire up routing** — if it's a domain lead, add a delegation rule to `agent/team-lead.md`.

4. **Record the decision** in `DECISIONS.md`.

### Agent frontmatter fields

| Field | Required | Values | Notes |
|-------|----------|--------|-------|
| `description` | Yes | string | Used by OpenCode for agent selection |
| `mode` | Yes | `primary`, `subagent` | `primary` = user-facing; `subagent` = delegated |
| `permission.edit` | Yes | `allow`, `deny` | Workers need `allow`; leads/orchestrators use `deny` |
| `permission.bash` | Yes | object or `allow`/`deny` | Key = command pattern, value = `allow`/`ask`/`deny` |

---

## Adding or Updating a Skill

Skills live **outside this repository** at `~/.agents/skills/`. They are loaded by agents via `skill("skill-name")`.

To add a skill reference to an agent:
1. Ensure the skill exists at `~/.agents/skills/<skill-name>/SKILL.md`
2. Add a `skills:` block to the agent's frontmatter (if supported)
3. Or have the agent call `skill("skill-name")` in its system prompt instructions

To create a new skill, use the `skill-creator` skill for guided authoring.

---

## Updating Agent Permissions

Permissions are declared in **two places** and both must be consistent:

1. **Agent frontmatter** (`agent/<name>.md`) — loaded by OpenCode at runtime
2. **`opencode.json` `agent` block** — OpenCode override layer

Permission levels:
- `allow` — agent can use this tool without asking
- `ask` — agent must ask user before using
- `deny` — tool is blocked entirely

Bash permissions use glob patterns:
```json
"bash": {
  "*": "ask",           // default: ask for anything not matched below
  "git log*": "allow",  // allow git log commands silently
  "rm *": "deny"        // never allow rm
}
```

After updating permissions, restart OpenCode and verify the agent behaves as expected.

---

## Adding a Slash Command

1. Create `commands/<command-name>.md`
2. Commands are loaded automatically by OpenCode from the `commands/` directory
3. Users invoke them as `/<command-name>` in the TUI

See `commands/commit.md` and `commands/review.md` for reference examples.

---

## Secrets Management

Secrets are stored in `.secrets/` and referenced in `opencode.json`:

```json
"GITEA_ACCESS_TOKEN": "{file:.secrets/gitea-token}"
```

**Rules:**
- `.secrets/` is gitignored — never commit secrets
- One secret per file, no trailing newline
- File names are descriptive (`gitea-token`, `plane-api-key`)
- When sharing this config, always strip `.secrets/` first

---

## Validation & Testing

```bash
# Validate opencode.json syntax
python3 -m json.tool opencode.json > /dev/null && echo "OK"

# Validate all JSON files
for f in *.json; do python3 -m json.tool "$f" > /dev/null 2>&1 && echo "OK: $f" || echo "FAIL: $f"; done

# Check OpenCode version
opencode --version
```

After any config change:
1. Run JSON validation
2. Restart OpenCode
3. Test the affected agent with a simple task

---

## Commit Style

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(agent): add @golang-lead with gRPC routing
fix(config): correct mobile-lead bash permissions
docs: update AGENTS.md hierarchy diagram
chore: add missing agents to opencode.json permissions block
```

Load the `conventional-commit` skill for interactive guided commits.

---

## Machine-Specific Notes

This configuration is tied to a specific machine:
- AI provider: Ollama at `http://localhost:11434/v1`
- Gitea instance: `https://gitea.istmocenter.com`
- Plane instance: `https://plane.intranet.istmocenter.com`

When porting to a new machine, update `opencode.json` endpoints and repopulate `.secrets/`.
