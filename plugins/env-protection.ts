import type { Plugin } from "@opencode-ai/plugin"

/**
 * Env Protection Plugin
 * 
 * Evita que el agente lea archivos sensibles como .env, .env.local, etc.
 * Protege credenciales de ser accidentalmente leakedas.
 */
export const EnvProtectionPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  // Archivos protegidos - no se pueden leer
  const protectedPatterns = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    ".env.test",
    ".env.staging",
    ".env.*.local",
    "credentials.json",
    "secrets.json",
    ".aws/credentials",
    ".ssh/id_rsa",
    ".npmrc",
    ".pypirc",
  ]

  // Archivos que se pueden leer pero con warning
  const warnPatterns = [
    ".env.example",
    ".env.template",
    "docker-compose.yml",
    "docker-compose.yaml",
  ]

  return {
    // Bloquear lectura de archivos protegidos
    "tool.execute.before": async (input, output) => {
      if (input.tool === "read") {
        const filePath = output.args.filePath || ""
        
        // Check protected patterns
        for (const pattern of protectedPatterns) {
          if (matchPattern(filePath, pattern)) {
            throw new Error(
              `ACCESO BLOQUEADO: Archivo protegido '${filePath}'. ` +
              `No se permite leer archivos de credentials. ` +
              `Si necesitás esta información, usá variables de entorno del sistema.`
            )
          }
        }

        // Warn on sensitive patterns
        for (const pattern of warnPatterns) {
          if (matchPattern(filePath, pattern)) {
            console.warn(`⚠️ ADVERTENCIA: Archivo potencialmente sensible '${filePath}'`)
            await client.app.log({
              body: {
                service: "env-protection",
                level: "warn",
                message: `Access to sensitive file: ${filePath}`,
              }
            })
          }
        }
      }
    },

    // Prevenir que se escriban credenciales
    "tool.execute.before": async (input, output) => {
      if (input.tool === "write" || input.tool === "create_or_update_file") {
        const filePath = output.args.filePath || ""
        
        for (const pattern of protectedPatterns) {
          if (matchPattern(filePath, pattern)) {
            throw new Error(
              `ESCritura BLOQUEADA: No se puede escribir en '${filePath}'. ` +
              `Los archivos de credentials deben estar en .gitignore y nunca ser commiteados.`
            )
          }
        }
      }
    },
  }
}

// Helper para matching de patrones simples
function matchPattern(path: string, pattern: string): boolean {
  // Handle exact match
  if (path === pattern) return true
  
  // Handle wildcard patterns like .env.*
  if (pattern.includes("*")) {
    const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$")
    return regex.test(path)
  }
  
  // Handle endings
  if (path.endsWith(pattern)) return true
  
  return false
}