import { runWeek3ParityGates, writeWeek3GateArtifacts } from "./contract-parity-gates-lib"

async function main() {
  const strictMode = process.argv.includes("--strict")
  const { current, report } = await runWeek3ParityGates(process.cwd(), strictMode ? "strict" : "gates")
  writeWeek3GateArtifacts(report, current)

  const summary = {
    generated_at: report.generated_at,
    checks: report.checks.map((check) => ({
      id: check.id,
      status: check.status,
      severity: check.severity,
      drift_count: check.drift_count,
    })),
    mode: report.mode,
    coverage: report.coverage,
    gate_pass: report.gate.pass,
    blocking_failures: report.gate.blocking_failures,
  }

  console.log(JSON.stringify(summary, null, 2))
  if (!report.gate.pass) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
