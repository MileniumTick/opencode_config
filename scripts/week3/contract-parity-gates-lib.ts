import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { collectCurrentParity, jsonDiffPaths, type ParitySnapshot, type Severity } from "./contract-parity-lib"

import AgentTeamsRuntime from "../../plugins/agent-teams-runtime"

export type CheckStatus = "PASS" | "FAIL" | "WARN"

export type GateCheck = {
  id: string
  title: string
  severity: Severity
  status: CheckStatus
  drift_count: number
  details: string[]
}

export type GateReport = {
  format_version: 1
  generated_at: string
  baseline_dir: string
  mode: "gates" | "strict"
  checks: GateCheck[]
  coverage?: {
    response_shapes: {
      total_team_tools: number
      covered_tools: number
      coverage_percent: number
      missing_commands: string[]
    }
  }
  observability?: {
    kpis: {
      recovery_ops_success_rate_percent: number
      stale_claim_requeue_coverage_percent: number
      delegation_resolution_rate_percent: number
      mailbox_resolution_rate_percent: number
      stale_claim_requeue_latency_ms: number
      critical_breaches: string[]
    }
    slos: {
      recovery_ops_success_rate_min_percent: number
      stale_claim_requeue_coverage_min_percent: number
      delegation_resolution_rate_min_percent: number
      stale_claim_requeue_latency_max_ms: number
    }
    drill_evidence: {
      generated_at: string
      team_id: string
      stale_task_id: string
      done_task_id: string
      delegation_id: string
      mailbox_message_id: string
      operations: {
        inspect_before: {
          latency_ms: number
          stale_claims: number
          open_delegations: number
          unresolved_mailbox: number
        }
        requeue_stale_claims: {
          latency_ms: number
          requeued_task_ids: string[]
        }
        resolve_delegations: {
          latency_ms: number
          resolved_count: number
          skipped_count: number
        }
        resolve_mailbox: {
          latency_ms: number
          resolved_count: number
          skipped_count: number
        }
      }
      invariants: {
        stale_task_ready_unclaimed: boolean
        done_task_immutable: boolean
      }
      pass: boolean
      issues: string[]
    }
  }
  policy_notes?: string[]
  gate: {
    blocking_severities: Severity[]
    blocking_failures: string[]
    pass: boolean
  }
}

const BASELINE_DIR = join(process.cwd(), "specs", "baselines", "current")

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>
}

export function getWeek3BaselineDir() {
  return BASELINE_DIR
}

export function loadBaseline(rootDir: string) {
  const baselineDir = join(rootDir, "specs", "baselines", "current")
  return {
    baselineDir,
    args: readJson(join(baselineDir, "tool-args-schema.snapshot.json")),
    response: readJson(join(baselineDir, "tool-response-top-level.snapshot.json")),
    ddl: readJson(join(baselineDir, "runtime-ddl-baseline.json")),
    taskStates: readJson(join(baselineDir, "task-state-drift.evidence.json")),
  }
}

function diffDdl(base: Record<string, unknown>, current: Record<string, unknown>) {
  const baseEntries = (base.entries ?? []) as Array<{ type: string; name: string; sql_normalized: string }>
  const currentEntries = (current.entries ?? []) as Array<{ type: string; name: string; sql_normalized: string }>

  const baseByKey = new Map(baseEntries.map((entry) => [`${entry.type}:${entry.name}`, entry]))
  const currentByKey = new Map(currentEntries.map((entry) => [`${entry.type}:${entry.name}`, entry]))

  const added = [...currentByKey.keys()].filter((key) => !baseByKey.has(key)).sort()
  const removed = [...baseByKey.keys()].filter((key) => !currentByKey.has(key)).sort()
  const changed = [...currentByKey.keys()]
    .filter((key) => baseByKey.has(key) && baseByKey.get(key)?.sql_normalized !== currentByKey.get(key)?.sql_normalized)
    .sort()

  return { added, removed, changed, driftCount: added.length + removed.length + changed.length }
}

function summarizeDiff(prefix: string, paths: string[], max = 30) {
  const selected = paths.slice(0, max)
  const result = selected.map((path) => `${prefix} ${path}`)
  if (paths.length > max) {
    result.push(`${prefix} ... and ${paths.length - max} more`)
  }
  return result
}

