import { readFileSync } from "node:fs"
import { join } from "node:path"

import { Database } from "bun:sqlite"

import AgentTeamsRuntime from "../../plugins/agent-teams-runtime"
import { canonicalToolNames } from "../../plugins/agent-teams-runtime/compat/tool-registry"
import { TASK_TRANSITIONS } from "../../plugins/agent-teams-runtime/shared/constants"

type JsonObject = Record<string, unknown>

export type Severity = "critical" | "high" | "medium" | "low"

export type TaskStateDrift = {
  format_version: number
  contract_reference: string
  runtime_reference: string
  missing_in_runtime: string[]
  extra_in_runtime: string[]
  transition_mismatches: Array<{
    state: string
    expected: string[]
    observed: string[]
    missing_transitions: string[]
    extra_transitions: string[]
    mismatch: boolean
  }>
}

export type ParitySnapshot = {
  toolArgsSnapshot: JsonObject
  responseSnapshot: JsonObject
  ddlBaseline: JsonObject
  taskStateDrift: TaskStateDrift
  summary: {
    generated_at: string
    tool_count: number
    ddl_entry_count: number
    task_state_drift: {
      missing_in_runtime: number
      extra_in_runtime: number
      transition_mismatches: number
    }
  }
}

export function createMockClient() {
  const messagesBySession = new Map<string, any[]>()

  return {
    app: {
      log: async () => ({ data: {} }),
      agents: async () => ({ data: [{ id: "agent-beta", name: "agent-beta" }] }),
    },
    session: {
      create: async ({ body }: any) => ({ data: { id: `session-${Math.random().toString(36).slice(2)}`, parentID: body?.parentID ?? null, title: body?.title ?? "" } }),
      promptAsync: async ({ path }: any) => {
        messagesBySession.set(path.id, [
          {
            info: {
              id: `message-${Math.random().toString(36).slice(2)}`,
              sessionID: path.id,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
            },
            parts: [{ type: "text", text: "Delegation finished successfully" }],
          },
        ])
        return { data: {} }
      },
      messages: async ({ path }: any) => ({ data: messagesBySession.get(path.id) ?? [] }),
    },
  }
}

function unwrapSchema(schema: any) {
  let current = schema
  let optional = false
  let nullable = false
  let hasDefault = false
  let defaultValue: unknown = undefined

  while (current?.def?.type) {
    const t = current.def.type
    if (t === "optional") {
      optional = true
      current = current.def.innerType
      continue
    }
    if (t === "nullable") {
      nullable = true
      current = current.def.innerType
      continue
    }
    if (t === "default") {
      hasDefault = true
      defaultValue = typeof current.def.defaultValue === "function" ? current.def.defaultValue() : current.def.defaultValue
      current = current.def.innerType
      continue
    }
    break
  }

  const baseType = current?.def?.type ?? current?.type ?? "unknown"
  const enumValues = Array.isArray(current?.options)
    ? [...current.options]
    : current?.def?.entries
      ? Object.keys(current.def.entries)
      : undefined

  const out: Record<string, unknown> = {
    schema_type: baseType,
    nullable,
    required: !optional && !hasDefault,
    has_default: hasDefault,
  }
  if (enumValues !== undefined) out.enum = enumValues
  if (hasDefault) out.default = defaultValue
  return out
}

function topLevelShape(obj: JsonObject) {
  const entries = Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))
  return Object.fromEntries(
    entries.map(([k, v]) => {
      const type = Array.isArray(v) ? "array" : v === null ? "null" : typeof v
      return [k, type]
    }),
  )
}

function responseCoverage(commands: Record<string, unknown>) {
  const expected = canonicalToolNames().filter((name) => name.startsWith("team_"))
  const covered = Object.keys(commands).sort()
  const missing = expected.filter((name) => !covered.includes(name)).sort()
  return {
    total_team_tools: expected.length,
    covered_tools: covered.length,
    coverage_percent: Number(((covered.length / Math.max(expected.length, 1)) * 100).toFixed(2)),
    covered_commands: covered,
    missing_commands: missing,
  }
}

function parseJsonResult(raw: unknown) {
  if (typeof raw !== "string") throw new Error("Tool response is not JSON string")
  return JSON.parse(raw) as JsonObject
}

function stableClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stableClone(v)) as T
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return Object.fromEntries(entries.map(([key, val]) => [key, stableClone(val)])) as T
  }
  return value
}

