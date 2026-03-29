# Runbook: MCP Server Failures

This runbook covers diagnosis and recovery for each MCP server configured in `opencode.json`.
Follow the relevant section when an MCP integration is unavailable or returning errors.

> **See also:** [`OBSERVABILITY.md`](../OBSERVABILITY.md) for metrics on agent failures that may
> correlate with MCP outages.

---

## Overview of MCP Servers

| Server | Type | Transport | Config Location |
|--------|------|-----------|-----------------|
| `context7` | Remote | HTTPS | `opencode.json` → `mcp.context7` |
| `engram` | Local | CLI (`engram mcp`) | `opencode.json` → `mcp.engram` |
| `gitea` | Local | CLI (`gitea-mcp`) | `opencode.json` → `mcp.gitea` |
| `plane` | Local | CLI (`uvx plane-mcp-server`) | `opencode.json` → `mcp.plane` |

---

## 1. `context7` — Remote Documentation Lookup

### Symptom

- Agent outputs: `"MCP tool call failed"` or `"context7 unavailable"` during documentation lookups
- Timeout errors when agents try to resolve library IDs
- OpenCode startup logs show: `Failed to connect to https://mcp.context7.com/mcp`

### Diagnosis

```bash
# Test network connectivity and TLS to the Context7 endpoint
curl -v --max-time 10 https://mcp.context7.com/mcp

# Check DNS resolution
nslookup mcp.context7.com

# Verify TLS certificate
openssl s_client -connect mcp.context7.com:443 -brief 2>&1 | head -20
```

**Expected:** HTTP 2xx or a valid JSON-RPC response body.
**If timeout or TLS error:** Network/firewall issue or Context7 service outage.

Check the Context7 status page: https://context7.com (if available) or check `@context7` on X.

### Fix

**Network/firewall issue:**
1. Verify outbound HTTPS (port 443) is allowed from this machine.
2. If behind a corporate proxy, configure `HTTPS_PROXY` environment variable.
3. Try from a different network to confirm it is not a local firewall issue.

**Service outage:**
1. No action required — Context7 is a third-party service; wait for it to recover.
2. In `opencode.json`, temporarily set `"enabled": false` for `context7` to suppress errors:
   ```json
   "context7": {
     "enabled": false,
     ...
   }
   ```
3. Re-enable once the service recovers.

### Graceful Degradation

If Context7 is unavailable, agents **MUST**:
- Skip documentation lookups silently — do not block task execution.
- Proceed using their built-in training knowledge.
- Note in their output: `"Context7 unavailable — proceeding without live documentation lookup."`
- Do **not** retry more than 2 times before giving up on the lookup.

---

## 2. `engram` — Local Memory Persistence

### Symptom

- Agent outputs: `"engram tool call failed"` or `"memory persistence unavailable"`
- Error: `command not found: engram` in shell logs
- OpenCode startup: `Failed to start MCP server: engram`
- Agents cannot save or retrieve cross-session memory

### Diagnosis

```bash
# Check if the engram binary is installed and on PATH
which engram
engram --version

# Test the MCP server directly
engram mcp --tools=agent --help

# Check if engram process crashes on startup
engram mcp --tools=agent 2>&1 | head -30
```

**Expected:** `engram --version` prints a version number; `engram mcp --tools=agent` starts
without error (it will block — use Ctrl+C to stop it).

### Fix

**Binary missing:**
```bash
# Install engram (check the project's official installation method)
# Common: install via Homebrew, cargo, or direct download
brew install engram          # if available via Homebrew
# OR
cargo install engram         # if Rust toolchain is available
```

**Binary installed but crashes:**
```bash
# Run with verbose logging to capture the crash
engram mcp --tools=agent --verbose 2>&1

# Check for corrupted state files
ls -la ~/.engram/
# If state is corrupted, back up and reset:
mv ~/.engram ~/.engram.bak
```

**PATH issue:**
```bash
# Add engram to PATH in your shell profile
echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.zshrc  # or ~/.bashrc
source ~/.zshrc
```

### Graceful Degradation

If Engram is unavailable, agents **MUST**:
- Skip `engram_mem_save` and `engram_mem_context` calls — do not block task execution.
- Output a note: `"Memory persistence unavailable — session context will not be saved."`
- Continue the task using only the current session context.
- Do **not** retry more than 1 time before skipping memory operations for the session.

---

## 3. `gitea` — Self-Hosted Git Operations

### Symptom

- Agent outputs: `"gitea tool call failed"` or `"git operation failed"`
- Error: `command not found: gitea-mcp` in shell logs
- Error: `401 Unauthorized` or `403 Forbidden` in Gitea API responses
- Error: `connection refused` or `no route to host` when accessing `gitea.istmocenter.com`

### Diagnosis

```bash
# Check if gitea-mcp binary is installed
which gitea-mcp
gitea-mcp --version

# Test network connectivity to the Gitea server
curl -v --max-time 10 https://gitea.istmocenter.com/api/v1/version

# Verify the token secret file exists and is non-empty
ls -la ~/.config/opencode/.secrets/gitea-token
cat ~/.config/opencode/.secrets/gitea-token | wc -c   # should be > 0

# Test the token against the Gitea API
GITEA_TOKEN=$(cat ~/.config/opencode/.secrets/gitea-token)
curl -H "Authorization: token $GITEA_TOKEN" https://gitea.istmocenter.com/api/v1/user
```

**Expected:** `curl .../version` returns `{"version":"..."}`. The token test returns your user info.

