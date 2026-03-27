import { randomUUID } from "node:crypto"

import { tool } from "@opencode-ai/plugin"

import { runtimeEvent } from "../shared/events"
import type { RuntimeContext } from "../shared/types"
import { artifactResponse, nowIso } from "../shared/utils"

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

export function createArtifactLinksDomain(ctx: RuntimeContext) {
  const { db, guards } = ctx

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
      guards.requireTeam(args.team_id)
      guards.requireEntity(args.team_id, args.entity_type, args.entity_id)

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

      runtimeEvent(ctx, {
        team_id: args.team_id,
        entity_type: "artifact_link",
        entity_id: id,
        event_type: "artifact_link.created",
        payload: {
          entity_type: args.entity_type,
          entity_id: args.entity_id,
          artifact_system: args.artifact_system,
          artifact_kind: args.artifact_kind,
          reference_id: args.reference_id,
        },
        created_at: createdAt,
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
      guards.requireTeam(args.team_id)

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

  return {
    tools: {
      team_artifact_link_create: artifactLinkCreate,
      team_artifact_link_list: artifactLinkList,
    },
  }
}
