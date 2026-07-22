# Relay Mission Contract (Prompt 8.1)

> A serializable, revisioned projection of what Relay is authoritatively
> trying to achieve — DERIVED from existing canonical state (Project Ledger,
> Blueprint, RelayTask, CompletionPolicy, budget/loop policies), NOT a second
> source of truth. Implemented in `src/relay/mission/mission.ts` (pure,
> browser-safe). CLI: `/mission`; `relay demo competitive` shows it locked.

## Shape (RelayMissionContract)

`missionId · projectId · title · objective · requirements[] · constraints[]
· acceptanceCriteria[{id,text,blocking}] · filesInScope/OutOfScope[] ·
systemsInScope/OutOfScope[] · assumptions[] · decisions[] ·
unresolvedQuestions[] · requiredEvidence[] · requiredReviewers[] ·
implementerRequirement · reviewerRequirement · maximumRepairIterations ·
maximumReviewRuns · maximumCostUsd · maximumRuntimeMinutes · completionRule ·
status · revision · bindingDigest · createdAt/By · updatedAt/By · provenance`

## Validation (deterministic)

- Objective required.
- At least one requirement.
- At least one blocking acceptance criterion.
- Explicit files OR systems out of scope required.
- Completion rule required; a rule requiring independent review must name
  required reviewers.
- An implementer requirement (role) is required.
- Mission revision must be positive.
- Secret-shaped and hidden-reasoning content rejected.

## Revisions + handoff staleness

- The **binding digest** is a stable, order-independent hash of the BINDING
  fields only: requirements, constraints, scope, acceptance criteria,
  required reviewers, evidence rules, completion rule, repair/review limits.
- A binding change increments the revision and changes the digest
  (`isBindingChange`).
- Display-only changes (title, assumptions, decisions, open questions) do
  NOT change the digest and do NOT stale handoffs.
- A handoff pinned to an older binding digest is stale
  (`handoffIsStale`) and cannot launch.
- The actor causing a revision is recorded (`updatedBy`); previous revisions
  remain independently inspectable.

## Boundary

Relay Core owns mission status, revision, and handoff staleness. The CLI
renders read models only. The mission module is a pure leaf projection: it
imports protocol types only — never Relay Core internals, adapters, the CLI,
Node, or `child_process` (boundary-tested).

## Competitive mission (demo)

Objective: preserve anonymous access while preventing one actor from
bypassing identity limits or spending controls. 5 requirements, 6 blocking
completion criteria, Claude Code as Implementer, Codex as required
Independent Reviewer, 1 repair iteration, completion rule =
`all_blocking_criteria_and_independent_review`. All SIMULATED.

## Known limitations

Volatile (no durable revision store); the demo uses a fixed mission spec
(operator authoring is post-YC). See COMPETITIVE_FEATURE_COVERAGE.md.
