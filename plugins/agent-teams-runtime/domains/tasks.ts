import { randomUUID } from "node:crypto"

import { tool } from "@opencode-ai/plugin"

import { assertTaskTransition, CLAIMABLE_TASK_STATUSES } from "../shared/constants"
import { runtimeEvent } from "../shared/events"
import type { AgentRow, RuntimeContext, TaskRow } from "../shared/types"
import { capabilitiesIntersect, nowIso, parseCapabilities } from "../shared/utils"

export function createTasksDomain(ctx: RuntimeContext) {
  const { db, guards } = ctx

  const CLAIM_ELIGIBLE_AGENT_STATUSES = new Set(["idle", "waiting"])

  function hasValidLease(agent: AgentRow) {
    if (!agent.lease_expires_at) return true
    return agent.lease_expires_at > nowIso()
  }

  function parseTaskClaimCapabilities(taskDescription: string) {
    const marker = /capabilities\s*:\s*([^\n]+)/i.exec(taskDescription)
    if (!marker) return [] as string[]

    return parseCapabilities(marker[1])
      .map((item) => item.trim())
      .filter(Boolean)
  }

  function requireClaimantOperational(teamId: string, task: TaskRow, claimant: string) {
    const claimantAgent = db.query(`SELECT * FROM agents WHERE team_id = $team_id AND agent_name = $agent_name`).get({
      $team_id: teamId,
      $agent_name: claimant,
    }) as AgentRow | null

    if (!claimantAgent) {
      throw new Error(`Claimant ${claimant} is not registered in team ${teamId}`)
    }

    if (!CLAIM_ELIGIBLE_AGENT_STATUSES.has(claimantAgent.status)) {
      throw new Error(`Claimant ${claimant} has non-operational status ${claimantAgent.status}; expected idle or waiting`)
    }

    if (!hasValidLease(claimantAgent)) {
      throw new Error(`Claimant ${claimant} lease expired at ${claimantAgent.lease_expires_at}`)
    }

    const requiredCapabilities = parseTaskClaimCapabilities(task.description)
    if (requiredCapabilities.length > 0 && !capabilitiesIntersect(requiredCapabilities, parseCapabilities(claimantAgent.capabilities_json))) {
      throw new Error(
        `Claimant ${claimant} lacks required capabilities [${requiredCapabilities.join(", ")}] declared for task ${task.id}`,
      )
    }

    return claimantAgent
  }

  const taskCreate = tool({
    description: "Create a shared runtime task for an agent team",
    args: {
      team_id: tool.schema.string(),
      title: tool.schema.string(),
      description: tool.schema.string(),
      priority: tool.schema.enum(["urgent", "high", "medium", "low"]).default("medium"),
      depends_on_task_id: tool.schema.string().optional(),
    },
    async execute(args) {
      guards.requireTeam(args.team_id)

      if (args.depends_on_task_id) {
        const dependency = db.query(`SELECT id FROM tasks WHERE id = $task_id AND team_id = $team_id`).get({ $task_id: args.depends_on_task_id, $team_id: args.team_id })
        if (!dependency) throw new Error(`Dependency task ${args.depends_on_task_id} not found in team ${args.team_id}`)
      }

      const id = randomUUID()
      const createdAt = nowIso()
      const status = args.depends_on_task_id ? "todo" : "ready"

      db.query(`
        INSERT INTO tasks (id, team_id, title, description, priority, status, claimed_by, claim_lease_expires_at, depends_on_task_id, created_at, updated_at)
        VALUES ($id, $team_id, $title, $description, $priority, $status, NULL, NULL, $depends_on_task_id, $created_at, $updated_at)
      `).run({
        $id: id,
        $team_id: args.team_id,
        $title: args.title,
        $description: args.description,
        $priority: args.priority,
        $status: status,
        $depends_on_task_id: args.depends_on_task_id ?? null,
        $created_at: createdAt,
        $updated_at: createdAt,
      })

      runtimeEvent(ctx, {
        team_id: args.team_id,
        entity_type: "task",
        entity_id: id,
        event_type: "task.created",
        payload: { title: args.title, status, depends_on_task_id: args.depends_on_task_id ?? null },
        created_at: createdAt,
      })

      return JSON.stringify({ id, team_id: args.team_id, title: args.title, status, priority: args.priority })
    },
  })

  const taskList = tool({
    description: "List runtime tasks for an agent team",
    args: {
      team_id: tool.schema.string(),
      status: tool.schema.string().optional(),
    },
    async execute(args) {
      guards.requireTeam(args.team_id)

      const normalizedStatusFilter = args.status

      const rows = (normalizedStatusFilter
        ? db.query(`SELECT * FROM tasks WHERE team_id = $team_id AND status = $status ORDER BY created_at ASC`).all({ $team_id: args.team_id, $status: normalizedStatusFilter })
        : db.query(`SELECT * FROM tasks WHERE team_id = $team_id ORDER BY created_at ASC`).all({ $team_id: args.team_id })) as TaskRow[]

      const gitRows = db.query(`SELECT * FROM git_work_items WHERE team_id = $team_id`).all({ $team_id: args.team_id }) as Array<{ task_id: string } & Record<string, unknown>>
      const gitByTaskId = new Map(gitRows.map((row) => [row.task_id, row]))

      return JSON.stringify({
        team_id: args.team_id,
        total: rows.length,
        tasks: rows.map((row) => ({
          ...row,
          git_work_item: gitByTaskId.get(row.id) ?? null,
        })),
      })
    },
  })

  const claimTaskTx = db.transaction((teamId: string, taskId: string, claimant: string, leaseMinutes: number) => {
    const task = guards.requireTask(teamId, taskId)
    if (!CLAIMABLE_TASK_STATUSES.has(task.status)) throw new Error(`Task ${taskId} is not claimable from status ${task.status}`)
    requireClaimantOperational(teamId, task, claimant)

    const now = new Date(nowIso())
    const leaseExpiresDate = new Date(nowIso())
    leaseExpiresDate.setUTCMinutes(leaseExpiresDate.getUTCMinutes() + leaseMinutes)
    const leaseExpires = leaseExpiresDate.toISOString()
    const updatedAt = now.toISOString()

    db.query(`
      UPDATE tasks
      SET status = 'in_progress', claimed_by = $claimed_by, claim_lease_expires_at = $claim_lease_expires_at, block_reason = NULL, updated_at = $updated_at
      WHERE id = $task_id AND team_id = $team_id
    `).run({
      $claimed_by: claimant,
      $claim_lease_expires_at: leaseExpires,
      $updated_at: updatedAt,
      $task_id: taskId,
      $team_id: teamId,
    })

    guards.maybeTouchRegisteredAgent(teamId, claimant, {
      status: "busy",
      lease_expires_at: leaseExpires,
      current_task_id: taskId,
    })

    runtimeEvent(ctx, {
      team_id: teamId,
      entity_type: "task",
      entity_id: taskId,
      event_type: "task.claimed",
      payload: { claimant, lease_expires_at: leaseExpires },
      created_at: updatedAt,
    })

    return db.query(`SELECT * FROM tasks WHERE id = $task_id`).get({ $task_id: taskId }) as TaskRow
  })

  const taskClaim = tool({
    description: "Claim a runtime task exclusively for a worker or agent",
    args: {
      team_id: tool.schema.string(),
      task_id: tool.schema.string(),
      claimant: tool.schema.string(),
      lease_minutes: tool.schema.number().default(15),
    },
    async execute(args) {
      const row = claimTaskTx(args.team_id, args.task_id, args.claimant, args.lease_minutes)
      return JSON.stringify(row)
    },
  })

  const taskReleaseTx = db.transaction((teamId: string, taskId: string, reason?: string) => {
    const task = guards.requireTask(teamId, taskId)
    assertTaskTransition(task.status, "ready")

    const now = nowIso()
    const previousClaimedBy = task.claimed_by

    db.query(`
      UPDATE tasks
      SET status = 'ready', claimed_by = NULL, claim_lease_expires_at = NULL, block_reason = NULL, updated_at = $updated_at
      WHERE id = $task_id AND team_id = $team_id
    `).run({
      $updated_at: now,
      $task_id: taskId,
      $team_id: teamId,
    })

    if (previousClaimedBy) {
      guards.maybeTouchRegisteredAgent(teamId, previousClaimedBy, { status: "idle", current_task_id: null })
    }

    runtimeEvent(ctx, {
      team_id: teamId,
      entity_type: "task",
      entity_id: taskId,
      event_type: "task.released",
      payload: { previous_claimed_by: previousClaimedBy, reason: reason ?? null },
      created_at: now,
    })

    return db.query(`SELECT * FROM tasks WHERE id = $task_id`).get({ $task_id: taskId }) as TaskRow
  })

  const taskRelease = tool({
    description: "Release a claimed task back to the pool",
    args: { team_id: tool.schema.string(), task_id: tool.schema.string(), reason: tool.schema.string().optional() },
    async execute(args) {
      return JSON.stringify(taskReleaseTx(args.team_id, args.task_id, args.reason))
    },
  })

  const taskBlockTx = db.transaction((teamId: string, taskId: string, reason?: string) => {
    const task = guards.requireTask(teamId, taskId)
    assertTaskTransition(task.status, "blocked")
    const now = nowIso()
    const previousClaimedBy = task.claimed_by

    db.query(`
      UPDATE tasks
      SET status = 'blocked', claimed_by = NULL, claim_lease_expires_at = NULL, block_reason = $block_reason, updated_at = $updated_at
      WHERE id = $task_id AND team_id = $team_id
    `).run({ $block_reason: reason ?? null, $updated_at: now, $task_id: taskId, $team_id: teamId })

    if (previousClaimedBy) guards.maybeTouchRegisteredAgent(teamId, previousClaimedBy, { status: "idle", current_task_id: null })

    runtimeEvent(ctx, {
      team_id: teamId,
      entity_type: "task",
      entity_id: taskId,
      event_type: "task.blocked",
      payload: { reason: reason ?? null, previous_status: task.status, claimed_by: previousClaimedBy },
      created_at: now,
    })

    return db.query(`SELECT * FROM tasks WHERE id = $task_id`).get({ $task_id: taskId }) as TaskRow
  })

  const taskBlock = tool({
    description: "Mark a task as blocked with an optional reason",
    args: { team_id: tool.schema.string(), task_id: tool.schema.string(), reason: tool.schema.string().optional() },
    async execute(args) {
      return JSON.stringify(taskBlockTx(args.team_id, args.task_id, args.reason))
    },
  })

  const taskUnblockTx = db.transaction((teamId: string, taskId: string) => {
    const task = guards.requireTask(teamId, taskId)
    assertTaskTransition(task.status, "ready")
    const now = nowIso()
    const previousClaimedBy = task.claimed_by

    db.query(`
      UPDATE tasks
      SET status = 'ready', claimed_by = NULL, claim_lease_expires_at = NULL, block_reason = NULL, updated_at = $updated_at
      WHERE id = $task_id AND team_id = $team_id
    `).run({ $updated_at: now, $task_id: taskId, $team_id: teamId })

    if (previousClaimedBy) guards.maybeTouchRegisteredAgent(teamId, previousClaimedBy, { status: "idle", current_task_id: null })

    runtimeEvent(ctx, {
      team_id: teamId,
      entity_type: "task",
      entity_id: taskId,
      event_type: "task.unblocked",
      payload: { previous_claimed_by: previousClaimedBy },
      created_at: now,
    })

    return db.query(`SELECT * FROM tasks WHERE id = $task_id`).get({ $task_id: taskId }) as TaskRow
  })

  const taskUnblock = tool({
    description: "Unblock a blocked task and return it to the ready pool",
    args: { team_id: tool.schema.string(), task_id: tool.schema.string() },
    async execute(args) {
      return JSON.stringify(taskUnblockTx(args.team_id, args.task_id))
    },
  })

  const taskCompleteTx = db.transaction((teamId: string, taskId: string) => {
    const task = guards.requireTask(teamId, taskId)
    assertTaskTransition(task.status, "done")
    const now = nowIso()
    const previousClaimedBy = task.claimed_by

    db.query(`
      UPDATE tasks
      SET status = 'done', claimed_by = NULL, claim_lease_expires_at = NULL, block_reason = NULL, updated_at = $updated_at
      WHERE id = $task_id AND team_id = $team_id
    `).run({ $updated_at: now, $task_id: taskId, $team_id: teamId })

    if (previousClaimedBy) guards.maybeTouchRegisteredAgent(teamId, previousClaimedBy, { status: "idle", current_task_id: null })

    const dependents = db.query(`SELECT * FROM tasks WHERE team_id = $team_id AND depends_on_task_id = $task_id AND status = 'todo'`).all({ $team_id: teamId, $task_id: taskId }) as TaskRow[]
    for (const dep of dependents) {
      db.query(`UPDATE tasks SET status = 'ready', updated_at = $updated_at WHERE id = $id`).run({ $updated_at: now, $id: dep.id })
      runtimeEvent(ctx, {
        team_id: teamId,
        entity_type: "task",
        entity_id: dep.id,
        event_type: "task.unblocked_by_completion",
        payload: { completed_task_id: taskId, dependent_task_id: dep.id },
        created_at: now,
      })
    }

    runtimeEvent(ctx, {
      team_id: teamId,
      entity_type: "task",
      entity_id: taskId,
      event_type: "task.completed",
      payload: { claimed_by: previousClaimedBy, cascaded_dependents: dependents.length },
      created_at: now,
    })

    return db.query(`SELECT * FROM tasks WHERE id = $task_id`).get({ $task_id: taskId }) as TaskRow
  })

  const taskComplete = tool({
    description: "Mark a task as done, release the agent, and cascade to dependent tasks",
    args: { team_id: tool.schema.string(), task_id: tool.schema.string() },
    async execute(args) {
      return JSON.stringify(taskCompleteTx(args.team_id, args.task_id))
    },
  })

  return {
    tools: {
      team_task_create: taskCreate,
      team_task_list: taskList,
      team_task_claim: taskClaim,
      team_task_release: taskRelease,
      team_task_block: taskBlock,
      team_task_unblock: taskUnblock,
      team_task_complete: taskComplete,
    },
  }
}
