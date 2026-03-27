import { randomUUID } from "node:crypto"

import { tool } from "@opencode-ai/plugin"

import { runtimeEvent } from "../shared/events"
import type { RuntimeContext } from "../shared/types"
import { baseBranchFor, nowIso } from "../shared/utils"
import { safeGit } from "../shared/db"

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

export function createGitWorkItemsDomain(ctx: RuntimeContext) {
  const { db, guards, directory } = ctx

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
      guards.requireTeam(args.team_id)
      guards.requireTask(args.team_id, args.task_id)

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

      runtimeEvent(ctx, {
        team_id: args.team_id,
        entity_type: "git_work_item",
        entity_id: row.id,
        event_type: existing ? "git_work_item.updated" : "git_work_item.created",
        payload: {
          task_id: args.task_id,
          branch_name: args.branch_name,
          base_branch: baseBranch,
          pr_target_branch: prTargetBranch,
          commit_batching_mode: args.commit_batching_mode,
          status: args.status,
          pr_number: args.pr_number ?? null,
          pr_url: args.pr_url ?? null,
        },
        created_at: updatedAt,
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
      guards.requireTeam(args.team_id)
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

  return {
    tools: {
      team_git_work_item_upsert: gitWorkItemUpsert,
      team_git_work_item_list: gitWorkItemList,
      team_git_work_item_validate: gitWorkItemValidate,
    },
  }
}
