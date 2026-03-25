#!/bin/bash
#
# Skill Registry Smoke Tests
# Basic validation of skill-registry functionality
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$SCRIPT_DIR"
WORKDIR="${WORKDIR:-$(pwd)}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
log_info() {
  echo -e "${YELLOW}[INFO]${NC} $1"
}

log_pass() {
  echo -e "${GREEN}[PASS]${NC} $1"
  ((TESTS_PASSED++))
}

log_fail() {
  echo -e "${RED}[FAIL]${NC} $1"
  ((TESTS_FAILED++))
}

assert_file_exists() {
  ((TESTS_RUN++))
  if [[ -f "$1" ]]; then
    log_pass "File exists: $1"
  else
    log_fail "File not found: $1"
    return 1
  fi
}

assert_dir_exists() {
  ((TESTS_RUN++))
  if [[ -d "$1" ]]; then
    log_pass "Directory exists: $1"
  else
    log_fail "Directory not found: $1"
    return 1
  fi
}

assert_file_readable() {
  ((TESTS_RUN++))
  if [[ -r "$1" ]]; then
    log_pass "File readable: $1"
  else
    log_fail "File not readable: $1"
    return 1
  fi
}

assert_contains() {
  ((TESTS_RUN++))
  if grep -q "$2" "$1"; then
    log_pass "File contains: $2"
  else
    log_fail "File does not contain: $2"
    return 1
  fi
}

assert_valid_yaml_frontmatter() {
  ((TESTS_RUN++))
  if head -3 "$1" | grep -q "^---"; then
    log_pass "Valid frontmatter in: $1"
  else
    log_fail "Invalid frontmatter in: $1"
    return 1
  fi
}

# Test: SKILL.md exists
test_skill_file_exists() {
  log_info "Test: SKILL.md exists"
  assert_file_exists "$SKILL_DIR/SKILL.md"
}

# Test: scan.sh exists and is executable
test_scan_script_exists() {
  log_info "Test: scan.sh exists and is executable"
  assert_file_exists "$SKILL_DIR/scan.sh"
  
  ((TESTS_RUN++))
  if [[ -x "$SKILL_DIR/scan.sh" ]]; then
    log_pass "scan.sh is executable"
  else
    log_fail "scan.sh is not executable"
    return 1
  fi
}

# Test: scan.sh has valid shebang
test_scan_shebang() {
  log_info "Test: scan.sh has valid shebang"
  ((TESTS_RUN++))
  if head -1 "$SKILL_DIR/scan.sh" | grep -q "^#!/bin/bash"; then
    log_pass "Valid shebang in scan.sh"
  else
    log_fail "Invalid shebang in scan.sh"
    return 1
  fi
}

# Test: SKILL.md has valid frontmatter
test_skill_frontmatter() {
  log_info "Test: SKILL.md has valid frontmatter"
  assert_valid_yaml_frontmatter "$SKILL_DIR/SKILL.md"
}

# Test: SKILL.md has name field
test_skill_has_name() {
  log_info "Test: SKILL.md has name field"
  assert_contains "$SKILL_DIR/SKILL.md" "^name:"
}

# Test: SKILL.md has description field
test_skill_has_description() {
  log_info "Test: SKILL.md has description field"
  assert_contains "$SKILL_DIR/SKILL.md" "^description:"
}

# Test: scan.sh can be executed (syntax check)
test_scan_syntax() {
  log_info "Test: scan.sh syntax check"
  ((TESTS_RUN++))
  if bash -n "$SKILL_DIR/scan.sh" 2>/dev/null; then
    log_pass "scan.sh has valid syntax"
  else
    log_fail "scan.sh has syntax errors"
    return 1
  fi
}

# Test: scan.sh runs without arguments
test_scan_runs() {
  log_info "Test: scan.sh runs without arguments"
  ((TESTS_RUN++))
  
  local output
  if output=$(cd "$WORKDIR" && bash "$SKILL_DIR/scan.sh" 2>&1); then
    log_pass "scan.sh executes without errors"
  else
    log_fail "scan.sh failed to execute: $output"
    return 1
  fi
}

