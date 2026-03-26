# OpenCode Agent Teams Runtime v1

## Purpose

OpenCode Agent Teams Runtime v1 defines a local-first coordination runtime for multiple agents working in the same repository. The design separates operational concerns across three explicit systems of record:

- SQLite is the live coordination source of truth.
- Engram is the durable memory, artifact, and checkpoint system.
- Git is the code, branch, and merge source of truth.

This architecture exists to make concurrent agent work explicit, inspectable, and recoverable without conflating short-lived runtime state with long-lived memory or repository history.

## Scope

The runtime covers five operational capabilities:

- delegation between agents
- a shared task board for active work coordination
- mailbox messaging for directed agent communication
- deterministic recovery after interruption or process loss
- Git workflow enforcement for branch targets and completion policy

The runtime is implementation-oriented. It is intended to drive a real execution model, not merely document a conceptual workflow.

## Current Implementation Status

The current runtime foundation already exists as an OpenCode plugin backed by SQLite.

Implemented now:

- runtime team creation and status inspection
- agent registry with lease-backed heartbeat tracking
- shared task creation, listing, and transactional claiming
- delegation record creation and lifecycle transitions
- real child-session-backed delegation launch using OpenCode SDK session APIs
- event-driven and on-demand synchronization of child-session outcomes back into runtime delegation records
- mailbox message creation, listing, and resolution transitions
- recovery checkpoint creation and latest-checkpoint lookup
- recovery inspection for stale agents, stale claims, unresolved mailbox items, open delegations, and unfinished Git work items
- explicit recovery actions to requeue stale claims and mark teams recovering or active
- recovery inspection hints for orphaned delegations, child-session sync candidates, delegation reassignment review, and mailbox resolution review
- explicit recovery actions to resolve open delegations, reassign unlaunched delegations, and batch-resolve mailbox messages
- persisted git work item metadata for branch name, base branch, PR target, PR details, and commit batching mode
- persisted artifact links so runtime entities can reference Engram checkpoints, summaries, and other durable artifacts
- live Git validation tooling that checks recorded branch policy against the repository worktree

Still pending for the next milestone:

- automatic Engram writes from runtime events instead of explicit link registration tools
- interruption and restart tests that exercise the new recovery action paths end to end

## Recovery Operations Implemented Now

Recovery remains operator-invoked and auditable. The runtime now exposes explicit tools for the main non-fake reconciliation paths:

- `team_recovery_inspect`
  - inspects stale claims, stale agents, unresolved mailbox, open delegations, unfinished Git work items
  - also returns `recovery_candidates` for:
    - `orphaned_delegations`
    - `delegation_child_session_sync`
    - `delegation_reassign_review`
    - `mailbox_resolution_review`
- `team_recovery_requeue_stale_claims`
  - requeues stale claimed work back to `ready`
  - marks impacted agents `recovering` or `offline`
- `team_recovery_resolve_delegations`
  - explicitly resolves selected open delegations as `cancelled`, `failed`, or `timed_out`
  - records reconciliation notes and preserves auditability in runtime events
  - does not silently resolve linked mailbox requests
- `team_recovery_reassign_delegation`
  - only works for `requested` or `accepted` delegations with no launched child session
  - updates the target agent in SQLite
  - emits a fresh mailbox delegation request for the new target
  - can explicitly resolve prior unresolved mailbox requests tied to the old target
- `team_recovery_resolve_mailbox`
  - explicitly batch-resolves selected mailbox messages
  - records recovery mailbox resolution events and leaves unselected messages untouched

These tools intentionally do not invent execution outcomes. They only mutate runtime state when an operator chooses a recovery path.

## Child Session Delegation Support

The current OpenCode plugin environment in this repository does support plugin-side real child-session launching.

Available SDK capabilities exposed to plugins here include:

