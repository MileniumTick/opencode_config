#!/usr/bin/env python3
"""Quality gates for repository maintainability checks.

Checks implemented:
1) Duplicate headings in agent files (same heading repeated in same file)
2) Stale references to non-existent agent filenames inside AGENTS.md and CONTRIBUTING.md
3) Forbidden direct bash allowance in team-lead frontmatter (must be `bash: deny`)
4) Missing required docs files: AGENTS.md, CONTRIBUTING.md, DECISIONS.md, OBSERVABILITY.md
5) Missing required rules files: security-standards.md, self-doubt-protocol.md, communication-standards.md
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import re
import sys
from typing import Iterable


@dataclass
class CheckResult:
    name: str
    passed: bool
    details: list[str]


def _repo_root() -> Path:
    """Resolve repository root from script location: <repo>/scripts/check-quality-gates.py."""
    script_path = Path(__file__).resolve()
    return script_path.parent.parent


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _agent_files(root: Path) -> list[Path]:
    """Return agent markdown files from supported directories.

    Supports both legacy `agent/` and current `agents/` folder names.
    """
    files: list[Path] = []
    for dirname in ("agents", "agent"):
        directory = root / dirname
        if directory.is_dir():
            files.extend(sorted(directory.glob("*.md")))
    return sorted(set(files))


def _normalize_heading(text: str) -> str:
    # Remove closing markdown hashes and normalize spacing/case.
    text = re.sub(r"\s*#+\s*$", "", text.strip())
    text = re.sub(r"\s+", " ", text)
    return text.casefold()


def check_duplicate_headings(root: Path) -> CheckResult:
    heading_re = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
    files = _agent_files(root)

    if not files:
        return CheckResult(
            name="Duplicate headings in agent files",
            passed=False,
            details=["No agent files found in `agents/` or `agent/` directories."],
        )

    failures: list[str] = []
    for file_path in files:
        seen: dict[str, tuple[str, int]] = {}
        duplicates: list[tuple[str, int, int]] = []
        for line_no, line in enumerate(_read_text(file_path).splitlines(), start=1):
            match = heading_re.match(line)
            if not match:
                continue

            original = match.group(2).strip()
            key = _normalize_heading(original)
            if key in seen:
                _, first_line = seen[key]
                duplicates.append((original, first_line, line_no))
            else:
                seen[key] = (original, line_no)

        if duplicates:
            formatted = "; ".join(
                f"`{title}` (first: L{first}, duplicate: L{dup})"
                for title, first, dup in duplicates
            )
            failures.append(f"{file_path.relative_to(root)} -> {formatted}")

    return CheckResult(
        name="Duplicate headings in agent files",
        passed=not failures,
        details=failures
        if failures
        else [f"Scanned {len(files)} agent files; no duplicates found."],
    )


def _extract_agent_path_references(content: str) -> set[str]:
    pattern = re.compile(r"(?P<path>(?:\./)?(?:agents?|agent)/[A-Za-z0-9._-]+\.md)")
    refs = set()
    for match in pattern.finditer(content):
        ref = match.group("path")
        refs.add(ref[2:] if ref.startswith("./") else ref)
    return refs


def check_stale_agent_references(root: Path) -> CheckResult:
    docs = [root / "AGENTS.md", root / "CONTRIBUTING.md"]
    missing_docs = [d.name for d in docs if not d.is_file()]
    if missing_docs:
        return CheckResult(
            name="Stale agent filename references in AGENTS.md and CONTRIBUTING.md",
            passed=False,
            details=[
                "Cannot evaluate stale references because required doc(s) are missing: "
                + ", ".join(missing_docs)
            ],
        )

    stale: list[str] = []
    total_refs = 0
    for doc in docs:
        refs = sorted(_extract_agent_path_references(_read_text(doc)))
        total_refs += len(refs)
        for ref in refs:
            resolved = root / ref
            if not resolved.is_file():
                stale.append(f"{doc.name}: `{ref}` does not exist")

    return CheckResult(
        name="Stale agent filename references in AGENTS.md and CONTRIBUTING.md",
        passed=not stale,
        details=stale if stale else [f"Validated {total_refs} agent file references."],
    )


def _extract_frontmatter(text: str) -> str | None:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None

    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            return "\n".join(lines[1:idx])
    return None


def _clean_yaml_scalar(value: str) -> str:
    value = value.strip()
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1].strip()
    return value


def check_team_lead_bash_deny(root: Path) -> CheckResult:
    candidates = [root / "agents" / "team-lead.md", root / "agent" / "team-lead.md"]
    team_lead = next((path for path in candidates if path.is_file()), None)

    if team_lead is None:
        return CheckResult(
            name="team-lead frontmatter bash policy",
            passed=False,
            details=["`team-lead.md` not found in `agents/` or `agent/`."],
        )

    frontmatter = _extract_frontmatter(_read_text(team_lead))
    if frontmatter is None:
        return CheckResult(
            name="team-lead frontmatter bash policy",
            passed=False,
            details=[
                f"{team_lead.relative_to(root)} is missing valid YAML frontmatter."
            ],
        )

    bash_values: list[str] = []
    for line in frontmatter.splitlines():
        match = re.match(r"^\s*bash\s*:\s*(.*?)\s*$", line)
        if match:
            bash_values.append(_clean_yaml_scalar(match.group(1)))

    if not bash_values:
        return CheckResult(
            name="team-lead frontmatter bash policy",
            passed=False,
            details=[
                f"{team_lead.relative_to(root)} frontmatter has no `bash:` entry."
            ],
        )

    if len(bash_values) != 1 or bash_values[0] != "deny":
        return CheckResult(
            name="team-lead frontmatter bash policy",
            passed=False,
            details=[
                f"{team_lead.relative_to(root)} has `bash` value(s): {bash_values}. Expected exactly `bash: deny`."
            ],
        )

    return CheckResult(
        name="team-lead frontmatter bash policy",
        passed=True,
        details=[f"{team_lead.relative_to(root)} uses `bash: deny` as required."],
    )


def _check_required_files(root: Path, title: str, files: Iterable[Path]) -> CheckResult:
    missing = [str(path.relative_to(root)) for path in files if not path.is_file()]
    return CheckResult(
        name=title,
        passed=not missing,
        details=missing if missing else ["All required files are present."],
    )


def check_required_docs(root: Path) -> CheckResult:
    required = [
        root / "AGENTS.md",
        root / "CONTRIBUTING.md",
        root / "DECISIONS.md",
        root / "OBSERVABILITY.md",
    ]
    return _check_required_files(root, "Required docs files", required)


def check_required_rules(root: Path) -> CheckResult:
    filenames = [
        "security-standards.md",
        "self-doubt-protocol.md",
        "communication-standards.md",
    ]

    missing: list[str] = []
    for filename in filenames:
        # Primary convention: rules/<file>.md. Defensive fallback: root file.
        primary = root / "rules" / filename
        fallback = root / filename
        if not primary.is_file() and not fallback.is_file():
            missing.append(f"rules/{filename}")

    return CheckResult(
        name="Required rules files",
        passed=not missing,
        details=missing if missing else ["All required rules files are present."],
    )


def _print_report(results: list[CheckResult], root: Path) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    overall_pass = all(result.passed for result in results)

    print("# Quality Gates Report")
    print()
    print(f"- Repository: `{root}`")
    print(f"- Generated: {now}")
    print()

    for idx, result in enumerate(results, start=1):
        status = "PASS ✅" if result.passed else "FAIL ❌"
        print(f"## {idx}) {result.name}: {status}")
        for detail in result.details:
            print(f"- {detail}")
        print()

    overall = "PASS ✅" if overall_pass else "FAIL ❌"
    print(f"## Overall: {overall}")


def main() -> int:
    try:
        root = _repo_root()
        if not root.is_dir():
            print(
                "# Quality Gates Report\n\n"
                f"- FATAL: Repository root could not be resolved from script location: `{root}`"
            )
            return 1

        results = [
            check_duplicate_headings(root),
            check_stale_agent_references(root),
            check_team_lead_bash_deny(root),
            check_required_docs(root),
            check_required_rules(root),
        ]

        _print_report(results, root)
        return 0 if all(result.passed for result in results) else 1
    except Exception as exc:  # Defensive fail-safe for CI visibility.
        print("# Quality Gates Report")
        print()
        print(f"- FATAL: Unexpected error while running quality gates: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
