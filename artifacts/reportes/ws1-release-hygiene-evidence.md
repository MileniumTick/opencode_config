# WS1 Release Hygiene Evidence (Gaps 1 y 5)

Fecha: 2026-03-27

## Objetivo

Evidencia operacional de:
1. Política CI strict blocking por defecto (sin bypass implícito).
2. Hygiene de release completa (checklist + empaquetado + evidencia).

## Cambios aplicados

### 1) CI strict blocking por defecto

- Workflow actualizado: `.github/workflows/runtime-smoke.yml`
- El flujo principal ejecuta `bun run verify:runtime:release`.
- `strict` se ejecuta por defecto dentro de la cadena release.
- Bypass solo explícito con metadata auditada completa:
  - `RUNTIME_STRICT_BYPASS=1`
  - `RUNTIME_STRICT_BYPASS_REASON`
  - `RUNTIME_STRICT_BYPASS_TICKET`
  - `RUNTIME_STRICT_BYPASS_APPROVED_BY`
  - `RUNTIME_STRICT_BYPASS_EXPIRES_AT` (futuro)

### 2) Release hygiene y empaquetado

- Nuevo agregador: `verify:runtime:release`.
- Nuevo empaquetado de evidencia: `verify:runtime:package`.
- Manifest de checksums SHA-256:
  - `artifacts/runtime-release/runtime-release-evidence.manifest.json`
- Checklist canónico:
  - `docs/runtime-release-checklist.md`

## Cadena canónica de verificación

```bash
bun run verify:runtime:release
```

Orden:
1. baseline
2. gates
3. strict
4. smoke

## Resultados de verificación ejecutados

### 1) Cadena release (blocking path)

Comando:

```bash
bun run verify:runtime:release
```

Resultado:
- PASS
- gates: `gate_pass=true`
- strict: `gate_pass=true`
- smoke: `10 pass / 0 fail`

### 2) Empaquetado de evidencia

Comando:

```bash
bun run verify:runtime:package
```

Resultado:
- PASS
- manifest generado: `artifacts/runtime-release/runtime-release-evidence.manifest.json`
- total checksums: `12`

### 3) Prueba negativa de bypass implícito

Comando:

```bash
RUNTIME_STRICT_BYPASS=1 bun run verify:runtime:release
```

Resultado:
- FAIL esperado
- Mensaje: faltan metadatos auditables obligatorios (`REASON`, `TICKET`, `APPROVED_BY`, `EXPIRES_AT`).

## Archivos tocados

- `.github/workflows/runtime-smoke.yml`
- `package.json`
- `scripts/week4/verify-runtime-release.ts`
- `scripts/week4/package-runtime-release-evidence.ts`
- `docs/runtime-release-checklist.md`
- `docs/runtime-recovery-runbook.md`
- `artifacts/reportes/ws1-release-hygiene-evidence.md`
