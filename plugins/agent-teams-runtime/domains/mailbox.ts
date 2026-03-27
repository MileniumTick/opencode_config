import { randomUUID } from "node:crypto"

import { tool } from "@opencode-ai/plugin"

import { runtimeEvent } from "../shared/events"
import type { MailboxMessageRow, RuntimeContext } from "../shared/types"
import { nowIso } from "../shared/utils"

export function createMailboxDomain(ctx: RuntimeContext) {
  const { db, guards } = ctx

  const mailboxSend = tool({
    description: "Send a runtime mailbox message between agents",
    args: {
      team_id: tool.schema.string(),
      sender_agent: tool.schema.string(),
      recipient_agent: tool.schema.string(),
      message_type: tool.schema.enum(["info", "blocking", "approval", "recovery", "delegation_request", "artifact_ready"]).default("info"),
      subject: tool.schema.string(),
      body: tool.schema.string(),
      task_id: tool.schema.string().optional(),
      delegation_id: tool.schema.string().optional(),
    },
    async execute(args) {
      guards.requireTeam(args.team_id)
      if (args.task_id) guards.requireTask(args.team_id, args.task_id)

      if (args.delegation_id) {
        const delegation = db.query(`SELECT id FROM delegations WHERE id = $delegation_id AND team_id = $team_id`).get({ $delegation_id: args.delegation_id, $team_id: args.team_id })
        if (!delegation) throw new Error(`Delegation ${args.delegation_id} not found in team ${args.team_id}`)
      }

      const id = randomUUID()
      const createdAt = nowIso()
      db.query(`
        INSERT INTO mailbox_messages (id, team_id, sender_agent, recipient_agent, task_id, delegation_id, message_type, subject, body, status, created_at, read_at, resolved_at, updated_at)
        VALUES ($id, $team_id, $sender_agent, $recipient_agent, $task_id, $delegation_id, $message_type, $subject, $body, 'pending', $created_at, NULL, NULL, $updated_at)
      `).run({
        $id: id,
        $team_id: args.team_id,
        $sender_agent: args.sender_agent,
        $recipient_agent: args.recipient_agent,
        $task_id: args.task_id ?? null,
        $delegation_id: args.delegation_id ?? null,
        $message_type: args.message_type,
        $subject: args.subject,
        $body: args.body,
        $created_at: createdAt,
        $updated_at: createdAt,
      })

      runtimeEvent(ctx, {
        team_id: args.team_id,
        entity_type: "mailbox_message",
        entity_id: id,
        event_type: "mailbox.sent",
        payload: {
          sender_agent: args.sender_agent,
          recipient_agent: args.recipient_agent,
          message_type: args.message_type,
          task_id: args.task_id ?? null,
          delegation_id: args.delegation_id ?? null,
        },
        created_at: createdAt,
      })

      return JSON.stringify({ id, status: "pending" })
    },
  })

  const mailboxList = tool({
    description: "List runtime mailbox messages for a recipient or team",
    args: {
      team_id: tool.schema.string(),
      recipient_agent: tool.schema.string().optional(),
      status: tool.schema.enum(["pending", "read", "resolved"]).optional(),
    },
    async execute(args) {
      guards.requireTeam(args.team_id)

      let query = `SELECT * FROM mailbox_messages WHERE team_id = $team_id`
      const params: Record<string, string> = { $team_id: args.team_id }

      if (args.recipient_agent) {
        query += ` AND recipient_agent = $recipient_agent`
        params.$recipient_agent = args.recipient_agent
      }
      if (args.status) {
        query += ` AND status = $status`
        params.$status = args.status
      }
      query += ` ORDER BY created_at ASC`

      const rows = db.query(query).all(params) as MailboxMessageRow[]
      return JSON.stringify({ team_id: args.team_id, total: rows.length, messages: rows })
    },
  })

  const mailboxTransition = tool({
    description: "Mark a mailbox message as read or resolved",
    args: {
      message_id: tool.schema.string(),
      next_status: tool.schema.enum(["read", "resolved"]),
    },
    async execute(args) {
      const row = db.query(`SELECT * FROM mailbox_messages WHERE id = $message_id`).get({ $message_id: args.message_id }) as MailboxMessageRow | null
      if (!row) throw new Error(`Mailbox message ${args.message_id} not found`)
      if (row.status === "resolved") throw new Error(`Mailbox message ${args.message_id} is already resolved`)

      const updatedAt = nowIso()
      const readAt = args.next_status === "read" || row.read_at ? row.read_at ?? updatedAt : null
      const resolvedAt = args.next_status === "resolved" ? updatedAt : row.resolved_at

      db.query(`
        UPDATE mailbox_messages
        SET status = $status, read_at = $read_at, resolved_at = $resolved_at, updated_at = $updated_at
        WHERE id = $message_id
      `).run({
        $status: args.next_status,
        $read_at: readAt,
        $resolved_at: resolvedAt,
        $updated_at: updatedAt,
        $message_id: args.message_id,
      })

      const updated = db.query(`SELECT * FROM mailbox_messages WHERE id = $message_id`).get({ $message_id: args.message_id }) as MailboxMessageRow
      return JSON.stringify(updated)
    },
  })

  return {
    tools: {
      team_mailbox_send: mailboxSend,
      team_mailbox_list: mailboxList,
      team_mailbox_transition: mailboxTransition,
    },
  }
}
