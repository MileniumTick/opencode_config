import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

import { Database } from "bun:sqlite"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

const ACTIVE_TASK_STATUSES = new Set(["todo", "ready", "claimed", "in_progress", "blocked", "review_needed", "verified"])
const CLAIMABLE_TASK_STATUSES = new Set(["todo", "ready"])
const TERMINAL_TASK_STATUSES = new Set(["done", "failed", "cancelled"])
const TEAM_STATUSES = new Set(["active", "paused", "recovering", "archived"])
const DELEGATION_TRANSITIONS = new Map<string, Set<string>>([
  ["requested", new Set(["accepted", "running", "cancelled", "failed", "timed_out"])],
  ["accepted", new Set(["running", "cancelled", "failed", "timed_out"])],
  ["running", new Set(["completed", "cancelled", "failed", "timed_out"])],
  ["completed", new Set()],
  ["cancelled", new Set()],
  ["failed", new Set()],
  ["timed_out", new Set()],
])

const TASK_TRANSITIONS = new Map<string, Set<string>>([
  ["todo", new Set(["ready", "blocked", "cancelled"])],
  ["ready", new Set(["claimed", "blocked", "cancelled"])],
  ["claimed", new Set(["in_progress", "ready", "blocked", "cancelled"])],
  ["in_progress", new Set(["review_needed", "ready", "blocked", "done", "failed", "cancelled"])],
  ["blocked", new Set(["ready", "claimed", "cancelled"])],
  ["review_needed", new Set(["verified", "in_progress", "blocked", "cancelled"])],
  ["verified", new Set(["done", "in_progress", "blocked", "cancelled"])],
  ["done", new Set([])],
  ["failed", new Set([])],
  ["cancelled", new Set([])],
])

function assertTaskTransition(from: string, to: string) {
  const allowed = TASK_TRANSITIONS.get(from)
  if (!allowed || !allowed.has(to)) {
    throw new Error(`Invalid task transition: ${from} -> ${to}`)
  }
}

type TeamRow = {
  id: string
  name: string
  goal: string
  status: string
  branch_name: string | null
  pr_target_branch: string | null
  created_at: string
  updated_at: string
}

type AgentRow = {
  id: string
  team_id: string
  agent_name: string
  role: string
  status: string
  capabilities_json: string
  last_heartbeat_at: string | null
  lease_expires_at: string | null
  current_task_id: string | null
  created_at: string
  updated_at: string
}

type TaskRow = {
  id: string
  team_id: string
  title: string
  description: string
  priority: string
  status: string
  claimed_by: string | null
  claim_lease_expires_at: string | null
  depends_on_task_id: string | null
  created_at: string
  updated_at: string
}

type DelegationRow = {
  id: string
  team_id: string
  task_id: string
  source_agent: string
  target_agent: string
  prompt: string
  status: string
  result_summary: string | null
  child_session_id: string | null
  child_message_id: string | null
  child_session_title: string | null
  launch_error: string | null
  launched_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

type MailboxMessageRow = {
  id: string
  team_id: string
  sender_agent: string
  recipient_agent: string
  task_id: string | null
  delegation_id: string | null
  message_type: string
  subject: string
  body: string
  status: string
  created_at: string
  read_at: string | null
  resolved_at: string | null
  updated_at: string
}

type RecoveryCheckpointRow = {
  id: string
  team_id: string
  checkpoint_type: string
  payload_json: string
  created_at: string
}

type GitWorkItemRow = {
  id: string
  team_id: string
  task_id: string
  branch_name: string
  base_branch: string
  pr_target_branch: string
  pr_number: number | null
  pr_url: string | null
  commit_batching_mode: string
  status: string
  created_at: string
  updated_at: string
}

type ArtifactLinkRow = {
  id: string
  team_id: string
  entity_type: string
  entity_id: string
  artifact_system: string
  artifact_kind: string
  reference_id: string
  uri: string | null
  note: string | null
  metadata_json: string | null
  created_at: string
}

type OpenCodeSessionRecord = {
  id: string
  parentID?: string | null
  title: string
}

type AssistantMessageRecord = {
  id: string
  sessionID: string
  role: string
  time?: {
    created: number
    completed?: number
  }
  error?: {
    data?: {
      message?: string
    }
  } | null
}

type SessionMessageRecord = {
  info: AssistantMessageRecord
  parts: Array<{
    type: string
    text?: string
  }>
}

function nowIso() {
  return new Date().toISOString()
}

function isoFromEpoch(value?: number) {
  return typeof value === "number" ? new Date(value).toISOString() : null
}

function projectKey(directory: string) {
  return createHash("sha256").update(directory).digest("hex").slice(0, 16)
}

function baseBranchFor(branchName?: string | null) {
  if (branchName?.startsWith("hotfix/")) return "main"
  return "development"
}

function assertDelegationTransition(from: string, to: string) {
  const allowed = DELEGATION_TRANSITIONS.get(from)
  if (!allowed || !allowed.has(to)) {
    throw new Error(`Invalid delegation transition: ${from} -> ${to}`)
  }
}

function parseCapabilities(input?: string | null) {
  if (!input) return [] as string[]

  try {
    const parsed = JSON.parse(input)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item)).filter(Boolean)
    }
  } catch {}

  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseMetadataJson(input?: string | null) {
  if (!input) return null

  try {
    return JSON.parse(input)
  } catch {
    return { raw: input }
  }
}

