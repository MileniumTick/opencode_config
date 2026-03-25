import type { Plugin } from "@opencode-ai/plugin"

const MAX_SUBAGENT_DEPTH = 3
const GUARDED_TOOLS = new Set(["task", "delegate", "sdd_delegate"])
const BYPASS_ENV = "OPENCODE_ALLOW_DEEP_SUBAGENTS"

type SessionRecord = {
  id?: string
  parentID?: string | null
}

async function getSessionDepth(client: any, sessionID: string): Promise<number> {
  let depth = 0
  let currentID: string | undefined = sessionID

  for (let i = 0; i < 32 && currentID; i++) {
    const response = await client.session.get({ path: { id: currentID } })
    const session = response?.data as SessionRecord | undefined

    if (!session?.parentID) return depth

    depth += 1
    currentID = session.parentID
  }

  return depth
}

export const RecursionGuard: Plugin = async ({ client }) => {
  await client.app
    .log({
      body: {
        service: "recursion-guard",
        level: "info",
        message: `Recursion guard enabled (max depth ${MAX_SUBAGENT_DEPTH})`,
      },
    })
    .catch(() => {})

  return {
    "tool.execute.before": async (input: any) => {
      if (!GUARDED_TOOLS.has(input.tool)) return
      if (process.env[BYPASS_ENV] === "1") return

      const sessionID = input.sessionID ?? input.session?.id
      if (!sessionID) return

      let depth = 0
      try {
        depth = await getSessionDepth(client, sessionID)
      } catch (error) {
        await client.app
          .log({
            body: {
              service: "recursion-guard",
              level: "warn",
              message: `Failed to calculate session depth for tool ${input.tool}: ${error instanceof Error ? error.message : String(error)}`,
            },
          })
          .catch(() => {})
        return
      }

      if (depth >= MAX_SUBAGENT_DEPTH) {
        await client.app
          .log({
            body: {
              service: "recursion-guard",
              level: "warn",
              message: `Blocked ${input.tool} at depth ${depth} (max ${MAX_SUBAGENT_DEPTH})`,
            },
          })
          .catch(() => {})

        throw new Error(
          [
            `Subagent recursion blocked: max depth ${MAX_SUBAGENT_DEPTH} reached.`,
            `Current session depth: ${depth}.`,
            "This worker must finish or return its result instead of spawning more subagents.",
            `To override temporarily for debugging, set ${BYPASS_ENV}=1 before starting OpenCode.`,
          ].join(" "),
        )
      }
    },

    "experimental.chat.system.transform": async (_input: any, output: any) => {
      output.system.push(`## Recursion Guard\n- Only delegate when strictly necessary.\n- If you are already inside a subagent chain, prefer finishing the task yourself.\n- Hard limit: subagent depth may not exceed ${MAX_SUBAGENT_DEPTH}.\n- When blocked by this rule, stop spawning agents and return a concrete summary/result.`)
    },
  }
}

export default RecursionGuard
