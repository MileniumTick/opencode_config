import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import { createArtifactLinksDomain } from "./domains/artifact-links"
import { createDelegationsDomain } from "./domains/delegations"
import { createGitWorkItemsDomain } from "./domains/git-work-items"
import { createMailboxDomain } from "./domains/mailbox"
import { createRecoveryDomain } from "./domains/recovery"
import { createTasksDomain } from "./domains/tasks"
import { createRuntimeEventHandler } from "./compat/event-handlers"
import { createToolRegistry } from "./compat/tool-registry"
import { TEAM_STATUSES } from "./shared/constants"
import { initRuntimeDb } from "./shared/db"
import { runtimeEvent } from "./shared/events"
import { createRuntimeGuards } from "./shared/guards"
import type { AgentRow, RuntimeContext, RuntimeDelegationLaunchPolicy, RuntimeWorkerPool, TeamRow } from "./shared/types"
import { agentResponse, baseBranchFor, nowIso, parseCapabilities, rowToTeamStatus } from "./shared/utils"

type RuntimeAgentConfig = {
  workerPool: RuntimeWorkerPool
  configuredAgents: Set<string>
  delegationLaunchPolicy: RuntimeDelegationLaunchPolicy
}

type RuntimeSelectionStrategy = "least-busy" | "round-robin"

type RuntimeConfigFile = {
  version?: number
  worker_pool_file?: string
  selection_strategy?: RuntimeSelectionStrategy
  delegation_launch?: {
    fallback_reassign?: "disabled" | "pool"
  }
}

type RuntimeWorkerPoolFile = {
  selection_strategy?: RuntimeSelectionStrategy
  workers?: Array<{ agent_name?: string; role?: string; capabilities?: string[] }>
}

const DEFAULT_RUNTIME_CONFIG_PATH = "agents/runtime-config.json"
const DEFAULT_WORKER_POOL_PATH = "agents/runtime-worker-pool.json"
const RUNTIME_CONFIG_PATH_ENV = "AGENT_TEAMS_RUNTIME_CONFIG"
const WORKER_POOL_PATH_ENV = "AGENT_TEAMS_RUNTIME_WORKER_POOL_FILE"
const SELECTION_STRATEGY_ENV = "AGENT_TEAMS_RUNTIME_SELECTION_STRATEGY"

function isRuntimeSelectionStrategy(value: unknown): value is RuntimeSelectionStrategy {
  return value === "least-busy" || value === "round-robin"
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T
  } catch {
    return null
  }
}

function resolveConfigPath(directory: string, targetPath: string) {
  return isAbsolute(targetPath) ? targetPath : resolve(directory, targetPath)
}

