# Runbook: CI Pipeline Failures

This runbook covers diagnosis and recovery for each quality gate defined in
`.gitea/workflows/ci.yml`. Use this when a CI run fails on a push or pull request.

> **Related:** See [`mcp-failure.md`](./mcp-failure.md) if the Gitea Actions runner itself is
> unreachable. See [`config-error.md`](./config-error.md) for `opencode.json` configuration issues.

---

## CI Pipeline Overview

The CI pipeline (`CI Quality Gates`) runs on every push to `main`, `feat/**`, and `fix/**`
branches, and on all pull requests to `main`. It contains 4 jobs that run in parallel:

| Job | Name | What It Checks |
|-----|------|----------------|
| `lint-json` | Lint JSON / JSONC | All `*.json` and `*.jsonc` files are valid JSON |
| `audit-deps` | Audit Dependencies | No high/critical vulnerabilities in npm/bun dependencies |
| `secret-scan` | Secret Scan | No hardcoded secrets or tokens in tracked files |
| `smoke-config` | Smoke Test Config | `opencode.json` exists, parses, and has no literal secrets |

---

## Gate 1: JSON Validation Failure (`lint-json`)

### What Triggers It

The `lint-json` job scans every `*.json` and `*.jsonc` file in the repo (excluding `.git/`,
`node_modules/`, `.secrets/`) and runs `python3 -m json.tool` against each one. The job fails if
**any** file returns a non-zero exit code from `json.tool`.

**Note:** `opencode.json` uses JSONC syntax (comments with `//`). The CI strips comments before
validation. If you see a `//`-related failure, see Gate 4 (`smoke-config`) instead.

### How to Reproduce Locally

```bash
# From repo root — replicates the exact CI logic
for f in $(find . \
  -not -path "./.git/*" \
  -not -path "./node_modules/*" \
  -not -path "./.secrets/*" \
  \( -name "*.json" -o -name "*.jsonc" \) ); do
  echo -n "Checking $f ... "
  python3 -m json.tool "$f" > /dev/null 2>&1 && echo "OK" || echo "FAIL"
done
```

### How to Fix

1. **Identify the failing file** — the CI log shows `FAIL` next to the file path with the parser
   error message.

2. **Common causes:**
   - Trailing comma after the last item in an array or object:
     ```json
     { "key": "value", }   ❌
     { "key": "value" }    ✅
     ```
   - Missing comma between items:
     ```json
     { "a": 1 "b": 2 }    ❌
     { "a": 1, "b": 2 }   ✅
     ```
   - Unquoted keys:
     ```json
     { key: "value" }      ❌
     { "key": "value" }    ✅
     ```
   - Single-quoted strings (not valid in JSON):
     ```json
     { "key": 'value' }    ❌
     { "key": "value" }    ✅
     ```

3. **Fix the file** using a JSON-aware editor (VS Code highlights syntax errors).

4. **Re-validate locally** before pushing:
   ```bash
   python3 -m json.tool path/to/broken-file.json > /dev/null && echo "OK"
   ```

### How to Verify the Fix

```bash
# All files should print "OK"
for f in $(find . \
  -not -path "./.git/*" \
  -not -path "./node_modules/*" \
  -not -path "./.secrets/*" \
  \( -name "*.json" -o -name "*.jsonc" \) ); do
  python3 -m json.tool "$f" > /dev/null 2>&1 && echo "OK: $f" || echo "FAIL: $f"
done
```

**Passing looks like:** All lines print `OK: <filename>` with no `FAIL` lines.

---

## Gate 2: Dependency Audit Failure (`audit-deps`)

### What Triggers It

The `audit-deps` job installs npm/bun dependencies (`bun install --frozen-lockfile`) and runs
`bun audit --level high`. The job fails if any **high** or **critical** vulnerability is found
in a transitive or direct dependency.

### How to Reproduce Locally

```bash
# Must have Bun installed: https://bun.sh
bun install --frozen-lockfile
bun audit --level high
```

### How to Fix

**Option A — Update the vulnerable package:**
```bash
# Update a specific package
bun update <package-name>

# Update all packages (check changelogs first for breaking changes)
bun update

# Verify the fix
bun audit --level high
```

**Option B — Override (use only if no fix is available):**
```bash
# Add an override in package.json
# (Bun supports "overrides" to pin transitive dependencies)
# "overrides": { "vulnerable-package": ">=safe-version" }
```

**Option C — Remove the dependency** if it is no longer needed:
```bash
bun remove <package-name>
```

### How to Verify the Fix

```bash
bun audit --level high
# Should exit 0 with: "No vulnerabilities found" or only low/medium severity items.
```

---

## Gate 3: Secret Scan Failure (`secret-scan`)

### What Triggers It

The `secret-scan` job scans all tracked files (excluding `.git/`, `node_modules/`, `.secrets/`)
for patterns that indicate a hardcoded secret value — not the approved `{file:.secrets/...}`
indirection pattern.

**Patterns detected:**
- Long API key / token values (16+ characters) assigned to keys like `API_KEY`, `ACCESS_TOKEN`, `SECRET`, `PASSWORD`
- Common provider key formats: `sk-...` (OpenAI), `ghp_...` (GitHub PAT), `ghs_...`, `AKIA...` (AWS)

**Safe pattern (not flagged):** `"{file:.secrets/filename}"` — this is the approved indirection.

### How to Reproduce Locally