### Fix

**Binary missing:**
```bash
# Install gitea-mcp — check the project's releases page:
# https://gitea.com/gitea/gitea-mcp/releases
# Download the appropriate binary for your platform and add to PATH:
curl -Lo /usr/local/bin/gitea-mcp https://gitea.com/gitea/gitea-mcp/releases/download/v<VERSION>/gitea-mcp-darwin-arm64
chmod +x /usr/local/bin/gitea-mcp
```

**Token expired or invalid:**
1. Log in to `https://gitea.istmocenter.com`
2. Navigate to: **User Settings** → **Applications** → **Manage Access Tokens**
3. Revoke the old token and generate a new one with `repo`, `issue`, and `read:user` scopes.
4. Update the secret file:
   ```bash
   echo "your-new-token-here" > ~/.config/opencode/.secrets/gitea-token
   chmod 600 ~/.config/opencode/.secrets/gitea-token
   ```
5. Restart OpenCode.

**Gitea server down:**
1. Verify the server is reachable: `ping gitea.istmocenter.com`
2. Contact your infrastructure team — this is a self-hosted server.
3. Check if it is a DNS issue vs. server down: `nslookup gitea.istmocenter.com`

**TLS/certificate issue:**
```bash
openssl s_client -connect gitea.istmocenter.com:443 -brief 2>&1 | head -20
```
If the certificate is expired or self-signed, you may need to add it to your trust store.

### Graceful Degradation

If Gitea is unavailable, agents **MUST**:
- Skip Gitea MCP tool calls — do not block task execution.
- Perform Git operations using the local `git` CLI if available and within `bash` permissions.
- Notify the user: `"Gitea MCP unavailable — using local git CLI as fallback."`
- Do **not** attempt operations that require server-side Gitea features (PRs, issues) — surface
  these as blocked items for manual resolution.

---

## 4. `plane` — Project Management

### Symptom

- Agent outputs: `"plane tool call failed"` or `"project management unavailable"`
- Error: `command not found: uvx` in shell logs
- Error: `401 Unauthorized` in Plane API responses
- Error: Package `plane-mcp-server` not found or fails to install via `uvx`

### Diagnosis

```bash
# Check if uvx (uv's tool runner) is installed
which uvx
uvx --version

# Test that plane-mcp-server can be resolved and run
uvx plane-mcp-server --help 2>&1 | head -20

# Verify secret files exist and are non-empty
ls -la ~/.config/opencode/.secrets/plane-api-key
ls -la ~/.config/opencode/.secrets/plane-workspace-slug
cat ~/.config/opencode/.secrets/plane-api-key | wc -c   # should be > 0

# Test the Plane API with the key
PLANE_KEY=$(cat ~/.config/opencode/.secrets/plane-api-key)
PLANE_SLUG=$(cat ~/.config/opencode/.secrets/plane-workspace-slug)
curl -H "X-Api-Key: $PLANE_KEY" \
     "https://plane.intranet.istmocenter.com/api/v1/workspaces/$PLANE_SLUG/projects/" \
     | python3 -m json.tool | head -30
```

**Expected:** `uvx --version` prints a version; `uvx plane-mcp-server --help` shows usage.
API test returns a JSON list of projects.

### Fix

**`uvx` not installed (`uv` toolchain missing):**
```bash
# Install uv (Python package manager that includes uvx)
curl -LsSf https://astral.sh/uv/install.sh | sh
# Then reload your shell:
source ~/.zshrc  # or ~/.bashrc
```

**`plane-mcp-server` package not found or outdated:**
```bash
# Force uvx to fetch the latest version
uvx --reinstall plane-mcp-server stdio

# Or specify a specific version if the latest is broken
uvx plane-mcp-server==0.x.y stdio
```

**API key missing or expired:**
1. Log in to `https://plane.intranet.istmocenter.com`
2. Navigate to: **Profile** → **API Tokens** → create a new token.
3. Update the secret file:
   ```bash
   echo "your-new-api-key-here" > ~/.config/opencode/.secrets/plane-api-key
   chmod 600 ~/.config/opencode/.secrets/plane-api-key
   ```
4. Restart OpenCode.

**Workspace slug wrong or missing:**
```bash
# The slug is the URL identifier for your workspace, e.g.:
# https://plane.intranet.istmocenter.com/your-workspace-slug/
echo "your-workspace-slug" > ~/.config/opencode/.secrets/plane-workspace-slug
chmod 600 ~/.config/opencode/.secrets/plane-workspace-slug
```

**Plane server unreachable:**
```bash
curl -v --max-time 10 https://plane.intranet.istmocenter.com
```
If unreachable, contact your infrastructure team — this is a self-hosted server.

### Graceful Degradation

If Plane is unavailable, agents **MUST**:
- Skip Plane MCP tool calls — do not block task execution.
- Notify the user: `"Plane MCP unavailable — project management operations skipped."`
- Continue with code tasks that do not require issue tracking.
- Record any work items that should have been created as a list in the agent output, so the
  user can manually create them when Plane is back online.

---

## General Recovery Checklist

After fixing any MCP server issue:

```bash
# 1. Verify opencode.json is still valid
python3 -m json.tool ~/.config/opencode/opencode.json > /dev/null && echo "JSON OK"

# 2. Restart OpenCode to reload MCP server connections
# (OpenCode does not hot-reload MCP config changes)

# 3. Verify the MCP server appears as connected in the OpenCode TUI
# Look for the server name in the session info / tool list
```
