# Spec: semana-1-runtime-canonical-contract

## Overview

Semana 1 define y fija un contrato canónico único para alinear estados runtime, flujo SDD y persistencia. También define un recorte documental para eliminar divergencias entre AGENTS, docs, specs, shared resources y skills SDD.

## Scope

### In Scope
- Crear el documento canónico `specs/contracts/runtime-operating-contract-v1.md`.
- Definir tablas de estados canónicos: team, agent, task, delegation, mailbox.
- Definir semántica crítica de estados y transiciones terminales.
- Definir flujo SDD y comandos canónicos del repositorio.
- Definir contrato de persistencia y orden canónico de resolución.
- Definir el delta documental sobre `AGENTS.md`, `docs`, `skills/_shared`, `skills/sdd-workflow`, `skills/sdd-spec`, `skills/sdd-archive`, `specs/opencode-agent-teams-runtime-v1.md`, `opencode.json`.

### Out of Scope
- Cambios en código runtime/plugin/tooling de ejecución.
- Migraciones de base de datos runtime.
- Refactor funcional de comandos SDD (solo alineación de contrato/documentación).
- Integración automática de validación de contrato en CI (se recomienda para Semana 2+).

## Delta Spec

## ADDED

### Feature: Contrato Operativo Canónico Runtime v1

#### Scenario: Documento canónico creado y referenciable
**Given** existe dispersión documental de estados y flujo
**When** se crea `specs/contracts/runtime-operating-contract-v1.md`
**Then** el repo tiene una única referencia canónica para estados runtime, flujo SDD y persistencia
**And** el documento incluye tablas de estados para team/agent/task/delegation/mailbox

#### Scenario: Semántica crítica explícita
**Given** operaciones de recuperación y cierre con riesgo de ambigüedad
**When** el contrato canónico define estados terminales y reglas críticas
**Then** queda explícito que estados terminales no mutan sin operación de reapertura
**And** queda explícito que mailbox no reemplaza task board

#### Scenario: Flujo SDD canónico normalizado
**Given** que existen variantes históricas de fases SDD
**When** se define flujo canónico `init -> explore -> spec -> tasks -> apply -> verify -> archive`
**Then** skills y docs deben alinear dependencias y nomenclatura a ese flujo

#### Scenario: Persistencia canónica unificada
**Given** que existen variantes de resolución entre documentos
**When** el contrato define un único orden de resolución de persistencia
**Then** todos los documentos deben usar el mismo orden y mapeo de artifacts por fase

## MODIFIED

### AGENTS.md
#### Changed: Alineación de flujo SDD y persistencia al contrato canónico
**From**: Definiciones internas potencialmente divergentes del contrato runtime v1
**To**: Referencia explícita al contrato canónico y resumen corto (sin duplicar tablas completas)

### docs/opencode-agent-teams-runtime-v1.md
#### Changed: Reducción de duplicación de vocabularios/semántica
**From**: Documento auto-contenido con vocabularios y políticas repetidas
**To**: Documento de arquitectura/implementación que referencia estados/contrato canónico

### specs/opencode-agent-teams-runtime-v1.md
#### Changed: Especificación funcional alineada con estados canónicos
**From**: Escenarios con vocabularios que pueden divergir del contrato único
**To**: Escenarios y glosario ajustados para usar los estados canónicos del contrato

### skills/_shared/persistence-contract.md
#### Changed: Resolución y defaults de persistencia
**From**: Variante legacy con prioridad YAML
**To**: Prioridad canónica `env -> project opencode.json -> global opencode.json -> default`, con compatibilidad legacy documentada para `.opencode/persistence.yaml` y `~/.config/opencode/persistence.yaml`

### skills/_shared/engram-convention.md y openspec-convention.md
#### Changed: Convenciones de artifacts y naming
**From**: Convenciones válidas pero no necesariamente alineadas fase-a-fase
**To**: Convenciones alineadas con mapeo canónico de artifacts SDD del contrato

### skills/sdd-workflow/SKILL.md
#### Changed: Fases/comandos canónicos
**From**: grafo `proposal -> specs -> tasks -> apply -> verify -> archive` con `design`
**To**: flujo canónico `init -> explore -> spec -> tasks -> apply -> verify -> archive` y compatibilidad explícita de `/sdd-ff`

### skills/sdd-spec/SKILL.md
#### Changed: Dependencias y output contract
**From**: orientado a input de `sdd-explore`
**To**: referencia explícita al contrato canónico y chequeo de vocabularios/estados en delta specs

### skills/sdd-archive/SKILL.md
#### Changed: Criterios de cierre
**From**: cierre centrado en merge de specs
**To**: cierre condicionado a alineación documental + validación de contrato canónico vigente

### opencode.json
#### Changed: Metadatos/config para reflejar canon operativo
**From**: configuración de agentes sin referencia explícita al contrato operativo canónico
**To**: referencia documental/configurable al contrato canónico para evitar deriva entre agentes

