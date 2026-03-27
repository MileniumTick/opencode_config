# Tasks: semana-3-contract-parity-hardening

## Contexto

Plan de Semana 3 para cerrar gaps críticos detectados en verificación (`status: warnings`) y dejar la base lista para Semana 4.

Gaps objetivo:
1. Drift crítico contrato↔runtime en estados de tasks.
2. Drift documental residual (`specs/semana-1-runtime-canonical-contract-delta-spec.md`, referencias a `sdd-design` en skills).
3. Paridad fuerte de tools: snapshot de args schema + top-level response shape + diff DDL baseline.

Referencias base:
- `specs/contracts/runtime-operating-contract-v1.md` (fuente canónica)
- `specs/opencode-agent-teams-runtime-v1.md`
- `specs/semana-1-runtime-canonical-contract-delta-spec.md`
- `archive/2026-q1/tasks/TASKS-week2-runtime-modularization.md` (pendientes 4.4 y 4.5)

---

## Decisión estratégica para Gap #1 (Task States Drift)

### Ruta A — Adaptar runtime al contrato actual (canónico)

**Qué implica**
- Ajustar vocabulario/transiciones de `task` en runtime para cumplir exactamente §1.3 del contrato canónico.
- Mantener contrato como fuente de verdad; runtime converge al contrato.

**Pros**
- Respeta política explícita: “si hay conflicto docs/skills, contrato prevalece”.
- Reduce ambigüedad para SDD, recovery y verificación automatizable.
- Menor costo de coordinación cross-doc (no hay que reabrir múltiples specs normativas).

**Contras**
- Puede requerir migración/control de compatibilidad de estados existentes en SQLite.
- Riesgo de regresión en tools que hoy aceptan estados legacy.

---

### Ruta B — Versionar/actualizar contrato para reflejar runtime real

**Qué implica**
- Crear versión contractual nueva (ej. v1.1/v2) o delta formalizando estados runtime actuales.
- Actualizar specs, skills y criterios de verify/archive para ese nuevo contrato.

**Pros**
- Minimiza cambios inmediatos en runtime en producción local.
- Útil si el runtime real ya se volvió estándar operativo de facto.

**Contras**
- Mayor blast radius documental (specs, skills, AGENTS, checklists, verify rules).
- Riesgo de “normalizar deuda” en vez de corregir drift.
- Retrasa paridad fuerte y complica Semana 4.

---

### Recomendación

✅ **Recomendada: Ruta A (adaptar runtime al contrato actual).**

**Rationale**:
1. El contrato canónico v1 ya define precedencia normativa explícita.
2. Semana 3 busca hardening/paridad, no renegociación de semántica.
3. Ruta A acota alcance y habilita automatización objetiva de compliance (tests/diffs) para Semana 4.

**Fallback controlado**: usar Ruta B solo si en Día 2 se demuestra incompatibilidad crítica no mitigable (riesgo alto de ruptura de datos/runtime).

---

## Plan diario (Semana 3)

## Día 1 — Baseline y freeze de contratos verificables
- [x] 1.1 Consolidar baseline de estados `task` observados en runtime (inputs válidos, transiciones permitidas, estados terminales).
- [x] 1.2 Consolidar baseline de tools runtime: lista completa `team_*`, args schema por tool y shape top-level de respuesta.
- [x] 1.3 Congelar baseline DDL actual (tablas, constraints, índices) para comparación posterior.
- [x] 1.4 Definir “matriz de drift” contrato vs runtime (estados/tasks, tools schemas, response shapes, DDL).

**Criterios de aceptación Día 1 (verificables)**
- Existe artefacto de baseline con:
  - vocabulario y grafo de transiciones task actual,
  - snapshot de args schema por tool,
  - snapshot de response top-level por tool,
  - snapshot DDL baseline.
- Existe matriz de drift con severidad (`critical/high/medium/low`) y owner por gap.

---

## Día 2 — Decisión final Gap #1 + plan de migración segura
- [x] 2.1 Ejecutar análisis de impacto de Ruta A (compatibilidad de datos, tools consumidores, recovery).
- [x] 2.2 Ejecutar análisis de impacto de Ruta B (coste documental + versionado + gobernanza).
- [x] 2.3 Tomar decisión formal (A o B) con ADR corto y criterios de rollback.
- [x] 2.4 Diseñar plan de compatibilidad/migración de estados task (idempotente y auditable).

**Criterios de aceptación Día 2 (verificables)**
- ADR/decision record publicado con decisión final, rationale y fallback.
- Matriz de impacto completada (riesgo, esfuerzo, blast radius, reversibilidad).
- Plan de migración incluye validación previa y posterior de integridad.

---

## Día 3 — Cierre Gap #2 (drift documental residual)
- [x] 3.1 Actualizar `specs/semana-1-runtime-canonical-contract-delta-spec.md` para eliminar drift residual y alinear texto a contrato vigente.
- [x] 3.2 Remover/ajustar referencias obligatorias a `sdd-design` en skills SDD donde ya no aplica al camino canónico mínimo.
- [x] 3.3 Alinear wording en skills SDD para que `spec + tasks` sean suficientes cuando no exista diseño formal.
- [x] 3.4 Generar checklist de consistencia documental cross-files (contrato, spec funcional, skills SDD).

