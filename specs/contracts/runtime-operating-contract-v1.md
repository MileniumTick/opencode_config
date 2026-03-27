# Runtime Operating Contract v1 (Canonical)

## Purpose

Establecer un contrato operativo único para alinear:

- estados runtime (team/agent/task/delegation/mailbox)
- flujo SDD y comandos canónicos del repositorio
- persistencia y orden de resolución

Este documento es **fuente canónica** para operación y documentación de runtime v1.

---

## 1) Canonical Runtime State Model

### 1.1 Team States

| Estado | Tipo | Descripción operacional | Transiciones permitidas |
|---|---|---|---|
| `active` | no terminal | Team operando normalmente | `paused`, `recovering`, `archived` |
| `paused` | no terminal | Operación detenida por decisión operativa | `active`, `recovering`, `archived` |
| `recovering` | no terminal | Team en reconciliación post-fallo/interrupción | `active`, `paused`, `archived` |
| `archived` | terminal | Team cerrado, sin nuevas operaciones activas | Ninguna |

### 1.2 Agent States

| Estado | Tipo | Descripción operacional | Transiciones permitidas |
|---|---|---|---|
| `idle` | no terminal | Disponible para tomar trabajo | `busy`, `waiting`, `recovering`, `offline` |
| `busy` | no terminal | Ejecutando tarea/delegación | `idle`, `waiting`, `recovering`, `offline` |
| `waiting` | no terminal | Bloqueado esperando input/dependencia | `idle`, `busy`, `recovering`, `offline` |
| `recovering` | no terminal | Estado temporal de recuperación | `idle`, `offline` |
| `offline` | no terminal | Sin heartbeat confiable o fuera de operación | `idle`, `recovering` |

### 1.3 Task States

| Estado | Tipo | Descripción operacional | Transiciones permitidas |
|---|---|---|---|
| `todo` | no terminal | Capturada, no lista para ejecución | `ready`, `blocked` |
| `ready` | no terminal | Lista para claim/ejecución | `in_progress`, `blocked`, `failed` |
| `in_progress` | no terminal | En ejecución activa | `review`, `blocked`, `ready`, `failed`, `done` |
| `blocked` | no terminal | Bloqueada por dependencia/riesgo | `ready`, `in_progress`, `failed` |
| `review` | no terminal | Lista para verify/archive/revisión | `in_progress`, `done`, `failed` |
| `done` | terminal | Completada | Ninguna |
| `failed` | terminal | Cerrada por fallo definitivo | Ninguna |

### 1.4 Delegation States

| Estado | Tipo | Descripción operacional | Transiciones permitidas |
|---|---|---|---|
| `requested` | no terminal | Delegación emitida, pendiente de aceptación/lanzamiento | `accepted`, `running`, `cancelled`, `failed`, `timed_out` |
| `accepted` | no terminal | Delegación aceptada por target agent | `running`, `cancelled`, `failed`, `timed_out` |
| `running` | no terminal | Delegación en ejecución (idealmente child session real) | `completed`, `failed`, `cancelled`, `timed_out` |
| `completed` | terminal | Delegación terminada con resultado usable | Ninguna |
| `failed` | terminal | Delegación termina por error/fallo | Ninguna |
| `cancelled` | terminal | Delegación cancelada explícitamente | Ninguna |
| `timed_out` | terminal | Delegación cerrada por timeout operativo | Ninguna |

### 1.5 Mailbox Message States

| Estado | Tipo | Descripción operacional | Transiciones permitidas |
|---|---|---|---|
| `pending` | no terminal | Mensaje creado, pendiente de lectura | `read`, `resolved` |
| `read` | no terminal | Mensaje leído, aún accionable | `resolved` |
| `resolved` | terminal | Mensaje cerrado operacionalmente | Ninguna |

---

## 2) Critical State Semantics

1. **Single live authority for coordination**
   - Estados vivos y ownership se resuelven en runtime store (SQLite), no en Engram.

2. **Terminal states are immutable**
   - `done/failed/completed/cancelled/timed_out/resolved/archived` no deben mutarse sin operación explícita de reapertura (fuera de v1).

