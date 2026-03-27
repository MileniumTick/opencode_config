# Tasks: semana-2-runtime-modularization

## Contexto

Plan de Semana 2 para modularizar `plugins/agent-teams-runtime.ts` por dominios, manteniendo **paridad funcional** con el contrato runtime v1 y **sin cambios de comportamiento**.

Specs base:
- `specs/contracts/runtime-operating-contract-v1.md`
- `specs/semana-1-runtime-canonical-contract-delta-spec.md`

No incluye implementación funcional nueva; solo extracción/organización segura (strangler refactor).

---

## Módulos destino (arquitectura objetivo)

- `plugins/agent-teams-runtime/index.ts` (bootstrap + wiring final de tools/events)
- `plugins/agent-teams-runtime/shared/types.ts` (row types, status unions, contracts comunes)
- `plugins/agent-teams-runtime/shared/constants.ts` (status sets, transition maps)
- `plugins/agent-teams-runtime/shared/db.ts` (init DB, schema/indexes, helpers comunes)
- `plugins/agent-teams-runtime/shared/guards.ts` (requireTeam/Task/Delegation/Mailbox/Agent)
- `plugins/agent-teams-runtime/shared/events.ts` (log runtime events)
- `plugins/agent-teams-runtime/domains/tasks.ts`
- `plugins/agent-teams-runtime/domains/delegations.ts`
- `plugins/agent-teams-runtime/domains/mailbox.ts`
- `plugins/agent-teams-runtime/domains/recovery.ts`
- `plugins/agent-teams-runtime/domains/git-work-items.ts`
- `plugins/agent-teams-runtime/domains/artifact-links.ts`
- `plugins/agent-teams-runtime/compat/tool-registry.ts` (mapa canónico `team_*`)
- `plugins/agent-teams-runtime/compat/event-handlers.ts` (event bridge `message.updated`/`session.error`)

---

## Estrategia incremental (Strangler)

1. **Congelar superficie pública**: snapshot de comandos expuestos actuales (`team_*`) y contratos de input/output.
2. **Extraer shared sin mover lógica de negocio**: constants/types/helpers/db/guards/events en módulos nuevos con imports desde archivo monolítico.
3. **Introducir fachada de compatibilidad**: `compat/tool-registry.ts` y `compat/event-handlers.ts` para mantener nombres y wiring idénticos.
4. **Migrar dominio por dominio**: mover implementación interna de cada tool al módulo destino, manteniendo firma y JSON output.
5. **Verificar paridad en cada corte**: compila + misma lista de tools + schema SQL sin drift + smoke de comandos críticos.
6. **Reducir monolito a orquestador**: `agent-teams-runtime.ts` queda como entrypoint temporal/bridge o reemplazado por `index.ts` con export default equivalente.

Regla de seguridad por paso: *si falla paridad, revertir extracción del dominio actual sin tocar otros dominios*.

---

## Phase 1: Foundation (quick wins + baseline)

- [ ] 1.1 Crear documento de baseline de API runtime: inventario de 32 tools `team_*`, eventos, y shape de respuestas JSON actuales.
- [x] 1.2 Definir estructura de carpetas/módulos destino bajo `plugins/agent-teams-runtime/` sin mover lógica todavía.
- [x] 1.3 Extraer `shared/types.ts` con todos los `*Row`, contracts y utilidades de tipos compartidos.
- [x] 1.4 Extraer `shared/constants.ts` con status sets/transitions alineados al contrato canónico v1.
- [x] 1.5 Extraer `shared/db.ts` (schema + indexes + helpers de inicialización) sin alterar SQL.
- [x] 1.6 Crear `compat/tool-registry.ts` con snapshot explícito de nombres públicos y orden estable.

## Phase 2: Shared runtime scaffolding

- [x] 2.1 Extraer `shared/guards.ts` (`requireTeam`, `requireTask`, etc.) y reemplazar llamadas internas en monolito. (depends on 1.3, 1.5)
- [x] 2.2 Extraer `shared/events.ts` para centralizar `runtime_events` logging y payload typing. (depends on 1.3, 1.5)
- [x] 2.3 Extraer utilidades puras (`parseIdList`, `truncateText`, `parseMetadataJson`, etc.) a `shared/utils.ts`. (depends on 1.3)
- [x] 2.4 Crear `compat/event-handlers.ts` para `message.updated` y `session.error` usando API idéntica. (depends on 2.2)

## Phase 3: Domain extraction (núcleo)

- [x] 3.1 Extraer dominio `tasks.ts` (`team_task_*`) manteniendo transiciones y estados actuales sin renombrados funcionales. (depends on 2.1, 2.2)
- [x] 3.2 Extraer dominio `delegations.ts` (`team_delegation_*`) conservando reglas de transición/launch/sync. (depends on 2.1, 2.2, 3.1)
- [x] 3.3 Extraer dominio `mailbox.ts` (`team_mailbox_*`) con estados `pending/read/resolved` sin cambios. (depends on 2.1, 2.2)
- [x] 3.4 Extraer dominio `recovery.ts` (`team_recovery_*` + `team_checkpoint_*`) preservando auditoría y notas. (depends on 3.2, 3.3)
- [x] 3.5 Extraer dominio `git-work-items.ts` (`team_git_work_item_*`) con misma policy y validaciones live. (depends on 2.1, 2.2)
- [x] 3.6 Extraer dominio `artifact-links.ts` (`team_artifact_link_*`) y validaciones de entidad/scope. (depends on 2.1, 2.2)