type RunMode = "gates" | "strict"

type GatePolicy = {
  mode: RunMode
  responseCoverageWarnThreshold: number
  responseCoverageFailThreshold: number
  responseShapeBlockingSeverity: Severity
}

function createGatePolicy(mode: RunMode): GatePolicy {
  if (mode === "strict") {
    return {
      mode,
      responseCoverageWarnThreshold: 100,
      responseCoverageFailThreshold: 100,
      responseShapeBlockingSeverity: "critical",
    }
  }

  return {
    mode,
    responseCoverageWarnThreshold: 90,
    responseCoverageFailThreshold: 80,
    responseShapeBlockingSeverity: "high",
  }
}

function diffResponseShape(
  baselineResponse: Record<string, unknown>,
  currentResponse: Record<string, unknown>,
  mode: RunMode,
) {
  if (mode === "strict") {
    return jsonDiffPaths(baselineResponse, currentResponse)
  }

  const baseCommands = ((baselineResponse.commands ?? {}) as Record<string, unknown>)
  const currentCommands = ((currentResponse.commands ?? {}) as Record<string, unknown>)
  const trackedToolNames = Object.keys(baseCommands).sort()

  const diffPaths: string[] = []
  for (const toolName of trackedToolNames) {
    if (!(toolName in currentCommands)) {
      diffPaths.push(`$.commands.${toolName}:removed`)
      continue
    }

    const baseToolShape = (baseCommands[toolName] ?? {}) as Record<string, unknown>
    const currentToolShape = (currentCommands[toolName] ?? {}) as Record<string, unknown>
    diffPaths.push(...jsonDiffPaths(baseToolShape, currentToolShape, `$.commands.${toolName}`))
  }

  return diffPaths
}