```bash
# Simplified local version of the secret scan
PATTERNS=(
  'sk-[A-Za-z0-9]{20,}'
  'ghp_[A-Za-z0-9]{36}'
  'AKIA[0-9A-Z]{16}'
  '[Aa][Pp][Ii][_-]?[Kk][Ee][Yy][[:space:]]*[:=][[:space:]]*"[A-Za-z0-9+/=_\-]{16,}"'
)

for pattern in "${PATTERNS[@]}"; do
  echo "Pattern: $pattern"
  grep -rEn \
    --exclude-dir=.git \
    --exclude-dir=node_modules \
    --exclude-dir=.secrets \
    "$pattern" . 2>/dev/null \
    | grep -v '{file:\.secrets/' \
    | grep -v '^Binary' \
    && echo "  ❌ MATCH FOUND" || echo "  ✅ Clean"
done
```

### How to Fix

**Never commit secrets.** If a secret was committed:

1. **Immediately revoke** the exposed secret at its provider (GitHub, OpenAI, AWS, etc.)
2. **Generate a new secret** from the provider dashboard
3. **Remove the secret from the file:**
   - Replace the literal value with the `{file:.secrets/filename}` pattern:
     ```json
     "GITEA_ACCESS_TOKEN": "{file:.secrets/gitea-token}"
     ```
   - Or remove the value entirely if it is not needed
4. **Store the new secret** in `.secrets/` (gitignored):
   ```bash
   echo "new-secret-value" > ~/.config/opencode/.secrets/the-secret-name
   chmod 600 ~/.config/opencode/.secrets/the-secret-name
   ```
5. **Rewrite git history** if the secret was in a previous commit (requires force push):
   ```bash
   # Use git-filter-repo (preferred) or BFG Repo-Cleaner
   pip install git-filter-repo
   git filter-repo --replace-text <(echo "old-secret-value==>REDACTED")
   # Then force push (coordinate with team — this rewrites history)
   git push --force-with-lease origin main
   ```
6. **Notify your team** that the secret was exposed and history was rewritten.

### How to Verify the Fix

```bash
# Re-run the scan — should produce no matches
grep -rEn \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  --exclude-dir=.secrets \
  'sk-[A-Za-z0-9]{20,}' . 2>/dev/null | grep -v '{file:' || echo "Clean"
```

**Passing:** No output (or only lines containing `{file:.secrets/...}`).

---

## Gate 4: Smoke Config Failure (`smoke-config`)

### What Triggers It

The `smoke-config` job validates `opencode.json` at the structural level:
- Confirms the file exists at repo root
- Parses it as JSON (strict)
- Checks for potential literal secrets (long token-like strings not using `{file:}` pattern)
- Reports missing recommended keys (`mcp`, `agent`, `provider`) as warnings

### How to Reproduce Locally

```bash
# Step 1: Basic JSON validation
python3 -m json.tool opencode.json > /dev/null && echo "JSON OK" || echo "JSON FAILED"

# Step 2: Structural check (matches what CI runs)
python3 -c "
import json, re, sys
with open('opencode.json', 'r') as f:
    raw = f.read()
try:
    config = json.loads(raw)
except json.JSONDecodeError as e:
    print(f'Parse error: {e}')
    sys.exit(1)

def check(obj, path=''):
    if isinstance(obj, dict):
        for k, v in obj.items():
            check(v, f'{path}.{k}')
    elif isinstance(obj, str):
        if re.search(r'[A-Za-z0-9+/=_\-]{32,}', obj) and not obj.startswith('{file:'):
            if not obj.startswith('http'):
                print(f'WARNING: Possible literal secret at {path}')

check(config)
print('Structural check complete.')
"
```

### How to Fix

See [`config-error.md`](./config-error.md) for detailed guidance on:
- JSON syntax errors
- Missing secret files
- Literal secrets in config

### How to Verify the Fix

```bash
python3 -m json.tool opencode.json > /dev/null && echo "✅ JSON OK"
```

**Passing:** `✅ JSON OK` with exit code 0.

---

## CI Runner Unreachable (Gitea Actions Down)

If the Gitea Actions runner is unreachable or CI jobs are not starting, the problem is
infrastructure-level, not code-level.

### Symptoms

- Push to `feat/**` branch triggers no CI run in the Gitea UI
- CI run is queued indefinitely with no log output
- Gitea UI shows runner as "offline" or "idle" with no agents picking up jobs

### Diagnosis

```bash
# Check if the Gitea server itself is reachable
curl -v --max-time 10 https://gitea.istmocenter.com/api/v1/version

# Check CI run status via the Gitea API
GITEA_TOKEN=$(cat ~/.config/opencode/.secrets/gitea-token)
curl -H "Authorization: token $GITEA_TOKEN" \
     "https://gitea.istmocenter.com/api/v1/repos/<owner>/<repo>/actions/runs?limit=5" \
     | python3 -m json.tool
```

### Resolution

1. **Contact your infrastructure team** — the Gitea Actions runner is a self-hosted service.
2. **Check runner registration:** In Gitea UI → Repository → Settings → Actions → Runners.
   Verify at least one runner is online.
3. **Restart the runner** (if you have access):
   ```bash
   # On the runner host
   systemctl restart gitea-runner   # or the equivalent service name
   ```
4. **Run quality gates locally** while the runner is down:
   ```bash
   # Gate 1: JSON lint
   python3 -m json.tool opencode.json > /dev/null && echo "OK"

   # Gate 3: Quick secret check
   grep -rn 'sk-[A-Za-z0-9]\{20,\}' --exclude-dir=.git --exclude-dir=.secrets . || echo "Clean"

   # Gate 4: Config smoke test
   python3 -m json.tool opencode.json > /dev/null && echo "Config OK"
   ```
5. **Do not merge to `main`** until CI passes — treat local passing as a temporary exception
   only, and re-verify on CI once the runner is back online.
