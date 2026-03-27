import type { Database } from "bun:sqlite"

export type TeamRow = {
  id: string
  name: string
  goal: string
  status: string
  branch_name: string | null
  pr_target_branch: string | null
  created_at: string
  updated_at: string
}

export type AgentRow = {
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

export type TaskRow = {
  id: string
  team_id: string
  title: string
  description: string
  priority: string
  status: string
  claimed_by: string | null
  claim_lease_expires_at: string | null
  block_reason: string | null
  depends_on_task_id: string | null
  created_at: string
  updated_at: string
}

export type DelegationRow = {
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

export type MailboxMessageRow = {
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

export type RecoveryCheckpointRow = {
  id: string
  team_id: string
  checkpoint_type: string
  payload_json: string
  created_at: string
}

export type GitWorkItemRow = {
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

export type ArtifactLinkRow = {
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

export type OpenCodeSessionRecord = {
  id: string
  parentID?: string | null
  title: string
}

export type AssistantMessageRecord = {
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

export type SessionMessageRecord = {
  info: AssistantMessageRecord
  parts: Array<{
    type: string
    text?: string
  }>
}

export type UpdateDelegationExecutionArgs = {
  delegation_id: string
  next_status?: string
  result_summary?: string | null
  child_session_id?: string | null
  child_message_id?: string | null
  child_session_title?: string | null
  launch_error?: string | null
  launched_at?: string | null
  completed_at?: string | null
}

export type RuntimeGuards = {
  requireTeam: (teamId: string) => TeamRow
  requireTask: (teamId: string, taskId: string) => TaskRow
  requireDelegation: (teamId: string, delegationId: string) => DelegationRow
  requireMailboxMessage: (teamId: string, messageId: string) => MailboxMessageRow
  requireEntity: (teamId: string, entityType: string, entityId: string) => void
  maybeTouchRegisteredAgent: (
    teamId: string,
    agentName: string,
    patch: { status?: string; lease_expires_at?: string | null; current_task_id?: string | null },
  ) => AgentRow | null
}

export type RuntimeContext = {
  client: any
  directory: string
  dbPath: string
  db: Database
  logEvent: ReturnType<Database["query"]>
  guards: RuntimeGuards
  agentExists: (agentName: string) => Promise<boolean>
  isAgentConfigured: (agentName: string) => boolean
  workerPool: RuntimeWorkerPool
  delegationLaunchPolicy: RuntimeDelegationLaunchPolicy
}

export type RuntimeWorkerDefinition = {
  agent_name: string
  role: string
  capabilities: string[]
}

export type RuntimeWorkerPool = {
  selection_strategy: "least-busy" | "round-robin"
  workers: RuntimeWorkerDefinition[]
}

export type RuntimeDelegationLaunchPolicy = {
  fallback_reassign: "disabled" | "pool"
}
