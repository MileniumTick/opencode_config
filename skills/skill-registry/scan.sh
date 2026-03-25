#!/bin/bash
#
# Skill Registry Scanner
# Scans skill directories and generates .atl/skill-registry.md
#

set -uo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="${WORKDIR:-$(pwd)}"
ATL_DIR="$WORKDIR/.atl"
REGISTRY_FILE="$ATL_DIR/skill-registry.md"
FORCE_FLAG=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --force)
      FORCE_FLAG=true
      shift
      ;;
    --paths)
      shift
      CUSTOM_PATHS="$@"
      break
      ;;
    --workdir)
      WORKDIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Resolve skill locations
resolve_skill_locations() {
  local locations=()

  # Global user skills (~/.agents/skills/)
  if [[ -d "$HOME/.agents/skills" ]]; then
    locations+=("$HOME/.agents/skills")
  fi

  # Project-local skills (.agents/skills/)
  if [[ -d "$WORKDIR/.agents/skills" ]]; then
    locations+=("$WORKDIR/.agents/skills")
  fi

  # Default skill location (~/.config/opencode/skills/)
  if [[ -d "$HOME/.config/opencode/skills" ]]; then
    locations+=("$HOME/.config/opencode/skills")
  fi

  # Add custom paths if provided
  if [[ -n "${CUSTOM_PATHS:-}" ]]; then
    for path in $CUSTOM_PATHS; do
      if [[ -d "$path" ]]; then
        locations+=("$path")
      fi
    done
  fi

  echo "${locations[@]}"
}

# Detect project conventions
detect_conventions() {
  local conventions=()
  local workdir="$1"

  local convention_files=("AGENTS.md" "CLAUDE.md" ".cursorrules" "opencode.json")

  for file in "${convention_files[@]}"; do
    if [[ -f "$workdir/$file" ]]; then
      conventions+=("$file")
    fi
  done

  echo "${conventions[@]}"
}

# Check if a directory contains a valid skill
is_valid_skill() {
  local skill_dir="$1"
  local skill_file="$skill_dir/SKILL.md"

  # Must have SKILL.md
  if [[ ! -f "$skill_file" ]]; then
    return 1
  fi

  # Must have valid frontmatter with name and description
  if ! grep -q "^---" "$skill_file"; then
    return 1
  fi

  # Extract name from frontmatter
  local name
  name=$(sed -n '/^---/,/^---/p' "$skill_file" | grep "^name:" | head -1 | cut -d':' -f2 | tr -d ' ')

  if [[ -z "$name" ]]; then
    return 1
  fi

  return 0
}

# Extract skill metadata from SKILL.md
extract_skill_metadata() {
  local skill_dir="$1"
  local skill_file="$skill_dir/SKILL.md"

  local name description

  # Extract name
  name=$(sed -n '/^---/,/^---/p' "$skill_file" | grep "^name:" | head -1 | cut -d':' -f2 | tr -d ' ')
  
  # Extract description
  description=$(sed -n '/^---/,/^---/p' "$skill_file" | grep "^description:" | head -1 | cut -d':' -f2- | tr -d ' ' | sed 's/^"//;s/"$//')

  echo "$name|$description"
}

# Generate trigger from skill name
generate_trigger() {
  local name="$1"
  
  # Extract prefix (e.g., "backend" from "backend-elysia")
  echo "$name" | cut -d'-' -f1
}

