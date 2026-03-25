import type { Plugin } from "@opencode-ai/plugin"

/**
 * Notification Plugin
 * 
 * Envía notificaciones del sistema cuando ocurren eventos importantes.
 * Requiere: macOS (usa osascript) o plataforma con notify-send
 */
export const NotificationPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  // Configurar qué eventos generan notificaciones
  const notifyOn: string[] = [
    "session.idle",           // Sesión completada
    "session.error",         // Error en sesión
    "session.compacted",     // Sesión comprimida
    "tool.execute.after",    // Tool ejecutada
  ]

  return {
    // Notificar cuando sesión termina
    "session.idle": async (input) => {
      try {
        // macOS notification
        await $`osascript -e 'display notification "Sesión completada" with title "OpenCode"'`
      } catch {
        // Ignore if not macOS
      }
    },

    // Notificar cuando hay error
    "session.error": async (input) => {
      try {
        await $`osascript -e 'display notification "Error en sesión" with title "OpenCode"'`
      } catch {
        // Ignore
      }
    },

    // Log de compactación para debugging
    "session.compacted": async (input) => {
      await client.app.log({
        body: {
          service: "notification-plugin",
          level: "info",
          message: `Session compacted: ${input.session?.id}`,
        }
      })
    },

    // Opcional: Log de tools ejecutadas (descomenta si querés)
    // "tool.execute.after": async (input) => {
    //   await client.app.log({
    //     body: {
    //       service: "notification-plugin",
    //       level: "debug",
    //       message: `Tool executed: ${input.tool}`,
    //     }
    //   })
    // },
  }
}