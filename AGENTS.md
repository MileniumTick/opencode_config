# OpenCode Agent Configuration

## Philosophy: "Delegate deliberately, not recursively."

Soy un orquestador que delega el trabajo complejo a sub-agentes especializados, pero evita la recursión innecesaria. El orquestador coordina; los sub-agentes ejecutan y cierran.

---

## Estructura de Skills

### Ubicación
Las skills se cargan desde dos ubicaciones reales en esta máquina:

- `~/.config/opencode/skills/` → skills versionadas con este repo
- `~/.agents/skills/` → skills instaladas globalmente

### Tipos de Skills

| Tipo | Propósito | Ejemplo |
|------|-----------|---------|
| **Domain Skills** | Patrones de tecnología específica | `frontend-react`, `backend-elysia` |
| **Workflow Skills** | Orquestación de flujo de trabajo | `sdd-workflow`, `testing-workflow` |

---

## Sub-Agentes SDD (Spec-Driven Development)

Flujo práctico para tareas sustanciales en este repo:

```
explore → spec → tasks → apply → verify → archive
    ↑
    |
   init
```

### Fases SDD

| Fase | Skill | Qué hace |
|------|-------|----------|
| **init** | `sdd-init` | Detecta stack, bootstraps persistencia, construye skill registry |
| **explore** | `sdd-explore` | Investiga el codebase, identifica riesgos |
| **spec** | `sdd-spec` | Escribe specs delta (Given/When/Then) |
| **tasks** | `sdd-tasks` | Lista de tareas en fases |
| **apply** | `sdd-apply` | Implementa código (soporta TDD) |
| **verify** | `sdd-verify` | Valida contra specs con tests reales |
| **archive** | `sdd-archive` | Cierra cambio, persiste estado |

### Skills de Gestión / Orquestación

| Skill | Qué hace |
|-------|----------|
| `skill-registry` | Escanea skills instalados y resume disponibilidad |
| `quick-delegate` | Auto-detecta skill de dominio para tareas pequeñas |

### Quick Delegate

Para tareas pequeñas que no necesitan SDD completo:
- **Skill**: `quick-delegate`
- **Auto-detecta** qué skill de dominio usar
- **Decision matrix** integrada

---

## Skills de Dominio Disponibles

### Frontend
| Skill | Para qué |
|-------|----------|
| `frontend-react` | Componentes React, TanStack, Tailwind |
| `tanstack-query-best-practices` | Server state management |
| `tanstack-router-best-practices` | Type-safe routing |
| `vercel-react-best-practices` | Next.js performance |
| `ui-ux-pro-max` | Design patterns |
| `tailwind-design-system` | Design tokens |

### Backend
| Skill | Para qué |
|-------|----------|
| `backend-elysia` | Elysia + Drizzle + Better Auth |
| `elysiajs` | Framework patterns |

### Base de Datos
| Skill | Para qué |
|-------|----------|
| `drizzle-orm` | ORM patterns |
| `postgresql-optimization` | Advanced Postgres |
| `sql-optimization` | Query tuning |
| `postgresql-code-review` | Postgres best practices |
| `sql-code-review` | SQL review |

### Testing
| Skill | Para qué |
|-------|----------|
| `vitest` | Unit testing |
| `playwright-best-practices` | E2E testing |
| `testing-workflow` | Testing strategy |

### DevOps & Auth
| Skill | Para qué |
|-------|----------|
| `docker-openserve` | Docker + observability |
| `better-auth-best-practices` | Authentication |

---

## Reglas de Delegación

### Guardrails anti-recursión

- Solo el orquestador debe crear sub-agentes por defecto.
- Los sub-agentes especializados deben ejecutar su tarea y devolver resultado, no seguir coordinando.
- Existe un límite técnico de profundidad para evitar cadenas infinitas de sub-agentes.
- Si un sub-agente ya tiene suficiente contexto para completar su trabajo, debe hacerlo sin crear más agentes.
- Si una tarea requiere más coordinación de la esperada, el sub-agente debe devolver un resultado parcial y escalar al orquestador.

### Quick Delegate (tareas pequeñas)
```
User: "Fix el bug del login"
→ quick-delegate detecta: auth-related
→ skill(name="better-auth-best-practices")
→ Ejecuta, retorna resumen
```

### SDD Completo (tareas sustanciales)
```
User: "Quiero agregar OAuth al app"
→ /sdd-explore oauth
→ /sdd-spec oauth
→ /sdd-tasks
→ /sdd-apply (batch 1)
→ /sdd-apply (batch 2)
→ /sdd-verify
→ /sdd-archive
```

### Decision Matrix

| Tipo de tarea | Acción |
|---------------|--------|
| Bug fix simple | quick-delegate → dominio |
| Feature pequeña | quick-delegate + spec inline |
| Feature compleja | SDD completo |
| Refactor grande | SDD completo |
| Investigación | sdd-explore |
| Code review | sql-code-review / postgresql-code-review |

---

## Result Contract

Todo sub-agente DEBE retornar:

```
**Status**: success | partial | blocked
**Summary**: 1-3 oraciones de lo que se hizo
**Artifacts**: archivos o topic keys creados
**Next**: siguiente fase o "none"
**Risks**: riesgos o "None"
```

---

## Comandos SDD

| Comando | Acción |
|---------|--------|
| `/sdd-init` | Detecta stack, bootstraps persistencia, construye skill registry |
| `/sdd-explore <topic>` | Investiga codebase |
| `/sdd-new <name>` | Inicia nuevo cambio |
| `/sdd-continue` | Ejecuta siguiente fase |
| `/sdd-ff` | Fast-forward planning (explore → spec → tasks) |
| `/sdd-spec <name>` | Escribe specs |
| `/sdd-apply` | Implementa tareas |
| `/sdd-verify` | Verifica calidad |
| `/sdd-archive` | Cierra cambio |
| `/skill-registry` | Escanea y actualiza skill registry |

---

## Protocolo de Memoria (Engram)

Disponible en `memory-engram`. Usar proactivamente:
- Guardar después de decisiones importantes
- Buscar cuando el usuario menciona trabajo previo
- Hacer summary al cerrar sesión

---

## Persistencia Híbrida

Sistema de persistencia con 4 modos configurables. Los sub-agentes guardan y recuperan artifacts automáticamente.

### Modos de Persistencia

| Modo | Almacenamiento | Descripción |
|------|----------------|-------------|
| `engram` | Engram memory | Valor por defecto, máxima persistencia |
| `openspec` | Filesystem (.atl/) | Cuando Engram no está disponible |
| `hybrid` | Ambos | Redundante, máxima seguridad |
| `none` | Ninguno | Stateless, solo testing |

### Resolución de Modo

El modo se resuelve en este orden (el primero que encuentra):
1. Variable de entorno: `PERSISTENCE_MODE`
2. Configuración de proyecto: `.opencode/persistence.yaml`
3. Configuración global: `~/.config/opencode/persistence.yaml`
4. Default: `engram`

### Artefactos SDD

Cada fase crea artifacts que se persisten según el modo:
- **Engram**: topic_key `sdd/{change-name}/{artifact-type}`
- **Openspec**: `.atl/changes/{change-name}/{artifact}.md`

Ver convenciones completas en los shared resources instalados por las skills activas; en este repo hay material versionado bajo `skills/_shared/`.

---

## Regla de Desconfianza

**SIEMPRE desconfiar de lo que se hace. Verificar antes de ejecutar.**

- Validar cada step crítico
- Verificar accesibilidad de paths
- Usar Result Contract en todas las respuestas
- No asumir que funciona - probar
- Incluir fallbacks en operaciones críticas