function truncateText(value: string, max = 4000) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 3)}...`
}

function extractText(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

function rowToTeamStatus(
  row: TeamRow,
  taskCounts: Record<string, number>,
  agentCounts: Record<string, number>,
  extras: {
    open_delegations: number
    stale_agents: number
    git_work_items: number
    artifact_links: number
  },
) {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    status: row.status,
    branch_name: row.branch_name,
    pr_target_branch: row.pr_target_branch,
    created_at: row.created_at,
    updated_at: row.updated_at,
    tasks: taskCounts,
    agents: agentCounts,
    ...extras,
  }
}

function agentResponse(row: AgentRow) {
  return {
    ...row,
    capabilities: parseCapabilities(row.capabilities_json),
  }
}

function artifactResponse(row: ArtifactLinkRow) {
  return {
    ...row,
    metadata: parseMetadataJson(row.metadata_json),
  }
}

function safeGit(directory: string, args: string[]) {
  try {
    const stdout = execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim()
    return { ok: true, stdout, stderr: "" }
  } catch (error) {
    const err = error as Error & { stderr?: string | Buffer }
    return {
      ok: false,
      stdout: "",
      stderr: typeof err.stderr === "string" ? err.stderr.trim() : err.stderr?.toString().trim() ?? err.message,
    }
  }
}

export const AgentTeamsRuntime: Plugin = async ({ client, directory }) => {
  const runtimeDir = join(process.env.HOME ?? directory, ".local", "share", "opencode", "agent-teams")
  mkdirSync(runtimeDir, { recursive: true })
  const dbPath = join(runtimeDir, `${projectKey(directory)}.sqlite`)
  mkdirSync(dirname(dbPath), { recursive: true })

  const db = new Database(dbPath)
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA foreign_keys = ON;")
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL,
      branch_name TEXT,
      pr_target_branch TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      last_heartbeat_at TEXT,
      lease_expires_at TEXT,
      current_task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(team_id, agent_name),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (current_task_id) REFERENCES tasks(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      claimed_by TEXT,
      claim_lease_expires_at TEXT,
      depends_on_task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS delegations (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      source_agent TEXT NOT NULL,
      target_agent TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      result_summary TEXT,
      child_session_id TEXT,
      child_message_id TEXT,
      child_session_title TEXT,
      launch_error TEXT,
      launched_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS runtime_events (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mailbox_messages (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      sender_agent TEXT NOT NULL,
      recipient_agent TEXT NOT NULL,
      task_id TEXT,
      delegation_id TEXT,
      message_type TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT,
      resolved_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
      FOREIGN KEY (delegation_id) REFERENCES delegations(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS recovery_checkpoints (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      checkpoint_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS git_work_items (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      pr_target_branch TEXT NOT NULL,
      pr_number INTEGER,
      pr_url TEXT,
      commit_batching_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(task_id),
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS artifact_links (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      artifact_system TEXT NOT NULL,
      artifact_kind TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      uri TEXT,
      note TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS runtime_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agents_team_status ON agents(team_id, status);
    CREATE INDEX IF NOT EXISTS idx_agents_team_lease ON agents(team_id, lease_expires_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_team_status ON tasks(team_id, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_team_claim_lease ON tasks(team_id, claim_lease_expires_at);
    CREATE INDEX IF NOT EXISTS idx_delegations_team_status ON delegations(team_id, status);
    CREATE INDEX IF NOT EXISTS idx_delegations_child_session ON delegations(child_session_id);
    CREATE INDEX IF NOT EXISTS idx_events_team_created ON runtime_events(team_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_mailbox_team_recipient_status ON mailbox_messages(team_id, recipient_agent, status);
    CREATE INDEX IF NOT EXISTS idx_mailbox_team_task ON mailbox_messages(team_id, task_id);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_team_created ON recovery_checkpoints(team_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_git_work_items_team_status ON git_work_items(team_id, status);
    CREATE INDEX IF NOT EXISTS idx_git_work_items_team_task ON git_work_items(team_id, task_id);
    CREATE INDEX IF NOT EXISTS idx_artifact_links_team_entity ON artifact_links(team_id, entity_type, entity_id);
  `)

  db.query(`
    INSERT INTO runtime_meta (key, value, updated_at)
    VALUES ('schema_version', '3', $updated_at)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run({ $updated_at: nowIso() })

  function ensureColumn(tableName: string, columnName: string, columnDefinition: string) {
    const columns = db.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === columnName)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`)
    }
  }

  ensureColumn("delegations", "child_session_id", "child_session_id TEXT")
  ensureColumn("delegations", "child_message_id", "child_message_id TEXT")
  ensureColumn("delegations", "child_session_title", "child_session_title TEXT")
  ensureColumn("delegations", "launch_error", "launch_error TEXT")
  ensureColumn("delegations", "launched_at", "launched_at TEXT")
  ensureColumn("delegations", "completed_at", "completed_at TEXT")
  ensureColumn("tasks", "block_reason", "block_reason TEXT")

  const logEvent = db.query(`
    INSERT INTO runtime_events (id, team_id, entity_type, entity_id, event_type, payload_json, created_at)
    VALUES ($id, $team_id, $entity_type, $entity_id, $event_type, $payload_json, $created_at)
  `)

  async function agentExists(agentName: string) {
    try {
      const response = await client.app.agents({ query: { directory } })
      const agents = Array.isArray(response?.data) ? response.data : []
      return agents.some((agent: any) => agent?.id === agentName || agent?.name === agentName)
    } catch {
      return true
    }
  }

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

  function updateDelegationExecution(args: {
    delegation_id: string
    next_status?: string
    result_summary?: string | null
    child_session_id?: string | null
    child_message_id?: string | null
    child_session_title?: string | null
    launch_error?: string | null
    launched_at?: string | null
    completed_at?: string | null
  }) {
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
      logEvent.run({
        $id: randomUUID(),
        $team_id: delegation.team_id,
        $entity_type: "delegation",
        $entity_id: delegation.id,
        $event_type: "delegation.sync_failed",
        $payload_json: JSON.stringify({ child_session_id: delegation.child_session_id, error: message }),
        $created_at: nowIso(),
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
      if (delegation.status !== "failed") {
        assertDelegationTransition(delegation.status, "failed")
      }
      updateDelegationExecution({
        delegation_id: delegation.id,
        next_status: "failed",
        result_summary: summary,
        child_message_id: latestAssistant.info.id,
        launch_error: errorMessage,
        completed_at: completedAt,
      })
      logEvent.run({
        $id: randomUUID(),
        $team_id: delegation.team_id,
        $entity_type: "delegation",
        $entity_id: delegation.id,
        $event_type: "delegation.failed",
        $payload_json: JSON.stringify({ child_session_id: delegation.child_session_id, child_message_id: latestAssistant.info.id, error: errorMessage }),
        $created_at: nowIso(),
      })
    } else if (latestAssistant.info.time?.completed) {
      if (delegation.status !== "completed") {
        assertDelegationTransition(delegation.status, "completed")
      }
      updateDelegationExecution({
        delegation_id: delegation.id,
        next_status: "completed",
        result_summary: summary,
        child_message_id: latestAssistant.info.id,
        launch_error: null,
        completed_at: completedAt,
      })
      logEvent.run({
        $id: randomUUID(),
        $team_id: delegation.team_id,
        $entity_type: "delegation",
        $entity_id: delegation.id,
        $event_type: "delegation.completed",
        $payload_json: JSON.stringify({ child_session_id: delegation.child_session_id, child_message_id: latestAssistant.info.id }),
        $created_at: nowIso(),
      })
    }

    return db.query(`SELECT * FROM delegations WHERE id = $delegation_id`).get({ $delegation_id: delegation.id }) as DelegationRow
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

      logEvent.run({
        $id: randomUUID(),
        $team_id: id,
        $entity_type: "team",
        $entity_id: id,
        $event_type: "team.started",
        $payload_json: JSON.stringify({ goal: args.goal, branch_name: args.branch_name ?? null, pr_target_branch: prTarget }),
        $created_at: createdAt,
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
      requireTeam(args.team_id)
      if (!TEAM_STATUSES.has(args.status)) throw new Error(`Unsupported team status ${args.status}`)

      const updatedAt = nowIso()
      db.query(`UPDATE teams SET status = $status, updated_at = $updated_at WHERE id = $team_id`).run({
        $status: args.status,
        $updated_at: updatedAt,
        $team_id: args.team_id,
      })

      logEvent.run({
        $id: randomUUID(),
        $team_id: args.team_id,
        $entity_type: "team",
        $entity_id: args.team_id,
        $event_type: `team.status.${args.status}`,
        $payload_json: JSON.stringify({ note: args.note ?? null }),
        $created_at: updatedAt,
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
      requireTeam(args.team_id)
      if (args.current_task_id) requireTask(args.team_id, args.current_task_id)

      const heartbeatAt = nowIso()
      const leaseExpiresAt = new Date(Date.now() + args.lease_minutes * 60_000).toISOString()
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

      logEvent.run({
        $id: randomUUID(),
        $team_id: args.team_id,
        $entity_type: "agent",
        $entity_id: row.id,
        $event_type: existing ? "agent.refreshed" : "agent.registered",
        $payload_json: JSON.stringify({ role: args.role, status: args.status, lease_expires_at: leaseExpiresAt, current_task_id: args.current_task_id ?? null }),
        $created_at: heartbeatAt,
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
      if (args.current_task_id) requireTask(args.team_id, args.current_task_id)

      const heartbeatAt = nowIso()
      const leaseExpiresAt = new Date(Date.now() + args.lease_minutes * 60_000).toISOString()

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

      logEvent.run({
        $id: randomUUID(),
        $team_id: args.team_id,
        $entity_type: "agent",
        $entity_id: row.id,
        $event_type: "agent.heartbeat",
        $payload_json: JSON.stringify({ status: args.status ?? row.status, lease_expires_at: leaseExpiresAt, current_task_id: args.current_task_id ?? row.current_task_id }),
        $created_at: heartbeatAt,
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
      requireTeam(args.team_id)

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
      requireTeam(args.team_id)

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

      logEvent.run({
        $id: randomUUID(),
        $team_id: args.team_id,
        $entity_type: "task",
        $entity_id: id,
        $event_type: "task.created",
        $payload_json: JSON.stringify({ title: args.title, status, depends_on_task_id: args.depends_on_task_id ?? null }),
        $created_at: createdAt,
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
      requireTeam(args.team_id)

      const rows = (args.status
        ? db.query(`SELECT * FROM tasks WHERE team_id = $team_id AND status = $status ORDER BY created_at ASC`).all({ $team_id: args.team_id, $status: args.status })
        : db.query(`SELECT * FROM tasks WHERE team_id = $team_id ORDER BY created_at ASC`).all({ $team_id: args.team_id })) as TaskRow[]

      const gitRows = db.query(`SELECT * FROM git_work_items WHERE team_id = $team_id`).all({ $team_id: args.team_id }) as GitWorkItemRow[]
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
    const task = requireTask(teamId, taskId)
    if (!CLAIMABLE_TASK_STATUSES.has(task.status)) throw new Error(`Task ${taskId} is not claimable from status ${task.status}`)

    const now = new Date()
    const leaseExpires = new Date(now.getTime() + leaseMinutes * 60_000).toISOString()
    const updatedAt = now.toISOString()

    db.query(`
      UPDATE tasks
      SET status = 'claimed', claimed_by = $claimed_by, claim_lease_expires_at = $claim_lease_expires_at, updated_at = $updated_at
      WHERE id = $task_id AND team_id = $team_id
    `).run({
      $claimed_by: claimant,
      $claim_lease_expires_at: leaseExpires,
      $updated_at: updatedAt,
      $task_id: taskId,
      $team_id: teamId,
    })

    maybeTouchRegisteredAgent(teamId, claimant, {
      status: "busy",
      lease_expires_at: leaseExpires,
      current_task_id: taskId,
    })

    logEvent.run({
      $id: randomUUID(),
      $team_id: teamId,
      $entity_type: "task",
      $entity_id: taskId,
      $event_type: "task.claimed",
      $payload_json: JSON.stringify({ claimant, lease_expires_at: leaseExpires }),
      $created_at: updatedAt,
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
    const task = requireTask(teamId, taskId)
    assertTaskTransition(task.status, "ready")

    const now = nowIso()
    const previousClaimedBy = task.claimed_by

    db.query(`
      UPDATE tasks
      SET status = 'ready', claimed_by = NULL, claim_lease_expires_at = NULL, updated_at = $updated_at
      WHERE id = $task_id AND team_id = $team_id
    `).run({
      $updated_at: now,
      $task_id: taskId,
      $team_id: teamId,
    })

    if (previousClaimedBy) {
      maybeTouchRegisteredAgent(teamId, previousClaimedBy, {
        status: "idle",
        current_task_id: null,
      })
    }

    logEvent.run({
      $id: randomUUID(),
      $team_id: teamId,
      $entity_type: "task",
      $entity_id: taskId,
      $event_type: "task.released",
      $payload_json: JSON.stringify({ previous_claimed_by: previousClaimedBy, reason: reason ?? null }),
      $created_at: now,
    })

    return db.query(`SELECT * FROM tasks WHERE id = $task_id`).get({ $task_id: taskId }) as TaskRow
  })

  const taskRelease = tool({
    description: "Release a claimed task back to the pool",
    args: {
      team_id: tool.schema.string(),
      task_id: tool.schema.string(),
      reason: tool.schema.string().optional(),
    },
    async execute(args) {
      const row = taskReleaseTx(args.team_id, args.task_id, args.reason)
      return JSON.stringify(row)
    },
  })

  const taskBlockTx = db.transaction((teamId: string, taskId: string, reason?: string) => {
    const task = requireTask(teamId, taskId)
    assertTaskTransition(task.status, "blocked")

    const now = nowIso()
    const previousClaimedBy = task.claimed_by

    db.query(`
      UPDATE tasks
      SET status = 'blocked', block_reason = $block_reason, updated_at = $updated_at
      WHERE id = $task_id AND team_id = $team_id
    `).run({
      $block_reason: reason ?? null,
      $updated_at: now,
      $task_id: taskId,
      $team_id: teamId,
    })

    if (previousClaimedBy) {
      maybeTouchRegisteredAgent(teamId, previousClaimedBy, {
        status: "idle",
        current_task_id: null,
      })
    }

    logEvent.run({
      $id: randomUUID(),
      $team_id: teamId,
      $entity_type: "task",
      $entity_id: taskId,
      $event_type: "task.blocked",
      $payload_json: JSON.stringify({ reason: reason ?? null, previous_status: task.status, claimed_by: previousClaimedBy }),
      $created_at: now,
    })

    return db.query(`SELECT * FROM tasks WHERE id = $task_id`).get({ $task_id: taskId }) as TaskRow
  })

  const taskBlock = tool({
    description: "Mark a task as blocked with an optional reason",
    args: {
      team_id: tool.schema.string(),
      task_id: tool.schema.string(),
      reason: tool.schema.string().optional(),
    },
    async execute(args) {
      const row = taskBlockTx(args.team_id, args.task_id, args.reason)
      return JSON.stringify(row)
    },
  })

  const taskUnblockTx = db.transaction((teamId: string, taskId: string) => {
    const task = requireTask(teamId, taskId)
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
      maybeTouchRegisteredAgent(teamId, previousClaimedBy, {
        status: "idle",
        current_task_id: null,
      })
    }

    logEvent.run({
      $id: randomUUID(),
      $team_id: teamId,
      $entity_type: "task",
      $entity_id: taskId,
      $event_type: "task.unblocked",
      $payload_json: JSON.stringify({ previous_claimed_by: previousClaimedBy }),
      $created_at: now,
    })

    return db.query(`SELECT * FROM tasks WHERE id = $task_id`).get({ $task_id: taskId }) as TaskRow
  })

  const taskUnblock = tool({
    description: "Unblock a blocked task and return it to the ready pool",
    args: {
      team_id: tool.schema.string(),
      task_id: tool.schema.string(),
    },
    async execute(args) {
      const row = taskUnblockTx(args.team_id, args.task_id)
      return JSON.stringify(row)
    },
  })

  const taskCompleteTx = db.transaction((teamId: string, taskId: string) => {
    const task = requireTask(teamId, taskId)
    assertTaskTransition(task.status, "done")

    const now = nowIso()
    const previousClaimedBy = task.claimed_by

    db.query(`
      UPDATE tasks
      SET status = 'done', updated_at = $updated_at
      WHERE id = $task_id AND team_id = $team_id
    `).run({
      $updated_at: now,
      $task_id: taskId,
      $team_id: teamId,
    })

    if (previousClaimedBy) {
      maybeTouchRegisteredAgent(teamId, previousClaimedBy, {
        status: "idle",
        current_task_id: null,
      })
    }

    // Cascade: find dependent tasks still in 'todo' and transition to 'ready'
    const dependents = db.query(
      `SELECT * FROM tasks WHERE team_id = $team_id AND depends_on_task_id = $task_id AND status = 'todo'`
    ).all({ $team_id: teamId, $task_id: taskId }) as TaskRow[]

    for (const dep of dependents) {
      db.query(`UPDATE tasks SET status = 'ready', updated_at = $updated_at WHERE id = $id`).run({
        $updated_at: now,
        $id: dep.id,
      })

      logEvent.run({
        $id: randomUUID(),
        $team_id: teamId,
        $entity_type: "task",
        $entity_id: dep.id,
        $event_type: "task.unblocked_by_completion",
        $payload_json: JSON.stringify({ completed_task_id: taskId, dependent_task_id: dep.id }),
        $created_at: now,
      })
    }

    logEvent.run({
      $id: randomUUID(),
      $team_id: teamId,
      $entity_type: "task",
      $entity_id: taskId,
      $event_type: "task.completed",
      $payload_json: JSON.stringify({ claimed_by: previousClaimedBy, cascaded_dependents: dependents.length }),
      $created_at: now,
    })

    return db.query(`SELECT * FROM tasks WHERE id = $task_id`).get({ $task_id: taskId }) as TaskRow
  })

  const taskComplete = tool({
    description: "Mark a task as done, release the agent, and cascade to dependent tasks",
    args: {
      team_id: tool.schema.string(),
      task_id: tool.schema.string(),
    },
    async execute(args) {
      const row = taskCompleteTx(args.team_id, args.task_id)
      return JSON.stringify(row)
    },
  })

  const delegationCreateTx = db.transaction((teamId: string, taskId: string, sourceAgent: string, targetAgent: string, prompt: string) => {
    const task = requireTask(teamId, taskId)
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

    logEvent.run({
      $id: randomUUID(),
      $team_id: teamId,
      $entity_type: "delegation",
      $entity_id: id,
      $event_type: "delegation.created",
      $payload_json: JSON.stringify({ task_id: taskId, source_agent: sourceAgent, target_agent: targetAgent, mailbox_message_id: messageId }),
      $created_at: createdAt,
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
      requireTeam(args.team_id)
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

      if (args.next_status === "accepted" || args.next_status === "running") {
        maybeTouchRegisteredAgent(row.team_id, row.target_agent, { status: "busy" })
      }

      if (["completed", "failed", "cancelled", "timed_out"].includes(args.next_status)) {
        maybeTouchRegisteredAgent(row.team_id, row.target_agent, { status: args.next_status === "completed" ? "idle" : "recovering" })
      }

      logEvent.run({
        $id: randomUUID(),
        $team_id: row.team_id,
        $entity_type: "delegation",
        $entity_id: row.id,
        $event_type: `delegation.${args.next_status}`,
        $payload_json: JSON.stringify({ result_summary: args.result_summary ?? null }),
        $created_at: updatedAt,
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

      const team = requireTeam(delegation.team_id)
      const task = requireTask(delegation.team_id, delegation.task_id)
      const targetAgentIsKnown = await agentExists(delegation.target_agent)
      if (!targetAgentIsKnown) {
        throw new Error(`Target agent ${delegation.target_agent} is not registered in the current OpenCode configuration`)
      }

      const sessionTitle = delegationChildSessionTitle(delegation, task)
      const launchedAt = nowIso()
      const created = await client.session.create({
        query: { directory },
        body: {
          parentID: context.sessionID,
          title: sessionTitle,
        },
      })
      const childSession = created?.data as OpenCodeSessionRecord | undefined
      if (!childSession?.id) {
        throw new Error(`Failed to create child session for delegation ${delegation.id}`)
      }

      try {
        await client.session.promptAsync({
          path: { id: childSession.id },
          query: { directory },
          body: {
            agent: delegation.target_agent,
            parts: [
              {
                type: "text",
                text: delegationChildPrompt(team, task, delegation),
              },
            ],
          },
        })
      } catch (error) {
        const launchError = error instanceof Error ? error.message : String(error)
        if (delegation.status !== "failed") {
          assertDelegationTransition(delegation.status, "failed")
        }
        updateDelegationExecution({
          delegation_id: delegation.id,
          next_status: "failed",
          child_session_id: childSession.id,
          child_session_title: sessionTitle,
          launch_error: launchError,
          launched_at: launchedAt,
        })
        logEvent.run({
          $id: randomUUID(),
          $team_id: delegation.team_id,
          $entity_type: "delegation",
          $entity_id: delegation.id,
          $event_type: "delegation.launch_failed",
          $payload_json: JSON.stringify({ child_session_id: childSession.id, error: launchError }),
          $created_at: nowIso(),
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
      maybeTouchRegisteredAgent(delegation.team_id, delegation.target_agent, { status: "busy" })
      logEvent.run({
        $id: randomUUID(),
        $team_id: delegation.team_id,
        $entity_type: "delegation",
        $entity_id: delegation.id,
        $event_type: "delegation.launched",
        $payload_json: JSON.stringify({ child_session_id: childSession.id, child_session_title: sessionTitle, parent_session_id: context.sessionID }),
        $created_at: launchedAt,
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
      requireTeam(args.team_id)

      if (args.task_id) requireTask(args.team_id, args.task_id)

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

      logEvent.run({
        $id: randomUUID(),
        $team_id: args.team_id,
        $entity_type: "mailbox_message",
        $entity_id: id,
        $event_type: "mailbox.sent",
        $payload_json: JSON.stringify({ sender_agent: args.sender_agent, recipient_agent: args.recipient_agent, message_type: args.message_type, task_id: args.task_id ?? null, delegation_id: args.delegation_id ?? null }),
        $created_at: createdAt,
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
      requireTeam(args.team_id)

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

  const checkpointCreate = tool({
    description: "Create a runtime recovery checkpoint snapshot for a team",
    args: {
      team_id: tool.schema.string(),
      checkpoint_type: tool.schema.enum(["manual", "verify", "archive", "recovery", "phase_boundary"]).default("manual"),
      note: tool.schema.string().optional(),
    },
    async execute(args) {
      const team = requireTeam(args.team_id)
      const tasks = db.query(`SELECT * FROM tasks WHERE team_id = $team_id ORDER BY created_at ASC`).all({ $team_id: args.team_id }) as TaskRow[]
      const delegations = db.query(`SELECT * FROM delegations WHERE team_id = $team_id ORDER BY created_at ASC`).all({ $team_id: args.team_id }) as DelegationRow[]
      const mailbox = db.query(`SELECT * FROM mailbox_messages WHERE team_id = $team_id AND status != 'resolved' ORDER BY created_at ASC`).all({ $team_id: args.team_id }) as MailboxMessageRow[]
      const agents = db.query(`SELECT * FROM agents WHERE team_id = $team_id ORDER BY agent_name ASC`).all({ $team_id: args.team_id }) as AgentRow[]
      const gitWorkItems = db.query(`SELECT * FROM git_work_items WHERE team_id = $team_id ORDER BY created_at ASC`).all({ $team_id: args.team_id }) as GitWorkItemRow[]
      const artifactLinks = db.query(`SELECT * FROM artifact_links WHERE team_id = $team_id ORDER BY created_at ASC`).all({ $team_id: args.team_id }) as ArtifactLinkRow[]

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

      logEvent.run({
        $id: randomUUID(),
        $team_id: args.team_id,
        $entity_type: "checkpoint",
        $entity_id: id,
        $event_type: "checkpoint.created",
        $payload_json: JSON.stringify({ checkpoint_type: args.checkpoint_type, note: args.note ?? null }),
        $created_at: createdAt,
      })

      return JSON.stringify({ id, team_id: args.team_id, checkpoint_type: args.checkpoint_type, created_at: createdAt })
    },
  })

  const checkpointLatest = tool({
    description: "Get the latest recovery checkpoint for a team",
    args: {
      team_id: tool.schema.string(),
    },
    async execute(args) {
      requireTeam(args.team_id)
      const row = db.query(`SELECT * FROM recovery_checkpoints WHERE team_id = $team_id ORDER BY created_at DESC LIMIT 1`).get({ $team_id: args.team_id }) as RecoveryCheckpointRow | null
      if (!row) return JSON.stringify({ status: "not_found", message: `No checkpoints found for team ${args.team_id}` })
      return JSON.stringify(row)
    },
  })

  const recoveryInspect = tool({
    description: "Inspect stale agents and claims, unresolved mailbox, open delegations, and unfinished git work items for recovery planning",
    args: {
      team_id: tool.schema.string(),
    },
    async execute(args) {
      requireTeam(args.team_id)
      const now = nowIso()
      const staleClaims = db.query(`SELECT * FROM tasks WHERE team_id = $team_id AND claim_lease_expires_at IS NOT NULL AND claim_lease_expires_at < $now AND status IN ('claimed','in_progress')`).all({ $team_id: args.team_id, $now: now }) as TaskRow[]
      const staleAgents = db.query(`SELECT * FROM agents WHERE team_id = $team_id AND lease_expires_at IS NOT NULL AND lease_expires_at < $now AND status IN ('idle','busy','waiting','recovering') ORDER BY agent_name ASC`).all({ $team_id: args.team_id, $now: now }) as AgentRow[]
      const unresolvedMailbox = db.query(`SELECT * FROM mailbox_messages WHERE team_id = $team_id AND status != 'resolved' ORDER BY created_at ASC`).all({ $team_id: args.team_id }) as MailboxMessageRow[]
      const openDelegations = db.query(`SELECT * FROM delegations WHERE team_id = $team_id AND status IN ('requested','accepted','running') ORDER BY created_at ASC`).all({ $team_id: args.team_id }) as DelegationRow[]
      const unfinishedGitWorkItems = db.query(`SELECT * FROM git_work_items WHERE team_id = $team_id AND status NOT IN ('merged','abandoned') ORDER BY updated_at DESC`).all({ $team_id: args.team_id }) as GitWorkItemRow[]
      const latestCheckpoint = db.query(`SELECT id, checkpoint_type, created_at FROM recovery_checkpoints WHERE team_id = $team_id ORDER BY created_at DESC LIMIT 1`).get({ $team_id: args.team_id }) as Record<string, string> | null

      return JSON.stringify({
        team_id: args.team_id,
        latest_checkpoint: latestCheckpoint,
        stale_agents: staleAgents.map(agentResponse),
        stale_claims: staleClaims,
        unresolved_mailbox: unresolvedMailbox,
        open_delegations: openDelegations,
        unfinished_git_work_items: unfinishedGitWorkItems,
      })
    },
  })

  const recoveryRequeueStaleClaimsTx = db.transaction((teamId: string, staleAgentStatus: string, note?: string | null) => {
    const now = nowIso()
    const staleClaims = db.query(`SELECT * FROM tasks WHERE team_id = $team_id AND claim_lease_expires_at IS NOT NULL AND claim_lease_expires_at < $now AND status IN ('claimed','in_progress') ORDER BY created_at ASC`).all({ $team_id: teamId, $now: now }) as TaskRow[]

    const impactedAgents = new Set<string>()
    for (const task of staleClaims) {
      db.query(`
        UPDATE tasks
        SET status = 'ready', claimed_by = NULL, claim_lease_expires_at = NULL, updated_at = $updated_at
        WHERE id = $task_id
      `).run({
        $updated_at: now,
        $task_id: task.id,
      })

      if (task.claimed_by) {
        impactedAgents.add(task.claimed_by)
      }

      logEvent.run({
        $id: randomUUID(),
        $team_id: teamId,
        $entity_type: "task",
        $entity_id: task.id,
        $event_type: "recovery.task.requeued",
        $payload_json: JSON.stringify({ previous_status: task.status, previous_claimed_by: task.claimed_by, note: note ?? null }),
        $created_at: now,
      })
    }

    for (const agentName of impactedAgents) {
      maybeTouchRegisteredAgent(teamId, agentName, {
        status: staleAgentStatus,
        lease_expires_at: now,
        current_task_id: null,
      })
    }

    logEvent.run({
      $id: randomUUID(),
      $team_id: teamId,
      $entity_type: "team",
      $entity_id: teamId,
      $event_type: "recovery.stale_claims.requeued",
      $payload_json: JSON.stringify({ count: staleClaims.length, impacted_agents: [...impactedAgents], stale_agent_status: staleAgentStatus, note: note ?? null }),
      $created_at: now,
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
      requireTeam(args.team_id)
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

  const gitWorkItemUpsert = tool({
    description: "Persist git branch and PR target metadata for a runtime task",
    args: {
      team_id: tool.schema.string(),
      task_id: tool.schema.string(),
      branch_name: tool.schema.string(),
      base_branch: tool.schema.string().optional(),
      pr_target_branch: tool.schema.string().optional(),
      pr_number: tool.schema.number().optional(),
      pr_url: tool.schema.string().optional(),
      commit_batching_mode: tool.schema.enum(["single", "multiple"]).default("single"),
      status: tool.schema.enum(["planned", "in_progress", "ready_for_review", "pr_open", "merged", "abandoned"]).default("planned"),
    },
    async execute(args) {
      requireTeam(args.team_id)
      requireTask(args.team_id, args.task_id)

      const expectedTarget = baseBranchFor(args.branch_name)
      const baseBranch = args.base_branch ?? expectedTarget
      const prTargetBranch = args.pr_target_branch ?? expectedTarget

      if (baseBranch !== expectedTarget) {
        throw new Error(`Invalid base_branch ${baseBranch} for branch ${args.branch_name}. Expected ${expectedTarget}.`)
      }
      if (prTargetBranch !== expectedTarget) {
        throw new Error(`Invalid pr_target_branch ${prTargetBranch} for branch ${args.branch_name}. Expected ${expectedTarget}.`)
      }

      const existing = db.query(`SELECT * FROM git_work_items WHERE task_id = $task_id`).get({ $task_id: args.task_id }) as GitWorkItemRow | null
      const updatedAt = nowIso()

      if (existing) {
        db.query(`
          UPDATE git_work_items
          SET branch_name = $branch_name,
              base_branch = $base_branch,
              pr_target_branch = $pr_target_branch,
              pr_number = $pr_number,
              pr_url = $pr_url,
              commit_batching_mode = $commit_batching_mode,
              status = $status,
              updated_at = $updated_at
          WHERE id = $id
        `).run({
          $branch_name: args.branch_name,
          $base_branch: baseBranch,
          $pr_target_branch: prTargetBranch,
          $pr_number: args.pr_number ?? null,
          $pr_url: args.pr_url ?? null,
          $commit_batching_mode: args.commit_batching_mode,
          $status: args.status,
          $updated_at: updatedAt,
          $id: existing.id,
        })
      } else {
        db.query(`
          INSERT INTO git_work_items (id, team_id, task_id, branch_name, base_branch, pr_target_branch, pr_number, pr_url, commit_batching_mode, status, created_at, updated_at)
          VALUES ($id, $team_id, $task_id, $branch_name, $base_branch, $pr_target_branch, $pr_number, $pr_url, $commit_batching_mode, $status, $created_at, $updated_at)
        `).run({
          $id: randomUUID(),
          $team_id: args.team_id,
          $task_id: args.task_id,
          $branch_name: args.branch_name,
          $base_branch: baseBranch,
          $pr_target_branch: prTargetBranch,
          $pr_number: args.pr_number ?? null,
          $pr_url: args.pr_url ?? null,
          $commit_batching_mode: args.commit_batching_mode,
          $status: args.status,
          $created_at: updatedAt,
          $updated_at: updatedAt,
        })
      }

      const row = db.query(`SELECT * FROM git_work_items WHERE task_id = $task_id`).get({ $task_id: args.task_id }) as GitWorkItemRow

      logEvent.run({
        $id: randomUUID(),
        $team_id: args.team_id,
        $entity_type: "git_work_item",
        $entity_id: row.id,
        $event_type: existing ? "git_work_item.updated" : "git_work_item.created",
        $payload_json: JSON.stringify({ task_id: args.task_id, branch_name: args.branch_name, base_branch: baseBranch, pr_target_branch: prTargetBranch, commit_batching_mode: args.commit_batching_mode, status: args.status, pr_number: args.pr_number ?? null, pr_url: args.pr_url ?? null }),
        $created_at: updatedAt,
      })

      return JSON.stringify(row)
    },
  })

  const gitWorkItemList = tool({
    description: "List persisted git work item metadata for a team",
    args: {
      team_id: tool.schema.string(),
      status: tool.schema.enum(["planned", "in_progress", "ready_for_review", "pr_open", "merged", "abandoned"]).optional(),
    },
    async execute(args) {
      requireTeam(args.team_id)

      const rows = (args.status
        ? db.query(`SELECT * FROM git_work_items WHERE team_id = $team_id AND status = $status ORDER BY updated_at DESC`).all({ $team_id: args.team_id, $status: args.status })
        : db.query(`SELECT * FROM git_work_items WHERE team_id = $team_id ORDER BY updated_at DESC`).all({ $team_id: args.team_id })) as GitWorkItemRow[]

      return JSON.stringify({ team_id: args.team_id, total: rows.length, git_work_items: rows })
    },
  })

  const gitWorkItemValidate = tool({
    description: "Validate persisted git work item policy against live repository state",
    args: {
      git_work_item_id: tool.schema.string().optional(),
      task_id: tool.schema.string().optional(),
    },
    async execute(args) {
      if (!args.git_work_item_id && !args.task_id) {
        throw new Error("Provide git_work_item_id or task_id")
      }

      const row = (args.git_work_item_id
        ? db.query(`SELECT * FROM git_work_items WHERE id = $id`).get({ $id: args.git_work_item_id })
        : db.query(`SELECT * FROM git_work_items WHERE task_id = $task_id`).get({ $task_id: args.task_id })) as GitWorkItemRow | null

      if (!row) throw new Error("Git work item not found")

      const expectedTarget = baseBranchFor(row.branch_name)
      const insideWorktree = safeGit(directory, ["rev-parse", "--is-inside-work-tree"])
      const currentBranch = safeGit(directory, ["branch", "--show-current"])
      const branchExists = safeGit(directory, ["rev-parse", "--verify", `refs/heads/${row.branch_name}`])
      const worktreeStatus = safeGit(directory, ["status", "--porcelain"])

      return JSON.stringify({
        git_work_item: row,
        expected_target_branch: expectedTarget,
        policy_valid: row.pr_target_branch === expectedTarget && row.base_branch === expectedTarget,
        git_repository_accessible: insideWorktree.ok && insideWorktree.stdout === "true",
        recorded_branch_exists: branchExists.ok,
        current_branch: currentBranch.ok ? currentBranch.stdout || null : null,
        current_branch_matches_recorded: currentBranch.ok ? currentBranch.stdout === row.branch_name : false,
        worktree_clean: worktreeStatus.ok ? worktreeStatus.stdout.length === 0 : false,
        git_errors: [insideWorktree, currentBranch, branchExists, worktreeStatus]
          .filter((result) => !result.ok)
          .map((result) => result.stderr),
      })
    },
  })

  const artifactLinkCreate = tool({
    description: "Persist an artifact or checkpoint link for a runtime entity. Use this to connect runtime state to Engram records explicitly.",
    args: {
      team_id: tool.schema.string(),
      entity_type: tool.schema.enum(["team", "agent", "task", "delegation", "mailbox_message", "checkpoint", "git_work_item"]),
      entity_id: tool.schema.string(),
      artifact_system: tool.schema.enum(["engram", "runtime", "external"]).default("engram"),
      artifact_kind: tool.schema.enum(["checkpoint", "summary", "artifact", "observation", "session_summary"]).default("artifact"),
      reference_id: tool.schema.string(),
      uri: tool.schema.string().optional(),
      note: tool.schema.string().optional(),
      metadata_json: tool.schema.string().optional().describe("Optional JSON metadata for the link"),
    },
    async execute(args) {
      requireTeam(args.team_id)
      requireEntity(args.team_id, args.entity_type, args.entity_id)

      const id = randomUUID()
      const createdAt = nowIso()
      db.query(`
        INSERT INTO artifact_links (id, team_id, entity_type, entity_id, artifact_system, artifact_kind, reference_id, uri, note, metadata_json, created_at)
        VALUES ($id, $team_id, $entity_type, $entity_id, $artifact_system, $artifact_kind, $reference_id, $uri, $note, $metadata_json, $created_at)
      `).run({
        $id: id,
        $team_id: args.team_id,
        $entity_type: args.entity_type,
        $entity_id: args.entity_id,
        $artifact_system: args.artifact_system,
        $artifact_kind: args.artifact_kind,
        $reference_id: args.reference_id,
        $uri: args.uri ?? null,
        $note: args.note ?? null,
        $metadata_json: args.metadata_json ?? null,
        $created_at: createdAt,
      })

      logEvent.run({
        $id: randomUUID(),
        $team_id: args.team_id,
        $entity_type: "artifact_link",
        $entity_id: id,
        $event_type: "artifact_link.created",
        $payload_json: JSON.stringify({ entity_type: args.entity_type, entity_id: args.entity_id, artifact_system: args.artifact_system, artifact_kind: args.artifact_kind, reference_id: args.reference_id }),
        $created_at: createdAt,
      })

      const row = db.query(`SELECT * FROM artifact_links WHERE id = $id`).get({ $id: id }) as ArtifactLinkRow
      return JSON.stringify(artifactResponse(row))
    },
  })

  const artifactLinkList = tool({
    description: "List artifact links for a team or runtime entity",
    args: {
      team_id: tool.schema.string(),
      entity_type: tool.schema.enum(["team", "agent", "task", "delegation", "mailbox_message", "checkpoint", "git_work_item"]).optional(),
      entity_id: tool.schema.string().optional(),
    },
    async execute(args) {
      requireTeam(args.team_id)

      let query = `SELECT * FROM artifact_links WHERE team_id = $team_id`
      const params: Record<string, string> = { $team_id: args.team_id }

      if (args.entity_type) {
        query += ` AND entity_type = $entity_type`
        params.$entity_type = args.entity_type
      }

      if (args.entity_id) {
        query += ` AND entity_id = $entity_id`
        params.$entity_id = args.entity_id
      }

      query += ` ORDER BY created_at DESC`
      const rows = db.query(query).all(params) as ArtifactLinkRow[]

      return JSON.stringify({
        team_id: args.team_id,
        total: rows.length,
        artifact_links: rows.map(artifactResponse),
      })
    },
  })

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
    event: async ({ event }) => {
      if (event.type === "message.updated") {
        const info = (event.properties as any)?.info as AssistantMessageRecord | undefined
        if (!info?.sessionID || info.role !== "assistant" || !info.time?.completed) return

        const delegation = db.query(`SELECT id FROM delegations WHERE child_session_id = $child_session_id`).get({
          $child_session_id: info.sessionID,
        }) as { id: string } | null

        if (delegation) {
          await syncDelegationChildSession(delegation.id)
        }
      }

      if (event.type === "session.error") {
        const sessionID = (event.properties as any)?.sessionID as string | undefined
        const errorMessage = (event.properties as any)?.error?.data?.message as string | undefined
        if (!sessionID) return

        const delegation = db.query(`SELECT * FROM delegations WHERE child_session_id = $child_session_id`).get({
          $child_session_id: sessionID,
        }) as DelegationRow | null

        if (!delegation || delegation.status === "failed" || delegation.status === "completed") return
        if (delegation.status !== "failed") {
          assertDelegationTransition(delegation.status, "failed")
        }
        updateDelegationExecution({
          delegation_id: delegation.id,
          next_status: "failed",
          launch_error: errorMessage ?? "Child session reported an execution error",
        })
        maybeTouchRegisteredAgent(delegation.team_id, delegation.target_agent, { status: "recovering" })
        logEvent.run({
          $id: randomUUID(),
          $team_id: delegation.team_id,
          $entity_type: "delegation",
          $entity_id: delegation.id,
          $event_type: "delegation.session_error",
          $payload_json: JSON.stringify({ child_session_id: sessionID, error: errorMessage ?? null }),
          $created_at: nowIso(),
        })
      }
    },
    tool: {
      team_start: createTeam,
      team_set_status: setTeamStatus,
      team_status: teamStatus,
      team_agent_register: agentRegister,
      team_agent_heartbeat: agentHeartbeat,
      team_agent_list: agentList,
      team_task_create: taskCreate,
      team_task_list: taskList,
      team_task_claim: taskClaim,
      team_task_release: taskRelease,
      team_task_block: taskBlock,
      team_task_unblock: taskUnblock,
      team_task_complete: taskComplete,
      team_delegation_create: delegationCreate,
      team_delegation_transition: delegationTransition,
      team_delegation_launch: delegationLaunch,
      team_delegation_sync: delegationSync,
      team_mailbox_send: mailboxSend,
      team_mailbox_list: mailboxList,
      team_mailbox_transition: mailboxTransition,
      team_checkpoint_create: checkpointCreate,
      team_checkpoint_latest: checkpointLatest,
      team_recovery_inspect: recoveryInspect,
      team_recovery_requeue_stale_claims: recoveryRequeueStaleClaims,
      team_git_work_item_upsert: gitWorkItemUpsert,
      team_git_work_item_list: gitWorkItemList,
      team_git_work_item_validate: gitWorkItemValidate,
      team_artifact_link_create: artifactLinkCreate,
      team_artifact_link_list: artifactLinkList,
    },
  }
}

export default AgentTeamsRuntime
