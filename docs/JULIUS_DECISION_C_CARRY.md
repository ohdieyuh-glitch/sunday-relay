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
- A WITH arm may also declare `"carryFrom"`: its paired WITHOUT mission's
  directory. The paid venue requires it (see below). On any other arm it is
  refused.
- The arm is part of the contract digest, so the two arms of a pair are always
  two runs, never one resumed as the other.
- An arm's second attempt (WITHOUT-2 after WITHOUT-1) is a rerun of the same
  contract, so it needs the paid workflow's rerun key, as every paid rerun does.
- Any mission may declare `"promotedWarningCategories"`: the review kinds it treats as blocking (option B in
  `JULIUS_DECISION_C_PAIR_VALIDITY.md`).
  - Absent, which is every committed mission, a reviewer's warning is retained and interrupts nothing.
  - A kind named here is promoted by Julius, never by the reviewer, so a WITHOUT arm whose reviewer only warns can
    still leave a VERIFIED_REPAIR_FINDING.
  - The field is closed-list (the kinds in `JULIUS_CHALLENGE_CATEGORIES`), and refused rather than dropped when wrong.
  - It is part of the contract digest, and the run prints it before any spend.
  - The bundle's `review-warnings.tsv` records each warning's declared kind and whether it was promoted.

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

## The paid venue: a carry that crosses databases

**The gap.** Every paid mission job gets a fresh PostgreSQL that is destroyed
with the runner. The carry above reads its sources from the receiving run's own
store, so on the paid venue a WITH arm found nothing of its pair, and its pair
gate refused it as `CARRY_EMPTY` every time. As first built, C could not run on
the only venue that runs paid missions.

**What crosses.** Only what the paid workflow already keeps: the WITHOUT arm's
evidence bundle (90 days). Three additions make it a carry source:

- `carry-export.json` in every paid bundle. It holds the reviewer findings of
  the one run the manifest names, and the `finding.*` ledger rows that give them
  their lives, in ledger order and under named fact keys only. It is written by
  `.github/julius-carry-export.sql` in the same shape the store reader returns,
  so the bundle selects exactly what the store would have, item for item.
- Three manifest lines: `mission=`, `contract_sha256=` (the contract file the
  job ran), and `carry_export_sha256=`, which is appended the moment the export
  is written.
- `carry.tsv`. This holds points 2 and 4 as tokens: the `knowledge.carried`
  manifest and each `context.compiled` row's `carriedReceived` facts. With it,
  every point of the proof is readable from a bundle after its database is gone.
  Point 3 was already in `project-brain.tsv`.

**How a WITH arm uses it** (`julius-carry-archive.ts`, `relay-bridge/julius/carry-archive.ts`):

1. The WITH contract names its pair: `"carryArm": "WITH", "carryFrom": "<WITHOUT
   mission directory>"`. The pairing is part of the contract digest, so it is
   frozen with the arm and never chosen at dispatch.
2. The WITH dispatch names the WITHOUT arm's paid workflow run:
   `julius-paid-dispatch.mjs --mission <WITH> ... --carry-source-run <run id>`.
   This sets the workflow input `carry_source_run` on the preflight and on the
   paid request.
3. **Fetch.** A workflow step uses the job's own read-only token
   (`actions: read`, already granted; no new permission). It fetches that run's
   one unexpired `julius-live-evidence` bundle and writes GitHub's own record of
   the run beside it: workflow file, event, commit, title, attempt, and the
   archive digest GitHub recorded next to the sha256 of what was downloaded.
4. **Verify** (`verify-carry`, before the attempt marker, on every dispatch).
   Each part is checked against what the receiving job knows for itself:
   - **GitHub's record:** this repository's paid workflow, `workflow_dispatch`,
     titled `mode=paid` for the paired mission, at the bundle's commit, with the
     archive digest matching.
   - **The manifest:** `mode=paid`, a clean checkout, and the same attempt.
     It must name the **same commit as the receiving job**: the arms of a pair
     run one frozen code, so main moving between arms refuses the WITH arm.
     It must name the paired mission, at that mission's contract digest in this
     checkout, and one Julius run.
   - **The export:** the sha256 the manifest recorded, that run, every finding
     that run's, and this mission's project.

   Then the same selection and pair gate the bootstrap applies run as a preview.
   A pair whose WITHOUT arm left no verified repair finding is refused as
   `CARRY_SOURCE_NOT_A_VALID_PAIR` while refusing is still free.
5. **LIVE** is handed the same bundle and verifies it again with the same code.
   The carry is then selected from that bundle **alone**, never from whatever
   else a database holds, and restored into the WITH run. The manifest event
   carries `origin=ARCHIVE` and names the source by workflow run, commit and
   digests. The WITH bundle keeps the pair's files it learned from under
   `carry-source/`.

