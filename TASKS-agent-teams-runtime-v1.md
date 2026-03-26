# OpenCode Agent Teams Runtime v1 Tasks

## Phase 0 - Baseline and alignment

- review existing orchestration, delegation, and memory integration code paths
- identify the runtime entrypoints that currently assume implicit agent state
- map any current SQLite, Engram, and Git touchpoints to the target architecture
- confirm where runtime-specific docs and implementation modules should live

## Phase 1 - Runtime data foundation

- ✅ define the initial SQLite schema for teams, tasks, delegations, mailbox messages, checkpoints, and runtime events
- add migration files and versioning strategy for the runtime schema
- define normalized status enums and validation rules
- ✅ implement an initial transactional runtime layer inside the OpenCode plugin

## Phase 2 - Shared task board

- ✅ implement task create and claim operations
- ✅ add atomic task claim protection to prevent dual ownership
- ✅ synchronize registered agent lease state during task claims when the claimant is known to the runtime
- ✅ implement release, block, unblock, and complete operations
- expose a board query model for lane, priority, assignee, and dependency views
- add tests for concurrent claim attempts and lifecycle transitions

## Phase 3 - Delegation workflow

- ✅ implement delegation creation linked to parent tasks
- create delegated-task records or linkage rules for sub-work
- ✅ implement delegation accept/cancel/fail/complete transition support
- ✅ wire mailbox notification creation into delegation lifecycle events
- ✅ launch real child-session-backed delegations via OpenCode SDK session APIs
- ✅ synchronize child-session completion and failure back into SQLite delegation records
- add tests for transactional delegation plus mailbox creation

## Phase 4 - Mailbox service

- ✅ implement mailbox and message persistence in SQLite
- support message types for informational, blocking, approval, and recovery events
- ✅ add read and resolve transitions with timestamps or equivalent audit fields
- ✅ add mailbox queries for unresolved, task-linked, and agent-directed messages
- test replay of unresolved mailbox items after restart

## Phase 5 - Engram durability layer

- define checkpoint payloads and artifact reference contracts
- write integration code that persists durable summaries and artifacts to Engram
- ✅ store linked Engram IDs back into runtime entity records through explicit artifact link persistence tools
- add lifecycle hooks for task completion, delegation completion, and recovery boundaries
- verify durable records can be traced from runtime IDs

## Phase 6 - Recovery and reconciliation

- ✅ implement agent heartbeat or lease expiry handling
- ✅ implement snapshot/checkpoint creation and latest-checkpoint lookup behavior
- ✅ detect stale claims, stale agents, open delegations, unresolved mail, and unfinished git work for recovery inspection
- ✅ define and implement operator-invoked requeue plus team-status recovery actions
- ✅ record recovery events with reconciliation notes
- ✅ add explicit delegation recovery actions for resolve and limited reassignment paths
- ✅ add explicit mailbox batch-resolution actions for recovery cleanup
- test interruption and restart behavior end to end

## Phase 7 - Git workflow enforcement

- ✅ add branch metadata fields to code-related work items
- ✅ implement policy checks for `hotfix/* -> main` and all other branches to `development`
- ✅ validate branch and working tree state directly from Git through runtime validation tooling
- ✅ support stored commit batching intent per work item
- add tests covering valid and invalid target-branch combinations

## Phase 8 - Operator and agent surfaces

- ✅ expose plugin tools for runtime startup, board inspection, delegation, child-session launch/sync, mailbox inspection, agent registry, git metadata, artifact links, and recovery execution
- ✅ add status reporting for active agents, blocked work, unresolved messages, and recovery outcomes
- ✅ provide operator-friendly error messages for policy violations and recovery conflicts
- ensure runtime entity IDs can be traced to Engram artifacts and Git context

## Phase 9 - Hardening and release readiness

- run concurrency, crash, and stale-lease stress tests
- audit schema migration safety and backwards-compatibility assumptions
- document failure handling and operator escalation paths
- define release checklist and rollout plan for runtime v1
- capture implementation learnings back into project memory and docs

## Suggested Delivery Order

- deliver phases 1 through 4 first so live coordination works end to end in SQLite
- deliver phases 5 and 6 next so recovery and durability are reliable
- deliver phase 7 before declaring workflow completion semantics stable
- finish phases 8 and 9 before broad rollout

## Definition Of Done

- live task board, delegation, and mailbox flows work transactionally in SQLite
- Engram stores durable checkpoints, summaries, and artifacts with linked runtime references
- recovery can reconcile interrupted work deterministically
- Git policy is enforced before completion workflows succeed
- documentation, spec, and implementation status remain aligned
