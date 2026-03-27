import type { Database } from "bun:sqlite"

import type { AgentRow, DelegationRow, MailboxMessageRow, TaskRow, TeamRow } from "./types"
import { nowIso } from "./utils"

type Deps = {
  db: Database
}

export function createRuntimeGuards({ db }: Deps) {
  function requireTeam(teamId: string) {
    const row = db.query(`SELECT * FROM teams WHERE id = $team_id`).get({ $team_id: teamId }) as TeamRow | null
    if (!row) throw new Error(`Team ${teamId} not found`)
    return row
  }

  function requireTask(teamId: string, taskId: string) {
    const row = db.query(`SELECT * FROM tasks WHERE id = $task_id AND team_id = $team_id`).get({ $task_id: taskId, $team_id: teamId }) as TaskRow | null
    if (!row) throw new Error(`Task ${taskId} not found in team ${teamId}`)
    return row
  }

  function requireDelegation(teamId: string, delegationId: string) {
    const row = db.query(`SELECT * FROM delegations WHERE id = $delegation_id AND team_id = $team_id`).get({
      $delegation_id: delegationId,
      $team_id: teamId,
    }) as DelegationRow | null
    if (!row) throw new Error(`Delegation ${delegationId} not found in team ${teamId}`)
    return row
  }

  function requireMailboxMessage(teamId: string, messageId: string) {
    const row = db.query(`SELECT * FROM mailbox_messages WHERE id = $message_id AND team_id = $team_id`).get({
      $message_id: messageId,
      $team_id: teamId,
    }) as MailboxMessageRow | null
    if (!row) throw new Error(`Mailbox message ${messageId} not found in team ${teamId}`)
    return row
  }

  function maybeTouchRegisteredAgent(teamId: string, agentName: string, patch: { status?: string; lease_expires_at?: string | null; current_task_id?: string | null }) {
    const row = db.query(`SELECT * FROM agents WHERE team_id = $team_id AND agent_name = $agent_name`).get({
      $team_id: teamId,
      $agent_name: agentName,
    }) as AgentRow | null

    if (!row) return null

    const updatedAt = nowIso()
    db.query(`
      UPDATE agents
      SET status = COALESCE($status, status),
          lease_expires_at = CASE WHEN $lease_expires_at_set = 1 THEN $lease_expires_at ELSE lease_expires_at END,
          current_task_id = CASE WHEN $current_task_id_set = 1 THEN $current_task_id ELSE current_task_id END,
          updated_at = $updated_at
      WHERE id = $id
    `).run({
      $status: patch.status ?? null,
      $lease_expires_at: patch.lease_expires_at ?? null,
      $lease_expires_at_set: Object.prototype.hasOwnProperty.call(patch, "lease_expires_at") ? 1 : 0,
      $current_task_id: patch.current_task_id ?? null,
      $current_task_id_set: Object.prototype.hasOwnProperty.call(patch, "current_task_id") ? 1 : 0,
      $updated_at: updatedAt,
      $id: row.id,
    })

    return db.query(`SELECT * FROM agents WHERE id = $id`).get({ $id: row.id }) as AgentRow
  }

  function requireEntity(teamId: string, entityType: string, entityId: string) {
    switch (entityType) {
      case "team": {
        const row = db.query(`SELECT id FROM teams WHERE id = $id`).get({ $id: entityId })
        if (!row) throw new Error(`Team entity ${entityId} not found`)
        return
      }
      case "agent": {
        const row = db.query(`SELECT id FROM agents WHERE team_id = $team_id AND id = $id`).get({ $team_id: teamId, $id: entityId })
        if (!row) throw new Error(`Agent entity ${entityId} not found in team ${teamId}`)
        return
      }
      case "task": {
        requireTask(teamId, entityId)
        return
      }
      case "delegation": {
        const row = db.query(`SELECT id FROM delegations WHERE team_id = $team_id AND id = $id`).get({ $team_id: teamId, $id: entityId })
        if (!row) throw new Error(`Delegation entity ${entityId} not found in team ${teamId}`)
        return
      }
      case "mailbox_message": {
        const row = db.query(`SELECT id FROM mailbox_messages WHERE team_id = $team_id AND id = $id`).get({ $team_id: teamId, $id: entityId })
        if (!row) throw new Error(`Mailbox entity ${entityId} not found in team ${teamId}`)
        return
      }
      case "checkpoint": {
        const row = db.query(`SELECT id FROM recovery_checkpoints WHERE team_id = $team_id AND id = $id`).get({ $team_id: teamId, $id: entityId })
        if (!row) throw new Error(`Checkpoint entity ${entityId} not found in team ${teamId}`)
        return
      }
      case "git_work_item": {
        const row = db.query(`SELECT id FROM git_work_items WHERE team_id = $team_id AND id = $id`).get({ $team_id: teamId, $id: entityId })
        if (!row) throw new Error(`Git work item entity ${entityId} not found in team ${teamId}`)
        return
      }
      default:
        throw new Error(`Unsupported entity_type ${entityType}`)
    }
  }

  return {
    requireTeam,
    requireTask,
    requireDelegation,
    requireMailboxMessage,
    maybeTouchRegisteredAgent,
    requireEntity,
  }
}