**Refusals, all before a run exists.** These come from the domain verifier,
each reached by its own test:

`CARRY_SOURCE_EXPECTATION_INVALID`, `_RUN_RECORD_MISSING`,
`_RUN_RECORD_MISMATCH`, `_NOT_THE_PAID_WORKFLOW`, `_NOT_DISPATCHED`,
`_NOT_PAID`, `_MISSION_MISMATCH`, `_ARCHIVE_DIGEST_MISMATCH`,
`_MANIFEST_MISSING`, `_MANIFEST_UNREADABLE`, `_COMMIT_MISMATCH`, `_DIRTY`,
`_RUN_UNNAMED`, `_CONTRACT_MISMATCH`, `_EXPORT_MISSING`,
`_EXPORT_DIGEST_MISMATCH`, `_EXPORT_MALFORMED`, `_EXPORT_RUN_MISMATCH`,
`_PROJECT_MISMATCH`.

The pairing adds four more:

- `CARRY_SOURCE_REQUIRED`: a WITH arm on the paid venue with no bundle.
- `CARRY_SOURCE_UNEXPECTED`: a bundle given to an arm that does not learn.
- `CARRY_SOURCE_UNPAIRED`: no `carryFrom`, or the arm names itself.
- `CARRY_SOURCE_NOT_A_VALID_PAIR`.

**Proof.**

| Suite | What it proves |
|---|---|
| `julius-carry-archive.test.ts` | One valid bundle, and **one change per refusal**. A closing case proves no refusal code is unreached. The parser is strict: no unknown field, ledger order, scalar facts, bounds. The worst-case manifest stays under the 8 KiB fact budget. |
| `relay-bridge/julius/carry-archive.test.ts` | The files on disk: the export's own bytes hashed, the pair's contract read beside the receiving one, and the pairing rules. `verify-carry` exit codes. Every line survives the evidence allowlist. |
| `julius-carry-archive.real-postgres.test.ts` | **Two databases.** The WITHOUT run lives in one. The dump's own query file exports it, and the bundle's selection **equals the WITHOUT store's own selection**. The WITH arm bootstraps in a second database that never held the WITHOUT run; its planner's `context.compiled` records `carriedReceived: 1`; and the dump's `carry.tsv` query reads points 2 and 4 back as tokens. Three mutants are killed: the timestamp precision, the origin, and the source. |
| `scripts/julius-first-live-mission.test.ts` | The workflow's shape: the input and its gate, a fetch with no new permission, verify before the attempt marker, LIVE handed the bundle only when named, the WITH bundle keeping its source, and the dump's export, digest and `carry.tsv`. |
| `julius-decision-c-rehearsal.real-postgres.test.ts` | **The dress rehearsal: both arms are REAL runs, nothing is paid.** The WITHOUT arm is bootstrapped from a `carryArm: "WITHOUT"` contract and driven through the live composition with scripted providers. Its reviewer rejects the build, a repair runs, and the re-review answers the finding from its own packet. The runtime's own finding and lifecycle are exported by the dump's query file, then bundled and verified. They select **exactly** what the WITHOUT store selects (a `VERIFIED_REPAIR_FINDING`, authored by the reviewer). The WITH arm, from a `carryFrom` contract on a second database, completes, restores it, and its planner's `context.compiled` names it. Mutant killed: an export that drops the raising review refuses the pair. |

Checked once by hand in this change (not CI): the real dump script, through
`docker exec -i` and `psql -v`, against a Docker PostgreSQL holding a WITHOUT
run. Both manifest digests matched a recomputation, and the claim's tab,
newline, quote and backslash survived. The verifier and selection read the real
file to `VERIFIED_REPAIR_FINDING=1`, `CARRY_PAIR_VALID`.

**Checked against GitHub's real records.** For M2's paid run 37222057584 the
API answered:
- **Run record:** `path` `.github/workflows/julius-first-live-mission.yml`,
  `event` `workflow_dispatch`, a `display_title` the run-name grammar parses,
  and a numeric `run_attempt`.
- **Artifact listing:** for `julius-live-evidence`, it carries `expired` and
  `digest: "sha256:<hex>"`.

The verifier is pinned to those shapes by a test.

**Not proven offline.** The archive download and unzip on a runner, with the
job's own token. The repository trust gate admits only `main`'s reviewed tip,
so this transport can first run live after it lands, at a WITH arm's preflight,
which spends nothing.

## Not done here

- The four paid C arms. These come after #321, 033, 034 and 035, then the freeze.
  The WITHOUT and WITH contracts, with `carryArm` and `carryFrom`, belong to the
  founder and SECOND.
- SECOND's independent verdict on this change and on the paid-venue transport.
  The transport changes the one workflow that can spend.
