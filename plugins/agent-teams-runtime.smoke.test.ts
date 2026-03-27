import { describe, expect, it } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"

import AgentTeamsRuntime from "./agent-teams-runtime"
import { assertTaskTransition, TASK_TRANSITIONS } from "./agent-teams-runtime/shared/constants"

function toolExec(pluginResult: any, toolName: string, args: any, context?: any) {
  const t = pluginResult.tool[toolName]
  if (!t || typeof t.execute !== "function") {
    throw new Error(`Tool ${toolName} not found`)
  }
  return t.execute(args, context)
}

function createMockClient() {
  const messagesBySession = new Map<string, any[]>()

  return {
    app: {
      log: async () => ({ data: {} }),
      agents: async () => ({ data: [{ id: "agent-beta", name: "agent-beta" }] }),
    },
    session: {
      create: async ({ body }: any) => ({ data: { id: `session-${Math.random().toString(36).slice(2)}`, parentID: body?.parentID ?? null, title: body?.title ?? "" } }),
      promptAsync: async ({ path }: any) => {
        messagesBySession.set(path.id, [
          {
            info: {
              id: `message-${Math.random().toString(36).slice(2)}`,
              sessionID: path.id,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
            },
            parts: [{ type: "text", text: "Delegation finished successfully" }],
          },
        ])
        return { data: {} }
      },
      messages: async ({ path }: any) => ({ data: messagesBySession.get(path.id) ?? [] }),
    },
  }
}

function createPoolAwareMockClient() {
  const messagesBySession = new Map<string, any[]>()

  return {
    app: {
      log: async () => ({ data: {} }),
      agents: async () => ({
        data: [
          { id: "backend-dev", name: "backend-dev" },
          { id: "frontend-dev", name: "frontend-dev" },
          { id: "sdd-apply", name: "sdd-apply" },
        ],
      }),
    },
    session: {
      create: async ({ body }: any) => ({ data: { id: `session-${Math.random().toString(36).slice(2)}`, parentID: body?.parentID ?? null, title: body?.title ?? "" } }),
      promptAsync: async ({ path }: any) => {
        messagesBySession.set(path.id, [
          {
            info: {
              id: `message-${Math.random().toString(36).slice(2)}`,
              sessionID: path.id,
              role: "assistant",
              time: { created: Date.now(), completed: Date.now() },
            },
            parts: [{ type: "text", text: "Delegation finished successfully" }],
          },
        ])
        return { data: {} }
      },
      messages: async ({ path }: any) => ({ data: messagesBySession.get(path.id) ?? [] }),
    },
  }
}

async function createRuntimeWithFallbackPolicy(policy: "disabled" | "pool") {
  const directory = `/tmp/opencode-runtime-smoke-${Date.now()}-policy-${policy}-${Math.random().toString(36).slice(2)}`
  await mkdir(`${directory}/agents`, { recursive: true })
  await writeFile(`${directory}/opencode.json`, JSON.stringify({
    agent: {
      "backend-dev": {},
      "frontend-dev": {},
      "sdd-apply": {},
    },
  }, null, 2))
  await writeFile(`${directory}/agents/runtime-config.json`, JSON.stringify({
    version: 1,
    worker_pool_file: "./agents/runtime-worker-pool.json",
    selection_strategy: "least-busy",
    delegation_launch: {
      fallback_reassign: policy,
    },
  }, null, 2))
  await writeFile(`${directory}/agents/runtime-worker-pool.json`, JSON.stringify({
    version: 1,
    selection_strategy: "least-busy",
    workers: [
      {
        agent_name: "backend-dev",
        role: "worker",
        capabilities: ["backend", "runtime", "delegation"],
      },
      {
        agent_name: "frontend-dev",
        role: "worker",
        capabilities: ["frontend", "testing", "delegation"],
      },
      {
        agent_name: "sdd-apply",
        role: "worker",
        capabilities: ["implementation", "delegation"],
      },
    ],
  }, null, 2))

  const client = createPoolAwareMockClient()
  const runtime = await AgentTeamsRuntime({ client, directory } as any)
  return { runtime, directory }
}