async function recoverySafetyProbe(rootDir: string) {
  const runtime = await AgentTeamsRuntime({
    client: {
      app: {
        log: async () => ({ data: {} }),
        agents: async () => ({ data: [{ id: "agent-beta", name: "agent-beta" }] }),
      },
      session: {
        create: async () => ({ data: { id: "session-probe" } }),
        promptAsync: async () => ({ data: {} }),
        messages: async () => ({ data: [] }),
      },
    } as any,
    directory: `${rootDir}/.tmp/week3-recovery-${Date.now()}`,
  } as any)

  const exec = async (toolName: string, args: Record<string, unknown>) => {
    const t: any = runtime.tool[toolName]
    if (!t || typeof t.execute !== "function") throw new Error(`Missing tool ${toolName}`)
    return JSON.parse(await t.execute(args)) as Record<string, any>
  }

  const team = await exec("team_start", { name: "week3-recovery", goal: "safety probe" })

  await exec("team_agent_register", {
    team_id: team.id,
    agent_name: "agent-alpha",
    role: "worker",
    status: "idle",
    lease_minutes: 15,
  })
  await exec("team_agent_register", {
    team_id: team.id,
    agent_name: "agent-beta",
    role: "worker",
    status: "idle",
    lease_minutes: 15,
  })

  const taskA = await exec("team_task_create", {
    team_id: team.id,
    title: "stale task",
    description: "stale",
    priority: "medium",
  })
  const taskB = await exec("team_task_create", {
    team_id: team.id,
    title: "done task",
    description: "done",
    priority: "medium",
  })

  await exec("team_task_claim", {
    team_id: team.id,
    task_id: taskA.id,
    claimant: "agent-alpha",
    lease_minutes: -1,
  })
  await exec("team_task_claim", {
    team_id: team.id,
    task_id: taskB.id,
    claimant: "agent-beta",
    lease_minutes: 15,
  })
  await exec("team_task_complete", {
    team_id: team.id,
    task_id: taskB.id,
  })

  const delegationTask = await exec("team_task_create", {
    team_id: team.id,
    title: "delegation recovery task",
    description: "delegation resolution",
    priority: "medium",
  })
  const delegation = await exec("team_delegation_create", {
    team_id: team.id,
    task_id: delegationTask.id,
    source_agent: "agent-alpha",
    target_agent: "agent-beta",
    prompt: "recovery drill delegation",
  })

  const mailbox = await exec("team_mailbox_send", {
    team_id: team.id,
    sender_agent: "agent-alpha",
    recipient_agent: "agent-beta",
    message_type: "blocking",
    subject: "recovery drill",
    body: "mailbox resolution probe",
    task_id: taskA.id,
    delegation_id: delegation.id,
  })

  const inspectStart = Date.now()
  const inspectBefore = await exec("team_recovery_inspect", { team_id: team.id })
  const inspectLatencyMs = Date.now() - inspectStart

  const before = await exec("team_task_list", { team_id: team.id })
  const requeueStart = Date.now()
  const requeue = await exec("team_recovery_requeue_stale_claims", {
    team_id: team.id,
    stale_agent_status: "recovering",
    note: "week3 safety",
  })
  const requeueLatencyMs = Date.now() - requeueStart

  const resolveDelegationStart = Date.now()
  const resolveDelegation = await exec("team_recovery_resolve_delegations", {
    team_id: team.id,
    delegation_ids: delegation.id,
    next_status: "cancelled",
    target_agent_status: "unchanged",
    note: "week3 delegation drill",
  })
  const resolveDelegationLatencyMs = Date.now() - resolveDelegationStart

  const resolveMailboxStart = Date.now()
  const resolveMailbox = await exec("team_recovery_resolve_mailbox", {
    team_id: team.id,
    message_ids: mailbox.id,
    note: "week3 mailbox drill",
  })
  const resolveMailboxLatencyMs = Date.now() - resolveMailboxStart

  const after = await exec("team_task_list", { team_id: team.id })

  const staleAfter = (after.tasks ?? []).find((row: any) => row.id === taskA.id)
  const doneAfter = (after.tasks ?? []).find((row: any) => row.id === taskB.id)

  const problems: string[] = []
  const inspectStaleClaims = Array.isArray(inspectBefore.stale_claims) ? inspectBefore.stale_claims.length : 0
  const inspectOpenDelegations = Array.isArray(inspectBefore.open_delegations) ? inspectBefore.open_delegations.length : 0
  const inspectUnresolvedMailbox = Array.isArray(inspectBefore.unresolved_mailbox) ? inspectBefore.unresolved_mailbox.length : 0

  const resolvedDelegations = Array.isArray(resolveDelegation.resolved) ? resolveDelegation.resolved : []
  const skippedDelegations = Array.isArray(resolveDelegation.skipped) ? resolveDelegation.skipped : []
  const resolvedMailbox = Array.isArray(resolveMailbox.resolved) ? resolveMailbox.resolved : []
  const skippedMailbox = Array.isArray(resolveMailbox.skipped) ? resolveMailbox.skipped : []

  if (inspectStaleClaims < 1) {
    problems.push("Recovery inspect did not detect stale claims for drill")
  }
  if ((requeue.requeued_task_ids ?? []).length !== 1 || requeue.requeued_task_ids[0] !== taskA.id) {
    problems.push(`Expected only stale task ${taskA.id} to be requeued`)
  }
  if (!staleAfter || staleAfter.status !== "ready" || staleAfter.claimed_by !== null) {
    problems.push("Stale task did not end in ready/unclaimed")
  }
  if (!doneAfter || doneAfter.status !== "done") {
    problems.push("Terminal done task was mutated during recovery")
  }
  if (doneAfter?.claimed_by !== null) {
    problems.push("Terminal done task should remain without claimed_by")
  }
  const beforeDone = (before.tasks ?? []).find((row: any) => row.id === taskB.id)
  if (!beforeDone || beforeDone.status !== "done") {
    problems.push("Probe setup failed: expected done task before recovery")
  }

  if (resolvedDelegations.length !== 1) {
    problems.push(`Expected 1 delegation resolved in drill, got ${resolvedDelegations.length}`)
  }

  if (resolvedMailbox.length !== 1) {
    problems.push(`Expected 1 mailbox message resolved in drill, got ${resolvedMailbox.length}`)
  }

  if (requeueLatencyMs > 10_000) {
    problems.push(`Stale claim requeue exceeded max latency SLO (observed=${requeueLatencyMs}ms, max=10000ms)`)
  }

  const successfulOps = [
    inspectLatencyMs >= 0,
    (requeue.requeued_task_ids ?? []).includes(taskA.id),
    resolvedDelegations.length === 1,
    resolvedMailbox.length === 1,
  ].filter(Boolean).length
  const totalOps = 4

  const staleCoveragePercent = inspectStaleClaims === 0
    ? 0
    : Number((((requeue.requeued_task_ids ?? []).length / inspectStaleClaims) * 100).toFixed(2))
  const delegationResolutionRatePercent = Number(((resolvedDelegations.length / Math.max(resolvedDelegations.length + skippedDelegations.length, 1)) * 100).toFixed(2))
  const mailboxResolutionRatePercent = Number(((resolvedMailbox.length / Math.max(resolvedMailbox.length + skippedMailbox.length, 1)) * 100).toFixed(2))
  const recoveryOpsSuccessRatePercent = Number(((successfulOps / totalOps) * 100).toFixed(2))

  return {
    pass: problems.length === 0,
    details: problems,
    evidence: {
      generated_at: new Date().toISOString(),
      team_id: team.id,
      stale_task_id: String(taskA.id),
      done_task_id: String(taskB.id),
      delegation_id: String(delegation.id),
      mailbox_message_id: String(mailbox.id),
      operations: {
        inspect_before: {
          latency_ms: inspectLatencyMs,
          stale_claims: inspectStaleClaims,
          open_delegations: inspectOpenDelegations,
          unresolved_mailbox: inspectUnresolvedMailbox,
        },
        requeue_stale_claims: {
          latency_ms: requeueLatencyMs,
          requeued_task_ids: Array.isArray(requeue.requeued_task_ids) ? requeue.requeued_task_ids : [],
        },
        resolve_delegations: {
          latency_ms: resolveDelegationLatencyMs,
          resolved_count: resolvedDelegations.length,
          skipped_count: skippedDelegations.length,
        },
        resolve_mailbox: {
          latency_ms: resolveMailboxLatencyMs,
          resolved_count: resolvedMailbox.length,
          skipped_count: skippedMailbox.length,
        },
      },
      invariants: {
        stale_task_ready_unclaimed: Boolean(staleAfter && staleAfter.status === "ready" && staleAfter.claimed_by === null),
        done_task_immutable: Boolean(doneAfter && doneAfter.status === "done" && doneAfter.claimed_by === null),
      },
      pass: problems.length === 0,
      issues: problems,
    },
    kpis: {
      recovery_ops_success_rate_percent: recoveryOpsSuccessRatePercent,
      stale_claim_requeue_coverage_percent: staleCoveragePercent,
      delegation_resolution_rate_percent: delegationResolutionRatePercent,
      mailbox_resolution_rate_percent: mailboxResolutionRatePercent,
      stale_claim_requeue_latency_ms: requeueLatencyMs,
    },
  }
}

