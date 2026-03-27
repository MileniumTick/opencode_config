# Semana 4 — Batch 3 Final Report

Fecha: 2026-03-27

## Objetivo del batch

1. Refresh controlado del baseline congelado para que `verify:runtime:strict` refleje estado aceptado actual.
2. Definir transición CI de strict `advisory` a `blocking` con criterio verificable.
3. Cierre operativo con evidencia y pasos de operación.

## Cambios implementados

### A) Refresh de baseline congelado

Se regeneraron artefactos de baseline/parity usando comandos oficiales del repo:

```bash
bun run verify:runtime:baseline
bun run verify:runtime:gates
bun run verify:runtime:strict
bun run verify:runtime:smoke
```

Estado final de verificación:
- `verify:runtime:gates` ✅ PASS
- `verify:runtime:strict` ✅ PASS
- `verify:runtime:smoke` ✅ PASS (3 pass, 0 fail)

### B) Política CI advisory → blocking

Se implementó mecanismo con toggle por variable de repositorio en workflow:

- Variable: `RUNTIME_STRICT_ENFORCEMENT`
- Valores:
  - `advisory` (default)
  - `blocking`

Comportamiento:
- Siempre corre `Runtime strict (PR frozen baseline)` en PR con `continue-on-error: true`.
- Si `RUNTIME_STRICT_ENFORCEMENT=blocking` y strict falla, el job falla explícitamente en `Enforce strict in blocking mode`.

### C) Criterio verificable de activación blocking

Criterio adoptado:
- 5 corridas consecutivas de PR con `Runtime strict (PR frozen baseline)` en `success`.

Ejecución operativa:
1. Mantener `advisory` hasta cumplir criterio.
2. Cambiar variable del repo a `RUNTIME_STRICT_ENFORCEMENT=blocking`.
3. Validar en PR siguiente.
4. Si hay regresión, volver temporalmente a `advisory` y revisar drift.

## Evidencia de trazabilidad (checksums)

```text
6f1e43ac990c4c226257132e77c413dca1c3230db0761063934ed7cb1006c5fb  tool-args-schema.snapshot.json
665262899d2a532434af3add45ff0c6d561f532cca127aaa365d2134a3632e98  tool-response-top-level.snapshot.json
b25e76436d895e42d7cbf61b676e5692f7311a046da3bec54ad7f26267ae5b5d  runtime-ddl-baseline.json
ebac783f3ec0bc370a43f8b32cbb0eecf615402ba4b0cdabaf1eb295b8fcb2ea  task-state-drift.evidence.json
f757b760b0aeb051c7a6644a33b6e0eb8432d51254a73614fa3876aee868272c  baseline-summary.json
1b43aaab77fed855d89fff9108ff3d9f32199aa64386d3259caa0a6d3d1e8386  compliance-gates.report.json
1b43aaab77fed855d89fff9108ff3d9f32199aa64386d3259caa0a6d3d1e8386  compliance-gates.report.strict.json
```

## Limpieza de artefactos no usados

Se eliminan artefactos `*.current.json` del baseline porque no son consumidos por ningún flujo activo:

- `tool-args-schema.current.json`
- `tool-response-top-level.current.json`
- `runtime-ddl.current.json`
- `task-state-drift.current.json`

Criterio verificable aplicado:
- Sin referencias en imports/scripts/workflows/docs activas (`grep` global del repo).
- Son derivados transitorios: `gates/strict` se basan en baseline congelado (`*.snapshot.json` + `runtime-ddl-baseline.json` + `task-state-drift.evidence.json`) y reportes (`compliance-gates.report*.json|md`).

## Nota operativa

- Durante una ejecución paralela inicial apareció `SQLiteError: database is locked` en strict.
- Reintento secuencial del flujo completo resolvió el problema y dejó todos los checks en verde.
