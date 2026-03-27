import { randomUUID } from "node:crypto"

import { tool } from "@opencode-ai/plugin"

import {
  ACTIVE_TASK_STATUSES,
  assertDelegationTransition,
  TERMINAL_TASK_STATUSES,
} from "../shared/constants"
import { runtimeEvent } from "../shared/events"
import type {
  AgentRow,
  DelegationRow,
  OpenCodeSessionRecord,
  RuntimeContext,
  SessionMessageRecord,
  TaskRow,
  TeamRow,
  UpdateDelegationExecutionArgs,
} from "../shared/types"
import { capabilitiesIntersect, extractText, isoFromEpoch, nowIso, parseCapabilities, truncateText } from "../shared/utils"

function delegationChildSessionTitle(delegation: DelegationRow, task: TaskRow) {
  return `Delegation ${delegation.id.slice(0, 8)} for ${delegation.target_agent}: ${task.title}`
}

function delegationChildPrompt(team: TeamRow, task: TaskRow, delegation: DelegationRow) {
  return [
    `You are executing a real delegated child session for agent team ${team.name}.`,
    `Team goal: ${team.goal}`,
    `Runtime team ID: ${team.id}`,
    `Delegation ID: ${delegation.id}`,
    `Parent task ID: ${task.id}`,
    `Parent task title: ${task.title}`,
    "",
    "Task description:",
    task.description,
    "",
    "Delegation request:",
    delegation.prompt,
    "",
    "Requirements:",
    "- Perform the delegated work in this child session.",
    "- Do not fake completion or simulate execution.",
    "- End with a concise result that can be surfaced back into the runtime.",
  ].join("\n")
}

