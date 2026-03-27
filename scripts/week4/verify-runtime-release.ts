import { spawnSync } from "node:child_process"

const STEPS: Array<{ id: string; command: string; args: string[] }> = [
  { id: "baseline", command: "bun", args: ["run", "verify:runtime:baseline"] },
  { id: "gates", command: "bun", args: ["run", "verify:runtime:gates"] },
  { id: "strict", command: "bun", args: ["run", "verify:runtime:strict"] },
  { id: "smoke", command: "bun", args: ["run", "verify:runtime:smoke"] },
]

type BypassMeta = {
  enabled: boolean
  reason: string
  ticket: string
  approvedBy: string
  expiresAt: string
}

function resolveBypassMeta(): BypassMeta {
  const enabled = process.env.RUNTIME_STRICT_BYPASS === "1"
  const reason = (process.env.RUNTIME_STRICT_BYPASS_REASON ?? "").trim()
  const ticket = (process.env.RUNTIME_STRICT_BYPASS_TICKET ?? "").trim()
  const approvedBy = (process.env.RUNTIME_STRICT_BYPASS_APPROVED_BY ?? "").trim()
  const expiresAt = (process.env.RUNTIME_STRICT_BYPASS_EXPIRES_AT ?? "").trim()
  return { enabled, reason, ticket, approvedBy, expiresAt }
}

function assertBypassAudit(meta: BypassMeta) {
  if (!meta.enabled) return

  const missing: string[] = []
  if (!meta.reason) missing.push("RUNTIME_STRICT_BYPASS_REASON")
  if (!meta.ticket) missing.push("RUNTIME_STRICT_BYPASS_TICKET")
  if (!meta.approvedBy) missing.push("RUNTIME_STRICT_BYPASS_APPROVED_BY")
  if (!meta.expiresAt) missing.push("RUNTIME_STRICT_BYPASS_EXPIRES_AT")
  if (missing.length > 0) {
    throw new Error(`Strict bypass is enabled but missing audit metadata: ${missing.join(", ")}`)
  }

  const expires = new Date(meta.expiresAt)
  if (Number.isNaN(expires.getTime())) {
    throw new Error("RUNTIME_STRICT_BYPASS_EXPIRES_AT must be a valid ISO-8601 datetime")
  }
  if (expires.getTime() <= Date.now()) {
    throw new Error("RUNTIME_STRICT_BYPASS_EXPIRES_AT must be in the future")
  }
}

function runStep(step: (typeof STEPS)[number]) {
  console.log(`\n=== [verify:runtime:release] ${step.id.toUpperCase()} ===`)
  const result = spawnSync(step.command, step.args, {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd(),
  })

  if (result.error) {
    throw result.error
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status)
  }

  if (result.signal) {
    console.error(`[verify:runtime:release] step ${step.id} interrupted by signal ${result.signal}`)
    process.exit(1)
  }
}

function main() {
  const bypass = resolveBypassMeta()
  assertBypassAudit(bypass)

  for (const step of STEPS) {
    if (step.id === "strict" && bypass.enabled) {
      console.log("\n=== [verify:runtime:release] STRICT BYPASS (EXPLICIT+AUDITED) ===")
      console.log(`reason=${bypass.reason}`)
      console.log(`ticket=${bypass.ticket}`)
      console.log(`approved_by=${bypass.approvedBy}`)
      console.log(`expires_at=${bypass.expiresAt}`)
      continue
    }

    runStep(step)
  }

  const chain = bypass.enabled
    ? "baseline→gates→(strict bypassed: explicit+audited)→smoke"
    : "baseline→gates→strict→smoke"
  console.log(`\n[verify:runtime:release] PASS — ${chain}`)
}

main()