3. **Recovery is explicit and auditable**
   - Cambios masivos de reconciliación deben pasar por acciones de recovery explícitas y registrar nota/auditoría.

4. **Delegation cannot be “invented” as completed**
   - `completed` requiere evidencia runtime sincronizada (child session o resolución explícita auditada).

5. **Mailbox is not a task board**
   - Mensajes acompañan coordinación; no reemplazan estados de task/delegation.

---

## 3) Canonical SDD Flow and Commands

### 3.1 Canonical Phase Order

`init -> explore -> spec -> tasks -> apply -> verify -> archive`

### 3.2 Canonical Commands (Repo)

| Comando | Semántica canónica |
|---|---|
| `/sdd-init` | Inicializa contexto del proyecto |
| `/sdd-explore <topic>` | Explora estado actual y riesgos |
| `/sdd-spec <name>` | Define delta spec (Given/When/Then) |
| `/sdd-tasks` | Descompone el spec en checklist por fases |
| `/sdd-apply` | Implementa tareas planificadas |
| `/sdd-verify` | Verifica implementación contra spec |
| `/sdd-archive` | Cierra el cambio y persiste estado final |
| `/sdd-new <name>` | Atajo para iniciar flujo (debe aterrizar al flujo canónico) |
| `/sdd-continue` | Avanza a la siguiente fase pendiente canónica |
| `/sdd-ff` | Fast-forward de planificación permitido solo si mantiene outputs equivalentes de `explore/spec/tasks` |

### 3.3 Canonical Rule for Documentation

- Si existe conflicto entre docs/skills, **este contrato prevalece**.
- Los skills deben declarar fases y dependencias compatibles con §3.1.

---

## 4) Persistence Contract (Canonical)

### 4.1 Modes

`engram | openspec | hybrid | none`

### 4.2 Resolution Order

1. `PERSISTENCE_MODE` (environment)
2. project config (`agents/persistence-mode.json` → `mode`)
3. global config (`~/.config/opencode/persistence.json` → `mode`)
4. default mode

Compatibilidad legacy (transitoria):
- `.opencode/persistence.yaml`
- `~/.config/opencode/persistence.yaml`

### 4.3 Backend Behavior by Mode

| Mode | Backend primario | Fallback |
|---|---|---|
| `engram` | Engram | none |
| `openspec` | `.atl/` filesystem | none |
| `hybrid` | Engram | `.atl/` filesystem |
| `none` | sin persistencia cross-session | none |

### 4.4 Canonical SDD Artifact Mapping

| Fase | Topic key Engram | Path Openspec |
|---|---|---|
| explore | `sdd/{change-name}/explore` | `.atl/changes/{change-name}/explore.md` |
| spec | `sdd/{change-name}/spec` | `.atl/changes/{change-name}/spec.md` |
| tasks | `sdd/{change-name}/tasks` | `.atl/changes/{change-name}/tasks.md` |
| apply | `sdd/{change-name}/apply-progress` | `.atl/changes/{change-name}/implementation/` |
| verify | `sdd/{change-name}/verify` | `.atl/changes/{change-name}/verification/` |
| archive | `sdd/{change-name}/archive` | `.atl/changes/{change-name}/archive/summary.md` |

---

## 5) Documentation Cut (Recorte) Policy

1. Mantener un único documento canónico por contrato operativo.
2. Reducir duplicaciones entre:
   - `AGENTS.md`
   - `docs/opencode-agent-teams-runtime-v1.md`
   - `specs/opencode-agent-teams-runtime-v1.md`
   - `skills/_shared/*`
   - `skills/sdd-*`
3. Reemplazar contenido duplicado por enlaces a este contrato donde aplique.

---

## 6) Compliance Checklist (Week 1)

- [ ] Vocabularios de estado runtime alineados con §1
- [ ] Semántica crítica alineada con §2
- [ ] Flujo/comandos SDD alineados con §3
- [ ] Persistencia y resolución alineadas con §4
- [ ] Recorte documental ejecutado según §5