export function createDelegationsDomain(ctx: RuntimeContext) {
  const { db, guards, client, directory } = ctx

  function parseDelegationCapabilities(prompt: string) {
    const marker = /capabilities\s*:\s*([^\n]+)/i.exec(prompt)
    if (!marker) return [] as string[]

    const parsed = parseCapabilities(marker[1])
    return parsed
      .map((item) => item.trim())
      .filter(Boolean)
  }

  function hasValidLease(agent: AgentRow) {
    if (!agent.lease_expires_at) return true
    return agent.lease_expires_at > nowIso()
  }

  async function preflightTargetAgent(teamId: string, targetAgent: string, requiredCapabilities: string[]) {
    const failures: string[] = []
    if (!ctx.isAgentConfigured(targetAgent)) {
      failures.push(`target ${targetAgent} is not present in active project agent config`)
    }
    const existsInRuntime = await ctx.agentExists(targetAgent)
    if (!existsInRuntime) {
      failures.push(`target ${targetAgent} is not available in current OpenCode runtime agent registry`)
    }

    const row = db.query(`SELECT * FROM agents WHERE team_id = $team_id AND agent_name = $agent_name`).get({
      $team_id: teamId,
      $agent_name: targetAgent,
    }) as AgentRow | null
    if (!row) {
      failures.push(`target ${targetAgent} is not registered in runtime team`)
      return { ok: false, failures, row: null as AgentRow | null }
    }

    if (!new Set(["idle", "waiting"]).has(row.status)) {
      failures.push(`target ${targetAgent} has non-operational status ${row.status}`)
    }
    if (!hasValidLease(row)) {
      failures.push(`target ${targetAgent} lease expired at ${row.lease_expires_at}`)
    }
    if (requiredCapabilities.length > 0 && !capabilitiesIntersect(requiredCapabilities, parseCapabilities(row.capabilities_json))) {
      failures.push(`target ${targetAgent} lacks required capabilities [${requiredCapabilities.join(", ")}]`)
    }

    return {
      ok: failures.length === 0,
      failures,
      row,
    }
  }

  function countAgentLoad(teamId: string, agentName: string) {
    const activeTasks = db.query(
      `SELECT COUNT(*) as count FROM tasks WHERE team_id = $team_id AND claimed_by = $agent_name AND status IN ('in_progress','review','blocked')`,
    ).get({
      $team_id: teamId,
      $agent_name: agentName,
    }) as { count: number }
    const activeDelegations = db.query(
      `SELECT COUNT(*) as count FROM delegations WHERE team_id = $team_id AND target_agent = $agent_name AND status IN ('requested','accepted','running')`,
    ).get({
      $team_id: teamId,
      $agent_name: agentName,
    }) as { count: number }

    return (activeTasks?.count ?? 0) + (activeDelegations?.count ?? 0)
  }

  function selectLeastBusyCandidate(
    teamId: string,
    requiredCapabilities: string[],
    excludedAgentName: string,
    runtimeAvailable: Set<string>,
  ) {
    const eligible = ctx.workerPool.workers.filter((worker) => {
      if (worker.agent_name === excludedAgentName) return false
      if (!ctx.isAgentConfigured(worker.agent_name)) return false
      if (!runtimeAvailable.has(worker.agent_name)) return false

      const agentRow = db.query(`SELECT * FROM agents WHERE team_id = $team_id AND agent_name = $agent_name`).get({
        $team_id: teamId,
        $agent_name: worker.agent_name,
      }) as AgentRow | null
      if (!agentRow) return false
      if (!new Set(["idle", "waiting"]).has(agentRow.status)) return false
      if (!hasValidLease(agentRow)) return false

      const mergedCapabilities = [...new Set([...worker.capabilities, ...parseCapabilities(agentRow.capabilities_json)])]
      if (requiredCapabilities.length > 0 && !capabilitiesIntersect(requiredCapabilities, mergedCapabilities)) {
        return false
      }

      return true
    })

    if (eligible.length === 0) return null

    const scored = eligible
      .map((worker) => ({
        worker,
        load: countAgentLoad(teamId, worker.agent_name),
      }))
      .sort((left, right) => {
        if (left.load !== right.load) return left.load - right.load
        return left.worker.agent_name.localeCompare(right.worker.agent_name)
      })

    return scored[0]?.worker ?? null
  }

  function selectRoundRobinCandidate(
    teamId: string,
    requiredCapabilities: string[],
    excludedAgentName: string,
    runtimeAvailable: Set<string>,
  ) {
    const ordered = ctx.workerPool.workers.filter((worker) => {
      if (worker.agent_name === excludedAgentName) return false
      if (!ctx.isAgentConfigured(worker.agent_name)) return false
      if (!runtimeAvailable.has(worker.agent_name)) return false

      const agentRow = db.query(`SELECT * FROM agents WHERE team_id = $team_id AND agent_name = $agent_name`).get({
        $team_id: teamId,
        $agent_name: worker.agent_name,
      }) as AgentRow | null
      if (!agentRow) return false
      if (!new Set(["idle", "waiting"]).has(agentRow.status)) return false
      if (!hasValidLease(agentRow)) return false

      const mergedCapabilities = [...new Set([...worker.capabilities, ...parseCapabilities(agentRow.capabilities_json)])]
      if (requiredCapabilities.length > 0 && !capabilitiesIntersect(requiredCapabilities, mergedCapabilities)) {
        return false
      }

      return true
    })

    if (ordered.length === 0) return null

    const pointerKey = `delegation_rr_last::${teamId}`
    const pointerRow = db.query(`SELECT value FROM runtime_meta WHERE key = $key`).get({ $key: pointerKey }) as { value: string } | null
    const lastAgentName = pointerRow?.value ?? null
    const lastIndex = lastAgentName ? ordered.findIndex((worker) => worker.agent_name === lastAgentName) : -1

    const nextIndex = lastIndex >= 0
      ? (lastIndex + 1) % ordered.length
      : 0

    const selected = ordered[nextIndex] ?? ordered[0]
    db.query(`
      INSERT INTO runtime_meta (key, value, updated_at)
      VALUES ($key, $value, $updated_at)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run({
      $key: pointerKey,
      $value: selected.agent_name,
      $updated_at: nowIso(),
    })

    return selected
  }

  async function selectFallbackCandidate(teamId: string, requiredCapabilities: string[], excludedAgentName: string) {
    const knownAgents = await ctx.client.app.agents({ query: { directory } }).catch(() => ({ data: null as unknown }))
    const known = Array.isArray(knownAgents?.data) ? knownAgents.data as Array<{ id?: string; name?: string }> : []
    const runtimeAvailable = new Set<string>()
    for (const agent of known) {
      if (typeof agent?.id === "string" && agent.id.length > 0) runtimeAvailable.add(agent.id)
      if (typeof agent?.name === "string" && agent.name.length > 0) runtimeAvailable.add(agent.name)
    }

    const enforceRuntimeAvailability = runtimeAvailable.size > 0

    if (ctx.workerPool.selection_strategy === "round-robin") {
      return selectRoundRobinCandidate(
        teamId,
        requiredCapabilities,
        excludedAgentName,
        enforceRuntimeAvailability ? runtimeAvailable : new Set(ctx.workerPool.workers.map((worker) => worker.agent_name)),
      )
    }

    return selectLeastBusyCandidate(
      teamId,
      requiredCapabilities,
      excludedAgentName,
      enforceRuntimeAvailability ? runtimeAvailable : new Set(ctx.workerPool.workers.map((worker) => worker.agent_name)),
    )
  }

  function notifyFallback(teamId: string, delegationId: string, sourceAgent: string, oldTarget: string, newTarget: string, reasons: string[]) {
    const createdAt = nowIso()
    const messageId = randomUUID()

    db.query(`
      INSERT INTO mailbox_messages (id, team_id, sender_agent, recipient_agent, task_id, delegation_id, message_type, subject, body, status, created_at, read_at, resolved_at, updated_at)
      VALUES ($id, $team_id, $sender_agent, $recipient_agent, NULL, $delegation_id, 'info', $subject, $body, 'pending', $created_at, NULL, NULL, $updated_at)
    `).run({
      $id: messageId,
      $team_id: teamId,
      $sender_agent: "runtime-system",
      $recipient_agent: sourceAgent,
      $delegation_id: delegationId,
      $subject: `Delegation ${delegationId.slice(0, 8)} fallback applied`,
      $body: `Target ${oldTarget} failed preflight: ${reasons.join("; ")}. Reassigned to ${newTarget}.`,
      $created_at: createdAt,
      $updated_at: createdAt,
    })

    runtimeEvent(ctx, {
      team_id: teamId,
      entity_type: "delegation",
      entity_id: delegationId,
      event_type: "delegation.fallback_notified",
      payload: { source_agent: sourceAgent, old_target: oldTarget, new_target: newTarget, mailbox_message_id: messageId, reasons },
      created_at: createdAt,
    })

    return messageId
  }

  function updateDelegationExecution(args: UpdateDelegationExecutionArgs) {
    const updatedAt = nowIso()
    db.query(`
      UPDATE delegations
      SET status = COALESCE($status, status),
          result_summary = COALESCE($result_summary, result_summary),
          child_session_id = COALESCE($child_session_id, child_session_id),
          child_message_id = COALESCE($child_message_id, child_message_id),
          child_session_title = COALESCE($child_session_title, child_session_title),
          launch_error = $launch_error,
          launched_at = COALESCE($launched_at, launched_at),
          completed_at = COALESCE($completed_at, completed_at),
          updated_at = $updated_at
      WHERE id = $delegation_id
    `).run({
      $status: args.next_status ?? null,
      $result_summary: args.result_summary ?? null,
      $child_session_id: args.child_session_id ?? null,
      $child_message_id: args.child_message_id ?? null,
      $child_session_title: args.child_session_title ?? null,
      $launch_error: args.launch_error ?? null,
      $launched_at: args.launched_at ?? null,
      $completed_at: args.completed_at ?? null,
      $updated_at: updatedAt,
      $delegation_id: args.delegation_id,
    })
  }

  async function syncDelegationChildSession(delegationId: string) {
    const delegation = db.query(`SELECT * FROM delegations WHERE id = $delegation_id`).get({ $delegation_id: delegationId }) as DelegationRow | null
    if (!delegation) throw new Error(`Delegation ${delegationId} not found`)
    if (!delegation.child_session_id) {
      return {
        delegation_id: delegation.id,
        status: delegation.status,
        child_session: null,
        note: "Delegation has no launched child session yet",
      }
    }

    let messages: SessionMessageRecord[] = []
    try {
      const response = await client.session.messages({
        path: { id: delegation.child_session_id },
        query: { directory, limit: 50 },
      })
      messages = Array.isArray(response?.data) ? (response.data as SessionMessageRecord[]) : []
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateDelegationExecution({
        delegation_id: delegation.id,
        next_status: delegation.status === "completed" ? delegation.status : "failed",
        launch_error: `Unable to inspect child session: ${message}`,
      })
      runtimeEvent(ctx, {
        team_id: delegation.team_id,
        entity_type: "delegation",
        entity_id: delegation.id,
        event_type: "delegation.sync_failed",
        payload: { child_session_id: delegation.child_session_id, error: message },
      })
      return db.query(`SELECT * FROM delegations WHERE id = $delegation_id`).get({ $delegation_id: delegation.id }) as DelegationRow
    }

    const assistantMessages = messages.filter((entry) => entry?.info?.role === "assistant")
    const latestAssistant = assistantMessages
      .slice()
      .sort((left, right) => (right.info.time?.created ?? 0) - (left.info.time?.created ?? 0))[0]

    if (!latestAssistant) {
      return {
        delegation_id: delegation.id,
        status: delegation.status,
        child_session_id: delegation.child_session_id,
        note: "Child session exists but has not produced an assistant result yet",
      }
    }

    const summary = truncateText(extractText(latestAssistant.parts) || "Child session completed without text output")
    const errorMessage = latestAssistant.info.error?.data?.message ?? null
    const completedAt = isoFromEpoch(latestAssistant.info.time?.completed)

    if (errorMessage) {
      if (delegation.status !== "failed") assertDelegationTransition(delegation.status, "failed")
      updateDelegationExecution({
        delegation_id: delegation.id,
        next_status: "failed",
        result_summary: summary,
        child_message_id: latestAssistant.info.id,
        launch_error: errorMessage,
        completed_at: completedAt,
      })
      runtimeEvent(ctx, {
        team_id: delegation.team_id,
        entity_type: "delegation",
        entity_id: delegation.id,
        event_type: "delegation.failed",
        payload: { child_session_id: delegation.child_session_id, child_message_id: latestAssistant.info.id, error: errorMessage },
      })
    } else if (latestAssistant.info.time?.completed) {
      if (delegation.status !== "completed") assertDelegationTransition(delegation.status, "completed")
      updateDelegationExecution({
        delegation_id: delegation.id,
        next_status: "completed",
        result_summary: summary,
        child_message_id: latestAssistant.info.id,
        launch_error: null,
        completed_at: completedAt,
      })
      runtimeEvent(ctx, {
        team_id: delegation.team_id,
        entity_type: "delegation",
        entity_id: delegation.id,
        event_type: "delegation.completed",
        payload: { child_session_id: delegation.child_session_id, child_message_id: latestAssistant.info.id },
      })
    }

    return db.query(`SELECT * FROM delegations WHERE id = $delegation_id`).get({ $delegation_id: delegation.id }) as DelegationRow
  }

  const delegationCreateTx = db.transaction((teamId: string, taskId: string, sourceAgent: string, targetAgent: string, prompt: string) => {
    const task = guards.requireTask(teamId, taskId)
    if (!ACTIVE_TASK_STATUSES.has(task.status) && !TERMINAL_TASK_STATUSES.has(task.status)) {
      throw new Error(`Task ${taskId} is not active; current status: ${task.status}`)
    }
    if (TERMINAL_TASK_STATUSES.has(task.status)) {
      throw new Error(`Task ${taskId} is terminal and cannot receive new delegation work`)
    }

    const id = randomUUID()
    const messageId = randomUUID()
    const createdAt = nowIso()

    db.query(`
      INSERT INTO delegations (id, team_id, task_id, source_agent, target_agent, prompt, status, result_summary, created_at, updated_at)
      VALUES ($id, $team_id, $task_id, $source_agent, $target_agent, $prompt, 'requested', NULL, $created_at, $updated_at)
    `).run({
      $id: id,
      $team_id: teamId,
      $task_id: taskId,
      $source_agent: sourceAgent,
      $target_agent: targetAgent,
      $prompt: prompt,
      $created_at: createdAt,
      $updated_at: createdAt,
    })

    db.query(`
      INSERT INTO mailbox_messages (id, team_id, sender_agent, recipient_agent, task_id, delegation_id, message_type, subject, body, status, created_at, read_at, resolved_at, updated_at)
      VALUES ($id, $team_id, $sender_agent, $recipient_agent, $task_id, $delegation_id, $message_type, $subject, $body, 'pending', $created_at, NULL, NULL, $updated_at)
    `).run({
      $id: messageId,
      $team_id: teamId,
      $sender_agent: sourceAgent,
      $recipient_agent: targetAgent,
      $task_id: taskId,
      $delegation_id: id,
      $message_type: "delegation_request",
      $subject: `Delegation request for task ${taskId}`,
      $body: prompt,
      $created_at: createdAt,
      $updated_at: createdAt,
    })

    runtimeEvent(ctx, {
      team_id: teamId,
      entity_type: "delegation",
      entity_id: id,
      event_type: "delegation.created",
      payload: { task_id: taskId, source_agent: sourceAgent, target_agent: targetAgent, mailbox_message_id: messageId },
      created_at: createdAt,
    })

    return { id, messageId }
  })

  const delegationCreate = tool({
    description: "Create a real runtime delegation record tied to a task. This records intent and state without faking execution.",
    args: {
      team_id: tool.schema.string(),
      task_id: tool.schema.string(),
      source_agent: tool.schema.string(),
      target_agent: tool.schema.string(),
      prompt: tool.schema.string(),
    },
    async execute(args) {
      guards.requireTeam(args.team_id)
      const result = delegationCreateTx(args.team_id, args.task_id, args.source_agent, args.target_agent, args.prompt)
      return JSON.stringify({
        id: result.id,
        mailbox_message_id: result.messageId,
        team_id: args.team_id,
        task_id: args.task_id,
        source_agent: args.source_agent,
        target_agent: args.target_agent,
        status: "requested",
        note: "Runtime delegation and mailbox request were created transactionally. Child-session execution integration is still a separate step.",
      })
    },
  })

  const delegationTransition = tool({
    description: "Advance a delegation state in the runtime foundation without faking execution",
    args: {
      delegation_id: tool.schema.string(),
      next_status: tool.schema.enum(["accepted", "running", "completed", "failed", "cancelled", "timed_out"]),
      result_summary: tool.schema.string().optional(),
    },
    async execute(args) {
      const row = db.query(`SELECT * FROM delegations WHERE id = $delegation_id`).get({ $delegation_id: args.delegation_id }) as DelegationRow | null
      if (!row) throw new Error(`Delegation ${args.delegation_id} not found`)

      assertDelegationTransition(row.status, args.next_status)
      const updatedAt = nowIso()
      db.query(`
        UPDATE delegations
        SET status = $status, result_summary = COALESCE($result_summary, result_summary), updated_at = $updated_at
        WHERE id = $delegation_id
      `).run({
        $status: args.next_status,
        $result_summary: args.result_summary ?? null,
        $updated_at: updatedAt,
        $delegation_id: args.delegation_id,
      })

      if (args.next_status === "accepted") {
        guards.maybeTouchRegisteredAgent(row.team_id, row.target_agent, { status: "waiting" })
      }
      if (args.next_status === "running") {
        guards.maybeTouchRegisteredAgent(row.team_id, row.target_agent, { status: "busy" })
      }
      if (["completed", "failed", "cancelled", "timed_out"].includes(args.next_status)) {
        guards.maybeTouchRegisteredAgent(row.team_id, row.target_agent, { status: args.next_status === "completed" ? "idle" : "recovering" })
      }

      runtimeEvent(ctx, {
        team_id: row.team_id,
        entity_type: "delegation",
        entity_id: row.id,
        event_type: `delegation.${args.next_status}`,
        payload: { result_summary: args.result_summary ?? null },
        created_at: updatedAt,
      })

      const updated = db.query(`SELECT * FROM delegations WHERE id = $delegation_id`).get({ $delegation_id: args.delegation_id }) as DelegationRow
      return JSON.stringify(updated)
    },
  })

  const delegationLaunch = tool({
    description: "Launch a real child-session-backed delegation for an existing runtime delegation",
    args: {
      delegation_id: tool.schema.string(),
    },
    async execute(args, context) {
      const delegation = db.query(`SELECT * FROM delegations WHERE id = $delegation_id`).get({ $delegation_id: args.delegation_id }) as DelegationRow | null
      if (!delegation) throw new Error(`Delegation ${args.delegation_id} not found`)
      if (delegation.child_session_id) {
        return JSON.stringify({
          delegation_id: delegation.id,
          status: delegation.status,
          child_session_id: delegation.child_session_id,
          child_session_title: delegation.child_session_title,
          note: "Delegation already has a launched child session",
        })
      }
      if (!["requested", "accepted"].includes(delegation.status)) {
        throw new Error(`Delegation ${delegation.id} cannot be launched from status ${delegation.status}`)
      }

      const team = guards.requireTeam(delegation.team_id)
      const task = guards.requireTask(delegation.team_id, delegation.task_id)
      const requiredCapabilities = parseDelegationCapabilities(delegation.prompt)
      const preflight = await preflightTargetAgent(delegation.team_id, delegation.target_agent, requiredCapabilities)
      const fallbackPolicy = ctx.delegationLaunchPolicy.fallback_reassign

      let targetAgent = delegation.target_agent
      let preflightReasons: string[] = []
      if (!preflight.ok) {
        preflightReasons = preflight.failures
        if (fallbackPolicy !== "pool") {
          const message = `Delegation ${delegation.id} launch preflight failed for target ${delegation.target_agent}`
          const detailedLaunchError = `${message}. Reasons: ${preflight.failures.join("; ")}. Fallback policy is disabled.`
          updateDelegationExecution({
            delegation_id: delegation.id,
            next_status: "failed",
            launch_error: detailedLaunchError,
          })
          runtimeEvent(ctx, {
            team_id: delegation.team_id,
            entity_type: "delegation",
            entity_id: delegation.id,
            event_type: "delegation.preflight_failed_policy_blocked",
            payload: {
              target_agent: delegation.target_agent,
              reasons: preflight.failures,
              required_capabilities: requiredCapabilities,
              fallback_policy: fallbackPolicy,
            },
          })
          throw new Error(detailedLaunchError)
        }

        const fallback = await selectFallbackCandidate(delegation.team_id, requiredCapabilities, delegation.target_agent)
        if (!fallback) {
          const message = `Delegation ${delegation.id} launch preflight failed for target ${delegation.target_agent} and no fallback candidate is available`
          const detailedLaunchError = `${message}. Reasons: ${preflight.failures.join("; ")}`
          updateDelegationExecution({
            delegation_id: delegation.id,
            next_status: "failed",
            launch_error: detailedLaunchError,
          })
          runtimeEvent(ctx, {
            team_id: delegation.team_id,
            entity_type: "delegation",
            entity_id: delegation.id,
            event_type: "delegation.preflight_failed_no_candidate",
            payload: { target_agent: delegation.target_agent, reasons: preflight.failures, required_capabilities: requiredCapabilities },
          })
          throw new Error(detailedLaunchError)
        }

        db.query(`UPDATE delegations SET target_agent = $target_agent, updated_at = $updated_at WHERE id = $delegation_id`).run({
          $target_agent: fallback.agent_name,
          $updated_at: nowIso(),
          $delegation_id: delegation.id,
        })
        targetAgent = fallback.agent_name

        runtimeEvent(ctx, {
          team_id: delegation.team_id,
          entity_type: "delegation",
          entity_id: delegation.id,
          event_type: "delegation.reassigned",
          payload: {
            reason: "preflight_failed",
            previous_target_agent: delegation.target_agent,
            new_target_agent: targetAgent,
            required_capabilities: requiredCapabilities,
            preflight_failures: preflight.failures,
            strategy: ctx.workerPool.selection_strategy,
            fallback_policy: fallbackPolicy,
          },
        })

        notifyFallback(delegation.team_id, delegation.id, delegation.source_agent, delegation.target_agent, targetAgent, preflight.failures)

        const reassignedPreflight = await preflightTargetAgent(delegation.team_id, targetAgent, requiredCapabilities)
        if (!reassignedPreflight.ok) {
          const detailedLaunchError = `Delegation ${delegation.id} reassigned target ${targetAgent} failed preflight. Reasons: ${reassignedPreflight.failures.join("; ")}`
          updateDelegationExecution({
            delegation_id: delegation.id,
            next_status: "failed",
            launch_error: detailedLaunchError,
          })
          runtimeEvent(ctx, {
            team_id: delegation.team_id,
            entity_type: "delegation",
            entity_id: delegation.id,
            event_type: "delegation.preflight_failed_reassigned_target",
            payload: {
              target_agent: targetAgent,
              reasons: reassignedPreflight.failures,
              required_capabilities: requiredCapabilities,
              fallback_policy: fallbackPolicy,
            },
          })
          throw new Error(detailedLaunchError)
        }
      }

      const targetAgentIsKnown = await ctx.agentExists(targetAgent)
      if (!targetAgentIsKnown) {
        const detailedLaunchError = `Delegation ${delegation.id} target ${targetAgent} is unavailable in current OpenCode runtime agent registry after preflight/fallback`
        updateDelegationExecution({
          delegation_id: delegation.id,
          next_status: "failed",
          launch_error: detailedLaunchError,
        })
        runtimeEvent(ctx, {
          team_id: delegation.team_id,
          entity_type: "delegation",
          entity_id: delegation.id,
          event_type: "delegation.launch_preflight_unavailable_target",
          payload: { target_agent: targetAgent, required_capabilities: requiredCapabilities },
        })
        throw new Error(detailedLaunchError)
      }

      const launchDelegation = {
        ...delegation,
        target_agent: targetAgent,
      }

      const sessionTitle = delegationChildSessionTitle(launchDelegation, task)
      const launchedAt = nowIso()
      const created = await client.session.create({
        query: { directory },
        body: { parentID: context.sessionID, title: sessionTitle },
      })
      const childSession = created?.data as OpenCodeSessionRecord | undefined
      if (!childSession?.id) throw new Error(`Failed to create child session for delegation ${delegation.id}`)

      try {
        await client.session.promptAsync({
          path: { id: childSession.id },
          query: { directory },
          body: {
            agent: targetAgent,
            parts: [{ type: "text", text: delegationChildPrompt(team, task, launchDelegation) }],
          },
        })
      } catch (error) {
        const launchError = error instanceof Error ? error.message : String(error)
        if (delegation.status !== "failed") assertDelegationTransition(delegation.status, "failed")
        updateDelegationExecution({
          delegation_id: delegation.id,
          next_status: "failed",
          child_session_id: childSession.id,
          child_session_title: sessionTitle,
          launch_error: launchError,
          launched_at: launchedAt,
        })
        runtimeEvent(ctx, {
          team_id: delegation.team_id,
          entity_type: "delegation",
          entity_id: delegation.id,
          event_type: "delegation.launch_failed",
          payload: { child_session_id: childSession.id, error: launchError },
        })
        return JSON.stringify({
          delegation_id: delegation.id,
          status: "failed",
          child_session_id: childSession.id,
          child_session_title: sessionTitle,
          launch_error: launchError,
        })
      }

      assertDelegationTransition(delegation.status, "running")
      updateDelegationExecution({
        delegation_id: delegation.id,
        next_status: "running",
        child_session_id: childSession.id,
        child_session_title: sessionTitle,
        launch_error: null,
        launched_at: launchedAt,
      })
      guards.maybeTouchRegisteredAgent(delegation.team_id, targetAgent, { status: "busy" })

      runtimeEvent(ctx, {
        team_id: delegation.team_id,
        entity_type: "delegation",
        entity_id: delegation.id,
        event_type: "delegation.launched",
        payload: {
          child_session_id: childSession.id,
          child_session_title: sessionTitle,
          parent_session_id: context.sessionID,
          target_agent: targetAgent,
          preflight_reassigned: targetAgent !== delegation.target_agent,
          preflight_reasons: preflightReasons,
        },
        created_at: launchedAt,
      })

      const updated = db.query(`SELECT * FROM delegations WHERE id = $delegation_id`).get({ $delegation_id: delegation.id }) as DelegationRow
      return JSON.stringify(updated)
    },
  })

  const delegationSync = tool({
    description: "Synchronize a delegation record with its real child session outcome",
    args: {
      delegation_id: tool.schema.string(),
    },
    async execute(args) {
      const updated = await syncDelegationChildSession(args.delegation_id)
      return JSON.stringify(updated)
    },
  })

  return {
    tools: {
      team_delegation_create: delegationCreate,
      team_delegation_transition: delegationTransition,
      team_delegation_launch: delegationLaunch,
      team_delegation_sync: delegationSync,
    },
    helpers: {
      updateDelegationExecution,
      syncDelegationChildSession,
    },
  }
}
