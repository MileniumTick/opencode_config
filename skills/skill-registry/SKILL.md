---
name: skill-registry
description: Automatic skill discovery and registry generation for agent orchestrator
---

# Skill Registry

Automatically scans and indexes all available skills for the agent orchestrator.

## Overview

This skill enables sub-agents to discover skills automatically without orchestrator intervention by:

1. Scanning skill directories
2. Detecting project conventions
3. Generating a registry file
4. Validating skill accessibility

## Scanning Locations

The registry scans in priority order:

```
1. ~/.agents/skills/           # Global user skills
2. .agents/skills/             # Project-local skills
3. ~/.config/opencode/skills/ # Default skill location
```

## Usage

### As Orchestrator Tool

```
Skill: skill-registry
Action: scan-and-register
```

### Direct Execution

```bash
# Scan and generate registry
./skills/skill-registry/scan.sh

# Force refresh
./skills/skill-registry/scan.sh --force

# With custom paths
./skills/skill-registry/scan.sh --paths ~/.custom/skills ./project/skills
```

## Scanning Algorithm

```typescript
interface ScanResult {
  skills: Skill[]
  conventions: Convention[]
  errors: string[]
  warnings: string[]
}

async function scanSkills(): Promise<ScanResult> {
  const locations = resolveSkillLocations()
  const skills: Skill[] = []
  const conventions = detectConventions()
  const errors: string[] = []
  const warnings: string[] = []

  for (const location of locations) {
    if (!exists(location)) {
      warnings.push(`Location not found: ${location}`)
      continue
    }

    const found = await scanDirectory(location)
    skills.push(...found)
  }

  // Validate each skill
  for (const skill of skills) {
    const valid = await validateSkill(skill)
    if (!valid) {
      errors.push(`Invalid skill: ${skill.name}`)
    }
  }

  return { skills, conventions, errors, warnings }
}
```

## Skill Detection

### Discovery Pattern

Skills are identified by:

1. **Directory with SKILL.md** — Primary indicator
2. **name in frontmatter** — Required field
3. **description in frontmatter** — Required field

### Example Skill Structure

```
skill-name/
└── SKILL.md
```

### SKILL.md Frontmatter Format

```yaml
---
name: skill-name
description: One-line description of skill purpose
---
```

## Convention Detection

The scanner detects project conventions from:

| File | What it tells us |
|------|------------------|
| `AGENTS.md` | Orchestrator configuration |
| `CLAUDE.md` | Claude-specific rules |
| `.cursorrules` | Cursor IDE rules |
| `opencode.json` | Project configuration |

### Detection Logic

```typescript
function detectConventions(): Convention[] {
  const conventions: Convention[] = []
  const root = process.cwd()

  const files = [
    'AGENTS.md',
    'CLAUDE.md',
    '.cursorrules',
    'opencode.json'
  ]

  for (const file of files) {
    const path = join(root, file)
    if (exists(path)) {
      conventions.push({
        type: file.replace('.md', '').replace('.json', ''),
        path,
        detected: true
      })
    }
  }

  return conventions
}
```

## Registry Generation

### Output Location

```
.atl/skill-registry.md
```

### Format

```markdown
# Skill Registry

Generated: 2026-01-15T14:30:00Z
Workdir: /Users/jchavarriam/project
Mode: hybrid

## Skills Table

| Trigger | Skill Name | Path | Description |
|---------|------------|------|-------------|
| auth | better-auth-best-practices | ~/.config/opencode/skills/better-auth/ | Authentication patterns |
| backend | backend-elysia | ~/.config/opencode/skills/backend-elysia/ | Elysia + Drizzle + Better Auth |
| db | drizzle-orm | ~/.config/opencode/skills/drizzle-orm/ | ORM patterns |
| docker | docker-openserve | ~/.config/opencode/skills/docker-openserve/ | Docker + observability |
| frontend | frontend-react | ~/.config/opencode/skills/frontend-react/ | React patterns |
| testing | testing-workflow | ~/.config/opencode/skills/testing-workflow/ | Testing strategy |
| sdd | sdd-workflow | ~/.config/opencode/skills/sdd-workflow/ | SDD workflow |
| memory | memory-engram | ~/.config/opencode/skills/memory-engram/ | Persistent memory |

## Project Conventions

| Convention | Found | Path |
|------------|-------|------|
| AGENTS.md | ✅ | ./AGENTS.md |
| CLAUDE.md | ❌ | - |
| .cursorrules | ❌ | - |
| opencode.json | ✅ | ./opencode.json |

## Persistence

- Mode: hybrid
- Engram available: true
- Fallback: .atl/

## Scan Metadata

- Locations scanned: 3
- Skills found: 8
- Errors: 0
- Warnings: 1
```

## Persistence Integration

### Using Engram (if available)

The registry can persist to Engram for cross-session availability:

```typescript
async function saveToEngram(scanResult: ScanResult) {
  await mem_save({
    title: 'skill-registry-scan',
    type: 'artifact',
    content: `
**What**: Scanned and indexed ${scanResult.skills.length} skills
**Where**: ${scanResult.locations.join(', ')}
**Learned**: ${scanResult.errors.length} errors found
    `,
    topic_key: 'sdd/skill-registry/scan'
  })
}
```

### Fallback Chain

```
Engram → .atl/skill-registry.md → Console output
```

## Validation

### Skill Validation Rules

Each discovered skill MUST pass:

1. **File exists**: `SKILL.md` present in directory
2. **Frontmatter valid**: Valid YAML with name and description
3. **Readable**: File permissions allow reading
4. **Path absolute**: Path resolved to absolute form

### Validation Function

```typescript
async function validateSkill(skill: Skill): Promise<boolean> {
  // Check SKILL.md exists
  const skillFile = join(skill.path, 'SKILL.md')
  if (!exists(skillFile)) {
    return false
  }

  // Check frontmatter
  const content = await readFile(skillFile)
  const frontmatter = parseFrontmatter(content)

  if (!frontmatter.name || !frontmatter.description) {
    return false
  }

  // Check read permission
  try {
    await readFile(skillFile)
  } catch {
    return false
  }

  return true
}
```

## Result Contract

All skill-registry operations return:

```typescript
interface RegistryResult {
  status: 'success' | 'partial' | 'blocked'
  summary: string
  artifacts: {
    registry: string      // Path to generated registry
    skills: number        // Count of skills found
  }
  validation: {
    valid: number
    invalid: number
    errors: string[]
  }
  next: string            // Next action or 'none'
  risks: string[]         // Potential issues
}
```

## Error Handling

| Error | Handling |
|-------|----------|
| No skills found | Return warning, empty registry |
| Permission denied | Skip location, continue scan |
| Invalid frontmatter | Mark as invalid, include in errors |
| Write failure | Try Engram, then fail gracefully |

## Sub-Agent Usage

Sub-agents can discover skills without orchestrator:

```typescript
// Inside sub-agent
const registry = await readRegistry()
const matchingSkills = registry.skills.filter(s =>
  s.trigger.includes(requestedDomain)
)
```

## Testing

Run smoke tests:

```bash
./skills/skill-registry/test.sh
```

Expected output:
- Skills found count matches actual directories
- All paths are absolute
- Registry is valid markdown
- All skills pass validation
