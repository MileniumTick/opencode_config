import type { Plugin } from "@opencode-ai/plugin"

/**
 * Logging Plugin
 * 
 * Logging estructurado centralizado para todas las operaciones.
 * Usa client.app.log() para logs consistentes.
 */
export const LoggingPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    // Log cuando inicia una sesión
    "session.created": async (input) => {
      await client.app.log({
        body: {
          service: "logging",
          level: "info",
          message: `Session started`,
          extra: {
            sessionId: input.session?.id,
            project: project?.name,
            directory: directory,
            worktree: worktree,
          }
        }
      })
    },

    // Log cuando termina una sesión
    "session.idle": async (input) => {
      const duration = input.session?.created_at 
        ? Date.now() - new Date(input.session.created_at).getTime()
        : 0
      
      await client.app.log({
        body: {
          service: "logging",
          level: "info",
          message: `Session completed`,
          extra: {
            sessionId: input.session?.id,
            durationMs: duration,
          }
        }
      })
    },

    // Log de errores
    "session.error": async (input) => {
      await client.app.log({
        body: {
          service: "logging",
          level: "error",
          message: `Session error: ${input.error?.message || "Unknown error"}`,
          extra: {
            sessionId: input.session?.id,
            error: input.error,
          }
        }
      })
    },

    // Log después de ejecutar una tool
    "tool.execute.after": async (input) => {
      const level = input.result?.error ? "warn" : "debug"
      
      await client.app.log({
        body: {
          service: "logging",
          level: level,
          message: `Tool: ${input.tool}`,
          extra: {
            tool: input.tool,
            success: !input.result?.error,
            duration: input.duration,
          }
        }
      })
    },

    // Log de compactación
    "session.compacted": async (input) => {
      await client.app.log({
        body: {
          service: "logging",
          level: "info",
          message: `Session compacted`,
          extra: {
            sessionId: input.session?.id,
            summaryLength: input.summary?.length,
          }
        }
      })
    },
  }
}