function documentationConsistencyProbe(rootDir: string) {
  const files = {
    contract: join(rootDir, "specs", "contracts", "runtime-operating-contract-v1.md"),
    specV1: join(rootDir, "specs", "opencode-agent-teams-runtime-v1.md"),
    week1Delta: join(rootDir, "specs", "semana-1-runtime-canonical-contract-delta-spec.md"),
    agents: join(rootDir, "AGENTS.md"),
    sddWorkflow: join(rootDir, "skills", "sdd-workflow", "SKILL.md"),
    sddApply: join(rootDir, "skills", "sdd-apply", "SKILL.md"),
    sddTasks: join(rootDir, "skills", "sdd-tasks", "SKILL.md"),
    sddVerify: join(rootDir, "skills", "sdd-verify", "SKILL.md"),
    sddArchive: join(rootDir, "skills", "sdd-archive", "SKILL.md"),
    sddSpec: join(rootDir, "skills", "sdd-spec", "SKILL.md"),
    sddExplore: join(rootDir, "skills", "sdd-explore", "SKILL.md"),
    sddInit: join(rootDir, "skills", "sdd-init", "SKILL.md"),
  }

  const read = (file: string) => readFileSync(file, "utf8")
  const problems: string[] = []
  const observations: string[] = []

  const contract = read(files.contract)
  const workflow = read(files.sddWorkflow)
  const specV1 = read(files.specV1)
  const week1Delta = read(files.week1Delta)

  const canonicalFlow = "init -> explore -> spec -> tasks -> apply -> verify -> archive"
  if (!contract.includes(canonicalFlow)) problems.push("Contract missing canonical flow declaration")
  if (!workflow.includes(canonicalFlow) && !workflow.includes("init → explore → spec → tasks → apply → verify → archive")) {
    problems.push("skills/sdd-workflow missing canonical phase graph")
  }
  if (!specV1.includes("Normative contract reference")) {
    problems.push("specs/opencode-agent-teams-runtime-v1.md missing normative contract reference")
  }
  if (!week1Delta.includes("fase **opcional**") && !week1Delta.includes("fase opcional")) {
    problems.push("week1 delta spec should keep design as optional (not mandatory)")
  }

  const checkNoDesignToken = [
    files.sddWorkflow,
    files.sddApply,
    files.sddTasks,
    files.sddVerify,
    files.sddArchive,
    files.sddSpec,
    files.sddExplore,
    files.sddInit,
  ]

  for (const file of checkNoDesignToken) {
    const content = read(file)
    if (content.includes("sdd-design")) {
      problems.push(`Forbidden mandatory token sdd-design found in ${file}`)
    }
    observations.push(`${file}:ok`)
  }

  const agents = read(files.agents)
  if (!agents.includes("runtime-operating-contract-v1.md")) {
    problems.push("AGENTS.md should reference canonical contract path")
  }

  return {
    pass: problems.length === 0,
    details: problems,
    evidence: {
      canonical_flow: canonicalFlow,
      checked_files: observations,
    },
  }
}

