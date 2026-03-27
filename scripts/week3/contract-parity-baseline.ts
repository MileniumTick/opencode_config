import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { collectCurrentParity } from "./contract-parity-lib"

const OUTPUT_DIR = join(process.cwd(), "specs", "baselines", "current")

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const parity = await collectCurrentParity(process.cwd(), "baseline")

  const baselineSummary = {
    generated_at: parity.summary.generated_at,
    output_dir: OUTPUT_DIR,
    tool_count: parity.summary.tool_count,
    task_state_drift: parity.summary.task_state_drift,
    ddl_drift_detected: false,
  }

  writeFileSync(
    join(OUTPUT_DIR, "tool-args-schema.snapshot.json"),
    `${JSON.stringify(parity.toolArgsSnapshot, null, 2)}\n`,
    "utf8",
  )
  writeFileSync(
    join(OUTPUT_DIR, "tool-response-top-level.snapshot.json"),
    `${JSON.stringify(parity.responseSnapshot, null, 2)}\n`,
    "utf8",
  )
  writeFileSync(
    join(OUTPUT_DIR, "runtime-ddl-baseline.json"),
    `${JSON.stringify(parity.ddlBaseline, null, 2)}\n`,
    "utf8",
  )
  writeFileSync(
    join(OUTPUT_DIR, "runtime-ddl.diff.json"),
    `${JSON.stringify({ format_version: 1, baseline_exists: true, added: [], removed: [], changed: [], drift_detected: false }, null, 2)}\n`,
    "utf8",
  )
  writeFileSync(
    join(OUTPUT_DIR, "task-state-drift.evidence.json"),
    `${JSON.stringify(parity.taskStateDrift, null, 2)}\n`,
    "utf8",
  )

  const summaryPath = join(OUTPUT_DIR, "baseline-summary.json")
  mkdirSync(dirname(summaryPath), { recursive: true })
  writeFileSync(summaryPath, `${JSON.stringify(baselineSummary, null, 2)}\n`, "utf8")

  console.log(JSON.stringify(baselineSummary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