## REMOVED

### Duplicaciones normativas en múltiples documentos
**Reason**: Reducir drift documental y ambigüedad operacional
**Migration**: Reemplazar texto duplicado por enlaces al contrato canónico y mantener solo contexto local de cada archivo

## Acceptance Criteria (Given/When/Then)

### AC1 — Contrato canónico presente
**Given** el repositorio en rama de planificación Semana 1
**When** se revisa `specs/contracts/runtime-operating-contract-v1.md`
**Then** existe y contiene tablas de estados canónicos para team/agent/task/delegation/mailbox

### AC2 — Semántica crítica completa
**Given** el contrato canónico
**When** se inspecciona la sección de semántica crítica
**Then** define autoridad de estado vivo, terminalidad, recovery explícito y separación mailbox/task

### AC3 — Flujo SDD consistente
**Given** `AGENTS.md`, `skills/sdd-workflow/SKILL.md`, `skills/sdd-spec/SKILL.md`, `skills/sdd-archive/SKILL.md`
**When** se comparan fases y comandos
**Then** todas las referencias son compatibles con `init -> explore -> spec -> tasks -> apply -> verify -> archive`

### AC4 — Persistencia consistente
**Given** `AGENTS.md` y `skills/_shared/persistence-contract.md`
**When** se compara orden de resolución de persistencia y default
**Then** ambos documentos muestran el mismo orden y mismo default recomendado

### AC5 — Recorte documental aplicado
**Given** `AGENTS.md`, `docs/opencode-agent-teams-runtime-v1.md`, `specs/opencode-agent-teams-runtime-v1.md`, `skills/_shared/*`
**When** se audita contenido normativo duplicado
**Then** la norma vive en el contrato canónico y los demás archivos enlazan/derivan de éste

### AC6 — Sin cambios de runtime code
**Given** el alcance de Semana 1
**When** se revisan artefactos creados
**Then** solo se agregan/ajustan specs y docs de planificación, sin implementación de runtime code

## Open Decisions and Recommended Defaults

1. **Default de persistencia canónico**
   - **Resuelto**: `hybrid` como default operativo canónico (alineado a `opencode.json` y contrato v1).
   - **Nota**: `engram` sigue siendo backend primario en modo `engram`, pero no default global.

2. **Estado `delivered` en mailbox**
   - **Abierto**: mantener `pending/read/resolved` o introducir `delivered` como estado visible canónico.
   - **Recomendado (default)**: mantener `pending/read/resolved` en v1 para minimizar complejidad; `delivered` puede quedar como metadata/evento no canónico.

3. **Soporte de fase `design` en SDD**
   - **Abierto**: mantener `design` como fase formal o como extensión opcional.
   - **Recomendado (default)**: fase **opcional** fuera del camino mínimo canónico; no bloquear `spec -> tasks`.

4. **Ubicación de configuración de persistencia**
   - **Resuelto**: contrato canónico en `opencode.json` (project) y `~/.config/opencode/opencode.json` (global).
   - **Nota**: `.opencode/persistence.yaml` y `~/.config/opencode/persistence.yaml` se mantienen solo como compatibilidad legacy transitoria.

## Week 4 — Workstream 4 (Gap 6): Legacy Runtime Compatibility Cleanup

### Goal

Reducir compatibilidad legacy residual en runtime (task statuses legacy y normalizaciones implícitas) sin romper flujos activos ni desalinear contrato canónico v1.

### Decisions Applied

1. **Task status mapping legacy (runtime plugin)**
   - **Decision**: retirar mapping in-memory (`claimed/review_needed/verified/cancelled`) y normalización de lectura/listado.
   - **Reasoning**: el contrato canónico v1 define únicamente estados `todo|ready|in_progress|blocked|review|done|failed`; mantener aliases oculta drift y puede normalizar entradas inválidas.

2. **Migración automática de statuses legacy en bootstrap**
   - **Decision**: retirar `UPDATE` masivo automático en `domains/tasks.ts` al inicializar dominio.
   - **Reasoning**: evita mutaciones implícitas no auditadas en startup y fuerza coherencia explícita con v1 (fuera de recovery).

3. **Compatibilidad legacy mantenida**
   - **Decision**: se mantiene **solo** la compatibilidad legacy de persistencia (`.opencode/persistence.yaml`, `~/.config/opencode/persistence.yaml`) ya explicitada en contrato/documentación.
   - **Reasoning**: aún puede existir dependencia operativa externa para modo de persistencia; su eliminación no forma parte de Gap 6 runtime status cleanup.

### Expected Impact

- Entradas legacy de estado de task ya no se normalizan silenciosamente.
- Transiciones de estados deben usar únicamente vocabulario canónico.
- Herramientas de parity/gates continúan validando que runtime y contrato estén alineados.