- `client.session.create(...)` with `parentID` support
- `client.session.promptAsync(...)` for background execution in the child session
- `client.session.messages(...)` for polling child-session outputs
- plugin `event` hooks that receive `message.updated` and `session.error`

That capability is sufficient to build non-fake delegation. The runtime now uses those APIs directly instead of simulating delegation with timers or local placeholder execution.

### What is implemented now

- `team_delegation_launch` creates a real child session under the current parent session
- `team_delegation_launch` submits the delegated prompt to the target agent through `promptAsync`
- SQLite delegation rows persist child-session linkage and launch/completion metadata
- `team_delegation_sync` inspects child-session messages and finalizes runtime delegation state
- plugin event handling auto-syncs completed child-session assistant outputs back into runtime state

### Remaining platform limitation

The main remaining blocker is not child-session creation. It is the absence of a single first-class SDK primitive for "launch delegation and await completion":

- `promptAsync` returns acceptance only, not a completion handle or final result payload
- completion must be inferred from `message.updated` events and/or `session.messages(...)` polling

So the platform supports real child sessions, but still requires orchestration code in the plugin to correlate launch, completion, and failure.

## Authority Model

### SQLite: live coordination authority

SQLite stores the current runtime state that must be transactionally correct while agents are active. It answers questions such as:

- which tasks exist right now
- which agent currently owns a task
- which delegations are open
- which mailbox messages are unresolved
- which recovery actions are pending
- which Git branch intent is attached to active work

SQLite is the only authority for mutable runtime coordination.

### Engram: durable context and recovery authority

Engram stores records that should survive runtime restarts and remain useful after active coordination ends. It is responsible for:

- durable checkpoints
- execution summaries
- result artifacts
- recovery notes and reconciliation history
- long-lived project memory linked to runtime entities

Engram is intentionally not used as a shared live task board or lock manager.

### Git: repository authority

Git remains the source of truth for:

- repository contents
- branch state
- commit history
- merge intent
- working tree truth

Runtime records may reference Git state, but they do not replace or infer it.

## Design Goals

- keep concurrent coordination local, transactional, and inspectable
- make recovery deterministic and auditable
- preserve a strict boundary between active runtime state and durable memory
- enforce Git workflow rules without replacing Git-native truth
- support incremental implementation with clear service boundaries

## Non-Goals

- distributed multi-host coordination
- using Engram as a mutable queue or lock service
- treating runtime intent as proof of repository state
- replacing Git branching or merge mechanics
- durable code storage outside the repository

## Runtime Responsibilities

The runtime is responsible for:

- managing teams, agents, tasks, delegations, mailboxes, and recovery records
- applying transactional claims and state transitions
- coordinating work ownership across agents
- linking live work to durable Engram artifacts and checkpoints
- validating Git policy before completion workflows advance

The runtime is not responsible for:

- storing canonical code content
- inventing merge outcomes
- rebuilding repository history from runtime records
- synchronizing coordination across multiple machines

## Component Architecture

### Runtime coordinator

The runtime coordinator owns SQLite access and exposes the transaction boundary for every stateful coordination action. It must guarantee atomic updates for:

- task creation and assignment
- delegation creation and acceptance
- mailbox delivery and resolution
- heartbeat or lease transitions
- recovery reconciliation updates

### Shared task board service

The task board service presents the live work queue for the team. It manages:

- task lifecycle state
- assignee ownership
- dependencies and blockers
- lane and priority metadata
- branch context for code-related work

All task board views are derived from current SQLite state.

### Delegation service

The delegation service creates and tracks sub-work relationships. It must:

- link a parent work item to delegated work
- assign the target agent explicitly
- record acceptance, rejection, completion, and failure
- maintain visibility into delegation lineage for recovery and reporting

### Mailbox service

The mailbox service supports directed communication between agents and between the orchestrator and agents. It covers:

- informational messages
- blocking requests
- approval or clarification requests
- recovery notices
- task-linked operational updates

Mailbox state is separate from task state, even when both reference the same work item.

