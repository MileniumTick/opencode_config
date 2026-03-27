export const ACTIVE_TASK_STATUSES = new Set(["todo", "ready", "in_progress", "blocked", "review"])
export const CLAIMABLE_TASK_STATUSES = new Set(["todo", "ready"])
export const TERMINAL_TASK_STATUSES = new Set(["done", "failed"])
export const TEAM_STATUSES = new Set(["active", "paused", "recovering", "archived"])

export const DELEGATION_TRANSITIONS = new Map<string, Set<string>>([
  ["requested", new Set(["accepted", "running", "cancelled", "failed", "timed_out"])],
  ["accepted", new Set(["running", "cancelled", "failed", "timed_out"])],
  ["running", new Set(["completed", "cancelled", "failed", "timed_out"])],
  ["completed", new Set()],
  ["cancelled", new Set()],
  ["failed", new Set()],
  ["timed_out", new Set()],
])

export const TASK_TRANSITIONS = new Map<string, Set<string>>([
  ["todo", new Set(["ready", "blocked"])],
  ["ready", new Set(["in_progress", "blocked", "failed"])],
  ["in_progress", new Set(["review", "blocked", "ready", "failed", "done"])],
  ["blocked", new Set(["ready", "in_progress", "failed"])],
  ["review", new Set(["in_progress", "done", "failed"])],
  ["done", new Set([])],
  ["failed", new Set([])],
])

export function assertTaskTransition(from: string, to: string) {
  const allowed = TASK_TRANSITIONS.get(from)
  if (!allowed || !allowed.has(to)) {
    throw new Error(`Invalid task transition: ${from} -> ${to}`)
  }
}

export function assertDelegationTransition(from: string, to: string) {
  const allowed = DELEGATION_TRANSITIONS.get(from)
  if (!allowed || !allowed.has(to)) {
    throw new Error(`Invalid delegation transition: ${from} -> ${to}`)
  }
}
