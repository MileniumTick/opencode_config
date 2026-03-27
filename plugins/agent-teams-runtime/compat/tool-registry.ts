const CANONICAL_TOOL_ORDER = [
  "team_start",
  "team_set_status",
  "team_status",
  "team_agent_register",
  "team_agent_heartbeat",
  "team_agent_list",
  "team_task_create",
  "team_task_list",
  "team_task_claim",
  "team_task_release",
  "team_task_block",
  "team_task_unblock",
  "team_task_complete",
  "team_delegation_create",
  "team_delegation_transition",
  "team_delegation_launch",
  "team_delegation_sync",
  "team_mailbox_send",
  "team_mailbox_list",
  "team_mailbox_transition",
  "team_checkpoint_create",
  "team_checkpoint_latest",
  "team_recovery_inspect",
  "team_recovery_requeue_stale_claims",
  "team_recovery_resolve_delegations",
  "team_recovery_reassign_delegation",
  "team_recovery_resolve_mailbox",
  "team_git_work_item_upsert",
  "team_git_work_item_list",
  "team_git_work_item_validate",
  "team_artifact_link_create",
  "team_artifact_link_list",
] as const

export function createToolRegistry(toolsByName: Record<string, unknown>) {
  const missing = CANONICAL_TOOL_ORDER.filter((name) => !(name in toolsByName))
  if (missing.length > 0) {
    throw new Error(`Missing runtime tools: ${missing.join(", ")}`)
  }

  const registry: Record<string, unknown> = {}
  for (const name of CANONICAL_TOOL_ORDER) {
    registry[name] = toolsByName[name]
  }
  return registry
}

export function canonicalToolNames() {
  return [...CANONICAL_TOOL_ORDER]
}