### Recovery manager

The recovery manager reconstructs a usable runtime after interruption. It is responsible for:

- loading current SQLite state and snapshots
- identifying stale leases and orphaned work
- retrieving linked Engram checkpoints and summaries
- deciding whether work should be resumed, requeued, or flagged for operator review
- recording reconciliation actions for auditability

### Git policy engine

The Git policy engine validates workflow constraints attached to active work. It must:

- validate branch target rules
- record intended base and target branch metadata per work item
- confirm Git state directly before completion or archive workflows
- reject invalid completion attempts when branch policy is violated

### Engram integration layer

The Engram integration layer writes durable records and references them back to runtime entities. It is responsible for:

- checkpoint creation
- artifact publication
- summary persistence
- recovery linkage between runtime IDs and Engram records

It must never become the authority for current task ownership, mailbox resolution, or delegation status.

## Data Model

The SQLite schema should remain explicit and small enough to inspect operationally. Core tables are:

### `teams`

- runtime team identity
- lifecycle status
- timestamps and runtime metadata

### `agents`

- agent identity and role
- capability tags
- current status
- heartbeat or lease metadata
- recovery state markers

### `tasks`

- task title and description
- lane, priority, and status
- assignee agent
- dependency and blocker fields
- optional Git context for code work

### `delegations`

- source agent and target agent
- source task and delegated task linkage
- lifecycle timestamps
- delegation status and failure reason

### `mailboxes`

- mailbox identity by scope or agent

### `messages`

- sender and recipient
- related task or delegation
- message type and resolution status
- created, read, and resolved timestamps

### `runtime_snapshots`

- snapshot version and creation timestamp
- runtime status summary
- pointers to related Engram checkpoints where relevant

### `recovery_events`

- restart and reconciliation history
- operator or automated action records
- outcome notes

### `git_work_items`

- branch name
- base branch
- target branch
- PR number and URL
- change scope
- commit batching mode
- workflow status

### `artifact_links`

- runtime entity type and ID
- linked Engram checkpoint IDs
- linked artifact IDs
- linked summary references
- optional URI, note, and JSON metadata

Recommended normalized status vocabularies:

- task status: `todo`, `ready`, `in_progress`, `blocked`, `review`, `done`, `failed`
- delegation status: `requested`, `accepted`, `running`, `completed`, `failed`, `cancelled`
- message status: `pending`, `delivered`, `read`, `resolved`
- agent status: `idle`, `busy`, `waiting`, `offline`, `recovering`

## Core Runtime Flows

### Delegation flow

1. A source agent requests delegation for a specific task or sub-task.
2. The runtime creates the delegation record and, if needed, a delegated task in the same transaction.
3. The target agent receives a mailbox message referencing that delegation.
4. The target agent accepts or rejects the work.
5. Acceptance atomically updates delegation state and task ownership.
6. Completion records task outcome and links durable artifacts or summaries in Engram.

### Shared task board flow

1. Tasks are created centrally in SQLite.
2. Agents claim or are assigned work through transactional updates.
3. Dependencies and blockers are updated directly on the task record.
4. Board views are rendered from current task state rather than inferred from message history.

### Mailbox flow

1. Messages are written into SQLite mailbox state.
2. Messages may reference tasks, delegations, or recovery actions.
3. Read and resolution state are tracked explicitly.
4. Recovery can replay unresolved mailbox items from live runtime state.

### Checkpoint flow

1. The runtime reaches a defined boundary such as task completion, delegation completion, or recovery preparation.
2. A durable summary, checkpoint, or artifact is written to Engram.
3. SQLite stores the resulting reference in `artifact_links` or related runtime tables.
4. Recovery and audit flows use those references later without making Engram the active coordinator.

### Git workflow flow

1. A task declares branch intent when code changes are expected.
2. The runtime records branch metadata in SQLite.
3. Git operations occur against the repository itself.
4. Verify or archive workflows confirm branch target and commit grouping rules before marking work complete.

