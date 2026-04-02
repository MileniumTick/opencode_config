#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

overall_status=0

print_section() {
  local title="$1"
  echo
  echo "========================================"
  echo "$title"
  echo "========================================"
}

run_check() {
  local description="$1"
  shift

  echo "- $description"
  if "$@" >/dev/null; then
    echo "  ✅ PASS"
  else
    echo "  ❌ FAIL"
    overall_status=1
  fi
}

print_section "1) Validate opencode.json syntax"
run_check "python3 -m json.tool opencode.json" \
  python3 -m json.tool "$ROOT_DIR/opencode.json"

print_section "2) Validate all root *.json files"
json_files=("$ROOT_DIR"/*.json)

if [[ ${#json_files[@]} -eq 0 ]]; then
  echo "- No root JSON files found"
  echo "  ❌ FAIL"
  overall_status=1
else
  for json_file in "${json_files[@]}"; do
    run_check "python3 -m json.tool $(basename "$json_file")" \
      python3 -m json.tool "$json_file"
  done
fi

print_section "3) Run quality gates"
run_check "python3 scripts/check-quality-gates.py" \
  python3 "$ROOT_DIR/scripts/check-quality-gates.py"

print_section "4) Verify key files exist"
required_files=(
  "commands/health.md"
  "tools/project-docs.ts"
  "plugins/project-docs-autolog.ts"
)

for rel_path in "${required_files[@]}"; do
  if [[ -f "$ROOT_DIR/$rel_path" ]]; then
    echo "- $rel_path"
    echo "  ✅ PASS"
  else
    echo "- $rel_path"
    echo "  ❌ FAIL"
    overall_status=1
  fi
done

print_section "Summary"
if [[ $overall_status -eq 0 ]]; then
  echo "✅ VERIFY CONFIG: PASS"
else
  echo "❌ VERIFY CONFIG: FAIL"
fi

exit "$overall_status"
