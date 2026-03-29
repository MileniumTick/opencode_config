# AGENTS.md - OpenCode Agent System Configuration

This file documents the agent system configuration and core behavioral directives for AI assistants operating in this repository.

---

## Core Behavioral Directives

### 1. Always Doubt Yourself (MANDATORY)

- Question your assumptions before delivering any output
- Ask: "What could be wrong with this?"
- Acknowledge limitations and uncertainties proactively

### 2. Success Score System (MANDATORY)

**Before delivering output, rate your confidence from 0-10 on 3-5 criteria:**
- Average = SUCCESS SCORE
- **If score < 8: DO NOT deliver** - acknowledge uncertainty and explain what's needed

---

## Build / Lint / Test Commands

This is a configuration directory with JSON/JSONC files only:

```bash
# Validate JSON syntax
cat opencode.json | python3 -m json.tool > /dev/null

# Validate all JSON files
for f in *.json *.jsonc; do python3 -m json.tool "$f" > /dev/null 2>&1 || echo "FAIL: $f"; done

# Start OpenCode and verify configuration loads
opencode --version
```

**No build or test commands exist** - this is a config-only repository.

---

## Code Style Guidelines

### JSON/JSONC Conventions

- **2-space indentation** for all JSON/JSONC files
- **Trailing commas** are acceptable in JSONC
- **Comments**: Use `//` to explain non-obvious settings
- **Group related settings** together
- **Descriptive keys** that are self-documenting
- **JSON Schema**: Use `$schema` validation where available

### File Organization

```
agent/              # Agent configuration files (team-lead, dev, qa, etc.)
.secrets/           # Gitignored secrets (tokens, API keys)
opencode.json       # Main OpenCode config (MCP servers, AI)
package.json       # NPM dependencies
```

### Naming Conventions

| File Type | Convention | Example |
|-----------|------------|---------|
| Config | snake_case.json | `opencode.json` |
| Agent | kebab-case.md | `team-lead.md` |
| Secrets | descriptive | `gitea-token`, `plane-api-key` |

### Security

- **NEVER commit secrets** to this directory
- Use `{file:.secrets/filename}` pattern for sensitive values
- Secrets stored in `.secrets/` are gitignored

---

## Agent System Architecture

### Available Agents

| Agent | Role | Level | When to Use |
|-------|------|-------|-------------|
| @team-lead | Orchestrator | 1 | Primary - delegates to domain leads |
| @backend-lead | Domain Lead | 2 | Backend (Node, Elysia, Go) |
| @frontend-lead | Domain Lead | 2 | Frontend (React, Vue, Svelte) |
| @data-lead | Domain Lead | 2 | Database, PostgreSQL, Drizzle |
| @security-lead | Domain Lead | 2 | Security, Auth, OWASP |
| @rust-lead | Domain Lead | 2 | Rust, WASM, systems |
| @python-lead | Domain Lead | 2 | Python, FastAPI, Django |
| @devops-lead | Domain Lead | 2 | Docker, CI/CD, Cloud |
| @mobile-lead | Domain Lead | 2 | Mobile (React Native, Flutter, Expo) |
| @golang-lead | Domain Lead | 2 | Go APIs, microservices, CLI tools |
| @qa | Domain Lead/Worker | 2/3 | Testing, Quality |
| @dev | Worker | 3 | Code implementation |
| @security | Worker | 3 | Security vulnerabilities |
| @exploration | Worker | 3 | Code analysis |
| @product-owner | Worker | 3 | Requirements |
| @ui-ux-partner | Worker | 3 | Interface design |

### Agent Communication Flow

1. User submits task (any language)
2. @team-lead creates plan (Plan-and-Execute)
3. @team-lead routes to appropriate domain lead (Level 2)
4. Domain lead delegates to workers (Level 3)
5. Domain lead consolidates and reports to @team-lead
6. @team-lead reports to user

---

## Active Integrations

### MCP Servers
- **context7** - Codebase context (remote)
- **engram** - Memory persistence (local)
- **gitea** - Git hosting at gitea.istmocenter.com
- **plane** - Project management at plane.intranet.istmocenter.com

### AI Provider
- **Ollama** (local) - qwen3:8b-16k model
- Endpoint: http://localhost:11434/v1

---

## Development Guidelines

### Agent Prompt Standards

- All agent prompts in English (for AI optimization)
- Use success score calculation before finalizing any output
- Apply skill loading for framework-specific tasks

### @dev Agent Standards

- Write idiomatic code for the language/framework
- Use explicit types (TypeScript)
- Handle errors appropriately
- Limit functions to <50 lines when possible
- Write tests for new functionality
- Comments explain "why", not "what"

### @exploration Agent Standards

- Provide evidence for all claims
- Search codebase thoroughly before answering
- Distinguish between facts and hypotheses

---

## Cursor Rules (Applied Here)

From `.cursor/rules/gentle-ai.mdc`:

- Never add AI attribution to commits (no Co-Authored-By)
- Never build after changes (this is a config-only repo)
- When asking user questions, STOP and wait for response
- Verify technical claims before stating them
- If unsure, investigate first

---

## Testing Configuration Changes

After modifying any configuration file:

1. Validate JSON syntax: `python3 -m json.tool file.json > /dev/null`
2. Start OpenCode and verify configuration loads
3. Test any new MCP integrations explicitly

---

## Notes

- This directory is machine-specific (API keys, local endpoints)
- When sharing configuration, sanitize secrets first
- Configuration tracked by git (see `.gitignore` for exclusions)
