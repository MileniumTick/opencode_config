# OpenCode Agent Teams Runtime v1 Specification

## Objective

Define the required behavior for a local-first multi-agent runtime where SQLite is the live coordination source of truth, Engram is the durable memory and artifact layer, and Git is the source of truth for code and branch state.

## Scope

This specification covers:

- delegation lifecycle
- shared task board behavior
- mailbox messaging behavior
- recovery and reconciliation behavior
- Git workflow policy enforcement

## Functional Requirements

### 1. Coordination authority boundaries

- The runtime must store active coordination state in SQLite.
- The runtime must store durable checkpoints, summaries, and artifacts in Engram.
- The runtime must consult Git directly for repository, branch, and working tree truth.
- The runtime must not use Engram as the mutable live task board, queue, or lock store.

### 2. Shared task board

- Tasks must be created, updated, claimed, released, blocked, and completed through SQLite-backed transactions.
- Each task must expose status, assignee, priority, lane, and optional dependency metadata.
- The board view must be derived from current SQLite state.
- Task ownership changes must be atomic.
- When available, registered agent lease state should be synchronized with task claims and recovery actions.

### 3. Delegation

- Delegation must create an explicit runtime record connecting source agent, target agent, and related work.
- Delegated work must be queryable independently from the parent work item.
- Acceptance or rejection of delegation must update delegation state transactionally.
- When platform session APIs are available, delegation launch must create a real child session rather than simulate execution.
- Runtime delegation records must persist child-session identifiers and enough metadata to reconcile launch, completion, and failure.
- Completion of delegated work must support linking durable artifacts or summaries in Engram.

### 4. Mailbox

- Directed messages between agents must be stored in SQLite.
- Messages must support explicit status transitions such as delivered, read, and resolved.
- Messages may reference related tasks or delegations.
- Unresolved messages must be recoverable after restart.

### 5. Recovery

- Recovery must start from SQLite runtime state.
- Recovery must consult Engram for linked checkpoints, summaries, and artifacts.
- Recovery must identify stale agents, incomplete delegations, unresolved mailbox items, and unfinished Git work items.
- Recovery must record reconciliation decisions.
- Recovery must not recreate live work from Engram alone when current SQLite state does not support that work.
- Recovery actions such as requeueing stale claims or marking the team recovering or active must be explicit runtime operations.

### 6. Git workflow

- Branch metadata for code-related tasks must be recorded in runtime state.
- Code-related tasks must support persisted PR metadata when known.
- Branches matching `hotfix/*` must target `main`.
- All other working branches must target `development`.
- Verify or archive workflows must confirm Git policy directly against repository state before completion.
- Commit grouping must support either a single focused commit or multiple logical commits when the work is naturally partitioned.

### 7. Artifact linkage

- Runtime entities must support explicit durable artifact links in SQLite.
- Artifact links must be able to reference Engram checkpoints, summaries, observations, or external durable URIs.
- Recovery inspection and checkpoints must include linked artifact context without treating those links as proof of live ownership.

## Acceptance Scenarios

### Scenario 1: Create and claim task

Given a running team runtime backed by SQLite
When an operator creates a new task with status `ready`
And an agent claims that task
Then the task must be visible on the shared board with the claiming agent as assignee
And the task status change and assignee update must be committed atomically in SQLite

### Scenario 2: Prevent split task ownership

Given a task in status `ready`
When two agents attempt to claim the same task concurrently
Then only one claim operation must succeed
And the losing agent must observe the committed owner from SQLite

### Scenario 3: Create delegation

Given an agent owns a parent task
When the agent delegates a sub-task to another agent
Then the runtime must create a delegation record linked to the parent work
And the target agent must receive a mailbox message referencing that delegation
And both records must be committed in the same coordination transaction

### Scenario 4: Accept delegation

Given a delegation exists in status `requested`
When the target agent accepts the delegation
Then the delegation status must become `accepted` or `running`
And the delegated task ownership must reflect the target agent
And the parent agent must be able to observe the updated state from the runtime

### Scenario 5: Complete delegated work with durable output

Given a delegated task is in progress
When the target agent completes the delegated work
And the runtime writes a checkpoint or artifact to Engram
Then the delegation must transition to `completed`
And the delegated task must transition to `done`
And the resulting Engram reference must be linked back to the runtime entity

### Scenario 5a: Launch real child session for delegation

Given a delegation exists in status `requested`
When the runtime launches delegated execution
Then it must create a real child session using the OpenCode session API
And the child session must record the current session as its parent
And the runtime must persist the child session identifier on the delegation record

### Scenario 5b: Reconcile child session completion

Given a delegation has a launched child session
When the child session produces a completed assistant result
Then the runtime must synchronize that result back into the delegation record
And the delegation must transition to `completed` or `failed` based on the child session outcome
And the synchronized result must be inspectable without inventing or simulating work

### Scenario 6: Mailbox resolution

Given an agent has an unread mailbox message linked to a task
When the agent reads and resolves the message
Then the runtime must persist `read` and `resolved` timestamps or equivalent status transitions in SQLite
And the message must no longer appear as unresolved in mailbox queries

### Scenario 7: Recover after agent interruption

Given a task is assigned to an agent whose lease has expired
And there is an unresolved delegation and mailbox message linked to that work
When the runtime executes recovery
Then the expired agent must be marked `offline` or `recovering`
And the task, delegation, and mailbox items must be surfaced for requeue, reassignment, or operator review
And the runtime must record a recovery event describing the reconciliation decision

### Scenario 8: Use Engram only as durable context during recovery

Given Engram contains artifacts for a previously active task
And SQLite no longer records that task as active
When recovery runs
Then the runtime must treat the Engram records as historical context only
And it must not recreate live work unless an explicit reopen or operator action occurs

### Scenario 9: Enforce hotfix branch target

Given a task declares branch `hotfix/fix-login-timeout`
When the runtime evaluates branch policy during verify or archive
Then the target branch must be `main`
And the runtime must reject completion if the target branch is not `main`

### Scenario 10: Enforce standard branch target

Given a task declares branch `feature/runtime-mailbox-indexes`
When the runtime evaluates branch policy during verify or archive
Then the target branch must be `development`
And the runtime must reject completion if the target branch is `main`

### Scenario 11: Validate Git directly before completion

Given a task is marked `review` in SQLite
When verify or archive executes
Then the runtime must inspect Git directly for branch and working state
And it must not mark the task complete based solely on runtime metadata

### Scenario 12: Support logical commit batching

Given a work item records batching mode as `multiple`
When the implementation reaches completion review
Then the resulting Git history must be allowed to contain multiple commits
And those commits must represent logical reviewable batches rather than arbitrary fragments

## Non-Functional Expectations

- Coordination operations must be transactional and observable.
- Recovery behavior must be deterministic and auditable.
- Status vocabularies must remain finite and explicit.
- Runtime state must remain small enough to inspect and debug operationally.
- Durable artifact linkage must be traceable from runtime records.

## Out Of Scope

- multi-host distributed consensus
- remote queue infrastructure
- replacing Git hosting or merge semantics
- storing repository contents in Engram
- using mailbox messages as the canonical task system

## Exit Criteria

This specification is satisfied when implementation demonstrates:

- SQLite-backed live coordination for task board, delegation, mailbox, and recovery metadata
- Engram-backed durable checkpoints and artifacts linked to runtime entities
- deterministic recovery behavior with recorded reconciliation outcomes
- Git policy enforcement for target branches and completion checks
- clear authority separation between SQLite, Engram, and Git
