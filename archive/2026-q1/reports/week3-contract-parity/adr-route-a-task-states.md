# ADR — Week 3 Batch 2: Ruta A para task states (contrato↔runtime)

## Estado
Accepted (Semana 3 / Batch 2)

## Contexto

El baseline de Batch 1 reportó drift crítico:

- D1: vocabulario de estados task divergente entre contrato canónico y runtime.
- D2: grafo de transiciones task divergente.

Contrato fuente de verdad: `specs/contracts/runtime-operating-contract-v1.md` (§1.3).

## Decisión

Adoptar **Ruta A**: adaptar runtime al contrato canónico vigente con cambios mínimos y seguros.

### Cambios aplicados

1. `TASK_TRANSITIONS` alineado exactamente a estados canónicos:
   - `todo`, `ready`, `in_progress`, `blocked`, `review`, `done`, `failed`.
2. Eliminación de estados no canónicos del runtime activo:
   - `claimed`, `review_needed`, `verified`, `cancelled`.
3. Compatibilidad legacy explícita con normalización:
   - `claimed -> in_progress`
   - `review_needed -> review`
   - `verified -> done`
   - `cancelled -> failed`
4. Normalización de datos existentes al iniciar el dominio de tasks (idempotente).
5. Ajustes recovery para considerar terminales/task activos canónicos.

## Estrategia de compatibilidad y rollback

### Compatibilidad

- Los comandos `team_*` se mantienen (sin rename/remoción de tools).
- `team_task_list` acepta filtro `status` legacy y lo normaliza internamente.
- Estados persistidos legacy en SQLite se migran en sitio por normalización idempotente.

### Rollback

Si aparece regresión crítica operativa:

1. Revertir commits de Batch 2 en runtime task state.
2. Regenerar baseline con `bun scripts/week3/contract-parity-baseline.ts`.
3. Reabrir decisión para Ruta B solo con evidencia de incompatibilidad no mitigable.

## Evidencia de cierre D1/D2

- `specs/baselines/week3-contract-parity/task-state-drift.evidence.json`
  - `missing_in_runtime: []`
  - `extra_in_runtime: []`
  - `transition_mismatches: []`
- `specs/baselines/week3-contract-parity/baseline-summary.json`
  - `task_state_drift` en cero
