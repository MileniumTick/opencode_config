# Persistence Mode Resolution v1

## Purpose

Define a schema-safe persistence mode resolution chain without custom keys in `opencode.json`.

## Valid Modes

`engram | openspec | hybrid | none`

## Resolution Order (Canonical)

1. `PERSISTENCE_MODE` (environment variable)
2. Project file: `agents/persistence-mode.json` → `mode`
3. Global file: `~/.config/opencode/persistence.json` → `mode`
4. Default: `hybrid`

Legacy compatibility (transitional):
- `.opencode/persistence.yaml`
- `~/.config/opencode/persistence.yaml`

## Notes

- `opencode.json` must remain schema-valid and SHOULD NOT include non-schema keys such as `persistence`.
- Runtime and SDD docs should reference this contract for persistence mode behavior.