# Scan a single location
scan_location() {
  local location="$1"
  local skills=()

  if [[ ! -d "$location" ]]; then
    echo "WARNING: Location not found: $location" >&2
    return 1
  fi

  for entry in "$location"/*; do
    if [[ -d "$entry" ]]; then
      if is_valid_skill "$entry"; then
        skills+=("$entry")
      fi
    fi
  done

  printf '%s\n' "${skills[@]}"
}

# Main scanning function
main() {
  echo "=== Skill Registry Scanner ===" >&2
  echo "Workdir: $WORKDIR" >&2
  echo ""

  # Resolve locations
  local locations
  locations=$(resolve_skill_locations)
  echo "Scanning locations: $locations" >&2
  echo "" >&2

  # Track results
  local all_skills=()
  local -a errors=()
  local -a warnings=()

  # Scan each location
  for location in $locations; do
    echo "Scanning: $location" >&2

    local found_skills
    found_skills=$(scan_location "$location")

    if [[ -n "$found_skills" ]]; then
      while IFS= read -r skill; do
        all_skills+=("$skill")
      done <<< "$found_skills"
    fi
  done

  echo "" >&2
  echo "Found ${#all_skills[@]} skills" >&2

  # Detect conventions
  local conventions
  conventions=$(detect_conventions "$WORKDIR")
  echo "Detected conventions: ${conventions:-none}" >&2
  echo "" >&2

  # Validate each skill
  local valid_count=0
  local invalid_count=0

  for skill_path in "${all_skills[@]}"; do
    if [[ -r "$skill_path/SKILL.md" ]]; then
      ((valid_count++))
    else
      ((invalid_count++))
      errors+=("Cannot read: $skill_path/SKILL.md")
    fi
  done

  echo "Validation: $valid_count valid, $invalid_count invalid" >&2

  # Check if registry needs update
  if [[ -f "$REGISTRY_FILE" ]] && [[ "$FORCE_FLAG" == "false" ]]; then
    echo "Registry already exists. Use --force to regenerate." >&2
    exit 0
  fi

  # Create .atl directory
  mkdir -p "$ATL_DIR"

  # Generate registry
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  cat > "$REGISTRY_FILE" << EOF
# Skill Registry

Generated: $timestamp
Workdir: $WORKDIR

## Skills Table

| Trigger | Skill Name | Path | Description |
|---------|------------|------|-------------|
EOF

  # Add each skill to table
  for skill_path in "${all_skills[@]}"; do
    local metadata
    metadata=$(extract_skill_metadata "$skill_path")
    local name description
    name=$(echo "$metadata" | cut -d'|' -f1)
    description=$(echo "$metadata" | cut -d'|' -f2)
    local trigger
    trigger=$(generate_trigger "$name")

    # Make path absolute
    local abs_path
    abs_path=$(cd "$skill_path" && pwd)

    echo "| $trigger | $name | $abs_path | $description |" >> "$REGISTRY_FILE"
  done

  # Add conventions section
  cat >> "$REGISTRY_FILE" << EOF

## Project Conventions

| Convention | Found | Path |
|------------|-------|------|
EOF

  for conv in AGENTS.md CLAUDE.md .cursorrules opencode.json; do
    if [[ " $conventions " =~ " $conv " ]]; then
      echo "| $conv | ✅ | ./$conv |" >> "$REGISTRY_FILE"
    else
      echo "| $conv | ❌ | - |" >> "$REGISTRY_FILE"
    fi
  done

  # Add scan metadata
  cat >> "$REGISTRY_FILE" << EOF

## Scan Metadata

- Locations scanned: $(echo $locations | wc -w)
- Skills found: ${#all_skills[@]}
- Valid: $valid_count
- Invalid: $invalid_count
EOF

  if [[ ${#errors[@]} -gt 0 ]]; then
    echo "- Errors: ${#errors[@]}" >> "$REGISTRY_FILE"
    for error in "${errors[@]}"; do
      echo "  - $error" >> "$REGISTRY_FILE"
    done
  fi

  echo "" >&2
  echo "Registry generated: $REGISTRY_FILE" >&2

  # Output JSON for programmatic use
  echo ""
  echo "=== RESULT ==="
  # Format errors array for JSON
  local errors_json="[]"
  if [[ ${#errors[@]} -gt 0 ]]; then
    errors_json="["
    for ((i=0; i<${#errors[@]}; i++)); do
      errors_json+="\"${errors[$i]}\""
      if ((i < ${#errors[@]} - 1)); then
        errors_json+=", "
      fi
    done
    errors_json+="]"
  fi
  
  cat << EOF
{
  "status": "success",
  "summary": "Scanned and registered ${#all_skills[@]} skills",
  "artifacts": {
    "registry": "$REGISTRY_FILE",
    "skills_count": ${#all_skills[@]}
  },
  "validation": {
    "valid": $valid_count,
    "invalid": $invalid_count,
    "errors": $errors_json
  },
  "next": "none",
  "risks": []
}
EOF
}

# Run main
main
