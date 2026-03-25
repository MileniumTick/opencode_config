import type { Plugin } from "@opencode-ai/plugin"

/**
 * Context Injector Plugin
 * 
 * Inyecta contexto adicional en cada sesión para mejorar respuestas.
 * Añade información del proyecto y convenciones.
 */
export const ContextInjectorPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  // Contexto base que se inyecta
  const baseContext = `
## Contexto del Proyecto

- **Proyecto**: ${project?.name || "Desconocido"}
- **Directorio**: ${directory}
- **Worktree**: ${worktree || "main"}

## Reglas de Seguridad

- NO leer archivos .env, credentials, keys
- NO escribir archivos sensibles
- Usar Result Contract en todas las respuestas

## Convenciones

- Skills en: ~/.agents/skills/
- Artefactos SDD en: .atl/changes/{change-name}/
- Usar Result Contract: **Status**, **Summary**, **Artifacts**, **Next**, **Risks**
`

  return {
    // Inyectar contexto cuando se compacta (antes de generar summary)
    "experimental.session.compacting": async (input, output) => {
      // Añadir contexto del proyecto al prompt de compactación
      output.context.push(baseContext)
      
      await client.app.log({
        body: {
          service: "context-injector",
          level: "debug",
          message: "Context injected into compaction",
        }
      })
    },

    // También podemos añadir contexto inicial cuando se crea sesión
    "session.created": async (input) => {
      await client.app.log({
        body: {
          service: "context-injector",
          level: "info",
          message: "Project context available",
          extra: {
            projectName: project?.name,
            directory: directory,
          }
        }
      })
    },
  }
}