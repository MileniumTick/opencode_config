# Week 3 — Contract Parity Drift Matrix (Batch 2)

## Scope

Baseline generado para Semana 3 Batch 1 sobre cuatro dimensiones:

1. Task states y transiciones (`contract` ↔ `runtime`)
2. Tools `team_*` args schema (top-level)
3. Top-level response shape de comandos críticos
4. DDL baseline actual del runtime

## Evidencia reproducible

- Script: `scripts/week3/contract-parity-baseline.ts`
- Comando: `bun scripts/week3/contract-parity-baseline.ts`
- Artefactos JSON:
  - `specs/baselines/week3-contract-parity/task-state-drift.evidence.json`
  - `specs/baselines/week3-contract-parity/tool-args-schema.snapshot.json`
  - `specs/baselines/week3-contract-parity/tool-response-top-level.snapshot.json`
  - `specs/baselines/week3-contract-parity/runtime-ddl-baseline.json`
  - `specs/baselines/week3-contract-parity/runtime-ddl.diff.json`

## Matriz de drift

| ID | Dimensión | Severidad | Estado | Evidencia | Referencias (archivo + sección) | Owner sugerido |
|---|---|---|---|---|---|---|
| D1 | Task status vocabulary | **critical** | ✅ Resuelto en Batch 2 | `task-state-drift.evidence.json` (`missing_in_runtime: []`, `extra_in_runtime: []`) | Contract: `specs/contracts/runtime-operating-contract-v1.md` §1.3 Task States · Runtime: `plugins/agent-teams-runtime/shared/constants.ts` (`ACTIVE_TASK_STATUSES`, `TASK_TRANSITIONS`) · Runtime ops: `plugins/agent-teams-runtime/domains/tasks.ts` | Runtime core |
| D2 | Task transitions graph | **critical** | ✅ Resuelto en Batch 2 | `task-state-drift.evidence.json` (`transition_mismatches: []`) | Contract: `specs/contracts/runtime-operating-contract-v1.md` §1.3 Task States · Runtime: `plugins/agent-teams-runtime/shared/constants.ts` (`TASK_TRANSITIONS`) | Runtime core |
| D3 | Tool args schema parity (`team_*`) | low | Baseline congelado (sin drift vs snapshot inicial) | `tool-args-schema.snapshot.json` | Runtime registration: `plugins/agent-teams-runtime/index.ts` + `plugins/agent-teams-runtime/compat/tool-registry.ts` | Verify/tooling |
| D4 | Tool response top-level shape (critical commands) | low | Baseline congelado | `tool-response-top-level.snapshot.json` | Runtime outputs: `plugins/agent-teams-runtime/index.ts`, `plugins/agent-teams-runtime/domains/tasks.ts`, `plugins/agent-teams-runtime/domains/delegations.ts`, `plugins/agent-teams-runtime/domains/mailbox.ts`, `plugins/agent-teams-runtime/domains/recovery.ts` | Verify/tooling |
| D5 | DDL baseline | medium | Baseline congelado; primer run sin baseline previo reporta "added" esperado | `runtime-ddl-baseline.json`, `runtime-ddl.diff.json` | DB schema: `plugins/agent-teams-runtime/shared/db.ts` | Runtime core |

## Notas clave

- D1 y D2 quedaron cerrados al converger `TASK_TRANSITIONS` al contrato canónico §1.3.
- Se agregó capa de compatibilidad para estados legacy (`claimed`, `review_needed`, `verified`, `cancelled`) mediante normalización a estados canónicos.
- Herramientas `team_*` se mantienen estables en nombres/args; la semántica de estado reportado ahora es canónica (`in_progress` en lugar de `claimed`).
- Snapshots de args/response/DDL se regeneraron sin drift estructural adicional (`tool_count: 32`, `ddl_drift_detected: false`).
