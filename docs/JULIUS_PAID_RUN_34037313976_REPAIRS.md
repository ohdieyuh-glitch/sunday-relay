# Julius — repairs after paid run 34037313976

Evidence: GitHub Actions run `34037313976`, job `101497635146`, commit
`b2dc9f239eeb54764beca97a2966afa24c7cc3a4`, mission `julius-live-mission-2`
(contract `spendUsd=20`, `repairCycles=3`, `max_ticks=32`). RESULT FAILED after
five ticks. Julius failed closed: no completion marker was written, and the
paid-attempt marker for the namespace now reads `attempted=2`. That marker is
not edited by this change.

## What the evidence shows, in order

1. Tick 1: the Prompt Architect produced a valid plan.
2. Tick 2: the Coding Agent ran BEFORE the plan review, implemented the change
   correctly (`workspace.diff` shows `run-summary.js` as specified; the runtime
   reported `success`, 7 turns, 6 tool uses), and was then refused post hoc by a
   hard-coded 50 cent ceiling (`coder_cost_exceeded`, non-retryable).
3. Ticks 3-4: the plan review timed out once, then applied an implementation
   rubric to a plan and produced six blocking "build" findings against a plan.
4. Tick 5: Julius correctly decided REPAIR for the plan, and the repair planner
   minted a `repair:plan` task on the CODING AGENT, which no live worker
   registers. It failed `PROVIDER_UNAVAILABLE` and the run failed.

Four defects, four fixes, all provider-free. The reviewer slot stays a
replaceable adapter; nothing Hermes-specific enters the domain.

## DEFECT 4 — build ran before the plan review cleared

The declared graph is plan -> plan review -> build -> build review. The claim
query offered any BLOCKED task whose dependencies were SUCCEEDED, and `build`
depended on `plan` alone, so `build` and `plan:review` became claimable in the
same tick.

Rule now: **a task is claimable only when Julius has released it.**

- The claim query (PostgreSQL and the in-memory model) offers RUNNABLE tasks
  only. BLOCKED is never claimable.
- Julius releases a BLOCKED task when every dependency is SKIPPED, or SUCCEEDED
  and *effectively accepted*: an ACCEPT decision, or a REPAIR decision
  superseded by an accepted repair lineage (the same rule mission completion
  already uses). `evaluateJuliusRelease` is the pure evaluator.
- The release is written in the same durable write as the accepting decision
  (`appendDecision({ releaseTaskIds })`), so a crash cannot leave a decision
  without its release or a release without its decision. A restart reads the
  same rows and reaches the same claimable set.
- Tasks Julius creates with already-satisfied dependencies (a review of a task
  that has SUCCEEDED, a repair, a sub-agent) are created RUNNABLE. Seeded
  dependents (`build`) are created BLOCKED and only Julius moves them.
- A rejected plan review records REPAIR and releases nothing; `build` stays
  BLOCKED until the revised plan is accepted.

## DEFECT 3 — a rejected plan produced an unroutable Coding Agent task

`planJuliusRepair` hard-coded `role: 'CODING_AGENT'` and
`taskType: repair:<parent taskType>` for every subject.

Rule now: **a repair inherits its subject's role and stage.**

- Role: the subject's role. A plan is revised by the Prompt Architect; an
  implementation is repaired by the Coding Agent. A reviewer is never repaired
  (its verdict is about the task it reviewed, as before).
- Stage: `repair:<stage>` where the stage strips any `repair:` prefixes, so a
  second repair round is `repair:build`, not `repair:repair:build`, and stays
  routable. Round numbering counts the whole lineage from durable task rows
  (`repairRoundsBefore`), so `repairCycles` bounds the lineage, not each hop.
- Routability is checked BEFORE the repair task exists. If no registered,
  healthy, C.A.R.D.-allowed worker accepts `(role, repair:<stage>)`, the run
  halts with `REPAIR_UNROUTABLE` and no attempt, reservation or task is spent.
