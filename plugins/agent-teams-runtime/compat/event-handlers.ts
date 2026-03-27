import { assertDelegationTransition } from "../shared/constants"
import { runtimeEvent } from "../shared/events"
import type { AssistantMessageRecord, DelegationRow, RuntimeContext } from "../shared/types"

type EventDeps = {
  syncDelegationChildSession: (delegationId: string) => Promise<unknown>
  updateDelegationExecution: (args: {
    delegation_id: string
    next_status?: string
    launch_error?: string | null
  }) => void
}

export function createRuntimeEventHandler(ctx: RuntimeContext, deps: EventDeps) {
  return async ({ event }: { event: any }) => {
    const { db, guards } = ctx

    if (event.type === "message.updated") {
      const info = (event.properties as any)?.info as AssistantMessageRecord | undefined
      if (!info?.sessionID || info.role !== "assistant" || !info.time?.completed) return

      const delegation = db.query(`SELECT id FROM delegations WHERE child_session_id = $child_session_id`).get({
        $child_session_id: info.sessionID,
      }) as { id: string } | null

      if (delegation) {
        await deps.syncDelegationChildSession(delegation.id)
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

      deps.updateDelegationExecution({
        delegation_id: delegation.id,
        next_status: "failed",
        launch_error: errorMessage ?? "Child session reported an execution error",
      })
      guards.maybeTouchRegisteredAgent(delegation.team_id, delegation.target_agent, { status: "recovering" })
      runtimeEvent(ctx, {
        team_id: delegation.team_id,
        entity_type: "delegation",
        entity_id: delegation.id,
        event_type: "delegation.session_error",
        payload: { child_session_id: sessionID, error: errorMessage ?? null },
      })
    }
  }
}
