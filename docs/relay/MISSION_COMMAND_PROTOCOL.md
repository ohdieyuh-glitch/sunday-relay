# Mission Command Protocol — Mission Operations Milestone 2

Status: implemented (deterministic, browser-safe, no live integration)
Module: `src/relay/mission/commands/`
Tests: one `*.test.ts` per module plus `command-scenarios.test.ts` (the twelve
required fixtures A–L end-to-end) and `command-boundary.test.ts` (zero
external activity, source-asserted)

## The rule this protocol enforces

> Natural language never directly mutates mission state.
> A user command is a REQUEST for a state transition — it is not itself a
> state transition.

"Stop Codex" does not stop anything. It enters a pipeline that decides what
the user intends, whether it is safe, what must be captured first, and whether
a human must confirm — and only an atomic executor applies the result:

```
natural-language request
  → deterministic interpretation      (command-interpreter boundary)
  → typed mission command             (command-types)
  → consequence analysis              (checkpoint · dependencies · independence)
  → ownership / dependency / permission / independence validation
  → checkpoint requirements           (checkpoint-before-intervention)
  → risk + approval calculation       (domain-controlled, never the interpreter)
  → command preview                   (Relay Will / Relay Will Not)
  → atomic state transition           (command-executor, all-or-nothing)
  → immutable command events          (append-only, redacted)
```

## Interpretation versus validation

The interpreter (`deterministic-command-interpreter.ts`) supports a documented
set of exact/pattern FIXTURES and never guesses: a request it cannot resolve
deterministically returns `clarification_required` (with the missing
information — "Stop it and give it to the other one" yields target task,
current agent, replacement agent) and unrecognized language returns
`rejected`. It emits a `RelayMissionCommandDraft` — targets, typed
`RelayStateChange`s, and the mission/task revisions it saw — nothing more.

A FUTURE model-backed interpreter plugs in behind the same
`RelayMissionCommandInterpreter` interface and gains no additional authority:
whatever any interpreter emits still passes the full 24-step validation
pipeline and the atomic executor. Interpretation confidence is typed
(`'deterministic'` today); risk is NEVER assigned by an interpreter.

## The typed command lifecycle

`received → interpreted → validation_required → validated → executing →
executed`, with `rejected` and `failed` as inspectable terminals. This
lifecycle is deliberately NOT the Milestone 1 four-status model: commands are
requests ABOUT missions/tasks. Affected entities transition through the real
Milestone 1 engine (`applyStatusTransition`) — the command layer holds no
private transition rules and cannot bypass cross-dimension invariants,
release gating, or stale-artifact review detection.

## Validation pipeline (`command-validator.ts`)

Twenty-four ordered checks: existence (mission/tasks/agents), revision
staleness (mission and per-task), entity-state compatibility (the interpreted
`previousState` must still be true), Milestone 1 transition validity,
ownership/partial-work/child-process identification, checkpoint calculation,
dependency analysis, review/evidence evaluation with stale-review
consequences, reviewer independence, Agent Passport + permission
compatibility, workspace compatibility, Mission Contract conflicts,
security-policy conflicts, budget consequences, risk, approval, and finally
ATOMIC APPLICABILITY — the whole change set is simulated through the real
Milestone 1 engine before the command may be called valid. Validation never
mutates the context (tested by snapshot).

## Checkpoint-before-intervention

Pause / cancel / redirect / reassign against active work calculate a typed
`RelayCommandCheckpointRequirement`: which of partial output, changed files,
commands, tests, errors, findings, processes, workspace state, cost, and
unresolved questions must be captured (a LIST — interrupted work usually has
several). The requirement becomes a prerequisite; the executor refuses to run
while it is pending and refuses permanently while it is failed. Nothing
checkpoints real files or processes here — these are deterministic domain
records (`CommandRunPartialWork`, opaque `childProcessRefs`).

## Dependency protection

Pausing a prerequisite lists its blocked dependents; cancelling walks the
TRANSITIVE closure of invalidated dependents; redirecting lists consumers of
the previous output; reassignment preserves dependency relationships.
Affected dependency ids travel on the command, invalidation raises risk, and
starting/resuming a task whose prerequisites are incomplete is
`DEPENDENCY_BLOCKED`. Plain list traversal — deliberately not a graph
database.

## Reviewer independence

