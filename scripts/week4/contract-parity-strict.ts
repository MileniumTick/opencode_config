import { runWeek3ParityGates, writeWeek3GateArtifacts } from "../week3/contract-parity-gates-lib"

async function main() {
  const { current, report } = await runWeek3ParityGates(process.cwd(), "strict")
  writeWeek3GateArtifacts(report, current)

  const summary = {
    generated_at: report.generated_at,
    mode: report.mode,
    checks: report.checks.map((check) => ({
      id: check.id,
      status: check.status,
      severity: check.severity,
      drift_count: check.drift_count,
    })),
    coverage: report.coverage,
    gate_pass: report.gate.pass,
    blocking_failures: report.gate.blocking_failures,
    policy_notes: report.policy_notes ?? [],
  }

  console.log(JSON.stringify(summary, null, 2))
  if (!report.gate.pass) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