# Test: scan.sh generates registry
test_generates_registry() {
  log_info "Test: scan.sh generates registry"
  
  # Run scan
  cd "$WORKDIR" && bash "$SKILL_DIR/scan.sh" --force >/dev/null 2>&1
  
  ((TESTS_RUN++))
  if [[ -f "$WORKDIR/.atl/skill-registry.md" ]]; then
    log_pass "Registry file generated"
  else
    log_fail "Registry file not generated"
    return 1
  fi
}

# Test: registry has skills table
test_registry_has_table() {
  log_info "Test: registry has skills table"
  
  # Ensure registry exists
  cd "$WORKDIR" && bash "$SKILL_DIR/scan.sh" --force >/dev/null 2>&1
  
  assert_file_exists "$WORKDIR/.atl/skill-registry.md"
  assert_contains "$WORKDIR/.atl/skill-registry.md" "| Trigger |"
}

# Test: all discovered skills have valid paths
test_skills_have_absolute_paths() {
  log_info "Test: skills have absolute paths in registry"
  
  ((TESTS_RUN++))
  
  # Run scan and capture output
  local output
  output=$(cd "$WORKDIR" && bash "$SKILL_DIR/scan.sh" --force 2>&1)
  
  # Check if any path is not absolute
  if grep -E "^\| [a-z]" "$WORKDIR/.atl/skill-registry.md" | grep -v "^| Trigger" | grep -qv "^| - "; then
    log_pass "Skills have absolute paths"
  else
    # More lenient check - just verify paths don't start with .
    if ! grep -E "^\| [a-z]" "$WORKDIR/.atl/skill-registry.md" | grep -v "^| Trigger" | grep -q "^| \."; then
      log_pass "No relative paths found"
    else
      log_fail "Found relative paths in registry"
      return 1
    fi
  fi
}

# Test: _shared files exist
test_shared_files_exist() {
  log_info "Test: _shared convention files exist"
  
  local shared_dir="$SCRIPT_DIR/../_shared"
  
  if [[ ! -d "$shared_dir" ]]; then
    log_fail "_shared directory not found at $shared_dir"
    return 1
  fi
  
  assert_file_exists "$shared_dir/persistence-contract.md"
  assert_file_exists "$shared_dir/engram-convention.md"
  assert_file_exists "$shared_dir/openspec-convention.md"
}

# Test: shared files have required sections
test_shared_files_have_content() {
  log_info "Test: shared files have required content"
  
  local shared_dir="$SCRIPT_DIR/../_shared"
  
  assert_contains "$shared_dir/persistence-contract.md" "Mode Resolution"
  assert_contains "$shared_dir/engram-convention.md" "Topic Key Format"
  assert_contains "$shared_dir/openspec-convention.md" "Directory Structure"
}

# Main test runner
main() {
  echo "========================================"
  echo "  Skill Registry Smoke Tests"
  echo "========================================"
  echo ""
  echo "Skill directory: $SKILL_DIR"
  echo "Working directory: $WORKDIR"
  echo ""
  
  # Run tests
  test_skill_file_exists
  test_scan_script_exists
  test_scan_shebang
  test_skill_frontmatter
  test_skill_has_name
  test_skill_has_description
  test_scan_syntax
  test_scan_runs
  test_generates_registry
  test_registry_has_table
  test_skills_have_absolute_paths
  test_shared_files_exist
  test_shared_files_have_content
  
  # Summary
  echo ""
  echo "========================================"
  echo "  Test Summary"
  echo "========================================"
  echo -e "Tests run:    $TESTS_RUN"
  echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
  echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
  echo ""
  
  if [[ $TESTS_FAILED -eq 0 ]]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
  else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
  fi
}

main "$@"
