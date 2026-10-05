# Julius Decision C: the corrected carry (`julius-carry.v2`)

**Status:** implemented on branch `relay/julius-decision-c-carry`, with cloud CI
and repo-native qualification. **AWAITING INDEPENDENT REVIEW** (SECOND). No
score is claimed. Decision C's +1.10 is earned only by the four paid arms under
the frozen registration, after this carry lands and the 13 (i) compatibility
gate holds at C's final head.

## The defect (Beta-blocking P2)

The first carry (`julius-claim-ledger.v1`, `relay-bridge/julius/mission-knowledge.ts`
on `main` `0a2b4d16`) took every claim the project held at `VERIFIED` or
`APPROVED`, of any kind. It wrote each copy into the next run with
`task_id NULL`, which makes it run-wide. Measured against what can actually
reach `VERIFIED` in the runtime, that is wrong in four ways:

| # | Defect | Where it came from |
|---|---|---|
| D1 | **Task state globalized.** An accepted review promotes *every* entry the reviewed task wrote (`juliusClaimPromotionsOnAccept`), including a coder's own `HANDOFF` notes. The carry copied them run-wide into the next mission. | `julius-claim-ledger.ts` promotion + carry `task_id NULL` |
| D2 | **A proposal promoted to truth.** A material architecture change after lock is written as a task-scoped `DECISION` reading "PROPOSED ARCHITECTURE REVISION — NOT IN FORCE". It is promoted with its task and was then carried as a verified, run-wide decision. | `julius-task-pipeline.ts` `architecture.proposed` |
| D3 | **The right thing could never travel.** The Independent Reviewer's findings are not brain entries. They live in `julius_reviewer_findings`, with their life (OPEN → ADDRESSED → RESOLVED) on the ledger. So a verified repair finding, the one thing a learning pair exists to move, was never carried. | `julius-finding-lifecycle.ts` |
| D4 | **Unknown read as zero.** A store failure was `.catch(() => [])`, so "nothing was eligible" and "nobody could look" left the same record. Nothing recorded what was considered, what was refused, or what the planner received. | `bootstrap.ts` |

## The corrected rules

These are implemented in `src/relay/mission/julius/julius-carry.ts`, which is pure.

**What carries, and nothing else:**

| Class | Rule |
|---|---|
| `VERIFIED_REPAIR_FINDING` | An Independent Reviewer's **blocking** finding. A review is on record as raising it (`finding.recorded`), at least one repair round claimed to address it, and its life ended `RESOLVED` by a reviewer's own declaration (`REVIEWER_RESOLVED` naming the resolving review). It has evidence and is not `DISMISSED`. A warning Julius promoted is recorded blocking, so it counts. |
| `VERIFIED_FINDING` | The same, resolved by the reviewer with no repair round, or a **non-blocking** finding that a repair round only happened to address (a repair marks every open finding of its unit addressed). It is verified, but it is **not** a repair finding. |
| `ACCEPTED_DECISION` | A run-wide (`task_id NULL`) `DECISION` entry whose current standing is `APPROVED` on `DECISION` evidence, so it was adopted and is in force. |

**Everything else is excluded by name.** The 17 codes, with their tests, are:
- `FINDING_DISMISSED`, `FINDING_UNRESOLVED`, `FINDING_ADDRESSED_NOT_VERIFIED`,
  `FINDING_SUPERSEDED`, `FINDING_ORIGIN_UNKNOWN`, `FINDING_RESOLUTION_UNKNOWN`,
  `FINDING_WITHOUT_EVIDENCE`;
- `CARRY_OF_CARRY`, `KIND_NOT_CARRYABLE` (`HANDOFF`, `CONSTRAINT`, `REQUIREMENT`,
  `ARTIFACT`, `FINDING`/`REPAIR` brain notes), `DECISION_PROPOSED_NOT_IN_FORCE`,
  `DECISION_NOT_ACCEPTED` (`VERIFIED` is not adopted), `DECISION_WITHOUT_AUTHORITY`,
  `TASK_SCOPED`, `TASK_SCOPE_UNKNOWN`, `CLAIM_TERMINAL`;
- `SAME_RUN`, `CARRY_LIMIT`.