describe("agent teams runtime modularized smoke", () => {
  it("keeps canonical team_* tools and task claim/release/complete flow", async () => {
    const client = createMockClient()
    const runtime = await AgentTeamsRuntime({ client, directory: `/tmp/opencode-runtime-smoke-${Date.now()}-a` } as any)

    const toolNames = Object.keys(runtime.tool).sort()
    expect(toolNames.length).toBe(32)
    expect(toolNames).toContain("team_task_claim")
    expect(toolNames).toContain("team_delegation_launch")
    expect(toolNames).toContain("team_mailbox_transition")

    const team = JSON.parse(await toolExec(runtime, "team_start", { name: "smoke", goal: "verify" }))
    const task = JSON.parse(await toolExec(runtime, "team_task_create", {
      team_id: team.id,
      title: "Task 1",
      description: "Do it",
      priority: "medium",
    }))

    await toolExec(runtime, "team_agent_register", {
      team_id: team.id,
      agent_name: "agent-alpha",
      role: "worker",
      status: "idle",
      capabilities: "runtime,claim",
      lease_minutes: 15,
    })

    const claimed = JSON.parse(await toolExec(runtime, "team_task_claim", { team_id: team.id, task_id: task.id, claimant: "agent-alpha", lease_minutes: 15 }))
    expect(claimed.status).toBe("in_progress")

    const released = JSON.parse(await toolExec(runtime, "team_task_release", { team_id: team.id, task_id: task.id }))
    expect(released.status).toBe("ready")

    await toolExec(runtime, "team_agent_heartbeat", {
      team_id: team.id,
      agent_name: "agent-alpha",
      status: "idle",
      lease_minutes: 15,
    })

    const claimedAgain = JSON.parse(await toolExec(runtime, "team_task_claim", { team_id: team.id, task_id: task.id, claimant: "agent-alpha", lease_minutes: 15 }))
    expect(claimedAgain.status).toBe("in_progress")

    const completed = JSON.parse(await toolExec(runtime, "team_task_complete", { team_id: team.id, task_id: task.id }))
    expect(completed.status).toBe("done")
  })

  it("matches canonical v1 task states/transitions and rejects legacy task statuses", () => {
    const expected = new Map<string, string[]>([
      ["todo", ["blocked", "ready"]],
      ["ready", ["blocked", "failed", "in_progress"]],
      ["in_progress", ["blocked", "done", "failed", "ready", "review"]],
      ["blocked", ["failed", "in_progress", "ready"]],
      ["review", ["done", "failed", "in_progress"]],
      ["done", []],
      ["failed", []],
    ])

    expect([...TASK_TRANSITIONS.keys()]).toEqual([...expected.keys()])
    for (const [state, transitions] of expected.entries()) {
      const observed = [...(TASK_TRANSITIONS.get(state) ?? new Set<string>())].sort()
      expect(observed).toEqual([...transitions].sort())
    }

    expect(() => assertTaskTransition("claimed", "in_progress")).toThrow("Invalid task transition")
    expect(() => assertTaskTransition("review_needed", "review")).toThrow("Invalid task transition")
  })

  it("supports delegation launch/sync and mailbox transitions", async () => {
    const client = createMockClient()
    const runtime = await AgentTeamsRuntime({ client, directory: `/tmp/opencode-runtime-smoke-${Date.now()}-b` } as any)

    const team = JSON.parse(await toolExec(runtime, "team_start", { name: "smoke2", goal: "delegations" }))
    await toolExec(runtime, "team_agent_register", {
      team_id: team.id,
      agent_name: "agent-beta",
      role: "worker",
      status: "idle",
      capabilities: "delegation",
      lease_minutes: 15,
    })
    const task = JSON.parse(await toolExec(runtime, "team_task_create", {
      team_id: team.id,
      title: "Task 2",
      description: "Delegate it",
      priority: "medium",
    }))

    const delegation = JSON.parse(await toolExec(runtime, "team_delegation_create", {
      team_id: team.id,
      task_id: task.id,
      source_agent: "agent-alpha",
      target_agent: "agent-beta",
      prompt: "Please do this",
    }))
    expect(delegation.status).toBe("requested")

    const launched = JSON.parse(await toolExec(runtime, "team_delegation_launch", { delegation_id: delegation.id }, { sessionID: "parent-session" }))
    expect(launched.status).toBe("running")
    expect(typeof launched.child_session_id).toBe("string")

    const synced = JSON.parse(await toolExec(runtime, "team_delegation_sync", { delegation_id: delegation.id }))
    expect(synced.status).toBe("completed")

    const mailbox = JSON.parse(await toolExec(runtime, "team_mailbox_send", {
      team_id: team.id,
      sender_agent: "agent-alpha",
      recipient_agent: "agent-beta",
      subject: "ping",
      body: "pong",
      message_type: "info",
    }))
    expect(mailbox.status).toBe("pending")

    const markedRead = JSON.parse(await toolExec(runtime, "team_mailbox_transition", { message_id: mailbox.id, next_status: "read" }))
    expect(markedRead.status).toBe("read")

    const markedResolved = JSON.parse(await toolExec(runtime, "team_mailbox_transition", { message_id: mailbox.id, next_status: "resolved" }))
    expect(markedResolved.status).toBe("resolved")
  })

  it("preflight passes and launches using a valid configured pool agent", async () => {
    const client = createPoolAwareMockClient()
    const runtime = await AgentTeamsRuntime({ client, directory: "/home/josue/.config/opencode" } as any)

    const team = JSON.parse(await toolExec(runtime, "team_start", { name: "preflight-ok", goal: "delegation launch" }))
    await toolExec(runtime, "team_agent_register", {
      team_id: team.id,
      agent_name: "backend-dev",
      role: "worker",
      status: "idle",
      capabilities: "backend,runtime,delegation",
      lease_minutes: 15,
    })

    const task = JSON.parse(await toolExec(runtime, "team_task_create", {
      team_id: team.id,
      title: "Valid preflight task",
      description: "Run with valid pool agent",
      priority: "medium",
    }))

    const delegation = JSON.parse(await toolExec(runtime, "team_delegation_create", {
      team_id: team.id,
      task_id: task.id,
      source_agent: "sdd-orchestrator",
      target_agent: "backend-dev",
      prompt: "Please execute this. capabilities: backend,runtime",
    }))

    const launched = JSON.parse(await toolExec(runtime, "team_delegation_launch", { delegation_id: delegation.id }, { sessionID: "parent-preflight" }))
    expect(launched.status).toBe("running")
    expect(launched.target_agent).toBe("backend-dev")
  })

  it("automatically falls back to another pool worker when target fails preflight", async () => {
    const client = createPoolAwareMockClient()
    const runtime = await AgentTeamsRuntime({ client, directory: "/home/josue/.config/opencode" } as any)

    const team = JSON.parse(await toolExec(runtime, "team_start", { name: "preflight-fallback", goal: "delegation fallback" }))
    await toolExec(runtime, "team_agent_register", {
      team_id: team.id,
      agent_name: "backend-dev",
      role: "worker",
      status: "busy",
      capabilities: "backend,runtime,delegation",
      lease_minutes: 15,
    })
    await toolExec(runtime, "team_agent_register", {
      team_id: team.id,
      agent_name: "sdd-apply",
      role: "worker",
      status: "idle",
      capabilities: "implementation,delegation",
      lease_minutes: 15,
    })

    const task = JSON.parse(await toolExec(runtime, "team_task_create", {
      team_id: team.id,
      title: "Fallback preflight task",
      description: "Fallback when target is busy",
      priority: "medium",
    }))

    const delegation = JSON.parse(await toolExec(runtime, "team_delegation_create", {
      team_id: team.id,
      task_id: task.id,
      source_agent: "sdd-orchestrator",
      target_agent: "backend-dev",
      prompt: "Please execute this. capabilities: delegation",
    }))

    const launched = JSON.parse(await toolExec(runtime, "team_delegation_launch", { delegation_id: delegation.id }, { sessionID: "parent-fallback" }))
    expect(launched.status).toBe("running")
    expect(launched.target_agent).toBe("sdd-apply")

    const mailbox = JSON.parse(await toolExec(runtime, "team_mailbox_list", {
      team_id: team.id,
      recipient_agent: "sdd-orchestrator",
    }))
    expect(mailbox.total).toBeGreaterThan(0)
    expect(mailbox.messages.some((msg: any) => msg.subject.includes("fallback applied"))).toBe(true)
  })

  it("returns clear failed result when no fallback candidates are available", async () => {
    const client = createPoolAwareMockClient()
    const runtime = await AgentTeamsRuntime({ client, directory: "/home/josue/.config/opencode" } as any)

    const team = JSON.parse(await toolExec(runtime, "team_start", { name: "preflight-no-candidate", goal: "no fallback" }))
    await toolExec(runtime, "team_agent_register", {
      team_id: team.id,
      agent_name: "backend-dev",
      role: "worker",
      status: "busy",
      capabilities: "backend,runtime,delegation",
      lease_minutes: 15,
    })

    const task = JSON.parse(await toolExec(runtime, "team_task_create", {
      team_id: team.id,
      title: "No candidate task",
      description: "No fallback candidate available",
      priority: "medium",
    }))

    const delegation = JSON.parse(await toolExec(runtime, "team_delegation_create", {
      team_id: team.id,
      task_id: task.id,
      source_agent: "sdd-orchestrator",
      target_agent: "backend-dev",
      prompt: "Please execute this. capabilities: backend",
    }))

    await expect(
      toolExec(runtime, "team_delegation_launch", { delegation_id: delegation.id }, { sessionID: "parent-no-candidate" }),
    ).rejects.toThrow("launch preflight failed")

    const inspected = JSON.parse(await toolExec(runtime, "team_status", { team_id: team.id }))
    expect(inspected.open_delegations).toBe(0)
  })

  it("fails fast without reassignment when fallback policy is disabled", async () => {
    const { runtime } = await createRuntimeWithFallbackPolicy("disabled")

    const team = JSON.parse(await toolExec(runtime, "team_start", { name: "preflight-policy-disabled", goal: "no fallback reassign" }))
    await toolExec(runtime, "team_agent_register", {
      team_id: team.id,
      agent_name: "backend-dev",
      role: "worker",
      status: "busy",
      capabilities: "backend,runtime,delegation",
      lease_minutes: 15,
    })

    const task = JSON.parse(await toolExec(runtime, "team_task_create", {
      team_id: team.id,
      title: "Policy disabled task",
      description: "Do not reassign on preflight failure",
      priority: "medium",
    }))

    const delegation = JSON.parse(await toolExec(runtime, "team_delegation_create", {
      team_id: team.id,
      task_id: task.id,
      source_agent: "sdd-orchestrator",
      target_agent: "backend-dev",
      prompt: "Please execute this. capabilities: backend",
    }))

    await expect(
      toolExec(runtime, "team_delegation_launch", { delegation_id: delegation.id }, { sessionID: "parent-policy-disabled" }),
    ).rejects.toThrow("Fallback policy is disabled")

    const mailbox = JSON.parse(await toolExec(runtime, "team_mailbox_list", {
      team_id: team.id,
      recipient_agent: "sdd-orchestrator",
    }))
    expect(mailbox.messages.some((msg: any) => msg.subject.includes("fallback applied"))).toBe(false)

    const inspection = JSON.parse(await toolExec(runtime, "team_recovery_inspect", { team_id: team.id }))
    expect(inspection.open_delegations.some((row: any) => row.id === delegation.id)).toBe(false)
  })

  it("enforces registered/operational claimant and capabilities on team_task_claim", async () => {
    const client = createMockClient()
    const runtime = await AgentTeamsRuntime({ client, directory: `/tmp/opencode-runtime-smoke-${Date.now()}-claim-enforcement` } as any)

    const team = JSON.parse(await toolExec(runtime, "team_start", { name: "claim-enforcement", goal: "hardening" }))

    const task = JSON.parse(await toolExec(runtime, "team_task_create", {
      team_id: team.id,
      title: "Capability task",
      description: "Do claim. capabilities: runtime,backend",
      priority: "medium",
    }))

    await expect(toolExec(runtime, "team_task_claim", {
      team_id: team.id,
      task_id: task.id,
      claimant: "unknown-agent",
      lease_minutes: 15,
    })).rejects.toThrow("is not registered in team")

    await toolExec(runtime, "team_agent_register", {
      team_id: team.id,
      agent_name: "agent-stale",
      role: "worker",
      status: "idle",
      capabilities: "runtime,backend",
      lease_minutes: -1,
    })
    await expect(toolExec(runtime, "team_task_claim", {
      team_id: team.id,
      task_id: task.id,
      claimant: "agent-stale",
      lease_minutes: 15,
    })).rejects.toThrow("lease expired")

    await toolExec(runtime, "team_agent_register", {
      team_id: team.id,
      agent_name: "agent-offline",
      role: "worker",
      status: "offline",
      capabilities: "runtime,backend",
      lease_minutes: 15,
    })
    await expect(toolExec(runtime, "team_task_claim", {
      team_id: team.id,
      task_id: task.id,
      claimant: "agent-offline",
      lease_minutes: 15,
    })).rejects.toThrow("non-operational status")

    await toolExec(runtime, "team_agent_register", {
      team_id: team.id,
      agent_name: "agent-no-cap",
      role: "worker",
      status: "idle",
      capabilities: "frontend,testing",
      lease_minutes: 15,
    })
    await expect(toolExec(runtime, "team_task_claim", {
      team_id: team.id,
      task_id: task.id,
      claimant: "agent-no-cap",
      lease_minutes: 15,
    })).rejects.toThrow("lacks required capabilities")

    await toolExec(runtime, "team_agent_register", {
      team_id: team.id,
      agent_name: "agent-ok",
      role: "worker",
      status: "idle",
      capabilities: "runtime,backend",
      lease_minutes: 15,
    })

    const claim = JSON.parse(await toolExec(runtime, "team_task_claim", {
      team_id: team.id,
      task_id: task.id,
      claimant: "agent-ok",
      lease_minutes: 15,
    }))
    expect(claim.status).toBe("in_progress")
    expect(claim.claimed_by).toBe("agent-ok")
  })

  it("recovers stale lease/open delegation/mailbox across runtime restart", async () => {
    const directory = `/tmp/opencode-runtime-smoke-${Date.now()}-recovery-restart`
    const client = createPoolAwareMockClient()
    const runtimeA = await AgentTeamsRuntime({ client, directory } as any)

    const team = JSON.parse(await toolExec(runtimeA, "team_start", { name: "recovery-e2e", goal: "restart recovery" }))
    await toolExec(runtimeA, "team_agent_register", {
      team_id: team.id,
      agent_name: "backend-dev",
      role: "worker",
      status: "idle",
      capabilities: "backend,runtime,delegation",
      lease_minutes: 15,
    })

    const staleTask = JSON.parse(await toolExec(runtimeA, "team_task_create", {
      team_id: team.id,
      title: "Stale claim task",
      description: "Should be requeued",
      priority: "high",
    }))

    await toolExec(runtimeA, "team_task_claim", {
      team_id: team.id,
      task_id: staleTask.id,
      claimant: "backend-dev",
      lease_minutes: -1,
    })

    const delegation = JSON.parse(await toolExec(runtimeA, "team_delegation_create", {
      team_id: team.id,
      task_id: staleTask.id,
      source_agent: "backend-dev",
      target_agent: "frontend-dev",
      prompt: "recover me later",
    }))

    const runtimeB = await AgentTeamsRuntime({ client, directory } as any)
    const inspection = JSON.parse(await toolExec(runtimeB, "team_recovery_inspect", { team_id: team.id }))

    expect(inspection.stale_claims.some((row: any) => row.id === staleTask.id)).toBe(true)
    expect(inspection.open_delegations.some((row: any) => row.id === delegation.id)).toBe(true)
    expect(inspection.unresolved_mailbox.some((row: any) => row.delegation_id === delegation.id)).toBe(true)

    const requeue = JSON.parse(await toolExec(runtimeB, "team_recovery_requeue_stale_claims", {
      team_id: team.id,
      stale_agent_status: "recovering",
      note: "restart recovery",
    }))
    expect(requeue.requeued_task_ids).toContain(staleTask.id)

    const resolvedDelegations = JSON.parse(await toolExec(runtimeB, "team_recovery_resolve_delegations", {
      team_id: team.id,
      delegation_ids: delegation.id,
      next_status: "timed_out",
      target_agent_status: "recovering",
      note: "restart recovery",
    }))
    expect(resolvedDelegations.resolved[0]?.status).toBe("timed_out")

    const messageIds = inspection.unresolved_mailbox
      .filter((row: any) => row.delegation_id === delegation.id)
      .map((row: any) => row.id)
    const resolvedMailbox = JSON.parse(await toolExec(runtimeB, "team_recovery_resolve_mailbox", {
      team_id: team.id,
      message_ids: messageIds.join(","),
      note: "restart recovery",
    }))
    expect(resolvedMailbox.resolved.length).toBeGreaterThan(0)

    const finalTasks = JSON.parse(await toolExec(runtimeB, "team_task_list", { team_id: team.id }))
    const finalStaleTask = finalTasks.tasks.find((row: any) => row.id === staleTask.id)
    expect(finalStaleTask.status).toBe("ready")
    expect(finalStaleTask.claimed_by).toBeNull()
  })

  it("uses round-robin fallback when configured", async () => {
    const previous = process.env.AGENT_TEAMS_RUNTIME_SELECTION_STRATEGY
    process.env.AGENT_TEAMS_RUNTIME_SELECTION_STRATEGY = "round-robin"

    try {
      const client = createPoolAwareMockClient()
      const runtime = await AgentTeamsRuntime({ client, directory: "/home/josue/.config/opencode" } as any)

      const team = JSON.parse(await toolExec(runtime, "team_start", { name: "rr-fallback", goal: "rr" }))
      await toolExec(runtime, "team_agent_register", {
        team_id: team.id,
        agent_name: "backend-dev",
        role: "worker",
        status: "idle",
        capabilities: "backend,runtime,delegation",
        lease_minutes: -1,
      })
      await toolExec(runtime, "team_agent_register", {
        team_id: team.id,
        agent_name: "frontend-dev",
        role: "worker",
        status: "idle",
        capabilities: "frontend,testing,delegation",
        lease_minutes: 15,
      })
      await toolExec(runtime, "team_agent_register", {
        team_id: team.id,
        agent_name: "sdd-apply",
        role: "worker",
        status: "idle",
        capabilities: "implementation,delegation",
        lease_minutes: 15,
      })

      const task1 = JSON.parse(await toolExec(runtime, "team_task_create", {
        team_id: team.id,
        title: "rr task 1",
        description: "delegation",
        priority: "medium",
      }))

      const delegation1 = JSON.parse(await toolExec(runtime, "team_delegation_create", {
        team_id: team.id,
        task_id: task1.id,
        source_agent: "sdd-orchestrator",
        target_agent: "backend-dev",
        prompt: "capabilities: delegation",
      }))
      const launch1 = JSON.parse(await toolExec(runtime, "team_delegation_launch", { delegation_id: delegation1.id }, { sessionID: "rr-parent-1" }))

      const task2 = JSON.parse(await toolExec(runtime, "team_task_create", {
        team_id: team.id,
        title: "rr task 2",
        description: "delegation",
        priority: "medium",
      }))

      const delegation2 = JSON.parse(await toolExec(runtime, "team_delegation_create", {
        team_id: team.id,
        task_id: task2.id,
        source_agent: "sdd-orchestrator",
        target_agent: "backend-dev",
        prompt: "capabilities: delegation",
      }))
      const launch2 = JSON.parse(await toolExec(runtime, "team_delegation_launch", { delegation_id: delegation2.id }, { sessionID: "rr-parent-2" }))

      expect(["frontend-dev", "sdd-apply"]).toContain(launch1.target_agent)
      expect(["frontend-dev", "sdd-apply"]).toContain(launch2.target_agent)
      expect(launch1.target_agent).not.toBe(launch2.target_agent)
    } finally {
      if (previous === undefined) {
        delete process.env.AGENT_TEAMS_RUNTIME_SELECTION_STRATEGY
      } else {
        process.env.AGENT_TEAMS_RUNTIME_SELECTION_STRATEGY = previous
      }
    }
  })
})
