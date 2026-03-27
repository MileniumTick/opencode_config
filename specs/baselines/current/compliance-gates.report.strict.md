# Week 3 Contract Parity — Compliance Gates Report

Generated: 2026-03-27T23:28:35.397Z
Mode: strict
Baseline: /home/josue/.config/opencode/specs/baselines/current

| Check | Severity | Status | Drift Count |
|---|---|---|---:|
| T1 Task State Contract Test | critical | PASS | 0 |
| T2 Tool Args Schema Parity Test | high | PASS | 0 |
| T3 Tool Response Shape Parity Test | critical | PASS | 0 |
| T3C Tool Response Shape Coverage | medium | PASS | 0 |
| T4 DDL Parity Diff Test | high | PASS | 0 |
| T5 Recovery Safety Test | critical | PASS | 0 |
| T6 Documentation Consistency Check | medium | PASS | 0 |
| T7 Recovery Drill Evidence + KPI/SLO Gate | critical | PASS | 0 |

Gate Result: **PASS**
Blocking Failures: none

## Coverage
Response shapes: 32/32 (100%)
Missing response commands: none

## Recovery Observability
Recovery ops success: 100% (SLO min 100%)
Stale claim requeue coverage: 100% (SLO min 100%)
Delegation resolution rate: 100% (SLO min 100%)
Stale claim requeue latency: 0ms (SLO max 10000ms)
Critical breaches: none

## Policy Notes
Strict mode enforces frozen baseline with zero drift across args/shape/DDL/task-state checks.
Strict mode escalates medium severity failures/warnings to blocking.
Recovery drill gate requires minimum evidence IDs and critical KPI/SLO compliance (ops success/requeue coverage/delegation resolution/requeue latency).
No allowlist exceptions configured in this run.

## Details
### T1 — Task State Contract Test
- No drift detected

### T2 — Tool Args Schema Parity Test
- No drift detected

### T3 — Tool Response Shape Parity Test
- No drift detected

### T3C — Tool Response Shape Coverage
- Coverage: 32/32 (100%)
- No missing commands in response shape coverage

### T4 — DDL Parity Diff Test
- No drift detected

### T5 — Recovery Safety Test
- Recovery safety probe passed (team_id=9a70e95c-6fa2-4212-9245-19d2387f9920)
- Requeued task IDs: 131f38fe-5909-41a8-967d-da659af006c5

### T6 — Documentation Consistency Check
- Canonical flow and contract references are consistent across target files
- /home/josue/.config/opencode/skills/sdd-workflow/SKILL.md:ok
- /home/josue/.config/opencode/skills/sdd-apply/SKILL.md:ok
- /home/josue/.config/opencode/skills/sdd-tasks/SKILL.md:ok
- /home/josue/.config/opencode/skills/sdd-verify/SKILL.md:ok
- /home/josue/.config/opencode/skills/sdd-archive/SKILL.md:ok
- /home/josue/.config/opencode/skills/sdd-spec/SKILL.md:ok
- /home/josue/.config/opencode/skills/sdd-explore/SKILL.md:ok
- /home/josue/.config/opencode/skills/sdd-init/SKILL.md:ok

### T7 — Recovery Drill Evidence + KPI/SLO Gate
- Recovery ops success rate: 100%
- Stale claim requeue coverage: 100%
- Delegation resolution rate: 100%
- Mailbox resolution rate: 100%
- Stale claim requeue latency: 0ms