function loadRuntimeAgentConfig(directory: string): RuntimeAgentConfig {
  const configPath = resolve(directory, "opencode.json")
  const fallbackPool: RuntimeWorkerPool = { selection_strategy: "least-busy", workers: [] }
  const fallback: RuntimeAgentConfig = {
    workerPool: fallbackPool,
    configuredAgents: new Set<string>(),
    delegationLaunchPolicy: { fallback_reassign: "pool" },
  }

  const opencodeConfig = readJsonFile<{ agent?: Record<string, unknown> }>(configPath)
  const configuredAgents = new Set<string>(Object.keys(opencodeConfig?.agent ?? {}))

  const runtimeConfigPath = resolveConfigPath(
    directory,
    process.env[RUNTIME_CONFIG_PATH_ENV] ?? DEFAULT_RUNTIME_CONFIG_PATH,
  )
  const runtimeConfig = readJsonFile<RuntimeConfigFile>(runtimeConfigPath)

  const workerPoolPath = resolveConfigPath(
    directory,
    process.env[WORKER_POOL_PATH_ENV] ?? runtimeConfig?.worker_pool_file ?? DEFAULT_WORKER_POOL_PATH,
  )
  const workerPoolFile = readJsonFile<RuntimeWorkerPoolFile>(workerPoolPath)

  const workers = Array.isArray(workerPoolFile?.workers)
      ? workerPoolFile.workers
          .filter((entry) => typeof entry?.agent_name === "string" && entry.agent_name.length > 0)
          .map((entry) => ({
            agent_name: String(entry.agent_name),
            role: typeof entry.role === "string" && entry.role.length > 0 ? entry.role : "worker",
            capabilities: Array.isArray(entry.capabilities)
              ? entry.capabilities.map((capability) => String(capability)).filter(Boolean)
              : [],
          }))
      : []

  const envSelectionStrategyRaw = process.env[SELECTION_STRATEGY_ENV]
  const envSelectionStrategy = isRuntimeSelectionStrategy(envSelectionStrategyRaw) ? envSelectionStrategyRaw : undefined
  const runtimeConfigSelectionStrategy = isRuntimeSelectionStrategy(runtimeConfig?.selection_strategy)
    ? runtimeConfig.selection_strategy
    : undefined
  const workerPoolSelectionStrategy = isRuntimeSelectionStrategy(workerPoolFile?.selection_strategy)
    ? workerPoolFile.selection_strategy
    : undefined

  const workerPool: RuntimeWorkerPool = {
    selection_strategy: envSelectionStrategy ?? runtimeConfigSelectionStrategy ?? workerPoolSelectionStrategy ?? "least-busy",
    workers,
  }

  const fallbackReassign = runtimeConfig?.delegation_launch?.fallback_reassign === "disabled"
    ? "disabled"
    : "pool"

  return {
    workerPool,
    configuredAgents: configuredAgents.size > 0 ? configuredAgents : fallback.configuredAgents,
    delegationLaunchPolicy: {
      fallback_reassign: fallbackReassign,
    },
  }
}

