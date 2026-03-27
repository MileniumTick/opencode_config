import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

import { Database } from "bun:sqlite"

import { nowIso, projectKey } from "./utils"

export function initRuntimeDb(directory: string) {
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

  return { db, dbPath, logEvent }
}

export function safeGit(directory: string, args: string[]) {
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
