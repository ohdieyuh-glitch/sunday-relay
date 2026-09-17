# The paid-run queue

Every Julius run that can spend provider money goes through one workflow,
`.github/workflows/julius-first-live-mission.yml`, and through one queue for one
paid provider slot. This file is how a session — the formal qualification, the
Live Evaluation Lab, or anything after them — dispatches, waits, and reads the
queue.

## The one spending path

`julius-first-live-mission.yml` is the only workflow that references a provider
key or the `julius-live-validation` environment, and a test fails if a second one
ever does. Its only trigger is a human (or session) `workflow_dispatch`.

A paid run is the same workflow dispatched with `confirm_live = RUN LIVE MISSION`.
Before any provider can be reached it must pass, in order:

1. **Admission** (`paid-slot` job): the trust gate from the pinned verifier, the
   queue claim (lane, key, mission) and the mission's lane grant, then the wait
   for the slot.
2. **The paid job's gates**: trust gate again, inputs, paid-attempt markers,
   the build, PostgreSQL / executor / attestation / sandbox, the Hermes profile,
   the contract check with the lane, **research observation** (the contract's
   granted hosts actually probed through Relay's bounded fetch),
   **provider readiness** (each provider accepts its key and serves the pinned
   model — metadata only, nothing generated), and role/model resolution.
3. Only then the attempt marker and the LIVE step.

A preflight is the same workflow without `confirm_live`. It skips admission,
spends nothing, and runs every check in step 2.

## Lanes and order

| rank | lane | who |
|---|---|---|
| 0 | `qualification` | the formal continuous-worker qualification (`julius-continuous-1`) |
| 1 | `qualification-repair` | its paid rerun after a repair |
| 2 | `lab` | new forward Julius missions (the Live Evaluation Lab) |
| 3 | `regression` | historical missions re-run as A/B or regression |

The lane a mission may claim is granted in `MISSION_LANES` in
`scripts/julius-live-contract-check.mjs`. A namespace not listed may claim `lab`
only. Claiming a lane the mission is not granted is refused before any spend.

**The admission rule.** A paid run PROCEEDS only when no other paid run holds the
slot (its `paid-slot` job succeeded and the run has not completed) and it is first
among all waiting paid runs by `(lane rank, created at, run id)`.

- A qualification dispatched while a lab run is **waiting** goes ahead of it.
- A qualification dispatched while a lab run is **admitted** waits for it. Nothing
  is ever preempted or cancelled: an admitted run holds a durable Julius run and
  live sandboxes.
- A waiting run continues automatically when the slot is released.
- An API error, a lagging listing or an unreadable title always resolves to
  WAIT; admission needs two consecutive PROCEED readings 15 s apart.
- The wait is bounded at 350 minutes (below GitHub's six-hour hosted-job cap);
  a run that is not admitted exits `paid_slot_wait_exhausted` having spent nothing.

The paid job also carries a job-level concurrency group
(`julius-paid-provider-slot`, `cancel-in-progress: false`) as a second line. The
workflow-level group is per run: GitHub keeps only one pending run per group and
cancels the older one when a third arrives, which is exactly what the queue
replaces.

## Dispatching: `scripts/julius-paid-dispatch.mjs`

    node scripts/julius-paid-dispatch.mjs --mission julius-continuous-1 --lane qualification --paid
    node scripts/julius-paid-dispatch.mjs --mission julius-lab-eval-1 --lane lab --paid
    node scripts/julius-paid-dispatch.mjs --mission <m> --lane <l> --paid --dry-plan   # read-only

It resolves `main`, refuses unless an accepted-main checkpoint exists for it,
checks the mission's contract and lane **as main has them** (read out of git at
the SHA), and names the attempt:

    <mission>@<main sha12>#<lane>#a<attempt>        (paid)
    <mission>@<main sha12>#<lane>#a<attempt>#preflight

- A run with the key queued or running → reported, nothing dispatched.
- A completed run with the key → the attempt is consumed; retry deliberately with `--attempt 2`.
- `--paid` requires a successful preflight at the same main; if none exists the
  client dispatches it, waits, and refuses the paid dispatch if it failed.
- **An ambiguous dispatch failure is reconciled before it is retried**: the client
  looks for the key for 90 s and dispatches again only if no run carries it (at
  most three requests).
- The `paid-slot` job refuses a second run carrying an earlier run's key, so a
  duplicate that bypassed the client still cannot spend.

## Reading the queue: `scripts/julius-paid-slot.mjs status`

    GH_TOKEN="$(gh auth token)" node scripts/julius-paid-slot.mjs status --repo ohdieyuh-glitch/sunday-relay [--logs]

prints `PAID_RUN_STATE=` one of:

| state | meaning |
|---|---|
| `IDLE` | nothing holds or waits for the slot |
| `QUALIFICATION_ACTIVE` | a `qualification` or `qualification-repair` run holds the slot |
| `LAB_ACTIVE` | a `lab` or `regression` run holds the slot |
| `QUEUED` | nothing holds the slot, runs are waiting (transient) |
| `PREFLIGHT_BLOCKED` | the latest paid run failed in a `Gate:` or `Preflight:` step |
| `PROVIDER_BLOCKED` | the latest paid run failed in LIVE and its log shows a provider refusal (`--logs` only) |

followed by the holder, the queue order, the last result and a table of run id,
mission, lane, key, head SHA, created/started, status, queue position and the
models pinned at that commit. Without `--logs`, a LIVE failure is reported as
`last_live_failure=unclassified` rather than guessed at.

## When the qualification holds the slot (Live Lab policy)

Do not sit idle and do not dispatch around it. Keep authoring and proving the
next lab fixture offline, keep deterministic repairs and tests moving, dispatch
the next approved NEW lab mission with the client as soon as it is landed — it
waits in the queue behind the qualification and proceeds by itself when the slot
is released. Historical reruns use `regression` and so wait behind lab missions.

## What is not known, stated

- **Provider balance is UNKNOWN.** No provider exposes a spend-free balance query.
  The readiness step says `provider_balance=UNKNOWN`; exhaustion surfaces when a
  provider refuses, and `status --logs` reports `PROVIDER_BLOCKED`.
- **A provider that never recovers ends the run in bounded calls**: a refused
  credential once, a transient class up to the task attempt ceiling (3), a review
  exactly once — pinned in `julius-continuous-lifecycle.e2e.test.ts` §13.
- Local Claude Code sessions need narrow permission rules to run the client and
  `gh workflow run` for these workflows; the rules are the founder's to add.
