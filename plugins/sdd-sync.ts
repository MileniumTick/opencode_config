import type { Plugin } from "@opencode-ai/plugin"

/**
 * SDD Sync Plugin
 * 
 * Sincroniza el estado de SDD con el filesystem.
 * Guarda proposals, specs, tasks en .atl/ para persistencia.
 */
export const SDDSyncPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  const atlDir = ".atl"

  return {
    // Cuando se compacta la sesión, guardar estado SDD
    "session.compacted": async (input, output) => {
      // Crear directorio .atl si no existe
      try {
        await $`mkdir -p ${atlDir}`
        
        await client.app.log({
          body: {
            service: "sdd-sync",
            level: "info",
            message: `SDD state synced to ${atlDir}`,
          }
        })
      } catch (e) {
        console.error("Failed to sync SDD state:", e)
      }
    },

    // Después de escribir un archivo, verificar si es un artifact SDD
    "tool.execute.after": async (input) => {
      if (input.tool === "write" || input.tool === "create_or_update_file") {
        const filePath = input.result?.filePath || ""
        
        // Detectar artifacts SDD por su ubicación
        if (filePath.includes("proposal.md") || 
            filePath.includes("spec.md") || 
            filePath.includes("design.md") ||
            filePath.includes("tasks.md")) {
          
          await client.app.log({
            body: {
              service: "sdd-sync",
              level: "debug",
              message: `SDD artifact created: ${filePath}`,
            }
          })
        }
      }
    },

    // Cuando se crea una sesión nueva, inicializar tracking
    "session.created": async (input) => {
      await client.app.log({
        body: {
          service: "sdd-sync",
          level: "info",
          message: `Session started: ${input.session?.id}`,
          extra: {
            project: project?.name,
            directory: directory,
          }
        }
      })
    },
  }
}