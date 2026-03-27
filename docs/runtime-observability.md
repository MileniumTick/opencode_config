# Runtime Observability (Week 3 — Gaps 2 y 4)

## Objetivo

Definir observabilidad mínima accionable para recovery runtime (`team_*`) con evidencias reales de drill y gates automáticos de cumplimiento.

Referencia de contrato: `specs/contracts/runtime-operating-contract-v1.md`.

## KPIs mínimos

Los KPIs se calculan durante el recovery drill ejecutado por:

- `bun run verify:runtime:gates`
- `bun run verify:runtime:strict`

### 1) `recovery_ops_success_rate_percent`

- Qué mide: porcentaje de operaciones críticas del drill que terminan correctamente.
- Operaciones incluidas: `inspect`, `requeue_stale_claims`, `resolve_delegations`, `resolve_mailbox`.
- Fórmula: `(ops_ok / 4) * 100`.

### 2) `stale_claim_requeue_coverage_percent`

- Qué mide: cobertura de claims stale detectados que fueron efectivamente requeueados.
- Fórmula: `requeued_task_ids / stale_claims_detected * 100`.

### 3) `delegation_resolution_rate_percent`

- Qué mide: porcentaje de delegations seleccionadas en drill que quedan resueltas.
- Fórmula: `resolved / (resolved + skipped) * 100`.

### 4) `mailbox_resolution_rate_percent`

- Qué mide: porcentaje de mensajes seleccionados en drill que quedan resueltos.
- Fórmula: `resolved / (resolved + skipped) * 100`.

### 5) `stale_claim_requeue_latency_ms`

- Qué mide: latencia observada para `team_recovery_requeue_stale_claims` en el drill.

## SLOs mínimos (gate crítico)

SLOs aplicados por el check `T7 Recovery Drill Evidence + KPI/SLO Gate`:

- `recovery_ops_success_rate_percent >= 100`
- `stale_claim_requeue_coverage_percent >= 100`
- `delegation_resolution_rate_percent >= 100`
- `stale_claim_requeue_latency_ms <= 10000`

Si cualquiera falla, el gate marca `FAIL` crítico.

## Evidencia mínima requerida

Además de KPI/SLO, el gate requiere evidencia mínima del drill:

- `team_id`
- `stale_task_id`
- `delegation_id`

Y evidencia operacional estructurada:

- latencias por operación (`inspect`, `requeue`, `resolve_delegations`, `resolve_mailbox`)
- ids requeueados y conteos resolved/skipped
- invariantes (`stale_task_ready_unclaimed`, `done_task_immutable`)

## Artefactos de salida

Generados en `specs/baselines/current/`:

- `compliance-gates.report.json`
- `compliance-gates.report.md`
- `runtime-observability.kpi.json` (KPIs, SLOs, breaches)
- `runtime-recovery-drill.evidence.json` (evidencia mínima estructurada)

En modo strict también se actualizan los sufijos `.strict.*` para el reporte de gates.

## Política anti-falsos positivos

- El gate usa operaciones runtime reales (no mocks de estado final).
- Los SLOs se enfocan en invariantes y completitud crítica, evitando checks de latencia excesivamente agresivos.
- Se evita bloquear por KPIs no críticos/no deterministas en esta fase.