**Scope and provenance travel with the fact.**
- A carried finding is written as a *PRIOR* lesson ("an earlier mission of this
  project, not this one"). Its text, claim evidence and manifest name the source
  run, the work it was about, the review that raised it, the repairs, and the
  review that resolved it.
- Its standing is `VERIFIED` on the resolving review, asserted by the reviewer.
  So no reviewer in the receiving run can "verify" it again.
- A copy is never carried onward: a third run sees the original, not the copy.
- **Every heir holds its own copy.** The copy's id names the run that receives
  it (`carried:<receiving run>:<source run>:<ref>`), and its claim id is derived
  from that. Entry ids are unique across the whole store, so with the source run
  alone, the first run to inherit a fact owned its copy: on a long-lived store
  every later heir was written nothing, its standing was deduplicated into the
  first heir's, and a WITH arm was still accepted. Each paid job's database is
  fresh, so the paid venue never met this.

**The pair rule (`juliusCarryPairGate`).**
- A `WITH` arm is valid only with at least one `VERIFIED_REPAIR_FINDING`.
- `CARRY_EMPTY`, `CARRY_DESIGN_ONLY` (decisions only, or verified findings with
  no repair) and `CARRY_UNKNOWN` (the store was unreadable) are invalid.
- The bootstrap refuses an invalid `WITH` arm (`carry_pair_invalid`) **before it
  writes anything**: no run, no task, nothing a paid dispatch could pick up.
- A `WITH` arm whose restore fails is refused too, as `bootstrap_persistence_failure`.
- So is a `WITH` arm that holds **less than its carry selected**
  (`carry_restore_incomplete`, retryable): the arm is judged on what it
  received.

**The restore converges.** The manifest is written last, only when every
selected copy and its standing are in the store, and it records how many the run
holds. A restore that failed partway left no manifest, so its replay finishes the
carry:
- each copy is written if it is not there yet, at the run's next revision, never
  one an earlier attempt took;
- each standing is recorded if it is not (the same standing is written once).

A replay that finds the manifest writes nothing and reports the same count.
- A `WITHOUT` arm inherits nothing, and its manifest records `arm=WITHOUT selected=0`.
- An ordinary mission (no arm) is never refused for its carry.

## The four-point proof: where each point is on the record

| Point | Record | Proven by |
|---|---|---|
| 1. What WITHOUT wrote | `julius_reviewer_findings` rows and the `julius.finding.recorded` / `julius.finding.transitioned` events of the WITHOUT run | `julius-carry.real-postgres.test.ts` "point 1" |
| 2. What became carry-eligible | One `julius.knowledge.carried` event per receiving run (id `julius:knowledge.carried:<run>`). It holds: version, arm, counts per class, `selectedEntryIds`, `excludedByCode`, and `excludedRefs` (`code:run:ref`) | `julius-carry.test.ts` and the real-PG test "point 2" |
| 3. What WITH restored | `julius_brain_entries` rows `carried:<receiving run>:<source run>:finding:<id>` (kind `FINDING`, worker = the reviewer) and their `julius_claim_standings` (reason `CARRIED_FROM:<source run>:<ref>`); the manifest's `written` is how many the run holds with their standing | real-PG test "point 3" (a replay writes nothing), "a second heir", "a squatted id" and "a restore that failed halfway" |
| 4. What the WITH planner received | `julius.context.compiled` on each task: `carriedReceived` (count) and `carriedReceivedIds`, read off the compiled snapshot's own `sourceEntryIds` | `julius-learning-loop.e2e.test.ts` (real run loop) |

## Registration

- A live mission contract may declare `"carryArm": "WITHOUT"` or `"WITH"`
  (`relay-bridge/julius/mission-contract.ts`). Any other value is refused.
- The arm is part of the contract digest, so the two arms of a pair are always
  two runs, never one resumed as the other.
- An arm's second attempt (WITHOUT-2 after WITHOUT-1) is a rerun of the same
  contract, so it needs the paid workflow's rerun key, as every paid rerun does.

The frozen order is **WITHOUT-1 → WITH-1 → WITHOUT-2 → WITH-2**, with no early
stop. **Not chosen here:** which mission the pair runs and its registration
document. Those belong to the founder and SECOND.

## The 13 (i) compatibility gate

- The carry adds writes on a path 13 (i) governs. The manifest append goes
  through `JuliusEventPostgresRepository.append`, which is serializable, and the
  brain/standing writes happen at bootstrap.
- Before C lands, the relevant unchanged concurrency test must show **zero
  conflicts at C's final head**.
- That test is the frozen 13 (i) stress and census bar. If its registration
  confines it to a local venue, it is **READY FOR LOCAL QUALIFICATION** at C's
  final head and must not be substituted with a cloud run.
- This gate does not change 13 (i)'s earned score.

## Not done here

- The four paid C arms. These come after #321, 033, 034 and 035, then the freeze.
- SECOND's independent verdict on this change.
- A preflight-time pair check inside `julius-first-live-mission.yml`. The
  bootstrap refusal already lands before any provider dispatch. Moving the check
  earlier, into the paid-slot admission, changes a workflow file and needs a
  separate reviewed change.