function parseContractTaskTransitions(contractPath: string) {
  const contractText = readFileSync(contractPath, "utf8")
  const lines = contractText.split("\n")
  const start = lines.findIndex((line) => line.includes("### 1.3 Task States"))
  const end = lines.findIndex((line, idx) => idx > start && line.includes("### 1.4 Delegation States"))
  const contractRows = lines.slice(start, end).filter((line) => line.trim().startsWith("| `"))
  const contractTransitions = new Map<string, Set<string>>()

  for (const row of contractRows) {
    const ticks = [...row.matchAll(/`([^`]+)`/g)].map((m) => m[1])
    if (ticks.length === 0) continue
    const [state, ...transitions] = ticks
    contractTransitions.set(state, new Set(transitions))
  }

  return contractTransitions
}

export function jsonDiffPaths(base: unknown, current: unknown, currentPath = "$", acc: string[] = []) {
  if (Object.is(base, current)) return acc

  if (Array.isArray(base) && Array.isArray(current)) {
    if (base.length !== current.length) {
      acc.push(`${currentPath}.length`)
    }
    const max = Math.max(base.length, current.length)
    for (let i = 0; i < max; i += 1) {
      jsonDiffPaths(base[i], current[i], `${currentPath}[${i}]`, acc)
    }
    return acc
  }

  const baseIsObj = Boolean(base) && typeof base === "object" && !Array.isArray(base)
  const currentIsObj = Boolean(current) && typeof current === "object" && !Array.isArray(current)
  if (baseIsObj && currentIsObj) {
    const a = base as Record<string, unknown>
    const b = current as Record<string, unknown>
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    for (const key of keys) {
      if (!(key in a)) {
        acc.push(`${currentPath}.${key}:added`)
        continue
      }
      if (!(key in b)) {
        acc.push(`${currentPath}.${key}:removed`)
        continue
      }
      jsonDiffPaths(a[key], b[key], `${currentPath}.${key}`, acc)
    }
    return acc
  }

  acc.push(currentPath)
  return acc
}

export async function collectCurrentParity(rootDir: string, runTag = "week3") {
  const runtime = await AgentTeamsRuntime({ client: createMockClient() as any, directory: `${rootDir}/.tmp/${runTag}-${Date.now()}` } as any)
  const toolNames = Object.keys(runtime.tool)
    .filter((name) => name.startsWith("team_"))
    .sort()

  const toolArgsSnapshot = {
    format_version: 1,
    source: "runtime live introspection",
    tool_count: toolNames.length,
    tools: toolNames.map((name) => {
      const runtimeTool: any = runtime.tool[name]
      const args = (runtimeTool?.args ?? {}) as Record<string, any>
      const argEntries = Object.entries(args).sort(([a], [b]) => a.localeCompare(b))
      const properties = Object.fromEntries(argEntries.map(([argName, schema]) => [argName, unwrapSchema(schema)]))
      const required = argEntries
        .filter(([, schema]) => unwrapSchema(schema).required)
        .map(([argName]) => argName)

      return {
        name,
        description: runtimeTool?.description ?? "",
        args: {
          type: "object",
          properties,
          required,
          additional_properties: false,
        },
      }
    }),
  }

  const execTool = async (toolName: string, args: Record<string, unknown>, context?: Record<string, unknown>) => {
    const t: any = runtime.tool[toolName]
    if (!t || typeof t.execute !== "function") throw new Error(`Tool ${toolName} not found`)
    return parseJsonResult(await t.execute(args, context))
  }

  const responseCommands: Record<string, { top_level_shape: Record<string, string> }> = {}
  const capture = (toolName: string, payload: JsonObject) => {
    responseCommands[toolName] = { top_level_shape: topLevelShape(payload) }
    return payload
  }

  const team = capture("team_start", await execTool("team_start", { name: `week3-${runTag}`, goal: "contract parity check" }))

  const teamPaused = capture("team_set_status", await execTool("team_set_status", {
    team_id: team.id,
    status: "paused",
    note: "response shape snapshot",
  }))
  if (teamPaused.status !== "paused") throw new Error("team_set_status did not transition to paused")

  capture("team_status", await execTool("team_status", { team_id: team.id }))

  capture("team_agent_register", await execTool("team_agent_register", {
    team_id: team.id,
    agent_name: "agent-alpha",
    role: "worker",
    status: "idle",
    lease_minutes: 15,
  }))

  await execTool("team_agent_register", {
    team_id: team.id,
    agent_name: "agent-beta",
    role: "worker",
    status: "idle",
    capabilities: "delegation",
    lease_minutes: 15,
  })

  capture("team_agent_heartbeat", await execTool("team_agent_heartbeat", {
    team_id: team.id,
    agent_name: "agent-alpha",
    status: "idle",
    lease_minutes: 15,
  }))

  capture("team_agent_list", await execTool("team_agent_list", { team_id: team.id }))

  const task = await execTool("team_task_create", {
    team_id: team.id,
    title: "Parity task",
    description: "Seed for response shape snapshots",
    priority: "medium",
  })
  capture("team_task_create", task)

  capture("team_task_list", await execTool("team_task_list", { team_id: team.id }))

  const claim = await execTool("team_task_claim", {
    team_id: team.id,
    task_id: task.id,
    claimant: "agent-alpha",
    lease_minutes: 15,
  })
  capture("team_task_claim", claim)

  const release = await execTool("team_task_release", {
    team_id: team.id,
    task_id: task.id,
    reason: "shape snapshot",
  })
  capture("team_task_release", release)

  const blocked = await execTool("team_task_block", {
    team_id: team.id,
    task_id: task.id,
    reason: "shape snapshot",
  })
  capture("team_task_block", blocked)

  const unblocked = await execTool("team_task_unblock", {
    team_id: team.id,
    task_id: task.id,
  })
  capture("team_task_unblock", unblocked)

  const completeTask = await execTool("team_task_create", {
    team_id: team.id,
    title: "Completion shape task",
    description: "Used to snapshot complete response shape",
    priority: "high",
  })
  await execTool("team_task_claim", {
    team_id: team.id,
    task_id: completeTask.id,
    claimant: "agent-alpha",
    lease_minutes: 15,
  })
  capture("team_task_complete", await execTool("team_task_complete", { team_id: team.id, task_id: completeTask.id }))

  const delegatedTask = await execTool("team_task_create", {
    team_id: team.id,
    title: "Delegation shape task",
    description: "Used to snapshot delegation response shapes",
    priority: "high",
  })

  const delegation = await execTool("team_delegation_create", {
    team_id: team.id,
    task_id: delegatedTask.id,
    source_agent: "agent-alpha",
    target_agent: "agent-beta",
    prompt: "Collect response shape",
  })
  capture("team_delegation_create", delegation)

  const delegationAccepted = await execTool("team_delegation_transition", {
    delegation_id: delegation.id,
    next_status: "accepted",
  })
  capture("team_delegation_transition", delegationAccepted)

  capture("team_delegation_launch", await execTool("team_delegation_launch", {
    delegation_id: delegation.id,
  }, { sessionID: "week3-parity-parent" }))

  capture("team_delegation_sync", await execTool("team_delegation_sync", { delegation_id: delegation.id }))

  const mailbox = await execTool("team_mailbox_send", {
    team_id: team.id,
    sender_agent: "agent-alpha",
    recipient_agent: "agent-beta",
    message_type: "info",
    subject: "shape",
    body: "snapshot",
  })
  capture("team_mailbox_send", mailbox)

  capture("team_mailbox_list", await execTool("team_mailbox_list", { team_id: team.id }))

  const mailboxRead = await execTool("team_mailbox_transition", { message_id: mailbox.id, next_status: "read" })
  capture("team_mailbox_transition", mailboxRead)

  const checkpoint = await execTool("team_checkpoint_create", {
    team_id: team.id,
    checkpoint_type: "manual",
    note: "parity",
  })
  capture("team_checkpoint_create", checkpoint)

  capture("team_checkpoint_latest", await execTool("team_checkpoint_latest", { team_id: team.id }))

  const recoveryInspect = await execTool("team_recovery_inspect", { team_id: team.id })
  capture("team_recovery_inspect", recoveryInspect)

  const staleTask = await execTool("team_task_create", {
    team_id: team.id,
    title: "Stale claim task",
    description: "Used for recovery stale claim response shape",
    priority: "medium",
  })
  await execTool("team_task_claim", {
    team_id: team.id,
    task_id: staleTask.id,
    claimant: "agent-alpha",
    lease_minutes: -1,
  })

  capture("team_recovery_requeue_stale_claims", await execTool("team_recovery_requeue_stale_claims", {
    team_id: team.id,
    stale_agent_status: "recovering",
    note: "snapshot stale recovery",
  }))

  const resolveDelegation = await execTool("team_delegation_create", {
    team_id: team.id,
    task_id: delegatedTask.id,
    source_agent: "agent-alpha",
    target_agent: "agent-zeta",
    prompt: "Resolve this delegation in recovery",
  })

  capture("team_recovery_resolve_delegations", await execTool("team_recovery_resolve_delegations", {
    team_id: team.id,
    delegation_ids: resolveDelegation.id,
    next_status: "cancelled",
    target_agent_status: "unchanged",
    note: "snapshot delegation resolution",
  }))

  const reassignDelegation = await execTool("team_delegation_create", {
    team_id: team.id,
    task_id: delegatedTask.id,
    source_agent: "agent-alpha",
    target_agent: "agent-unregistered",
    prompt: "Reassign this delegation",
  })

  capture("team_recovery_reassign_delegation", await execTool("team_recovery_reassign_delegation", {
    team_id: team.id,
    delegation_id: reassignDelegation.id,
    new_target_agent: "agent-beta",
    resolve_prior_mailbox: "yes",
    note: "snapshot delegation reassign",
  }))

  capture("team_recovery_resolve_mailbox", await execTool("team_recovery_resolve_mailbox", {
    team_id: team.id,
    message_ids: mailbox.id,
    note: "snapshot mailbox resolve",
  }))

  capture("team_set_status", await execTool("team_set_status", {
    team_id: team.id,
    status: "active",
    note: "return active after snapshot",
  }))

  capture("team_git_work_item_upsert", await execTool("team_git_work_item_upsert", {
    team_id: team.id,
    task_id: task.id,
    branch_name: "feature/week4-batch2-parity",
    commit_batching_mode: "single",
    status: "in_progress",
  }))

  capture("team_git_work_item_list", await execTool("team_git_work_item_list", { team_id: team.id }))

  capture("team_git_work_item_validate", await execTool("team_git_work_item_validate", { task_id: task.id }))

  capture("team_artifact_link_create", await execTool("team_artifact_link_create", {
    team_id: team.id,
    entity_type: "task",
    entity_id: task.id,
    artifact_system: "runtime",
    artifact_kind: "artifact",
    reference_id: `snapshot-${runTag}`,
    note: "response shape snapshot",
  }))

  capture("team_artifact_link_list", await execTool("team_artifact_link_list", {
    team_id: team.id,
    entity_type: "task",
    entity_id: task.id,
  }))

  capture("team_status", await execTool("team_status", { team_id: team.id }))

  const responseSnapshot = {
    format_version: 2,
    source: "runtime live execution",
    coverage: responseCoverage(responseCommands),
    commands: responseCommands,
  }

  const db = new Database(String(team.runtime_db), { readonly: true })
  const ddlRows = db
    .query(`
      SELECT type, name, tbl_name, sql
      FROM sqlite_master
      WHERE type IN ('table', 'index')
        AND name NOT LIKE 'sqlite_%'
      ORDER BY type ASC, name ASC
    `)
    .all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>
  db.close()

  const ddlBaseline = {
    format_version: 1,
    source: "runtime sqlite_master",
    entries: ddlRows.map((row) => ({
      type: row.type,
      name: row.name,
      table: row.tbl_name,
      sql_normalized: (row.sql ?? "").replace(/\s+/g, " ").trim().replace(/;$/, ""),
    })),
  }

  const contractTransitions = parseContractTaskTransitions(join(rootDir, "specs", "contracts", "runtime-operating-contract-v1.md"))
  const runtimeTransitions = new Map<string, Set<string>>()
  for (const [state, transitions] of TASK_TRANSITIONS.entries()) {
    runtimeTransitions.set(state, new Set(transitions))
  }

  const contractStates = new Set(contractTransitions.keys())
  const runtimeStates = new Set(runtimeTransitions.keys())
  const missingInRuntime = [...contractStates].filter((state) => !runtimeStates.has(state)).sort()
  const extraInRuntime = [...runtimeStates].filter((state) => !contractStates.has(state)).sort()

  const transitionMismatches = [...contractStates]
    .filter((state) => runtimeStates.has(state))
    .map((state) => {
      const expected = [...(contractTransitions.get(state) ?? new Set<string>())].sort()
      const observed = [...(runtimeTransitions.get(state) ?? new Set<string>())].sort()
      const missingTransitions = expected.filter((s) => !observed.includes(s))
      const extraTransitions = observed.filter((s) => !expected.includes(s))
      return {
        state,
        expected,
        observed,
        missing_transitions: missingTransitions,
        extra_transitions: extraTransitions,
        mismatch: missingTransitions.length > 0 || extraTransitions.length > 0,
      }
    })
    .filter((item) => item.mismatch)

  const taskStateDrift: TaskStateDrift = {
    format_version: 1,
    contract_reference: "specs/contracts/runtime-operating-contract-v1.md §1.3 Task States",
    runtime_reference: "plugins/agent-teams-runtime/shared/constants.ts TASK_TRANSITIONS",
    missing_in_runtime: missingInRuntime,
    extra_in_runtime: extraInRuntime,
    transition_mismatches: transitionMismatches,
  }

  return {
    toolArgsSnapshot: stableClone(toolArgsSnapshot),
    responseSnapshot: stableClone(responseSnapshot),
    ddlBaseline: stableClone(ddlBaseline),
    taskStateDrift,
    summary: {
      generated_at: new Date().toISOString(),
      tool_count: toolNames.length,
      ddl_entry_count: ddlBaseline.entries.length,
      task_state_drift: {
        missing_in_runtime: missingInRuntime.length,
        extra_in_runtime: extraInRuntime.length,
        transition_mismatches: transitionMismatches.length,
      },
    },
  } satisfies ParitySnapshot
}
