# The Julius MVP qualification suite

**The question this page answers** is the founder's, not the architecture's:
*can Julius reliably accomplish useful human objectives?* — across software
development, game development, professional work, and failure/recovery. It is
organised by those four categories, and every row is **machine-checked**:
`scripts/julius-mvp-qualification.test.ts` resolves every file and requires
every case reference to name a case that exists. A reference that cannot be
resolved is not evidence, and that applies to this page.

**Two kinds of row.** DETERMINISTIC means the real runtime with the provider
replaced at its own boundary — it proves Julius and nothing about a model. LIVE
means a real provider answered; the suite holds exactly **one**, paid run
34414726976, and the test pins that count because a live row costs money and a
founder's authorisation.

**What "representative" means here.** Not many missions — a small set that
exercises the real system deeply: the real run loop, the real pipeline, the real
live composition where the case names it, the real durable store read back
afterwards. Volume is not claimed and would not help.

## Category A — software development

| # | Shape | Kind | Where | Case |
|---|---|---|---|---|
| A1 | feature implementation, clean | DETERMINISTIC | `relay-bridge/julius/julius-live-composition.test.ts` | `runs architect → coder → reviewer through Julius and completes only via verification` |
| A1L | feature implementation, clean | **LIVE** | `docs/JULIUS_PAID_RUN_34414726976_LIVE_RUN_3.md` | *(bundle, not a case)* |
| A2 | bug repair after a real reviewer catch | DETERMINISTIC | `relay-bridge/julius/julius-live-composition.test.ts` | `catches the defect, sends it back, and completes once the repair removes it` |
| A3 | reviewer rejection that refuses to launder | DETERMINISTIC | `relay-bridge/julius/julius-live-composition.test.ts` | `catches the defect again when the repair does not remove it` |
| A4 | multi-file change, attributed per attempt | DETERMINISTIC | `src/relay/mission/julius/julius-attempt-workspace.e2e.test.ts` | `attempt 2 owns only B and C, and reports A and B as inherited` |
| A5 | scope enforcement on a real change set | DETERMINISTIC | `src/relay/mission/julius/julius-coding-agent-scope.e2e.test.ts` | `an edit to an out-of-scope path — here a brand-new untracked file — fails the work and sends it to repair` |
| A6 | a coder's completion claim held to its evidence | DETERMINISTIC | `src/relay/mission/julius/julius-coding-agent-scope.e2e.test.ts` | `a report that claims completion is refused by name, and the work still stands on its evidence` |
| A7 | architect revises a rejected plan | DETERMINISTIC | `src/relay/mission/julius/julius-paid-run-34037313976.e2e.test.ts` | `plan → plan review REJECTS → architect revises → re-review ACCEPTS` |
| A8 | tests run through the independent executor | DETERMINISTIC | `relay-bridge/julius/julius-live-composition.test.ts` | `Tool effects went through the executor port` |

## Category B — game development

| # | Shape | Kind | Where | Case |
|---|---|---|---|---|
| B1 | gameplay/tooling change with a data-file deliverable | DETERMINISTIC | `src/relay/mission/julius/julius-mission-breadth.e2e.test.ts` | `completes a game-development mission through the same lifecycle, unchanged` |
| B2 | Wonderland reads real mission state | DETERMINISTIC | `src/relay/mission/julius/julius-slot-view.e2e.test.ts` | `answers for all three roles, always, in a fixed order` |
| B3 | Wonderland reads it over the bridge | DETERMINISTIC | `relay-bridge/julius-state-routes.test.ts` | `serves the API’s own slot view for a mission that really ran` |
| B4 | Wonderland creates a mission over the bridge, through the real bootstrap | DETERMINISTIC | `relay-bridge/julius-mission-routes.test.ts` | `creates the run through the real bootstrap` |
| B5 | a created report mission is held to its DIFF, not to a test it never declared | DETERMINISTIC | `relay-bridge/julius-mission-routes.test.ts` | `carries the no-check declaration through` |
| B6 | the seam against a REAL PostgreSQL: what a client creates is what it watches, and both are what the database holds (gated on `JULIUS_REAL_POSTGRES=1` + `DATABASE_URL`) | DETERMINISTIC | `relay-bridge/julius-bridge-seam.real-postgres.test.ts` | `what a client creates is what a client then watches, and both are what the database holds` |
| B7 | re-posting a contract resumes the run in the database rather than creating a second | DETERMINISTIC | `relay-bridge/julius-bridge-seam.real-postgres.test.ts` | `re-posting the same contract resumes the same run instead of creating a second one` |

## Category C — professional work