export async function runWeek3ParityGates(rootDir: string, mode: RunMode = "gates"): Promise<{ current: ParitySnapshot; report: GateReport }> {
  const policy = createGatePolicy(mode)
  const baseline = loadBaseline(rootDir)
  const current = await collectCurrentParity(rootDir, mode)

  const argsDiff = jsonDiffPaths(baseline.args, current.toolArgsSnapshot)
  const responseDiff = diffResponseShape(
    baseline.response,
    current.responseSnapshot as unknown as Record<string, unknown>,
    mode,
  )
  const ddlDiff = diffDdl(baseline.ddl, current.ddlBaseline)
  const taskStateDrift = current.taskStateDrift
  const recoveryProbe = await recoverySafetyProbe(rootDir)
  const docsProbe = documentationConsistencyProbe(rootDir)
  const observabilitySLOs = {
    recovery_ops_success_rate_min_percent: 100,
    stale_claim_requeue_coverage_min_percent: 100,
    delegation_resolution_rate_min_percent: 100,
    stale_claim_requeue_latency_max_ms: 10_000,
  }
  const criticalBreaches: string[] = []
  if (recoveryProbe.kpis.recovery_ops_success_rate_percent < observabilitySLOs.recovery_ops_success_rate_min_percent) {
    criticalBreaches.push(
      `Recovery operation success rate below SLO (${recoveryProbe.kpis.recovery_ops_success_rate_percent}% < ${observabilitySLOs.recovery_ops_success_rate_min_percent}%)`,
    )
  }
  if (recoveryProbe.kpis.stale_claim_requeue_coverage_percent < observabilitySLOs.stale_claim_requeue_coverage_min_percent) {
    criticalBreaches.push(
      `Stale claim requeue coverage below SLO (${recoveryProbe.kpis.stale_claim_requeue_coverage_percent}% < ${observabilitySLOs.stale_claim_requeue_coverage_min_percent}%)`,
    )
  }
  if (recoveryProbe.kpis.delegation_resolution_rate_percent < observabilitySLOs.delegation_resolution_rate_min_percent) {
    criticalBreaches.push(
      `Delegation resolution rate below SLO (${recoveryProbe.kpis.delegation_resolution_rate_percent}% < ${observabilitySLOs.delegation_resolution_rate_min_percent}%)`,
    )
  }
  if (recoveryProbe.kpis.stale_claim_requeue_latency_ms > observabilitySLOs.stale_claim_requeue_latency_max_ms) {
    criticalBreaches.push(
      `Stale claim requeue latency above SLO (${recoveryProbe.kpis.stale_claim_requeue_latency_ms}ms > ${observabilitySLOs.stale_claim_requeue_latency_max_ms}ms)`,
    )
  }
  if (!recoveryProbe.evidence.team_id || !recoveryProbe.evidence.stale_task_id || !recoveryProbe.evidence.delegation_id) {
    criticalBreaches.push("Missing minimum drill evidence identifiers (team/task/delegation)")
  }
  const responseCoverageRaw = ((current.responseSnapshot as Record<string, unknown>).coverage ?? {}) as Record<string, unknown>
  const responseCoverage = {
    total_team_tools: Number(responseCoverageRaw.total_team_tools ?? 0),
    covered_tools: Number(responseCoverageRaw.covered_tools ?? 0),
    coverage_percent: Number(responseCoverageRaw.coverage_percent ?? 0),
    missing_commands: Array.isArray(responseCoverageRaw.missing_commands)
      ? responseCoverageRaw.missing_commands.map((item) => String(item))
      : [],
  }

  const coveragePolicyStatus: CheckStatus =
    responseCoverage.coverage_percent < policy.responseCoverageFailThreshold
      ? "FAIL"
      : responseCoverage.coverage_percent < policy.responseCoverageWarnThreshold
        ? "WARN"
        : "PASS"

  const checks: GateCheck[] = [
    {
      id: "T1",
      title: "Task State Contract Test",
      severity: "critical",
      status:
        taskStateDrift.missing_in_runtime.length === 0
        && taskStateDrift.extra_in_runtime.length === 0
        && taskStateDrift.transition_mismatches.length === 0
          ? "PASS"
          : "FAIL",
      drift_count:
        taskStateDrift.missing_in_runtime.length
        + taskStateDrift.extra_in_runtime.length
        + taskStateDrift.transition_mismatches.length,
      details: [
        ...taskStateDrift.missing_in_runtime.map((state) => `Missing state in runtime: ${state}`),
        ...taskStateDrift.extra_in_runtime.map((state) => `Extra state in runtime: ${state}`),
        ...taskStateDrift.transition_mismatches.map((item) => `Transition mismatch in ${item.state}: expected [${item.expected.join(", ")}], observed [${item.observed.join(", ")}]`),
      ],
    },
    {
      id: "T2",
      title: "Tool Args Schema Parity Test",
      severity: "high",
      status: argsDiff.length === 0 ? "PASS" : "FAIL",
      drift_count: argsDiff.length,
      details: summarizeDiff("Args drift:", argsDiff),
    },
    {
      id: "T3",
      title: "Tool Response Shape Parity Test",
      severity: policy.responseShapeBlockingSeverity,
      status: responseDiff.length === 0 ? "PASS" : "FAIL",
      drift_count: responseDiff.length,
      details: summarizeDiff("Response shape drift:", responseDiff),
    },
    {
      id: "T3C",
      title: "Tool Response Shape Coverage",
      severity: "medium",
      status: coveragePolicyStatus,
      drift_count: responseCoverage.missing_commands.length,
      details: [
        `Coverage: ${responseCoverage.covered_tools}/${responseCoverage.total_team_tools} (${responseCoverage.coverage_percent}%)`,
        ...(responseCoverage.missing_commands.length > 0
          ? [
              ...responseCoverage.missing_commands.slice(0, 25).map((name) => `Missing response shape snapshot for: ${name}`),
              ...(responseCoverage.missing_commands.length > 25
                ? [`... and ${responseCoverage.missing_commands.length - 25} more`]
                : []),
            ]
          : ["No missing commands in response shape coverage"])
      ],
    },
    {
      id: "T4",
      title: "DDL Parity Diff Test",
      severity: "high",
      status: ddlDiff.driftCount === 0 ? "PASS" : "FAIL",
      drift_count: ddlDiff.driftCount,
      details: [
        ...ddlDiff.added.map((key) => `DDL added: ${key}`),
        ...ddlDiff.removed.map((key) => `DDL removed: ${key}`),
        ...ddlDiff.changed.map((key) => `DDL changed: ${key}`),
      ],
    },
    {
      id: "T5",
      title: "Recovery Safety Test",
      severity: "critical",
      status: recoveryProbe.pass ? "PASS" : "FAIL",
      drift_count: recoveryProbe.details.length,
      details: recoveryProbe.pass
        ? [
            `Recovery safety probe passed (team_id=${recoveryProbe.evidence.team_id})`,
            `Requeued task IDs: ${((recoveryProbe.evidence.operations?.requeue_stale_claims?.requeued_task_ids ?? []) as string[]).join(", ")}`,
          ]
        : recoveryProbe.details,
    },
    {
      id: "T6",
      title: "Documentation Consistency Check",
      severity: "medium",
      status: docsProbe.pass ? "PASS" : "FAIL",
      drift_count: docsProbe.details.length,
      details: docsProbe.pass
        ? [
            "Canonical flow and contract references are consistent across target files",
            ...docsProbe.evidence.checked_files,
          ]
        : docsProbe.details,
    },
    {
      id: "T7",
      title: "Recovery Drill Evidence + KPI/SLO Gate",
      severity: "critical",
      status: criticalBreaches.length === 0 ? "PASS" : "FAIL",
      drift_count: criticalBreaches.length,
      details: criticalBreaches.length > 0
        ? criticalBreaches
        : [
            `Recovery ops success rate: ${recoveryProbe.kpis.recovery_ops_success_rate_percent}%`,
            `Stale claim requeue coverage: ${recoveryProbe.kpis.stale_claim_requeue_coverage_percent}%`,
            `Delegation resolution rate: ${recoveryProbe.kpis.delegation_resolution_rate_percent}%`,
            `Mailbox resolution rate: ${recoveryProbe.kpis.mailbox_resolution_rate_percent}%`,
            `Stale claim requeue latency: ${recoveryProbe.kpis.stale_claim_requeue_latency_ms}ms`,
          ],
    },
  ]

  const blockingSeverities: Severity[] = mode === "strict"
    ? ["critical", "high", "medium"]
    : ["critical", "high"]
  const blockingFailures = checks
    .filter((check) => (check.status === "FAIL" || (mode === "strict" && check.status === "WARN")) && blockingSeverities.includes(check.severity))
    .map((check) => check.id)

  const report: GateReport = {
    format_version: 1,
    generated_at: new Date().toISOString(),
    baseline_dir: baseline.baselineDir,
    mode,
    checks,
    coverage: {
      response_shapes: responseCoverage,
    },
    observability: {
      kpis: {
        ...recoveryProbe.kpis,
        critical_breaches: criticalBreaches,
      },
      slos: observabilitySLOs,
      drill_evidence: recoveryProbe.evidence,
    },
    policy_notes: [
      mode === "strict"
        ? "Strict mode enforces frozen baseline with zero drift across args/shape/DDL/task-state checks."
        : "Default gates mode preserves existing flow while reporting expanded response shape coverage.",
      mode === "strict"
        ? "Strict mode escalates medium severity failures/warnings to blocking."
        : `Coverage thresholds: WARN below ${policy.responseCoverageWarnThreshold}%, FAIL below ${policy.responseCoverageFailThreshold}%.`,
      "Recovery drill gate requires minimum evidence IDs and critical KPI/SLO compliance (ops success/requeue coverage/delegation resolution/requeue latency).",
      "No allowlist exceptions configured in this run.",
    ],
    gate: {
      blocking_severities: blockingSeverities,
      blocking_failures: blockingFailures,
      pass: blockingFailures.length === 0,
    },
  }

  return { current, report }
}

