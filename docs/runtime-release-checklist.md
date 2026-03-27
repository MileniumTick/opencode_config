# Runtime Release Checklist (WS1 — Gaps 1 y 5)

## Objetivo

Definir una hygiene de release canónica y auditable para runtime (`team_*`) con política CI estricta **blocking por defecto** y evidencia mínima obligatoria.

Contrato de referencia: `specs/contracts/runtime-operating-contract-v1.md`.

## Release Gate Canónico

Comando agregador oficial (orden seguro):

```bash
bun run verify:runtime:release
```

Secuencia ejecutada:
1. `verify:runtime:baseline`
2. `verify:runtime:gates`
3. `verify:runtime:strict`
4. `verify:runtime:smoke`

Notas:
- El orden es deliberado (baseline → gates → strict → smoke) para detectar drift temprano antes del smoke final.
- `verify:runtime` delega a `verify:runtime:release` para evitar rutas paralelas no auditadas.

## Política CI Strict (blocking por defecto)

Workflow: `.github/workflows/runtime-smoke.yml`.

Regla canónica:
- `verify:runtime:strict` se comporta como **gate bloqueante por defecto**.
- No existe bypass implícito.

### Excepción permitida (solo incidente)

Bypass solo si `RUNTIME_STRICT_BYPASS=1` y metadata auditada completa:

- `RUNTIME_STRICT_BYPASS_REASON`
- `RUNTIME_STRICT_BYPASS_TICKET`
- `RUNTIME_STRICT_BYPASS_APPROVED_BY`
- `RUNTIME_STRICT_BYPASS_EXPIRES_AT` (ISO-8601 futuro)

Si falta cualquier campo o `EXPIRES_AT` es inválido/expirado, CI falla.

## Evidencia obligatoria de release

### 1) Artefactos parity/gates (fuente)

Ubicación: `specs/baselines/current/`

- `tool-args-schema.snapshot.json`
- `tool-response-top-level.snapshot.json`
- `runtime-ddl-baseline.json`
- `runtime-ddl.diff.json`
- `task-state-drift.evidence.json`
- `compliance-gates.report.json`
- `compliance-gates.report.md`
- `compliance-gates.report.strict.json`
- `compliance-gates.report.strict.md`
- `runtime-observability.kpi.json`
- `runtime-recovery-drill.evidence.json`
- `baseline-summary.json`

### 2) Manifest empaquetado (checksums)

Generar:

```bash
bun run verify:runtime:package
```

Salida:
- `artifacts/runtime-release/runtime-release-evidence.manifest.json`

El manifest incluye:
- cadena de verificación ejecutada,
- timestamp,
- checksums SHA-256 + tamaño de archivos requeridos.

## Checklist operativo pre-release

- [ ] Ejecutar `bun run verify:runtime:release` local/CI con resultado PASS.
- [ ] Confirmar que no hay bypass activo (`RUNTIME_STRICT_BYPASS != 1`) o que el bypass está auditado y vigente.
- [ ] Ejecutar `bun run verify:runtime:package`.
- [ ] Adjuntar en PR/Release los artefactos de `specs/baselines/current/` y `artifacts/runtime-release/`.
- [ ] Verificar que `compliance-gates.report.strict.json` tiene `gate.pass=true` (si no hay bypass).
- [ ] Verificar smoke tests PASS (`verify:runtime:smoke`).
- [ ] Confirmar compatibilidad API `team_*` sin cambios de contrato top-level no aprobados.

## Checklist operativo post-release

- [ ] Mantener evidencia (artefacto CI y/o almacenamiento de release) accesible para auditoría.
- [ ] Si hubo bypass temporal, remover variables de bypass al cierre del incidente.
- [ ] Registrar enlace a ticket/incidente y aprobación en bitácora operativa.
