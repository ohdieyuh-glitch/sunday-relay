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

`floor` divides evenly only when the ceiling divides by the round count, so
the guarantee is AT MOST the ceiling, never exactly it: a $10 contract with two
repair rounds shares $3.333333 three times and leaves a micro-dollar unspent.
Under-spending the authorization is the safe direction.

Every role draws from that one ledger. The Prompt Architect and the Independent
Reviewer report no cost, so their reservations settle at what they held rather
than at a zero nobody measured, and a later Coding Agent round is allocated
what REMAINS — a share is an upper bound on a round, not a reservation of one.
On the default $5 contract that means the repair round runs on the remainder
rather than on a second $2.50. Splitting the ceiling by role instead would mean
inventing a ratio, which is the thing this policy exists to avoid.

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

## What the adversarial review changed

Six provider-free review agents read this change before it merged. Four
completed and raised nineteen findings; these are the ones that were real, and
what was done about them. Three would have failed a live run.

- **A repair admitted by FAILED evidence has no findings**, because
  `verifyTask` returns REPAIR whenever the subject's evidence failed, whether
  or not a reviewer wrote anything. The first version of the reviewer adapter
  refused such a review (`reviewer_prior_findings_absent`), which would have
  failed a run that was repairing exactly as designed. The refusal is gone; the
  prompt says the round was admitted by failed evidence, and the reviewer
  judges the repaired work and its evidence. `requires` no longer lists prior
  findings, because they are not required.
- **Unknown cost settled a reservation at zero.** A runtime that reports no
  cost is Unknown, not free, and freeing the whole hold handed the rest of the
  mission money the dispatch may already have spent. `commit` now takes
  `usdMicros: number | null`, and `null` settles at what was reserved.
- **A failed attempt's spend was released, not charged.** A hosted run that
  timed out after billing $4.90 returned its whole $5 hold, and the retry was
  granted the same $5 again. `release` now carries what the boundary reported
  billing, and money already spent is committed rather than freed — at what it
  cost, not at what it was allowed to cost, so a runtime that overran its
  ceiling drives the remaining budget down and, past zero, denies the next
  dispatch instead of hiding the overspend.
- **A replayed decision would have minted a second repair round**, since
  `repairRoundsBefore` counts the existing child and the replay computes the
  next round under a fresh id. The write that records a decision is now the one
  that schedules its repair.
- **A truncated context dropped the findings first**, because they are compiled
  after the Project Brain and the compiler stops at the first entry that
  overflows. The brain stays first (a revision that loses the objective is the
  worse failure) and a repair whose findings did not fit is refused with
  `repair_context_findings_dropped` rather than dispatched blind.
- **Acceptance liveness counted any child.** A succeeded sub-agent could mask a
  review that failed for good, leaving a dependent waiting forever. Only a
  reviewer child decides an undecided task, and only a repair of the planner's
  own shape keeps a REPAIR live.
- Smaller: an allocation under one cent is refused before the runtime is
  reached (a $0 ceiling still bills the turn that notices); an empty diff is no
  implementation; the compiled findings no longer appear inside the reviewer's
  "founder's original request"; a repair round's cost refusal is recorded as
  `repair:build` rather than as the first build; the packet type makes a stage
  without its charge unrepresentable; every halt names its cause in the ledger;
  and the evidence bundle gains `budget.tsv` (what each dispatch was allowed to
  spend, and what it settled).

## Known limits, stated rather than hidden

- **A crash between accepting a worker result and writing its decision leaves
  the run stalled.** The task is SUCCEEDED with no decision, nothing
  re-verifies it, and its dependents are never released; the drive loop ends
  and reports the stall. Before this change the dependent would have run
  anyway, which is the defect being fixed, so failing closed is the correct
  direction. Recovery re-verification of a decided-nothing task is recorded
  debt, not built here.
- **The allocation policy and the spend ledger are process-scoped**, as the run
  budget already was: one contract, one process, one mission. A second run
  claimed by the same process would be allocated from this mission's contract.
  Pre-existing shape, unchanged by this work, recorded in
  `docs/JULIUS_BETA_READINESS.md` alongside the durable-ledger debt.
- **Two dependencies accepted concurrently can each miss the other's release.**
  A release is computed from the decisions the accepting write can see, so if a
  fan-in's last two dependencies were accepted by two processes at the same
  instant, neither would see the other and the dependent would stay BLOCKED.
  Nothing in the live graph fans in — `build` depends on the plan alone, a
  review on the task it reviews, a repair on nothing — and a live mission is one
  process with a C.A.R.D. concurrency of 1, so the race has no reachable
  instance today. It would surface as a stall the drive loop reports, not as
  work running unverified. Computing the release inside the store's own
  transaction, or sweeping for it when a run would otherwise stall, is the fix
  if a fan-in ever enters the graph.
- **Repair rows written before this change are not lineage members** (they
  carry `CODING_AGENT` on a plan repair, or a doubled `repair:repair:` type).
  No such rows exist: a live mission's database is created and destroyed with
  its CI job.