export function writeWeek3GateArtifacts(report: GateReport, current: ParitySnapshot, outputDir = BASELINE_DIR) {
  mkdirSync(outputDir, { recursive: true })

  const modeSuffix = report.mode === "strict" ? ".strict" : ""

  writeFileSync(join(outputDir, "compliance-gates.report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8")
  writeFileSync(join(outputDir, `compliance-gates.report${modeSuffix}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8")
  if (report.observability) {
    writeFileSync(
      join(outputDir, "runtime-observability.kpi.json"),
      `${JSON.stringify({
        format_version: 1,
        generated_at: report.generated_at,
        mode: report.mode,
        ...report.observability,
      }, null, 2)}\n`,
      "utf8",
    )
    writeFileSync(
      join(outputDir, "runtime-recovery-drill.evidence.json"),
      `${JSON.stringify({
        format_version: 1,
        generated_at: report.generated_at,
        mode: report.mode,
        drill_evidence: report.observability.drill_evidence,
      }, null, 2)}\n`,
      "utf8",
    )
  }
  const baseDdl = readJson(join(outputDir, "runtime-ddl-baseline.json"))
  const ddlDiff = diffDdl(baseDdl, current.ddlBaseline as unknown as Record<string, unknown>)
  writeFileSync(
    join(outputDir, "runtime-ddl.diff.json"),
    `${JSON.stringify({ format_version: 1, baseline_exists: true, added: ddlDiff.added, removed: ddlDiff.removed, changed: ddlDiff.changed, drift_detected: ddlDiff.driftCount > 0 }, null, 2)}\n`,
    "utf8",
  )
  const lines = [
    "# Week 3 Contract Parity — Compliance Gates Report",
    "",
    `Generated: ${report.generated_at}`,
    `Mode: ${report.mode}`,
    `Baseline: ${report.baseline_dir}`,
    "",
    "| Check | Severity | Status | Drift Count |",
    "|---|---|---|---:|",
    ...report.checks.map((check) => `| ${check.id} ${check.title} | ${check.severity} | ${check.status} | ${check.drift_count} |`),
    "",
    `Gate Result: **${report.gate.pass ? "PASS" : "FAIL"}**`,
    report.gate.blocking_failures.length > 0
      ? `Blocking Failures: ${report.gate.blocking_failures.join(", ")}`
      : "Blocking Failures: none",
    "",
    "## Coverage",
    report.coverage
      ? `Response shapes: ${report.coverage.response_shapes.covered_tools}/${report.coverage.response_shapes.total_team_tools} (${report.coverage.response_shapes.coverage_percent}%)`
      : "Response shapes: unavailable",
    report.coverage && report.coverage.response_shapes.missing_commands.length > 0
      ? `Missing response commands: ${report.coverage.response_shapes.missing_commands.join(", ")}`
      : "Missing response commands: none",
    "",
    "## Recovery Observability",
    report.observability
      ? `Recovery ops success: ${report.observability.kpis.recovery_ops_success_rate_percent}% (SLO min ${report.observability.slos.recovery_ops_success_rate_min_percent}%)`
      : "Recovery ops success: unavailable",
    report.observability
      ? `Stale claim requeue coverage: ${report.observability.kpis.stale_claim_requeue_coverage_percent}% (SLO min ${report.observability.slos.stale_claim_requeue_coverage_min_percent}%)`
      : "Stale claim requeue coverage: unavailable",
    report.observability
      ? `Delegation resolution rate: ${report.observability.kpis.delegation_resolution_rate_percent}% (SLO min ${report.observability.slos.delegation_resolution_rate_min_percent}%)`
      : "Delegation resolution rate: unavailable",
    report.observability
      ? `Stale claim requeue latency: ${report.observability.kpis.stale_claim_requeue_latency_ms}ms (SLO max ${report.observability.slos.stale_claim_requeue_latency_max_ms}ms)`
      : "Stale claim requeue latency: unavailable",
    report.observability && report.observability.kpis.critical_breaches.length > 0
      ? `Critical breaches: ${report.observability.kpis.critical_breaches.join(" | ")}`
      : "Critical breaches: none",
    "",
    "## Policy Notes",
    ...(report.policy_notes ?? ["No policy notes"]),
    "",
    "## Details",
    ...report.checks.flatMap((check) => [
      `### ${check.id} — ${check.title}`,
      ...(check.details.length > 0 ? check.details.map((detail) => `- ${detail}`) : ["- No drift detected"]),
      "",
    ]),
  ]

  writeFileSync(join(outputDir, "compliance-gates.report.md"), `${lines.join("\n")}\n`, "utf8")
  writeFileSync(join(outputDir, `compliance-gates.report${modeSuffix}.md`), `${lines.join("\n")}\n`, "utf8")
}