## Recovery Model

Recovery begins from SQLite because it owns the live coordination view. Engram enriches that view with durable artifacts, checkpoints, and summaries. Git remains authoritative for repository state.

### Recovery principles

- SQLite is the first source consulted for active runtime state.
- Engram supplements recovery but does not override live coordination state by default.
- Git truth must be re-read directly during recovery-sensitive workflows.
- recovery actions must be auditable and repeatable.

### Recovery sequence

1. Open the SQLite runtime database.
2. Load current entity state and the latest valid snapshot.
3. Detect stale agent leases, incomplete delegations, unresolved messages, and unfinished Git work items.
4. Fetch linked Engram checkpoints and summaries for impacted entities.
5. Reconstruct agent-facing context using SQLite current state plus Engram durable context.
6. Reassign, requeue, or flag work according to runtime policy, including explicit operator-invoked recovery actions.
7. Record a recovery event describing reconciliation decisions.

### Recovery rules

- task ownership always comes from SQLite
- historical context and artifacts come from Engram
- branch truth comes from Git
- stale work is reclaimed through lease-expiry or explicit operator action, not by assuming Engram implies liveness
- durable artifacts without active SQLite state remain history until an operator or policy explicitly reopens work

## Git Workflow Policy

Git policy is enforced as runtime policy, not as a substitute for repository state.

### Branch target rules

- branches matching `hotfix/*` must target `main`
- all other working branches must target `development`

### Commit policy

- prefer a single commit for small, cohesive changes
- require multiple commits when work naturally separates into reviewable batches
- store intended batching mode with the work item when known

### Operational rules

- runtime state cannot prove that repository changes exist
- task completion does not automatically imply merge readiness
- verify and archive workflows must check Git state directly before completion

## Failure Modes And Tradeoffs

SQLite simplifies local correctness and recovery, but it limits write concurrency compared with a distributed coordination system. That tradeoff is acceptable for a local-first runtime.

Keeping SQLite and Engram separate introduces intentional duplication between live state and durable history. This duplication improves correctness because active coordination remains transactional while durable context remains stable across restarts.

Recovery quality depends on disciplined checkpointing. The runtime remains recoverable without perfect checkpoints, but operator context and replay quality degrade when checkpoints are missing.

Mailbox state and task board state are separate on purpose. This avoids semantic confusion, but implementers must keep messaging workflows from becoming a shadow task system.

## Implementation Guidance

### Phase 1: runtime foundation

- define the SQLite schema and migrations
- implement transactional services for task, delegation, mailbox, and agent lifecycle updates
- add heartbeat or lease handling for agent liveness

### Phase 2: durable artifact integration

- define Engram checkpoint and artifact contracts
- persist runtime-to-Engram links
- add summary or checkpoint hooks at key lifecycle boundaries

### Phase 3: recovery and reconciliation

- implement snapshot loading and stale-agent detection
- rebuild agent-facing context from SQLite and Engram references
- add operator-visible reconciliation reporting

### Phase 4: Git policy enforcement

- implement branch target validation
- store branch intent and batching mode per work item
- enforce policy during verify and archive flows

### Phase 5: operator surface

- expose CLI or service commands for startup, delegation, mailbox inspection, recovery, and policy validation
- provide runtime status and audit views for active teams

### Phase 6: hardening

- test contention, crashes, stale lease handling, and checkpoint completeness
- add schema versioning and migration safety
- define operator escalation paths for failed recovery or policy conflicts

## Delivery Criteria

The architecture is considered successfully realized when:

- all live coordination flows execute transactionally against SQLite
- Engram stores checkpoints, summaries, and artifacts with linked runtime IDs
- Git policy is enforced before work completion without replacing Git truth
- interrupted runs can be recovered with deterministic, auditable reconciliation
- agents can coordinate through task board, delegation, and mailbox flows without split-brain state
