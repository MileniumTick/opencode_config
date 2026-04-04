/// <reference types="node" />

import { mkdir, readFile, writeFile } from "node:fs/promises"
import type { Plugin } from "@opencode-ai/plugin"
import { exec as execCallback } from "node:child_process"
import { join, resolve } from "node:path"
import { promisify } from "node:util"

const exec = promisify(execCallback)

const AUTO_COMMIT_MIN_INTERVAL_MS = 10 * 60 * 1000
const AUTO_COMMIT_STATE_DIR = join(process.env.HOME || "", ".config", "opencode", "logs")
const AUTO_COMMIT_STATE_FILE = join(AUTO_COMMIT_STATE_DIR, "auto-commit-state.json")
const AUTO_COMMIT_MESSAGE = "chore: auto-save verified session changes"
const DOCS_PREFIX = "docs/ai-work/"

type ExecResult = {
  ok: boolean
  stdout: string
}

const runGit = async (cwd: string, args: string): Promise<ExecResult> => {
  try {
    const { stdout } = await exec(`git ${args}`, {
      cwd,
      maxBuffer: 1024 * 1024,
    })

    return { ok: true, stdout: stdout.trim() }
  } catch (error) {
    const stdout =
      error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string"
        ? error.stdout.trim()
        : ""

    return { ok: false, stdout }
  }
}

const readState = async (): Promise<Record<string, number>> => {
  try {
    const raw = await readFile(AUTO_COMMIT_STATE_FILE, "utf8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}

    const state: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key !== "string") continue
      if (typeof value !== "number" || !Number.isFinite(value)) continue
      state[key] = value
    }

    return state
  } catch {
    return {}
  }
}

const writeState = async (state: Record<string, number>): Promise<void> => {
  try {
    await mkdir(AUTO_COMMIT_STATE_DIR, { recursive: true })
    await writeFile(AUTO_COMMIT_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8")
  } catch {
    // Silent by design.
  }
}

const listChangedFiles = async (cwd: string): Promise<string[]> => {
  const [staged, unstaged, untracked] = await Promise.all([
    runGit(cwd, "diff --name-only --cached --relative"),
    runGit(cwd, "diff --name-only --relative"),
    runGit(cwd, "ls-files --others --exclude-standard"),
  ])

  const files = new Set<string>()

  for (const result of [staged, unstaged, untracked]) {
    for (const line of result.stdout.split("\n")) {
      const file = line.trim()
      if (file) files.add(file)
    }
  }

  return [...files]
}

const isDocsOnlyChange = (file: string): boolean => file.startsWith(DOCS_PREFIX)

export const AutoCommitPlugin: Plugin = async () => {
  const projectHint = resolve(process.env.OPENCODE_WORKTREE || process.cwd())

  return {
    event: async ({ event }) => {
      try {
        if (event.type !== "session.idle") return

        const hintedCwd = resolve(projectHint)
        const insideWorktree = await runGit(hintedCwd, "rev-parse --is-inside-work-tree")
        if (!insideWorktree.ok || insideWorktree.stdout !== "true") return

        const repoRootResult = await runGit(hintedCwd, "rev-parse --show-toplevel")
        const repoRoot = repoRootResult.ok ? repoRootResult.stdout : ""
        if (!repoRoot) return

        const now = Date.now()
        const state = await readState()
        const lastRun = state[repoRoot] || 0
        if (now - lastRun < AUTO_COMMIT_MIN_INTERVAL_MS) return

        const [userName, userEmail, statusResult, lastCommitResult, changedFiles] = await Promise.all([
          runGit(repoRoot, "config user.name"),
          runGit(repoRoot, "config user.email"),
          runGit(repoRoot, "status --porcelain --untracked-files=all"),
          runGit(repoRoot, "log -1 --pretty=%s"),
          listChangedFiles(repoRoot),
        ])

        if (!userName.ok || !userName.stdout || !userEmail.ok || !userEmail.stdout) return
        if (!statusResult.ok || !statusResult.stdout) return
        if (changedFiles.length === 0) return

        const hasNonDocsChanges = changedFiles.some((file) => !isDocsOnlyChange(file))
        const lastCommitMessage = lastCommitResult.ok ? lastCommitResult.stdout.toLowerCase() : ""

        if (lastCommitMessage.startsWith("wip:") && !hasNonDocsChanges) return
        if (!hasNonDocsChanges) return

        await runGit(repoRoot, "add -A")
        const commitResult = await runGit(
          repoRoot,
          `commit -m ${JSON.stringify(AUTO_COMMIT_MESSAGE)}`,
        )

        if (!commitResult.ok) return

        state[repoRoot] = now
        await writeState(state)
      } catch {
        // Silent by design: plugin must never throw hard errors.
      }
    },
  }
}
