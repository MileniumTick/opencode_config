# Runbook: opencode.json Configuration Errors

This runbook covers the most common errors when `opencode.json` is misconfigured. OpenCode reads
this file at startup; errors here prevent agents, MCP servers, and tool permissions from loading.

> **Related:** See [`mcp-failure.md`](./mcp-failure.md) for MCP server runtime failures.
> See [`ci-failure.md`](./ci-failure.md) for CI pipeline issues.

---

## Quick Validation Command

Always run this first to confirm whether `opencode.json` is currently valid:

```bash
python3 -m json.tool ~/.config/opencode/opencode.json > /dev/null && echo "✅ JSON OK" || echo "❌ JSON INVALID"
```

---

## Error 1: JSON Syntax Error

### Symptom

- OpenCode fails to start or loads with no agents/MCP servers
- OpenCode shows a startup error referencing `opencode.json`
- Running `python3 -m json.tool opencode.json` prints an error like:
  ```
  Expecting ',' delimiter: line 42 column 3 (char 1204)
  ```

### Diagnosis

```bash
# This will print the exact line and character position of the error
python3 -m json.tool ~/.config/opencode/opencode.json
```

If the command exits with an error, the output will include the line number. Open the file and
go to that line.

### Common Causes

| Cause | Example | Fix |
|-------|---------|-----|
| Trailing comma after last item | `{ "a": 1, }` | Remove the trailing comma |
| Comment with `//` in strict JSON context | `// comment` anywhere | Use JSONC-aware tool; CI strips comments |
| Missing comma between items | `{ "a": 1 "b": 2 }` | Add `,` between items |
| Unquoted key | `{ key: "val" }` | Quote the key: `"key": "val"` |
| Single-quoted string | `'value'` | Use double quotes: `"value"` |
| Unclosed brace or bracket | `{ "mcp": {` (no closing `}`) | Add the missing `}` or `]` |

### Fix

1. Run `python3 -m json.tool opencode.json` to get the exact error position.
2. Open the file in a JSON-aware editor (VS Code shows syntax errors inline).
3. Fix the identified issue.
4. Re-validate:
   ```bash
   python3 -m json.tool ~/.config/opencode/opencode.json > /dev/null && echo "OK"
   ```
5. Restart OpenCode.

**Note:** `opencode.json` uses JSONC syntax — `//` line comments are allowed per the OpenCode
schema. `python3 -m json.tool` may reject comments; this is expected for JSONC. The CI pipeline
strips comments before validation. If only comments are causing failures, the file may actually
be valid for OpenCode while failing `json.tool`.

---

## Error 2: Missing Secret File

### Symptom

- An MCP server fails to start with an authentication error
- OpenCode startup log shows: `Failed to read secret file: .secrets/gitea-token`
- A bash command produces: `No such file or directory: .secrets/plane-api-key`
- Gitea MCP returns `401 Unauthorized` immediately

### Diagnosis

```bash
# Check which secret files exist
ls -la ~/.config/opencode/.secrets/

# The following files should all exist (non-empty):
cat ~/.config/opencode/.secrets/gitea-token       | wc -c  # > 0
cat ~/.config/opencode/.secrets/plane-api-key     | wc -c  # > 0
cat ~/.config/opencode/.secrets/plane-workspace-slug | wc -c  # > 0
```

### Fix

For each missing secret file:

1. **Obtain the secret value** from the relevant service (see the MCP server table below).
2. **Create the file** with correct permissions:
   ```bash
   # Create the .secrets directory if it doesn't exist
   mkdir -p ~/.config/opencode/.secrets

   # Write the secret (replace <VALUE> with the actual secret)
   echo "<VALUE>" > ~/.config/opencode/.secrets/<filename>
   chmod 600 ~/.config/opencode/.secrets/<filename>
   ```

**Secret file reference:**

| File | Service | How to Obtain |
|------|---------|---------------|
| `.secrets/gitea-token` | Gitea at `gitea.istmocenter.com` | User Settings → Applications → Generate Token (scopes: `repo`, `issue`, `read:user`) |
| `.secrets/plane-api-key` | Plane at `plane.intranet.istmocenter.com` | Profile → API Tokens → Create Token |
| `.secrets/plane-workspace-slug` | Plane | The URL slug of your workspace (e.g., `my-workspace` from `https://plane.../my-workspace/`) |

3. **Verify** the files are created and non-empty:
   ```bash
   ls -la ~/.config/opencode/.secrets/
   ```

4. **Restart OpenCode** — secrets are read at startup, not dynamically.

5. **Never commit** these files — `.secrets/` is gitignored. Verify:
   ```bash
   git check-ignore -v ~/.config/opencode/.secrets/gitea-token
   ```
   Expected output: `.gitignore:... .secrets/`

---

## Error 3: Model Not Available (Ollama)

### Symptom

- OpenCode starts but all agent responses fail with an error like:
  `model "qwen3:8b-16k" not found`
- OpenCode shows: `Error: pull model manifest: file does not exist`
- Agents produce no output or immediately fail

### Diagnosis

```bash
# Check if Ollama is running
ollama list

# Check if the specific model is available locally
ollama list | grep qwen3

# Check if the Ollama service is running
curl -s http://localhost:11434/api/tags | python3 -m json.tool | grep name
```

**Expected:** `qwen3:8b-16k` appears in the list with a non-zero size.

### Fix

**Model not pulled:**
```bash
# Pull the model (this downloads ~5-8 GB — ensure sufficient disk space)
ollama pull qwen3:8b-16k

# Verify the pull succeeded
ollama list | grep qwen3
```