| # | Shape | Kind | Where | Case |
|---|---|---|---|---|
| C1 | research / structured analysis to a document | DETERMINISTIC | `src/relay/mission/julius/julius-mission-breadth.e2e.test.ts` | `completes a professional-work mission with no tests and no test evidence` |
| C2 | a rejected document becomes repair, not completion | DETERMINISTIC | `src/relay/mission/julius/julius-mission-breadth.e2e.test.ts` | `still repairs a non-code mission when the reviewer rejects it` |
| C3 | the same, on the LIVE path with no test command | DETERMINISTIC | `relay-bridge/julius/julius-live-composition.test.ts` | `runs nothing, records no TEST row, and still completes on the diff it produced` |
| C4 | prior learning improves the next mission, leaking nothing | DETERMINISTIC | `src/relay/mission/julius/julius-learning-loop.e2e.test.ts` | `hands the coder the relevant finding and none of the residue` |

## Category D — failure and recovery

| # | Shape | Kind | Where | Case |
|---|---|---|---|---|
| D1 | provider failure, retried to the ceiling and no further | DETERMINISTIC | `src/relay/mission/julius/julius-continuous-lifecycle.e2e.test.ts` | `a coder whose provider is rate limited FOREVER` |
| D2 | provider refusal of the caller | DETERMINISTIC | `src/relay/mission/julius/julius-continuous-lifecycle.e2e.test.ts` | `a coder whose provider refuses its credential every time: one call, FAILED, not retried, not completed` |
| D3 | timeout is a retryable outcome, not a hang | DETERMINISTIC | `src/relay/mission/julius/julius-worker-deadline.test.ts` | `1 · the dispatch ends as a retryable TIMEOUT rather than hanging` |
| D4 | malformed provider response | DETERMINISTIC | `src/relay/mission/julius/julius-chaos.test.ts` | `refuses a malformed provider result and records no evidence from it` |
| D5 | restart: nothing executed twice | DETERMINISTIC | `src/relay/mission/julius/julius-chaos.test.ts` | `a crash between the provider result and its verification never buys the answer twice` |
| D6 | restart: the new durable records survive | DETERMINISTIC | `src/relay/mission/julius/julius-restart-survival.e2e.test.ts` | `serves the same slot view to a client after the restart as before it` |
| D7 | incomplete evidence: a reference that cannot resolve is not one | DETERMINISTIC | `src/relay/mission/julius/julius-artifact-reference.test.ts` | `is NULL for a key into this process — the value that used to be stored` |
| D8 | budget pressure stops the run rather than looping | DETERMINISTIC | `src/relay/mission/julius/julius-chaos.test.ts` | `stops rather than looping when the budget is exhausted mid-run` |
| D9 | a failed attempt that billed still counts | DETERMINISTIC | `src/relay/mission/julius/julius-evidence-completeness.e2e.test.ts` | `carries the spend of an attempt that billed and then failed` |
| D10 | context-authority clash fails closed | DETERMINISTIC | `src/relay/mission/julius/julius-context-delivery.e2e.test.ts` | `fails the task with a named failure class instead of throwing out of the tick` |

## What is NOT qualified, by category

- **A — an unfamiliar repository and a tool-HEAVY mission.** Every deterministic
  row above runs against a fixture workspace and an executor fake. The real
  Docker executor proof (`scripts/julius-sibling-e2e.ts`) is provisioned by
  `.github/workflows/julius-real-infra.yml` on a Linux runner — image builds,
  a `tmpfs` mount, generated keys — and was not run here. Inspecting an
  unfamiliar repository is proven only as far as the fixture repository is
  unfamiliar, which is not far.
- **B — a real Unreal change.** B1 is the lifecycle carrying a game-tooling
  deliverable; no row here opens Wonderland's own source under Julius's
  contracts, reviewer and evidence. That is the founder's stated strongest
  qualification environment and it is entirely unexercised. **B4 creates, it
  does not drive:** the run a client creates lands durable in READY and stays
  there until the mission job drives it — dispatch is not reachable from a
  client, by decision. B6 and B7 hold the same seam against a real PostgreSQL
  through the production compositions, and are `todo` wherever no database is
  configured — a skipped proof, never a passing one. The built bridge process
  was also driven over HTTP against that database by hand (handoff §000d, with
  the run id); a hand-run is evidence of a moment, not a row here.
- **C — a mission whose result is not a file.** A message sent, a form
  submitted, a booking made has no diff to show, and an implementation review
  still requires one. Named in `julius-mission-breadth.e2e` as a limit.
- **D — a CONTENT refusal.** D2 is a provider refusing the CALLER. A model
  declining a specific request has no failure class of its own and is
  indistinguishable from a bad credential.
- **Every category — LIVE.** One paid run, one shape. No adversarial shape has a
  live trace, and the improvement in C4 is measured over real runs of the real
  loop but rests on the fixture's stated premise that a worker without the fact
  does worse.

## How to read a row

A row proves that Julius's machinery does what the shape requires when a
provider behaves that way. It does not prove a real provider behaves that way.
Both halves are needed for MVP; only the first is buyable without money, and the
first is what this page holds.
