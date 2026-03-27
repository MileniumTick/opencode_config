# Runtime Recovery Runbook (Operativo Inicial)

## Objetivo

Procedimiento mínimo y auditable para recuperar operación del runtime (`team_*`) sin inventar estados, manteniendo compatibilidad con el contrato canónico.

Contrato de referencia: `specs/contracts/runtime-operating-contract-v1.md`.

## Pool estático + asignación dinámica (operativo)

Desde esta versión, `team_delegation_launch` ejecuta preflight duro y aplica fallback **solo** cuando la policy explícita lo permite.

### Configuración activa

- Config runtime (plugin): `agents/runtime-config.json`
- Pool estático de workers: `agents/runtime-worker-pool.json`
- Overrides por ENV:
  - `AGENT_TEAMS_RUNTIME_CONFIG`
  - `AGENT_TEAMS_RUNTIME_WORKER_POOL_FILE`
  - `AGENT_TEAMS_RUNTIME_SELECTION_STRATEGY`

Parámetros esperados:
- `selection_strategy`: `least-busy` o `round-robin` (ambos activos)
- `delegation_launch.fallback_reassign`: `pool` (default) o `disabled`
- `workers[]`: `agent_name`, `role`, `capabilities[]`
- Preflight operativo en launch: target configurado, registrado en team runtime, estado `idle|waiting`, lease vigente, capability compatible (si delegación declara `capabilities:` en prompt)

### Semántica final de preflight en `team_delegation_launch`

1. `target_agent` debe pasar preflight duro antes de launch real:
   - presente en configuración activa del proyecto
   - visible en runtime registry de OpenCode
   - registrado en `agents` para el `team_id`
   - estado operativo `idle|waiting`
   - lease vigente
   - capabilities compatibles si el prompt declara `capabilities:`
2. Si falla preflight, el launch hace **fail-fast** con error claro y auditable (no launch simulado).
3. Fallback/reasignación automática solo existe bajo policy explícita:
   - `agents/runtime-config.json` → `delegation_launch.fallback_reassign`
   - valores: `pool` (habilitado) o `disabled` (sin fallback)
4. Con `fallback_reassign = disabled`:
   - no hay reasignación
   - delegación pasa a `failed`
   - se emite `delegation.preflight_failed_policy_blocked`
   - la tool responde con error explícito (`throw`) para fail-fast
5. Con `fallback_reassign = pool`:
   - se puede reasignar al pool elegible según strategy activa
   - se audita con `delegation.reassigned` y notificación mailbox al `source_agent`
   - si no hay candidato, delegación pasa a `failed`, evento `delegation.preflight_failed_no_candidate`, y la tool responde con error explícito (`throw`)

### Fallback dinámico en `team_delegation_launch` (policy `pool`)

Cuando el `target_agent` falla preflight y la policy lo permite:
1. Se selecciona candidato alternativo del pool (`least-busy`, empate por nombre estable).
2. Se reasigna la delegación en SQLite (auditable en runtime events).
3. Se notifica por mailbox al `source_agent` con motivos de preflight y agente seleccionado.

Si no hay candidatos elegibles:
- la delegación queda en `failed`
- `launch_error` explica claramente causa + razones de preflight
- se emite evento `delegation.preflight_failed_no_candidate`
- la tool falla de forma explícita (error) para impedir launch silencioso

## Comandos de verificación operativa (repo)

```bash
bun run verify:runtime
```

`verify:runtime` es alias del agregador canónico:

```bash
bun run verify:runtime:release
```

Desglose:

```bash
bun run verify:runtime:baseline
bun run verify:runtime:gates
bun run verify:runtime:strict
bun run verify:runtime:smoke
```

`verify:runtime:strict` valida contra baseline congelado (no regenera snapshots) y falla ante drift en:
- args schema
- response top-level shapes
- runtime DDL
- task-state contract drift

Compromiso actual (2026-03-27): en CI de PR `verify:runtime:strict` es **blocking por defecto**.

Bypass explícito y auditable (solo incidente):
- Variable `RUNTIME_STRICT_BYPASS=1` (repo/org) habilita bypass temporal.
- Metadata obligatoria:
  - `RUNTIME_STRICT_BYPASS_REASON`
  - `RUNTIME_STRICT_BYPASS_TICKET`
  - `RUNTIME_STRICT_BYPASS_APPROVED_BY`
  - `RUNTIME_STRICT_BYPASS_EXPIRES_AT` (ISO-8601 futuro)
- El workflow valida metadata completa; sin ella, falla.
- Se deja evidencia en logs (`Runtime strict bypass notice`).

## Flujo recomendado de recovery

> Todos los pasos usan herramientas runtime reales (`team_*`) expuestas por `plugins/agent-teams-runtime`.

### 0) Crear checkpoint previo

Tool: `team_checkpoint_create`

Args sugeridos:

```json
{
  "team_id": "<TEAM_ID>",
  "checkpoint_type": "recovery",
  "note": "pre-recovery snapshot"
}
```

### 1) Inspeccionar estado y candidatos

Tool: `team_recovery_inspect`

```json
{
  "team_id": "<TEAM_ID>"
}
```

Revisar especialmente:
- `stale_claims`
- `stale_agents`
- `open_delegations`
- `unresolved_mailbox`
- `recovery_candidates.*`

### 2) Requeue de claims stale

Tool: `team_recovery_requeue_stale_claims`

```json
{
  "team_id": "<TEAM_ID>",
  "stale_agent_status": "recovering",
  "note": "requeue stale claims after inspection"
}
```

Resultado esperado:
- Tasks stale pasan a `ready`
- `claimed_by` / lease quedan limpios
- agentes impactados pasan a `recovering` u `offline`

### 3) Resolver delegations abiertas (si no son recuperables)

Tool: `team_recovery_resolve_delegations`

```json
{
  "team_id": "<TEAM_ID>",
  "delegation_ids": "<DELEGATION_ID_1>,<DELEGATION_ID_2>",
  "next_status": "timed_out",
  "target_agent_status": "recovering",
  "note": "operator recovery resolution"
}
```

Notas:
- `next_status` permitido: `cancelled | failed | timed_out`
- no resuelve mailbox automáticamente (paso explícito más abajo)

### 4) Reasignar delegación no lanzada (opcional)

Tool: `team_recovery_reassign_delegation`

```json
{
  "team_id": "<TEAM_ID>",
  "delegation_id": "<DELEGATION_ID>",
  "new_target_agent": "<AGENT_NAME>",
  "resolve_prior_mailbox": "yes",
  "note": "reassign to available agent"
}
```

Usar solo si la delegación está `requested/accepted` y no tiene `child_session_id`.

### 5) Resolver mailbox pendiente recuperado

Tool: `team_recovery_resolve_mailbox`

```json
{
  "team_id": "<TEAM_ID>",
  "message_ids": "<MESSAGE_ID_1>,<MESSAGE_ID_2>",
  "note": "resolved during recovery"
}
```

### 6) Verificación post-recovery

Tools útiles:
- `team_status`
- `team_task_list`
- `team_delegation_sync` (para delegaciones con child session)
- `team_mailbox_list`

Ejemplos:

```json
{
  "team_id": "<TEAM_ID>"
}
```

### 7) Crear checkpoint posterior

Tool: `team_checkpoint_create`

```json
{
  "team_id": "<TEAM_ID>",
  "checkpoint_type": "recovery",
  "note": "post-recovery snapshot"
}
```

## Smoke/CI mínimo

Workflow: `.github/workflows/runtime-smoke.yml`

Ejecuta en `push` y `pull_request`:
1. `bun run verify:runtime:release` (chain baseline→gates→strict→smoke; strict blocking por defecto salvo bypass explícito auditado)
2. `bun run verify:runtime:package` (genera manifest SHA-256 para evidencia de release)

### Playbook de bypass temporal (solo incidentes)

1) Setear en repo/org:
- `RUNTIME_STRICT_BYPASS=1`
- `RUNTIME_STRICT_BYPASS_REASON=<ticket o incidente>`
- `RUNTIME_STRICT_BYPASS_TICKET=<ID ticket/cambio>`
- `RUNTIME_STRICT_BYPASS_APPROVED_BY=<owner/aprobador>`
- `RUNTIME_STRICT_BYPASS_EXPIRES_AT=<ISO-8601 futuro>`

2) Confirmar en PR que:
- `Validate strict bypass metadata` pasa
- aparece `Runtime strict bypass notice` con metadata completa

3) Remover bypass al finalizar incidente:
- `RUNTIME_STRICT_BYPASS=0` (o eliminar variable)
- limpiar variables de metadata de bypass

Publica artefactos en:
- `specs/baselines/current/`
- `artifacts/runtime-release/`

## Drills + evidencia + observabilidad mínima

Los verifies de runtime (`verify:runtime:gates` y `verify:runtime:strict`) ejecutan un drill real con runtime tools y gate crítico `T7`.

### Qué valida `T7`

1. Evidencia mínima obligatoria:
   - `team_id`
   - `stale_task_id`
   - `delegation_id`

2. SLOs críticos:
   - `recovery_ops_success_rate_percent >= 100`
   - `stale_claim_requeue_coverage_percent >= 100`
   - `delegation_resolution_rate_percent >= 100`
   - `stale_claim_requeue_latency_ms <= 10000`

3. Invariantes de seguridad:
   - task stale termina `ready` y sin claim
   - task terminal `done` permanece inmutable

### Artefactos operativos del drill

Se publican en `specs/baselines/current/`:

- `runtime-observability.kpi.json`
- `runtime-recovery-drill.evidence.json`

Estos se suman al `compliance-gates.report.*` para trazabilidad en PR/CI.
