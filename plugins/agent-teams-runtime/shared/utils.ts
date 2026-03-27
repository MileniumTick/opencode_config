import { createHash } from "node:crypto"

import type { AgentRow, ArtifactLinkRow, TeamRow } from "./types"

export function nowIso() {
  return new Date().toISOString()
}

export function isoFromEpoch(value?: number) {
  return typeof value === "number" ? new Date(value).toISOString() : null
}

export function projectKey(directory: string) {
  return createHash("sha256").update(directory).digest("hex").slice(0, 16)
}

export function baseBranchFor(branchName?: string | null) {
  if (branchName?.startsWith("hotfix/")) return "main"
  return "development"
}

export function parseCapabilities(input?: string | null) {
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

export function capabilitiesIntersect(expected: string[], actual: string[]) {
  if (!expected.length) return true
  const set = new Set(actual.map((item) => item.toLowerCase()))
  return expected.some((item) => set.has(item.toLowerCase()))
}

export function parseMetadataJson(input?: string | null) {
  if (!input) return null

  try {
    return JSON.parse(input)
  } catch {
    return { raw: input }
  }
}

export function truncateText(value: string, max = 4000) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 3)}...`
}

export function parseIdList(input: string) {
  return [...new Set(
    input
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )]
}

export function extractText(parts: Array<{ type: string; text?: string }>) {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

export function rowToTeamStatus(
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

export function agentResponse(row: AgentRow) {
  return {
    ...row,
    capabilities: parseCapabilities(row.capabilities_json),
  }
}

export function artifactResponse(row: ArtifactLinkRow) {
  return {
    ...row,
    metadata: parseMetadataJson(row.metadata_json),
  }
}
