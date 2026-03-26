# SDD Workflow Skills

This folder contains the sub-agents for the SDD workflow.

## Structure

```
sdd-workflow/
├── SKILL.md              # Orchestrator core (main entry)
└── skills/
    ├── sdd-explore/      # Codebase investigation
    ├── sdd-spec/         # Requirements definition
    ├── sdd-tasks/        # Implementation planning
    ├── sdd-apply/        # Code implementation
    ├── sdd-verify/       # Quality verification
    ├── sdd-archive/      # Close change
    └── quick-delegate/   # Fast routing for small tasks
```

## Usage

The orchestrator (me) delegates to these skills as needed:

1. **Quick tasks** → `quick-delegate` → domain skill
2. **Small features** → `sdd-explore` → `sdd-spec` → `sdd-apply` → `sdd-verify` → `sdd-archive`
3. **Large features** → Full SDD: explore → spec → design → tasks → apply → verify → archive

## Commands

| Command | Phase |
|---------|-------|
| `/sdd-init` | Initialize project context |
| `/sdd-explore <topic>` | Investigate codebase |
| `/sdd-spec <name>` | Write specs |
| `/sdd-tasks` | Plan tasks |
| `/sdd-apply` | Implement code |
| `/sdd-verify` | Verify quality |
| `/sdd-archive` | Close change |

## Result Contract

All sub-agents return:
```
**Status**: success | partial | blocked
**Summary**: 1-3 sentences
**Artifacts**: files or topic keys
**Next**: next phase or "none"
**Risks**: issues or "None"
```
