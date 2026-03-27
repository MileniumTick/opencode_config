# Semana 4 — Backlog Priorizado (basado en evidencia)

Fecha: 2026-03-27

## P1 (alta prioridad)

1. **Integrar gates en `/sdd-verify`**
   - Consumir `scripts/week3/contract-parity-gates.ts` como paso estándar de verify runtime.
   - Éxito: verify falla automáticamente con drift `critical/high`.

2. **Agregar ejecución en CI local del repo**
   - Ejecutar baseline+gates+smoke en pipeline.
   - Éxito: reporte publicado por corrida con artefactos adjuntos.

## P2 (media prioridad)

3. **Expandir response shape coverage**
   - Incluir más tools `team_*` en snapshot de responses para reducir blind spots.
   - Éxito: cobertura >90% de comandos runtime públicos.

4. **Gate de compatibilidad backward para filtros/aliases legacy**
   - Tests específicos para entradas legacy esperadas (si aplica).
   - Éxito: matriz explícita de compatibilidad aceptada.

## P3 (baja prioridad)

5. **Reportes resumidos para handoff operativo**
   - Generar formato corto diario para operaciones.
   - Éxito: plantilla estable reutilizable.

## Dependencias

- P1.1 depende de acuerdo de flujo en skill `sdd-verify`.
- P1.2 depende de entorno CI del repositorio.