Reuses the PRODUCTION structural rule (`reviewerIsIndependent`,
`src/relay/mission/entitlement.ts`): same agent, same session, same adapter
lineage, or same independence group is never independent, and a NEW SESSION
of the same execution identity is the same party. The protected invariant:
the original implementer MAY repair its own artifact but may NEVER
independently approve it; interrupting a review preserves confirmed partial
findings and the independent re-review requirement; approval requires a
completed INDEPENDENT review of the CURRENT artifact revision — a stale
review (`STALE_REVIEW`) or a missing one (bypass, critical risk) rejects.

## Permissions, workspaces, contracts

Permission compatibility validates the replacement agent's typed permission
record (read/write path coverage, responsibility coverage, expiry,
revocation, production access) — a read-only reviewer cannot take a repair
task, and a repair assignment never carries release authority. Changes are
classified: production-write expansion and network widening are EXPANSIONS
(critical/security-weakening); prohibitions are narrowings. Workspace rules:
one active write owner, no silent inheritance, CLI and browser worktrees are
never confused, and every ownership transfer is an EXPLICIT
`workspace` state change the executor applies visibly or not at all.
Mission Contract conflicts are never silently bypassed: amendable contracts
route through explicit human approval at calculated risk; non-amendable
contracts reject (`MISSION_CONTRACT_CONFLICT`, `SECURITY_POLICY_CONFLICT`,
hard budget limits → `BUDGET_CONFLICT`).

## Risk and human approval

`calculateCommandRisk` is deterministic and DOMAIN-controlled (low: resume a
valid waiting task; medium: pause behind a safe checkpoint; high: cancel with
partial changes, review invalidation, ownership transfer, material budget
increase, permission expansion; critical: production writes, deployment,
security weakening, evidence discard, review/budget bypass, release without
approval). `calculateApprovalRequirement` is computed separately: losing
partial work, invalidating a review, transferring ownership, material budget
increases, production/security changes, releasing/deploying, or bypassing any
gate demands a typed human-approval prerequisite — and high/critical risk
always does. There is no approval UI or authentication here; approvals are
domain records.

## Preview, events, storage, atomicity

`projectCommandPreview` is a pure projection: requested command,
interpretation, RELAY WILL (checkpoint first, every typed change, preserved
findings, retained re-review), RELAY WILL NOT (approve its own repair, mark
verification complete, mark release eligible, merge, deploy), affected
entities, risk, approval, and readiness — derived entirely from typed data.

Events (`command-events.ts`) are frozen at creation, sequence-ordered per
command, mission-revision-linked, and their metadata passes the secret
redactor (key-name and value patterns) before storage. The repositories
(`command-repository.ts`) are IN-MEMORY, deterministic, and clearly
non-production: unique command ids, append-only contiguous event streams with
no delete/replace API, deep-frozen returned clones, inspectable rejected and
failed commands, and stored execution outcomes for idempotent duplicate
responses.

The executor re-reads the live context, re-validates revisions,
prerequisites, permissions, and workspaces, builds the COMPLETE next context
on a clone (every Milestone 1 transition through the real engine), and
commits in ONE replacement. Any failure after execution begins emits
`command_failed`, applies NOTHING (including earlier changes in the same
command), and preserves the original context byte-for-byte. Duplicate
execution returns the stored outcome with zero new events.

## What is deterministic / mock here

Everything. Zero provider calls, zero network, zero process control, zero
storage beyond the labeled in-memory repositories, zero clock reads — ids and
timestamps are caller-supplied, exactly as in Milestone 1
(`command-boundary.test.ts` asserts all of this at the source level, plus the
import allowlist: the domain reaches only `../status/status-model`,
`../entitlement`, and `../terminal`).

## Future integration boundaries

- **Milestone 3 — Execution Capsules**: `CommandAgentPassportRecord` grows
  into the real Agent Passport; `RunStatus`/`TaskStatus` adapt into per-agent
  execution capsules; `childProcessRefs` bind to real capsule process records
  (still never controlled from the command domain).
- **Milestone 4 — Aquala Trace**: command events gain hash chaining and
  durable append-only storage; the in-memory event store retires;
  reconstruction becomes the ledger's integrity check.
- **Milestone 5 — Mission Economics**: `CommandBudgetContext` gains real
  spend tracking; budget consequences move from typed limits to live
  economics; repair-attempt accounting joins contract validation.
- **Milestone 6 — Mission Operations Interface**: renders
  `RelayMissionCommandPreview`, drives clarification round-trips, and hosts
  the human approval flow. No UI ships in this milestone — the original Live
  Terminal and Demo Simulation are untouched.