- The revising worker sees the findings: Julius compiles the subject's OPEN
  blocking findings into the repair task's context as FINDING entries (and into
  the re-review's context), so the Prompt Architect revises against them and
  the reviewer judges resolution against them. The revised plan replaces the
  plan artifact the Coding Agent will read.
- The live composition registers `repair:plan` on the Prompt Architect and
  `review:repair:plan` on the reviewer; the Coding Agent keeps `repair:build`.

## DEFECT 2 — the reviewer was not stage-aware

Rule now: **the review stage is canonical task metadata, and the charge for
each stage is a provider-independent contract.**

- `reviewStageOf(taskType)` reads `review:plan`, `review:build`,
  `review:repair:plan`, `review:repair:build`. The dispatch carries `taskType`,
  so no adapter parses task ids.
- `reviewChargeFor(stage)` states what the reviewer judges, what it must NOT
  demand, and which artifacts the stage requires. A plan review judges the plan
  (objective, criteria coverage, scope, constraints, required implementation,
  verification strategy, risks, handoff readiness) and must not demand edits,
  a diff, file contents or executed tests. A build review judges the
  implementation and requires the diff and test output. A repair review adds
  "every prior finding resolved".
- The Hermes adapter consumes the stage and charge; the packet carries no diff
  or test output at the plan stage, and a build-stage review with no diff is
  refused rather than reviewed against nothing. Reviewer output remains
  evidence only; Julius alone records findings and decides.

## DEFECT 1 — the mission budget did not govern the hosted Coding Agent

Authority chain, now wired end to end:

    Mission Contract spendUsd
      -> Julius run budget (createRunSpendBudget)
        -> per-dispatch allocation (evaluateJuliusAllocation)
          -> reservation of exactly that allocation
            -> adapter execution limit (HostedLimits + SDK maxBudgetUsd)

### The allocation policy (`julius-allocation.v1`, rule `EQUAL_SHARE_OVER_AUTHORIZED_ROUNDS`)

The contract authorizes one build plus `repairCycles` repair rounds within
`spendUsd`. Each Coding Agent dispatch is therefore allocated an equal share of
the ceiling, bounded by what remains:

    share      = floor(ceilingUsdMicros / (1 + authorizedRepairRounds))
    allocation = min(share, remaining)          when remaining is known
    allocation = min(share, estimate)           when remaining is Unknown
    allocation = 0 -> dispatch denied            when remaining <= 0

For `julius-live-mission-2` (`$20`, 3 repair rounds) the share is `$5.00` per
Coding Agent dispatch; for the default contract (`$5`, 1 round) it is `$2.50`.
Nothing is a fixed ratio between roles: the Prompt Architect and the reviewer
keep their fixed estimates (they report no cost), and the share is derived from
the two contract fields alone. If every authorized round spends its full share
the mission spends exactly its ceiling and never more.

Properties held by construction and by test:

- The allocation is reserved against the run ledger before dispatch, so the sum
  of allocations never exceeds the ceiling, repairs draw from the same ledger,
  and a task allocation never exceeds the remaining budget.
- The adapter's execution limit IS the reservation: `maxCostCents` and the SDK
  `maxBudgetUsd` are set from the allocation, so the runtime stops before
  overspending, and the post-hoc ceiling check still fails closed if the
  reported cost exceeds the allocation.
- With no allocation policy, the adapter keeps its conservative 50 cent default.
  Mission 2's grant cannot leak to another mission or namespace because the
  policy is built per run from that run's contract.
- Unknown cost stays Unknown (`costSource: unavailable`); an SDK
  `error_max_budget_usd` result is refused as `coder_cost_exceeded`.
- Failure diagnostics add `costUsdMicros`, `costCeilingUsdMicros`, `costSource`.

This policy becomes canonical only when the founder approves the exact head of
the PR that carries it. No paid run is authorized by this document.