**Criterios de aceptación Día 3 (verificables)**
- No quedan referencias inconsistentes a `sdd-design` como prerequisito obligatorio en skills core.
- `semana-1-*delta-spec` refleja estado normativo actual sin contradicción interna.
- Checklist documental pasa en revisión manual con evidencia de diff.

---

## Día 4 — Implementación de paridad fuerte (Gap #3) — snapshots
- [x] 4.1 Definir formato canónico de snapshot de args schema por tool (estable y serializable).
- [x] 4.2 Definir formato canónico de snapshot de response top-level por tool (keys/shape esperadas).
- [x] 4.3 Definir formato canónico de snapshot DDL baseline (normalizado para evitar ruido).
- [x] 4.4 Publicar snapshots versionados y trazables para comparación en verify.

**Criterios de aceptación Día 4 (verificables)**
- Existen 3 snapshots versionados: args schema, response shape, DDL baseline.
- Formato de snapshots permite diff determinista entre ejecuciones.

---

## Día 5 — Validación por diff y gates de calidad
- [x] 5.1 Crear procedimiento de diff automatizable para `args schema` vs baseline.
- [x] 5.2 Crear procedimiento de diff automatizable para `response shape` vs baseline.
- [x] 5.3 Crear procedimiento de diff automatizable para `DDL` vs baseline.
- [x] 5.4 Definir reglas de gate: qué drift bloquea (critical/high) y qué drift permite warning.

**Criterios de aceptación Día 5 (verificables)**
- Cada dimensión (args/shape/DDL) tiene reporte `PASS/FAIL` con detalle.
- El gate de severidad está documentado y usable por `sdd-verify`.

---

## Día 6 — E2E de compliance y cierre de warnings
- [x] 6.1 Ejecutar corrida completa de verificación contra contrato + snapshots.
- [x] 6.2 Resolver warnings críticos abiertos o registrar excepción explícita con fecha de vencimiento.
- [x] 6.3 Ejecutar re-check de regresión en task lifecycle y recovery paths relacionados.
- [x] 6.4 Preparar paquete de evidencia para cierre de Semana 3.

**Criterios de aceptación Día 6 (verificables)**
- No quedan warnings críticos sin owner/plan.
- Reporte de compliance completo adjunto con resultados por gap.

---

## Día 7 — Buffer, hardening final y handoff Semana 4
- [x] 7.1 Aplicar buffer para regresiones detectadas en Día 6.
- [x] 7.2 Cerrar pendientes de documentación operativa mínima.
- [x] 7.3 Publicar `Week 3 Exit Report` con estado final por gap.
- [x] 7.4 Publicar backlog priorizado de Semana 4 basado en evidencias.

**Criterios de aceptación Día 7 (verificables)**
- Exit report firmado con estado final (`closed/accepted risk/deferred`) por cada gap.
- Backlog Semana 4 priorizado y con dependencias claras.

---

## Lista de tests/artefactos obligatorios para habilitar Semana 4

### Tests / Verificaciones
- [x] T1. **Task State Contract Test**: valida vocabulario y transiciones task contra `runtime-operating-contract-v1.md`.
- [x] T2. **Tool Args Schema Parity Test**: compara args schema actual vs snapshot baseline.
- [x] T3. **Tool Response Shape Parity Test**: compara shape top-level actual vs snapshot baseline.
- [x] T4. **DDL Parity Diff Test**: compara DDL actual vs baseline normalizado, detectando drift de tablas/índices/constraints.
- [x] T5. **Recovery Safety Test**: confirma que reconciliación no viola estados terminales ni inventa ownership.
- [x] T6. **Documentation Consistency Check**: valida ausencia de contradicciones entre contrato/specs/skills SDD.

### Artefactos de salida
- [x] A1. `sdd/semana-3-contract-parity-hardening/tasks`
- [x] A2. `sdd/semana-3-contract-parity-hardening/verify`
- [x] A3. Snapshot args schema (versionado)
- [x] A4. Snapshot response top-level shape (versionado)
- [x] A5. Snapshot DDL baseline + reporte diff
- [x] A6. ADR decisión Gap #1 (Ruta A/B + rationale + fallback)
- [x] A7. Week 3 Exit Report + backlog Semana 4

---

## Dependencies

| Task | Depends On |
|------|------------|
| 2.1 | 1.1, 1.4 |
| 2.2 | 1.4 |
| 2.3 | 2.1, 2.2 |
| 2.4 | 2.3 |
| 3.1 | 2.3 |
| 3.2 | 2.3 |
| 3.3 | 3.2 |
| 3.4 | 3.1, 3.3 |
| 4.1 | 1.2 |
| 4.2 | 1.2 |
| 4.3 | 1.3 |
| 4.4 | 4.1, 4.2, 4.3 |
| 5.1 | 4.4 |
| 5.2 | 4.4 |
| 5.3 | 4.4 |
| 5.4 | 5.1, 5.2, 5.3 |
| 6.1 | 5.4, 3.4 |
| 6.2 | 6.1 |
| 6.3 | 6.1 |
| 6.4 | 6.2, 6.3 |
| 7.1 | 6.4 |
| 7.2 | 6.4 |
| 7.3 | 7.1, 7.2 |
| 7.4 | 7.3 |

---

## Estimated Complexity

- Día 1: Medium
- Día 2: Medium
- Día 3: Low-Medium
- Día 4: Medium
- Día 5: Medium-High
- Día 6: High
- Día 7: Medium
