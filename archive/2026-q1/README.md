# Archive 2026 Q1

Este directorio guarda artefactos históricos para reducir ruido del workspace activo,
manteniendo trazabilidad y recuperación.

## Criterio aplicado

- `tasks/`: planes históricos cerrados o superseded.
- `reports/`: reportes históricos redundantes que no son requeridos por scripts activos de verify/runtime.

## Índice (v1 limpia)

### Activo (canónico)

- `specs/contracts/` → contratos activos canónicos.
- `specs/baselines/current/` → baseline activo consumido por `verify:runtime:baseline|gates|strict`.

### Histórico (archivo)

- `archive/2026-q1/tasks/` → task plans históricos cerrados/superseded.
- `archive/2026-q1/reports/` → reportes históricos no requeridos por verify activo.
- `archive/2026-q1/reports/week3-contract-parity/` → ADR/checklists/reportes de cierre semana 3.
