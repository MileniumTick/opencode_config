import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join, relative } from "node:path"

type ReleaseEvidenceManifest = {
  format_version: 1
  generated_at: string
  verification_chain: ["verify:runtime:baseline", "verify:runtime:gates", "verify:runtime:strict", "verify:runtime:smoke"]
  source_dir: string
  checksums: Array<{
    file: string
    sha256: string
    bytes: number
  }>
}

const ROOT = process.cwd()
const BASELINE_DIR = join(ROOT, "specs", "baselines", "current")
const OUTPUT_DIR = join(ROOT, "artifacts", "runtime-release")
const OUTPUT_FILE = join(OUTPUT_DIR, "runtime-release-evidence.manifest.json")

const REQUIRED_FILES = [
  "tool-args-schema.snapshot.json",
  "tool-response-top-level.snapshot.json",
  "runtime-ddl-baseline.json",
  "runtime-ddl.diff.json",
  "task-state-drift.evidence.json",
  "compliance-gates.report.json",
  "compliance-gates.report.md",
  "compliance-gates.report.strict.json",
  "compliance-gates.report.strict.md",
  "runtime-observability.kpi.json",
  "runtime-recovery-drill.evidence.json",
  "baseline-summary.json",
]

function checksumFor(filePath: string) {
  const buffer = readFileSync(filePath)
  const hash = createHash("sha256").update(buffer).digest("hex")
  return { sha256: hash, bytes: buffer.byteLength }
}

function main() {
  const checksums = REQUIRED_FILES.map((name) => {
    const fullPath = join(BASELINE_DIR, name)
    const digest = checksumFor(fullPath)
    return {
      file: relative(ROOT, fullPath),
      sha256: digest.sha256,
      bytes: digest.bytes,
    }
  })

  const manifest: ReleaseEvidenceManifest = {
    format_version: 1,
    generated_at: new Date().toISOString(),
    verification_chain: ["verify:runtime:baseline", "verify:runtime:gates", "verify:runtime:strict", "verify:runtime:smoke"],
    source_dir: relative(ROOT, BASELINE_DIR),
    checksums,
  }

  mkdirSync(OUTPUT_DIR, { recursive: true })
  writeFileSync(OUTPUT_FILE, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

  console.log(JSON.stringify({ output: relative(ROOT, OUTPUT_FILE), checksums: checksums.length }, null, 2))
}

main()