**Ollama service not running:**
```bash
# Start Ollama
ollama serve &

# Or on macOS, start the Ollama app from /Applications/Ollama.app
open /Applications/Ollama.app

# Verify it's running
curl -s http://localhost:11434/api/tags
```

**Wrong model name in `opencode.json`:**
```bash
# List available models to find the correct name
ollama list

# Update opencode.json if the model name differs
# "provider" → "ollama" → "models" → change the key to match `ollama list` output
```

**Disk space issue:**
```bash
df -h ~/   # check available space; model needs ~5-8 GB
```

### Verify the Fix

```bash
# Quick test: ask the model a question via Ollama CLI
ollama run qwen3:8b-16k "Say hello in one word"
```

**Expected:** The model responds. If it does, OpenCode will also be able to use it.

---

## Error 4: Agent Permission Error

### Symptom

- An agent attempts an action (e.g., editing a file) and it is blocked
- OpenCode shows: `Permission denied: edit is not allowed for agent <name>`
- A bash command is rejected: `Command not allowed: <command> is not in the allow-list`
- An agent cannot use a tool it needs to complete its task

### Diagnosis

1. **Identify which agent** is being blocked and which tool/command is denied.
2. **Check the agent's current permissions** in `opencode.json`:
   ```bash
   python3 -c "
   import json
   with open('opencode.json') as f:
       config = json.load(f)
   agent_name = 'dev'  # change this to the agent being blocked
   perms = config.get('agent', {}).get(agent_name, {}).get('permission', {})
   print(f'Permissions for {agent_name}:')
   print(json.dumps(perms, indent=2))
   "
   ```
3. **Check the agent's frontmatter** (`agent/<name>.md`) for any permissions declared there.

### How to Safely Expand Permissions

> ⚠️ **Permission changes require review** — per `AGENTS.md`, any agent needing new permissions
> must be reviewed by `@security-lead` and documented with a justification comment.

1. **Create a branch** for the permission change:
   ```bash
   git checkout -b feat/expand-<agent-name>-permissions
   ```

2. **Edit `opencode.json`** — add the specific command to the agent's allow-list:
   ```json
   "<agent-name>": {
     "permission": {
       "bash": {
         "existing-command": "allow",
         "new-command": "allow"  // Justification: needed for X
       }
     }
   }
   ```

3. **Use the most restrictive scope possible** — prefer specific commands over wildcards.

4. **Add a comment** explaining the justification (JSONC comments are allowed in `opencode.json`).

5. **Submit a PR** and request review from `@security-lead` before merging to `main`.

6. **Document the decision** in `DECISIONS.md` after the PR is merged.

### Permission Policy Quick Reference

| Agent | `edit` | `bash` |
|-------|--------|--------|
| `team-lead` | `deny` | `deny` |
| Domain leads (`backend-lead`, etc.) | `deny` | Read-only: `grep`, `git log/diff/status/show` |
| `dev` | `allow` | Full access |
| `exploration` | `deny` | `ls`, `cat`, `grep`, `git` read commands only |
| `security` | `deny` | Audit/scan CLIs only (`npm audit`, `trivy`, `semgrep`) |
| `qa` | `deny` | Test runners and linters only |
| `product-owner`, `ui-ux-partner` | `deny` | `deny` |

---

## Error 5: MCP Server Version Mismatch

### Symptom

- MCP tool calls return unexpected errors or missing tools
- An MCP server starts but tools are not listed correctly
- Error: `Tool not found: <tool-name>` for a tool that should exist
- OpenCode logs show version warnings for an MCP server

### Diagnosis

```bash
# Check currently installed versions

# engram
engram --version

# gitea-mcp
gitea-mcp --version

# plane-mcp-server (via uvx — check which version uvx resolves)
uvx --show-resolution plane-mcp-server 2>/dev/null || uvx plane-mcp-server --version 2>&1 | head -5

# context7 is remote — check their changelog at https://context7.com/changelog
```

### Fix

**Engram:**
```bash
# Update via your installation method
brew upgrade engram       # if installed via Homebrew
cargo install engram      # if installed via cargo (reinstalls latest)
```

**gitea-mcp:**
```bash
# Download the latest release from:
# https://gitea.com/gitea/gitea-mcp/releases
# Replace the binary at the same path it was installed to:
INSTALL_PATH=$(which gitea-mcp)
curl -Lo "$INSTALL_PATH" https://gitea.com/gitea/gitea-mcp/releases/download/v<NEW_VERSION>/gitea-mcp-$(uname -m)
chmod +x "$INSTALL_PATH"
gitea-mcp --version  # verify new version
```

**plane-mcp-server (uvx):**
```bash
# uvx always fetches the latest version by default
# Force a fresh fetch by clearing the uvx cache:
uvx --reinstall plane-mcp-server stdio

# Or pin to a specific version if the latest is broken:
# In opencode.json, change the command to include a version pin:
# "command": ["uvx", "plane-mcp-server==0.x.y", "stdio"]
```

**context7 (remote):**
- Remote MCP servers update automatically on the server side.
- If tool signatures changed, check: https://context7.com/changelog
- If the `url` in `opencode.json` changed, update it:
  ```json
  "context7": {
    "type": "remote",
    "url": "https://mcp.context7.com/mcp"  // update if URL changed
  }
  ```

### After Updating

1. Validate `opencode.json` is still syntactically valid:
   ```bash
   python3 -m json.tool ~/.config/opencode/opencode.json > /dev/null && echo "OK"
   ```
2. Restart OpenCode — MCP servers are initialized at startup.
3. Verify the updated MCP server's tools appear correctly in the OpenCode TUI.