export const AgentTeamsRuntime: Plugin = async ({ client, directory }) => {
  const { db, dbPath, logEvent } = initRuntimeDb(directory)
  const guards = createRuntimeGuards({ db })
  const runtimeAgentConfig = loadRuntimeAgentConfig(directory)

  async function agentExists(agentName: string) {
    try {
      const response = await client.app.agents({ query: { directory } })
      const agents = Array.isArray(response?.data) ? response.data : []
      return agents.some((agent: any) => agent?.id === agentName || agent?.name === agentName)
    } catch {
      return true
    }
  }

  function isAgentConfigured(agentName: string) {
    if (runtimeAgentConfig.configuredAgents.size === 0) return true
    return runtimeAgentConfig.configuredAgents.has(agentName)
  }

  const ctx: RuntimeContext = {
    client,
    directory,
    dbPath,
    db,
    logEvent,
    guards,
    agentExists,
    isAgentConfigured,
    workerPool: runtimeAgentConfig.workerPool,
    delegationLaunchPolicy: runtimeAgentConfig.delegationLaunchPolicy,
  }

  const createTeam = tool({
    description: "Create a new agent teams runtime entry for the current project",
    args: {
      name: tool.schema.string().describe("Short team/run name"),
      goal: tool.schema.string().describe("Execution goal for the coordinated run"),
      branch_name: tool.schema.string().optional().describe("Working branch name, eg feature/x or hotfix/y"),
    },
    async execute(args) {
      const id = randomUUID()
      const createdAt = nowIso()
      const prTarget = baseBranchFor(args.branch_name)

      db.query(`
        INSERT INTO teams (id, name, goal, status, branch_name, pr_target_branch, created_at, updated_at)
        VALUES ($id, $name, $goal, 'active', $branch_name, $pr_target_branch, $created_at, $updated_at)
      `).run({
        $id: id,
        $name: args.name,
        $goal: args.goal,
        $branch_name: args.branch_name ?? null,
        $pr_target_branch: prTarget,
        $created_at: createdAt,
        $updated_at: createdAt,
      })

      runtimeEvent(ctx, {
        team_id: id,
        entity_type: "team",
        entity_id: id,
        event_type: "team.started",
        payload: { goal: args.goal, branch_name: args.branch_name ?? null, pr_target_branch: prTarget },
        created_at: createdAt,
      })

      return JSON.stringify({
        id,
        name: args.name,
        goal: args.goal,
        status: "active",
        branch_name: args.branch_name ?? null,
        pr_target_branch: prTarget,
        runtime_db: dbPath,
      })
    },
  })

  const setTeamStatus = tool({
    description: "Set an explicit runtime team status such as recovering or active",
    args: {
      team_id: tool.schema.string(),
      status: tool.schema.enum(["active", "paused", "recovering", "archived"]),
      note: tool.schema.string().optional(),
    },
    async execute(args) {
      guards.requireTeam(args.team_id)
      if (!TEAM_STATUSES.has(args.status)) throw new Error(`Unsupported team status ${args.status}`)

      const updatedAt = nowIso()
      db.query(`UPDATE teams SET status = $status, updated_at = $updated_at WHERE id = $team_id`).run({
        $status: args.status,
        $updated_at: updatedAt,
        $team_id: args.team_id,
      })

      runtimeEvent(ctx, {
        team_id: args.team_id,
        entity_type: "team",
        entity_id: args.team_id,
        event_type: `team.status.${args.status}`,
        payload: { note: args.note ?? null },
        created_at: updatedAt,
      })

      return JSON.stringify(db.query(`SELECT * FROM teams WHERE id = $team_id`).get({ $team_id: args.team_id }) as TeamRow)
    },
  })

  const teamStatus = tool({
    description: "Get summary status for an agent teams runtime",
    args: {
      team_id: tool.schema.string().optional().describe("Team identifier. Defaults to latest active team."),
    },
    async execute(args) {
      const row = (args.team_id
        ? db.query(`SELECT * FROM teams WHERE id = $team_id`).get({ $team_id: args.team_id })
        : db.query(`SELECT * FROM teams WHERE status IN ('active','paused','recovering') ORDER BY created_at DESC LIMIT 1`).get()) as TeamRow | null

      if (!row) {
        return JSON.stringify({ status: "not_found", message: "No active agent team runtime found" })
      }

      const countsRaw = db.query(`SELECT status, COUNT(*) as count FROM tasks WHERE team_id = $team_id GROUP BY status`).all({ $team_id: row.id }) as Array<{ status: string; count: number }>
      const taskCounts = Object.fromEntries(countsRaw.map((item) => [item.status, item.count]))

      const agentCountsRaw = db.query(`SELECT status, COUNT(*) as count FROM agents WHERE team_id = $team_id GROUP BY status`).all({ $team_id: row.id }) as Array<{ status: string; count: number }>
      const agentCounts = Object.fromEntries(agentCountsRaw.map((item) => [item.status, item.count]))

      const openDelegations = db.query(`SELECT COUNT(*) as count FROM delegations WHERE team_id = $team_id AND status IN ('requested','accepted','running')`).get({ $team_id: row.id }) as { count: number }
      const staleAgents = db.query(`SELECT COUNT(*) as count FROM agents WHERE team_id = $team_id AND lease_expires_at IS NOT NULL AND lease_expires_at < $now AND status IN ('idle','busy','waiting','recovering')`).get({ $team_id: row.id, $now: nowIso() }) as { count: number }
      const gitWorkItems = db.query(`SELECT COUNT(*) as count FROM git_work_items WHERE team_id = $team_id AND status != 'merged' AND status != 'abandoned'`).get({ $team_id: row.id }) as { count: number }
      const artifactLinks = db.query(`SELECT COUNT(*) as count FROM artifact_links WHERE team_id = $team_id`).get({ $team_id: row.id }) as { count: number }

      return JSON.stringify({
        ...rowToTeamStatus(row, taskCounts, agentCounts, {
          open_delegations: openDelegations?.count ?? 0,
          stale_agents: staleAgents?.count ?? 0,
          git_work_items: gitWorkItems?.count ?? 0,
          artifact_links: artifactLinks?.count ?? 0,
        }),
        runtime_db: dbPath,
      })
    },
  })

  const agentRegister = tool({
    description: "Register or refresh an agent in the runtime registry with lease metadata",
    args: {
      team_id: tool.schema.string(),
      agent_name: tool.schema.string(),
      role: tool.schema.string().default("worker"),
      status: tool.schema.enum(["idle", "busy", "waiting", "offline", "recovering"]).default("idle"),
      capabilities: tool.schema.string().optional().describe("Comma-separated list or JSON array of agent capabilities"),
      lease_minutes: tool.schema.number().default(15),
      current_task_id: tool.schema.string().optional(),
    },
    async execute(args) {
      guards.requireTeam(args.team_id)
      if (args.current_task_id) guards.requireTask(args.team_id, args.current_task_id)

      const heartbeatAt = nowIso()
      const leaseExpiresAtDate = new Date(nowIso())
      leaseExpiresAtDate.setUTCMinutes(leaseExpiresAtDate.getUTCMinutes() + args.lease_minutes)
      const leaseExpiresAt = leaseExpiresAtDate.toISOString()
      const capabilitiesJson = JSON.stringify(parseCapabilities(args.capabilities))
      const existing = db.query(`SELECT * FROM agents WHERE team_id = $team_id AND agent_name = $agent_name`).get({
        $team_id: args.team_id,
        $agent_name: args.agent_name,
      }) as AgentRow | null

      if (existing) {
        db.query(`
          UPDATE agents
          SET role = $role,
              status = $status,
              capabilities_json = $capabilities_json,
              last_heartbeat_at = $last_heartbeat_at,
              lease_expires_at = $lease_expires_at,
              current_task_id = $current_task_id,
              updated_at = $updated_at
          WHERE id = $id
        `).run({
          $role: args.role,
          $status: args.status,
          $capabilities_json: capabilitiesJson,
          $last_heartbeat_at: heartbeatAt,
          $lease_expires_at: leaseExpiresAt,
          $current_task_id: args.current_task_id ?? null,
          $updated_at: heartbeatAt,
          $id: existing.id,
        })
      } else {
        db.query(`
          INSERT INTO agents (id, team_id, agent_name, role, status, capabilities_json, last_heartbeat_at, lease_expires_at, current_task_id, created_at, updated_at)
          VALUES ($id, $team_id, $agent_name, $role, $status, $capabilities_json, $last_heartbeat_at, $lease_expires_at, $current_task_id, $created_at, $updated_at)
        `).run({
          $id: randomUUID(),
          $team_id: args.team_id,
          $agent_name: args.agent_name,
          $role: args.role,
          $status: args.status,
          $capabilities_json: capabilitiesJson,
          $last_heartbeat_at: heartbeatAt,
          $lease_expires_at: leaseExpiresAt,
          $current_task_id: args.current_task_id ?? null,
          $created_at: heartbeatAt,
          $updated_at: heartbeatAt,
        })
      }

      const row = db.query(`SELECT * FROM agents WHERE team_id = $team_id AND agent_name = $agent_name`).get({
        $team_id: args.team_id,
        $agent_name: args.agent_name,
      }) as AgentRow

      runtimeEvent(ctx, {
        team_id: args.team_id,
        entity_type: "agent",
        entity_id: row.id,
        event_type: existing ? "agent.refreshed" : "agent.registered",
        payload: { role: args.role, status: args.status, lease_expires_at: leaseExpiresAt, current_task_id: args.current_task_id ?? null },
        created_at: heartbeatAt,
      })

      return JSON.stringify(agentResponse(row))
    },
  })

  const agentHeartbeat = tool({
    description: "Renew agent heartbeat and lease state in the runtime registry",
    args: {
      team_id: tool.schema.string(),
      agent_name: tool.schema.string(),
      status: tool.schema.enum(["idle", "busy", "waiting", "offline", "recovering"]).optional(),
      lease_minutes: tool.schema.number().default(15),
      current_task_id: tool.schema.string().optional(),
    },
    async execute(args) {
      const row = db.query(`SELECT * FROM agents WHERE team_id = $team_id AND agent_name = $agent_name`).get({
        $team_id: args.team_id,
        $agent_name: args.agent_name,
      }) as AgentRow | null
      if (!row) throw new Error(`Agent ${args.agent_name} is not registered in team ${args.team_id}`)
      if (args.current_task_id) guards.requireTask(args.team_id, args.current_task_id)

      const heartbeatAt = nowIso()
      const leaseExpiresAtDate = new Date(nowIso())
      leaseExpiresAtDate.setUTCMinutes(leaseExpiresAtDate.getUTCMinutes() + args.lease_minutes)
      const leaseExpiresAt = leaseExpiresAtDate.toISOString()

      db.query(`
        UPDATE agents
        SET status = COALESCE($status, status),
            last_heartbeat_at = $last_heartbeat_at,
            lease_expires_at = $lease_expires_at,
            current_task_id = COALESCE($current_task_id, current_task_id),
            updated_at = $updated_at
        WHERE id = $id
      `).run({
        $status: args.status ?? null,
        $last_heartbeat_at: heartbeatAt,
        $lease_expires_at: leaseExpiresAt,
        $current_task_id: args.current_task_id ?? null,
        $updated_at: heartbeatAt,
        $id: row.id,
      })

      runtimeEvent(ctx, {
        team_id: args.team_id,
        entity_type: "agent",
        entity_id: row.id,
        event_type: "agent.heartbeat",
        payload: {
          status: args.status ?? row.status,
          lease_expires_at: leaseExpiresAt,
          current_task_id: args.current_task_id ?? row.current_task_id,
        },
        created_at: heartbeatAt,
      })

      const updated = db.query(`SELECT * FROM agents WHERE id = $id`).get({ $id: row.id }) as AgentRow
      return JSON.stringify(agentResponse(updated))
    },
  })

  const agentList = tool({
    description: "List registered runtime agents for a team",
    args: {
      team_id: tool.schema.string(),
      status: tool.schema.enum(["idle", "busy", "waiting", "offline", "recovering"]).optional(),
    },
    async execute(args) {
      guards.requireTeam(args.team_id)

      const rows = (args.status
        ? db.query(`SELECT * FROM agents WHERE team_id = $team_id AND status = $status ORDER BY agent_name ASC`).all({ $team_id: args.team_id, $status: args.status })
        : db.query(`SELECT * FROM agents WHERE team_id = $team_id ORDER BY agent_name ASC`).all({ $team_id: args.team_id })) as AgentRow[]

      return JSON.stringify({
        team_id: args.team_id,
        total: rows.length,
        agents: rows.map(agentResponse),
      })
    },
  })

  const tasksDomain = createTasksDomain(ctx)
  const delegationsDomain = createDelegationsDomain(ctx)
  const mailboxDomain = createMailboxDomain(ctx)
  const recoveryDomain = createRecoveryDomain(ctx, {
    updateDelegationExecution: delegationsDomain.helpers.updateDelegationExecution,
  })
  const gitDomain = createGitWorkItemsDomain(ctx)
  const artifactDomain = createArtifactLinksDomain(ctx)

  await client.app
    .log({
      body: {
        service: "agent-teams-runtime",
        level: "info",
        message: `Agent Teams Runtime initialized at ${dbPath}`,
      },
    })
    .catch(() => {})

  return {
    event: createRuntimeEventHandler(ctx, {
      syncDelegationChildSession: delegationsDomain.helpers.syncDelegationChildSession,
      updateDelegationExecution: delegationsDomain.helpers.updateDelegationExecution,
    }),
    tool: createToolRegistry({
      team_start: createTeam,
      team_set_status: setTeamStatus,
      team_status: teamStatus,
      team_agent_register: agentRegister,
      team_agent_heartbeat: agentHeartbeat,
      team_agent_list: agentList,
      ...tasksDomain.tools,
      ...delegationsDomain.tools,
      ...mailboxDomain.tools,
      ...recoveryDomain.tools,
      ...gitDomain.tools,
      ...artifactDomain.tools,
    }),
  }
}

export default AgentTeamsRuntime
