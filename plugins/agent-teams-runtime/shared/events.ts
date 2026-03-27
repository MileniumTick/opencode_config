import { randomUUID } from "node:crypto"

import type { RuntimeContext } from "./types"
import { nowIso } from "./utils"

export function runtimeEvent(
  ctx: RuntimeContext,
  args: {
    team_id: string
    entity_type: string
    entity_id: string
    event_type: string
    payload: unknown
    created_at?: string
  },
) {
  ctx.logEvent.run({
    $id: randomUUID(),
    $team_id: args.team_id,
    $entity_type: args.entity_type,
    $entity_id: args.entity_id,
    $event_type: args.event_type,
    $payload_json: JSON.stringify(args.payload),
    $created_at: args.created_at ?? nowIso(),
  })
}
