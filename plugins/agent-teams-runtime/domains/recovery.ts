import { randomUUID } from "node:crypto"

import { tool } from "@opencode-ai/plugin"

import { assertDelegationTransition } from "../shared/constants"
import { runtimeEvent } from "../shared/events"
import type { AgentRow, DelegationRow, MailboxMessageRow, RecoveryCheckpointRow, RuntimeContext, TaskRow } from "../shared/types"
import { agentResponse, artifactResponse, nowIso, parseIdList } from "../shared/utils"

type RecoveryDeps = {
  updateDelegationExecution: (args: {
    delegation_id: string
    next_status?: string
    result_summary?: string | null
    child_session_id?: string | null
    child_message_id?: string | null
    child_session_title?: string | null
    launch_error?: string | null
    launched_at?: string | null
    completed_at?: string | null
  }) => void
}

export function createRecoveryDomain(ctx: RuntimeContext, deps: RecoveryDeps) {
  const { db, guards } = ctx

  const checkpointCreate = tool({
    description: "Create a runtime recovery checkpoint snapshot for a team",
    args: {
      team_id: tool.schema.string(),
      checkpoint_type: tool.schema.enum(["manual", "verify", "archive", "recovery", "phase_boundary"]).default("manual"),
      note: tool.schema.string().optional(),
    },
    async execute(args) {
      const team = guards.requireTeam(args.team_id)
      const tasks = db.query(`SELECT * FROM tasks WHERE team_id = $team_id ORDER BY created_at ASC`).all({ $team_id: args.team_id }) as TaskRow[]
      const delegations = db.query(`SELECT * FROM delegations WHERE team_id = $team_id ORDER BY created_at ASC`).all({ $team_id: args.team_id }) as DelegationRow[]
      const mailbox = db.query(`SELECT * FROM mailbox_messages WHERE team_id = $team_id AND status != 'resolved' ORDER BY created_at ASC`).all({ $team_id: args.team_id }) as MailboxMessageRow[]
      const agents = db.query(`SELECT * FROM agents WHERE team_id = $team_id ORDER BY agent_name ASC`).all({ $team_id: args.team_id }) as AgentRow[]
      const gitWorkItems = db.query(`SELECT * FROM git_work_items WHERE team_id = $team_id ORDER BY created_at ASC`).all({ $team_id: args.team_id }) as any[]
      const artifactLinks = db.query(`SELECT * FROM artifact_links WHERE team_id = $team_id ORDER BY created_at ASC`).all({ $team_id: args.team_id }) as any[]

      const id = randomUUID()
      const createdAt = nowIso()
      const payload = {
        note: args.note ?? null,
        team,
        agents: agents.map(agentResponse),
        tasks,
        delegations,
        unresolved_mailbox: mailbox,
        git_work_items: gitWorkItems,
        artifact_links: artifactLinks.map(artifactResponse),
      }

      db.query(`
        INSERT INTO recovery_checkpoints (id, team_id, checkpoint_type, payload_json, created_at)
        VALUES ($id, $team_id, $checkpoint_type, $payload_json, $created_at)
      `).run({
        $id: id,
        $team_id: args.team_id,
        $checkpoint_type: args.checkpoint_type,
        $payload_json: JSON.stringify(payload),
        $created_at: createdAt,
      })

      runtimeEvent(ctx, {
        team_id: args.team_id,
        entity_type: "checkpoint",
        entity_id: id,
        event_type: "checkpoint.created",
        payload: { checkpoint_type: args.checkpoint_type, note: args.note ?? null },
        created_at: createdAt,
      })

      return JSON.stringify({ id, team_id: args.team_id, checkpoint_type: args.checkpoint_type, created_at: createdAt })
    },
  })

  const checkpointLatest = tool({
    description: "Get the latest recovery checkpoint for a team",
    args: { team_id: tool.schema.string() },
    async execute(args) {
      guards.requireTeam(args.team_id)
      const row = db.query(`SELECT * FROM recovery_checkpoints WHERE team_id = $team_id ORDER BY created_at DESC LIMIT 1`).get({ $team_id: args.team_id }) as RecoveryCheckpointRow | null
      if (!row) return JSON.stringify({ status: "not_found", message: `No checkpoints found for team ${args.team_id}` })
      return JSON.stringify(row)
    },
  })

  const recoveryInspect = tool({
    description: "Inspect stale agents and claims, unresolved mailbox, open delegations, and unfinished git work items for recovery planning",
    args: { team_id: tool.schema.string() },
    async execute(args) {
      guards.requireTeam(args.team_id)
      const now = nowIso()
      const staleClaims = db.query(`SELECT * FROM tasks WHERE team_id = $team_id AND claim_lease_expires_at IS NOT NULL AND claim_lease_expires_at < $now AND status IN ('in_progress')`).all({ $team_id: args.team_id, $now: now }) as TaskRow[]
      const staleAgents = db.query(`SELECT * FROM agents WHERE team_id = $team_id AND lease_expires_at IS NOT NULL AND lease_expires_at < $now AND status IN ('idle','busy','waiting','recovering') ORDER BY agent_name ASC`).all({ $team_id: args.team_id, $now: now }) as AgentRow[]
      const unresolvedMailbox = db.query(`SELECT * FROM mailbox_messages WHERE team_id = $team_id AND status != 'resolved' ORDER BY created_at ASC`).all({ $team_id: args.team_id }) as MailboxMessageRow[]
      const openDelegations = db.query(`SELECT * FROM delegations WHERE team_id = $team_id AND status IN ('requested','accepted','running') ORDER BY created_at ASC`).all({ $team_id: args.team_id }) as DelegationRow[]
      const unfinishedGitWorkItems = db.query(`SELECT * FROM git_work_items WHERE team_id = $team_id AND status NOT IN ('merged','abandoned') ORDER BY updated_at DESC`).all({ $team_id: args.team_id }) as any[]
      const latestCheckpoint = db.query(`SELECT id, checkpoint_type, created_at FROM recovery_checkpoints WHERE team_id = $team_id ORDER BY created_at DESC LIMIT 1`).get({ $team_id: args.team_id }) as Record<string, string> | null

      const staleAgentNames = new Set(staleAgents.map((agent) => agent.agent_name))
      const registeredAgents = db.query(`SELECT agent_name, status, lease_expires_at FROM agents WHERE team_id = $team_id`).all({ $team_id: args.team_id }) as Array<Pick<AgentRow, "agent_name" | "status" | "lease_expires_at">>
      const registeredAgentNames = new Set(registeredAgents.map((agent) => agent.agent_name))
      const terminalTaskIds = new Set((db.query(`SELECT id FROM tasks WHERE team_id = $team_id AND status IN ('done','failed')`).all({ $team_id: args.team_id }) as Array<{ id: string }>).map((row) => row.id))
      const terminalDelegationIds = new Set((db.query(`SELECT id FROM delegations WHERE team_id = $team_id AND status IN ('completed','failed','cancelled','timed_out')`).all({ $team_id: args.team_id }) as Array<{ id: string }>).map((row) => row.id))

      const orphanedDelegations = openDelegations.filter((delegation) => !registeredAgentNames.has(delegation.target_agent) || staleAgentNames.has(delegation.target_agent) || (delegation.status !== "running" && !delegation.child_session_id))
      const childSessionSyncCandidates = openDelegations.filter((delegation) => Boolean(delegation.child_session_id))
      const reassignCandidates = openDelegations.filter((delegation) => !delegation.child_session_id && (staleAgentNames.has(delegation.target_agent) || !registeredAgentNames.has(delegation.target_agent)))
      const mailboxResolutionCandidates = unresolvedMailbox.filter((message) => (message.delegation_id && terminalDelegationIds.has(message.delegation_id)) || (message.task_id && terminalTaskIds.has(message.task_id)))

      return JSON.stringify({
        team_id: args.team_id,
        latest_checkpoint: latestCheckpoint,
        stale_agents: staleAgents.map(agentResponse),
        stale_claims: staleClaims,
        unresolved_mailbox: unresolvedMailbox,
        open_delegations: openDelegations,
        recovery_candidates: {
          orphaned_delegations: orphanedDelegations,
          delegation_child_session_sync: childSessionSyncCandidates,
          delegation_reassign_review: reassignCandidates,
          mailbox_resolution_review: mailboxResolutionCandidates,
        },
        unfinished_git_work_items: unfinishedGitWorkItems,
      })
    },
  })

  const recoveryRequeueStaleClaimsTx = db.transaction((teamId: string, staleAgentStatus: string, note?: string | null) => {
    const now = nowIso()
    const staleClaims = db.query(`SELECT * FROM tasks WHERE team_id = $team_id AND claim_lease_expires_at IS NOT NULL AND claim_lease_expires_at < $now AND status IN ('in_progress') ORDER BY created_at ASC`).all({ $team_id: teamId, $now: now }) as TaskRow[]
    const impactedAgents = new Set<string>()

    for (const task of staleClaims) {
      db.query(`
        UPDATE tasks
        SET status = 'ready', claimed_by = NULL, claim_lease_expires_at = NULL, block_reason = NULL, updated_at = $updated_at
        WHERE id = $task_id
      `).run({ $updated_at: now, $task_id: task.id })

      if (task.claimed_by) impactedAgents.add(task.claimed_by)
      runtimeEvent(ctx, {
        team_id: teamId,
        entity_type: "task",
        entity_id: task.id,
        event_type: "recovery.task.requeued",
        payload: { previous_status: task.status, previous_claimed_by: task.claimed_by, note: note ?? null },
        created_at: now,
      })
    }

    for (const agentName of impactedAgents) {
      guards.maybeTouchRegisteredAgent(teamId, agentName, { status: staleAgentStatus, lease_expires_at: now, current_task_id: null })
    }

    runtimeEvent(ctx, {
      team_id: teamId,
      entity_type: "team",
      entity_id: teamId,
      event_type: "recovery.stale_claims.requeued",
      payload: { count: staleClaims.length, impacted_agents: [...impactedAgents], stale_agent_status: staleAgentStatus, note: note ?? null },
      created_at: now,
    })

    return { staleClaims, impactedAgents: [...impactedAgents] }
  })

  const recoveryRequeueStaleClaims = tool({
    description: "Operational recovery action: requeue stale claimed work and mark impacted agents recovering or offline",
    args: {
      team_id: tool.schema.string(),
      stale_agent_status: tool.schema.enum(["recovering", "offline"]).default("recovering"),
      note: tool.schema.string().optional(),
    },
    async execute(args) {
      guards.requireTeam(args.team_id)
      const result = recoveryRequeueStaleClaimsTx(args.team_id, args.stale_agent_status, args.note ?? null)
      return JSON.stringify({
        team_id: args.team_id,
        requeued_task_ids: result.staleClaims.map((row) => row.id),
        impacted_agents: result.impactedAgents,
        stale_agent_status: args.stale_agent_status,
        note: args.note ?? null,
      })
    },
  })

  const recoveryResolveDelegationsTx = db.transaction((teamId: string, delegationIds: string[], nextStatus: string, targetAgentStatus: string, note?: string | null) => {
    const updatedAt = nowIso()
    const resolved: Array<DelegationRow & { linked_unresolved_mailbox_ids: string[] }> = []
    const skipped: Array<{ delegation_id: string; reason: string }> = []

    for (const delegationId of delegationIds) {
      const row = guards.requireDelegation(teamId, delegationId)
      if (["completed", "failed", "cancelled", "timed_out"].includes(row.status)) {
        skipped.push({ delegation_id: delegationId, reason: `Delegation already terminal in status ${row.status}` })
        continue
      }

      assertDelegationTransition(row.status, nextStatus)
      const summaryNote = note?.trim() ? `Recovery resolution: ${note.trim()}` : null
      deps.updateDelegationExecution({
        delegation_id: row.id,
        next_status: nextStatus,
        result_summary: summaryNote,
        launch_error: nextStatus === "failed" || nextStatus === "timed_out" ? summaryNote : row.launch_error,
        completed_at: updatedAt,
      })

      if (targetAgentStatus !== "unchanged") {
        guards.maybeTouchRegisteredAgent(teamId, row.target_agent, { status: targetAgentStatus })
      }

      runtimeEvent(ctx, {
        team_id: teamId,
        entity_type: "delegation",
        entity_id: row.id,
        event_type: `recovery.delegation.${nextStatus}`,
        payload: { previous_status: row.status, target_agent: row.target_agent, target_agent_status: targetAgentStatus, note: note ?? null },
        created_at: updatedAt,
      })

      const linkedMailbox = db.query(`SELECT id FROM mailbox_messages WHERE team_id = $team_id AND delegation_id = $delegation_id AND status != 'resolved' ORDER BY created_at ASC`).all({
        $team_id: teamId,
        $delegation_id: row.id,
      }) as Array<{ id: string }>
      const updated = guards.requireDelegation(teamId, row.id)
      resolved.push({ ...updated, linked_unresolved_mailbox_ids: linkedMailbox.map((message) => message.id) })
    }

    runtimeEvent(ctx, {
      team_id: teamId,
      entity_type: "team",
      entity_id: teamId,
      event_type: "recovery.delegations.resolved",
      payload: { delegation_ids: delegationIds, next_status: nextStatus, target_agent_status: targetAgentStatus, resolved_count: resolved.length, skipped_count: skipped.length, note: note ?? null },
      created_at: updatedAt,
    })

    return { resolved, skipped }
  })

  const recoveryResolveDelegations = tool({
    description: "Operational recovery action: explicitly resolve open delegations as cancelled, failed, or timed out",
    args: {
      team_id: tool.schema.string(),
      delegation_ids: tool.schema.string().describe("Comma-separated delegation IDs to resolve"),
      next_status: tool.schema.enum(["cancelled", "failed", "timed_out"]),
      target_agent_status: tool.schema.enum(["unchanged", "idle", "recovering", "offline"]).default("unchanged"),
      note: tool.schema.string().optional(),
    },
    async execute(args) {
      guards.requireTeam(args.team_id)
      const delegationIds = parseIdList(args.delegation_ids)
      if (delegationIds.length === 0) throw new Error("Provide at least one delegation ID")

      const result = recoveryResolveDelegationsTx(args.team_id, delegationIds, args.next_status, args.target_agent_status, args.note ?? null)
      return JSON.stringify({
        team_id: args.team_id,
        next_status: args.next_status,
        target_agent_status: args.target_agent_status,
        resolved: result.resolved,
        skipped: result.skipped,
        note: args.note ?? null,
      })
    },
  })

  const recoveryReassignDelegationTx = db.transaction((teamId: string, delegationId: string, newTargetAgent: string, resolvePriorMailbox: string, note?: string | null) => {
    const row = guards.requireDelegation(teamId, delegationId)
    if (!["requested", "accepted"].includes(row.status)) {
      throw new Error(`Delegation ${delegationId} can only be reassigned from requested or accepted state; current status is ${row.status}`)
    }
    if (row.child_session_id) {
      throw new Error(`Delegation ${delegationId} already launched child session ${row.child_session_id}; use explicit resolution instead of reassignment`)
    }
    if (row.target_agent === newTargetAgent) {
      throw new Error(`Delegation ${delegationId} already targets ${newTargetAgent}`)
    }

    const updatedAt = nowIso()
    db.query(`
      UPDATE delegations
      SET target_agent = $target_agent,
          status = 'requested',
          result_summary = NULL,
          updated_at = $updated_at
      WHERE id = $delegation_id
    `).run({
      $target_agent: newTargetAgent,
      $updated_at: updatedAt,
      $delegation_id: delegationId,
    })

    let resolvedPriorMailboxIds: string[] = []
    if (resolvePriorMailbox === "yes") {
      const priorMailbox = db.query(`SELECT id FROM mailbox_messages WHERE team_id = $team_id AND delegation_id = $delegation_id AND status != 'resolved' ORDER BY created_at ASC`).all({
        $team_id: teamId,
        $delegation_id: delegationId,
      }) as Array<{ id: string }>
      resolvedPriorMailboxIds = priorMailbox.map((message) => message.id)
      for (const message of priorMailbox) {
        db.query(`
          UPDATE mailbox_messages
          SET status = 'resolved',
              read_at = COALESCE(read_at, $updated_at),
              resolved_at = $updated_at,
              updated_at = $updated_at
          WHERE id = $message_id
        `).run({ $updated_at: updatedAt, $message_id: message.id })

        runtimeEvent(ctx, {
          team_id: teamId,
          entity_type: "mailbox_message",
          entity_id: message.id,
          event_type: "recovery.mailbox.resolved",
          payload: { delegation_id: delegationId, reason: "delegation_reassigned", note: note ?? null },
          created_at: updatedAt,
        })
      }
    }

    const messageId = randomUUID()
    const reassignedBody = [
      `Recovery reassigned delegation ${delegationId}.`,
      note?.trim() ? `Operator note: ${note.trim()}` : null,
      "Original delegation prompt:",
      row.prompt,
    ].filter(Boolean).join("\n\n")

    db.query(`
      INSERT INTO mailbox_messages (id, team_id, sender_agent, recipient_agent, task_id, delegation_id, message_type, subject, body, status, created_at, read_at, resolved_at, updated_at)
      VALUES ($id, $team_id, $sender_agent, $recipient_agent, $task_id, $delegation_id, $message_type, $subject, $body, 'pending', $created_at, NULL, NULL, $updated_at)
    `).run({
      $id: messageId,
      $team_id: teamId,
      $sender_agent: row.source_agent,
      $recipient_agent: newTargetAgent,
      $task_id: row.task_id,
      $delegation_id: row.id,
      $message_type: "delegation_request",
      $subject: `Recovery reassigned delegation for task ${row.task_id}`,
      $body: reassignedBody,
      $created_at: updatedAt,
      $updated_at: updatedAt,
    })

    runtimeEvent(ctx, {
      team_id: teamId,
      entity_type: "delegation",
      entity_id: row.id,
      event_type: "recovery.delegation.reassigned",
      payload: { previous_target_agent: row.target_agent, new_target_agent: newTargetAgent, mailbox_message_id: messageId, resolved_prior_mailbox_ids: resolvedPriorMailboxIds, note: note ?? null },
      created_at: updatedAt,
    })

    const updated = guards.requireDelegation(teamId, row.id)
    return { updated, messageId, resolvedPriorMailboxIds }
  })

  const recoveryReassignDelegation = tool({
    description: "Operational recovery action: reassign an unlaunched delegation to a new target agent and emit a fresh mailbox request",
    args: {
      team_id: tool.schema.string(),
      delegation_id: tool.schema.string(),
      new_target_agent: tool.schema.string(),
      resolve_prior_mailbox: tool.schema.enum(["yes", "no"]).default("yes"),
      note: tool.schema.string().optional(),
    },
    async execute(args) {
      guards.requireTeam(args.team_id)
      const targetAgentIsKnown = await ctx.agentExists(args.new_target_agent)
      if (!targetAgentIsKnown) {
        throw new Error(`Target agent ${args.new_target_agent} is not registered in the current OpenCode configuration`)
      }

      const result = recoveryReassignDelegationTx(args.team_id, args.delegation_id, args.new_target_agent, args.resolve_prior_mailbox, args.note ?? null)
      return JSON.stringify({
        team_id: args.team_id,
        delegation: result.updated,
        recovery_mailbox_message_id: result.messageId,
        resolved_prior_mailbox_ids: result.resolvedPriorMailboxIds,
        note: args.note ?? null,
      })
    },
  })

  const recoveryResolveMailboxTx = db.transaction((teamId: string, messageIds: string[], note?: string | null) => {
    const updatedAt = nowIso()
    const resolved: MailboxMessageRow[] = []
    const skipped: Array<{ message_id: string; reason: string }> = []

    for (const messageId of messageIds) {
      const row = guards.requireMailboxMessage(teamId, messageId)
      if (row.status === "resolved") {
        skipped.push({ message_id: messageId, reason: "Mailbox message already resolved" })
        continue
      }

      db.query(`
        UPDATE mailbox_messages
        SET status = 'resolved',
            read_at = COALESCE(read_at, $updated_at),
            resolved_at = $updated_at,
            updated_at = $updated_at
        WHERE id = $message_id
      `).run({
        $updated_at: updatedAt,
        $message_id: messageId,
      })

      runtimeEvent(ctx, {
        team_id: teamId,
        entity_type: "mailbox_message",
        entity_id: row.id,
        event_type: "recovery.mailbox.resolved",
        payload: { previous_status: row.status, task_id: row.task_id, delegation_id: row.delegation_id, note: note ?? null },
        created_at: updatedAt,
      })

      resolved.push(guards.requireMailboxMessage(teamId, row.id))
    }

    runtimeEvent(ctx, {
      team_id: teamId,
      entity_type: "team",
      entity_id: teamId,
      event_type: "recovery.mailbox.batch_resolved",
      payload: { message_ids: messageIds, resolved_count: resolved.length, skipped_count: skipped.length, note: note ?? null },
      created_at: updatedAt,
    })

    return { resolved, skipped }
  })

  const recoveryResolveMailbox = tool({
    description: "Operational recovery action: batch-resolve mailbox messages selected during recovery review",
    args: {
      team_id: tool.schema.string(),
      message_ids: tool.schema.string().describe("Comma-separated mailbox message IDs to resolve"),
      note: tool.schema.string().optional(),
    },
    async execute(args) {
      guards.requireTeam(args.team_id)
      const messageIds = parseIdList(args.message_ids)
      if (messageIds.length === 0) throw new Error("Provide at least one mailbox message ID")

      const result = recoveryResolveMailboxTx(args.team_id, messageIds, args.note ?? null)
      return JSON.stringify({ team_id: args.team_id, resolved: result.resolved, skipped: result.skipped, note: args.note ?? null })
    },
  })

  return {
    tools: {
      team_checkpoint_create: checkpointCreate,
      team_checkpoint_latest: checkpointLatest,
      team_recovery_inspect: recoveryInspect,
      team_recovery_requeue_stale_claims: recoveryRequeueStaleClaims,
      team_recovery_resolve_delegations: recoveryResolveDelegations,
      team_recovery_reassign_delegation: recoveryReassignDelegation,
      team_recovery_resolve_mailbox: recoveryResolveMailbox,
    },
  }
}