## Phase 4: Integration + hardening

- [x] 4.1 Crear `index.ts` como composición final de módulos (db/shared/domains/compat), manteniendo export plugin equivalente. (depends on 3.1-3.6)
- [x] 4.2 Mantener `plugins/agent-teams-runtime.ts` como thin wrapper o redirección temporal para backward compatibility interna. (depends on 4.1)
- [x] 4.3 Ejecutar validación de paridad de comandos: mismos 32 nombres `team_*`, mismas firmas/required fields, mismo shape top-level en responses. (depends on 4.1)
- [ ] 4.4 Ejecutar validación de schema: DDL e índices sin drift (compatibilidad DB completa, sin migraciones). (depends on 4.1)
- [ ] 4.5 Documentar decision log de modularización + mapa de ownership por dominio para Semana 3. (depends on 4.3, 4.4)

---

## Definition of Done por módulo

### Shared (types/constants/db/helpers)
- [ ] Compila sin errores TypeScript/Bun.
- [ ] No cambia SQL DDL ni índices existentes.
- [ ] Todos los imports consumidores usan los nuevos módulos sin duplicación.

### tasks
- [ ] Se exponen exactamente: `team_task_create`, `team_task_list`, `team_task_claim`, `team_task_release`, `team_task_block`, `team_task_unblock`, `team_task_complete`.
- [ ] Misma semántica y transiciones que baseline vigente.
- [ ] Smoke test manual de claim/release/block/unblock/complete sin regresiones.

### delegations
- [ ] Se exponen exactamente: `team_delegation_create`, `team_delegation_transition`, `team_delegation_launch`, `team_delegation_sync`.
- [ ] Transiciones válidas/terminales idénticas a baseline.
- [ ] Event bridge (`message.updated`, `session.error`) sigue sincronizando igual.

### mailbox
- [ ] Se exponen exactamente: `team_mailbox_send`, `team_mailbox_list`, `team_mailbox_transition`.
- [ ] Estados `pending/read/resolved` y timestamps sin cambios.

### recovery
- [ ] Se exponen exactamente: `team_recovery_inspect`, `team_recovery_requeue_stale_claims`, `team_recovery_resolve_delegations`, `team_recovery_reassign_delegation`, `team_recovery_resolve_mailbox`.
- [ ] Se mantienen garantías de auditoría (`note`, cambios explícitos).

### git work items
- [ ] Se exponen exactamente: `team_git_work_item_upsert`, `team_git_work_item_list`, `team_git_work_item_validate`.
- [ ] Misma compatibilidad con estado real de git.

### artifact links
- [ ] Se exponen exactamente: `team_artifact_link_create`, `team_artifact_link_list`.
- [ ] Validación de entidad/ID y metadata JSON sin cambios.

### Integración final
- [ ] Plugin exporta la misma superficie pública.
- [ ] DB schema compatible 100% (sin migración requerida).
- [ ] No se detectan cambios funcionales observables por consumidores de tools.

---

## Riesgos técnicos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Import cycles entre dominios/shared | Build roto o init parcial | Regla de dependencias en una dirección: `shared -> domains -> compat -> index`; prohibir imports cruzados entre dominios |
| Drift de transacciones al mover lógica | Inconsistencia runtime | Mantener boundaries de transacción actuales; mover bloques completos, no fragmentados |
| Race conditions en claim/lease y recovery | Estados incoherentes | Preservar queries atómicas y orden de updates; agregar smoke concurrente mínimo por dominio crítico |
| Cambio accidental de naming público `team_*` | Ruptura de consumidores externos | `compat/tool-registry.ts` con lista canónica + check automatizable de igualdad de nombres |
| Divergencia de schema SQL | Incompatibilidad de DB existente | Extraer DDL literal a `shared/db.ts` sin editar; diff textual contra baseline antes de merge |
| Cambios de shape JSON en responses | Ruptura de parsing aguas abajo | Snapshot de respuestas críticas en baseline y comparación por keys obligatorias |
| Acoplamiento oculto de event handlers con delegations | Sync incompleto | Extraer `compat/event-handlers.ts` con tests/smoke explícitos de `message.updated` y `session.error` |

---

## Orden propuesto (1 semana, quick wins primero)

### Día 1 (Quick wins)
- 1.1, 1.2, 1.3, 1.4

### Día 2
- 1.5, 1.6, 2.1

### Día 3
- 2.2, 2.3, 2.4, 3.1

### Día 4
- 3.2, 3.3

### Día 5
- 3.4, 3.5, 3.6

### Día 6
- 4.1, 4.2, 4.3

### Día 7 (cierre)
- 4.4, 4.5 + buffer de regresiones

---

## Dependencies

| Task | Depends On |
|------|------------|
| 2.1 | 1.3, 1.5 |
| 2.2 | 1.3, 1.5 |
| 2.4 | 2.2 |
| 3.1 | 2.1, 2.2 |
| 3.2 | 2.1, 2.2, 3.1 |
| 3.3 | 2.1, 2.2 |
| 3.4 | 3.2, 3.3 |
| 3.5 | 2.1, 2.2 |
| 3.6 | 2.1, 2.2 |
| 4.1 | 3.1, 3.2, 3.3, 3.4, 3.5, 3.6 |
| 4.2 | 4.1 |
| 4.3 | 4.1 |
| 4.4 | 4.1 |
| 4.5 | 4.3, 4.4 |

---

## Estimated Complexity

- Phase 1: Medium
- Phase 2: Medium
- Phase 3: High
- Phase 4: Medium
