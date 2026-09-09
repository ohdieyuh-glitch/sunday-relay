> **This PR targets Sunday Relay only.**
> **This PR must be squash-merged.**
> **Do not merge without founder authorization.**

Base SHA: `872f1790465c4d519d9a89c7e525fdaf23f5c3d0`
Head SHA: `6e3ccd39795be06fb2e7cecffac5aeb4c66b231b`

## The failed run this repairs

**Paid run `34186711214`** (and `34185920678` before it), mission
`julius-live-mission-2`, on trusted `main` `872f1790` — which already carries
PR #234's repairs for the *earlier* run `34037313976`. **This is the next
generation of failure, not that one.**

| | 34185920678 | 34186711214 |
|---|---|---|
| durable run | `run:4bf13d0e833a042c74f57555` | same mission, new run |
| provider call | one, `gpt-5.6-sol`, `resp_06601f0695…87d1eb9` | one, `gpt-5.6-sol`, `resp_09fd5357c9…f805e51` |
| plan bytes | 14,581 | 14,550 |
| architect | `validation_passed=false`, `plan_false_work_claim`, `validation_field=` **empty** | identical |
| coder / reviewer / repair / decisions | none | none |
| final | `plan` FAILED, `build` BLOCKED, run FAILED after 1 tick | identical |

Two independent samples, same rule, same wall — **systematic, not sampling**.
That is why no third paid run was made on unrepaired code.

## The exact causal chain

1. The architect's charter named all four banned phrases **inside the
   prohibition itself** — *"Never state or imply that files were edited, that
   tests were run…"*.
2. The plan schema then asks the architect for `prohibitedActions` and
   `handoff.prohibitedActions` — lists whose entire purpose is to state what
   must not be done.
3. The most obedient possible answer therefore carried those phrases, in those
   lists.
4. `plan_false_work_claim` was a substring scan over `JSON.stringify(plan)`. A
   plan that **forbids** claiming work and a plan that **claims** it serialise
   the same.
5. The plan was refused. `build` stayed BLOCKED. The run ended FAILED.
6. Fourteen of the fifteen validation rules carry a `reasonField`; **this one
   carried none**, so the bundle could say only that a banned phrase appeared
   somewhere in a 14 KB document.

## Before behaviour

`origin/main` at `872f1790`, run under the reproduction below:

- a schema-valid plan that merely *forbids* the claim → **refused**,
  `plan_false_work_claim`, `reasonField: undefined`;
- and had the rule named a field, it could not have been published anyway:
  `safeFieldName` admitted at most two dotted segments and no index, so
  `plan.handoff.boundedTask`, `plan.testPlan[1]` and `plan.contextRefs[1]` all
  resolve to `null`. **No nested refusal has ever been publishable.**

## Root cause

Three defects, not one, plus a fourth the two runs really argued for:

1. **The rule could not tell a prohibition from a claim.** A whole-document
   substring scan cannot distinguish forbidding a claim from making one.
2. **The diagnostic could not survive the allowlist.** A pre-existing bound in
   `safeFieldName` (`julius-router.ts`) that predates this change.
3. **The charter supplied the banned strings**, making the echo the obedient
   answer.
4. **A self-inflicted, self-correctable refusal was terminal.** Every other
   recoverable failure in a Julius run gets one bounded attempt at recovery;
   the architect's own validator was the exception, and the mission paid for it
   twice. The same is true of the reviewer, which killed paid run
   `33802017460` with both reviews unparseable.

## The repair

**The rule is aimed, not weakened.** The scan is now a structural walk. A
completion claim is an *assertion about the state of the work*; a field that
*enumerates a condition* is not one. Exempt **by exact path, never by key
name**: `prohibitedActions` and `acceptanceCriteria` at both levels, `testPlan`,
`handoff.requiredTests`, `handoff.expectedEvidence`, `risks`. Still scanned:
everything the Coding Agent reads as its charge — `objectiveSummary`,
`handoff.objective`, `handoff.boundedTask`, every implementation step,
assumption, requirement, architecture decision and rationale — plus any field a
model invents, and any deeper copy of an exempt path
(`handoff.extra.testPlan` is scanned).

**The diagnostic survives.** `safeFieldName` accepts a bounded **structural
path** (identifier segments, decimal indices, 160 characters) and still refuses
prose, key shapes and the composite `path :: phrase` form an earlier draft
emitted. `reasonField` carries the path alone; the new `reasonClaim` carries
*which* of the four phrases as a closed token, published as
`validation_claim_phrase`. Model-chosen keys render `unnameable`; a path deeper
than eight segments truncates with a `.deeper` tail; keys are walked **sorted**,
so two runs of the same model report the same path.

**The charter stops supplying the strings.** It states the rule in the abstract
— *write the entire plan in the future tense* — and asks the model not to quote
it back.

**One correction, on both roles.** The architect is told what it broke — the
closed reason code and the structural path — and asked once more. All fifteen
reason codes have a correction; an unparseable answer gets the same one. The
reviewer gets the same treatment on the six shapes where an answer *arrived* in
the wrong shape, and never on a timeout, a 503, a refused credential, a dead
process, a rejected request or an oversized answer. **Its own text never
travels back**, which is structural rather than intended: `review_incomplete`
carries a safe message, a shape and diagnostics, and the review text is not
among them. Every `reasonField` the architect correction interpolates comes
from a fixed literal key list this repository owns or from the sanitized walk —
audited, not assumed.

**A correction is a spend, so it obeys the ceiling.**
`evaluateJuliusAllocation` gives every non-coder role `basis: 'ESTIMATE'`, and
only the hosted coder is handed its allocation as a spend *limit* — so the
architect's 300,000 µUSD is a reservation, not a per-call cap, and two calls
inside one dispatch cannot exceed a reservation already made. What they could
do is buy a second call for a mission with nothing left, so a dispatch whose
allocation reports `usdMicros <= 0` gets its first ask and **no correction**, on
both roles. `plan_attempts` and `review_attempts` record the call counts,
because a retry the artifact could not show would be a spend nobody could
account for.

## Provider-free reproduction

Both generations, one process, one input — reproducible from this branch:

```
git show origin/main:src/relay/mission/prompt-architect/prompt-architect-plan.ts \
  > src/relay/mission/prompt-architect/generation-a.repro.ts
git show origin/main:src/relay/mission/julius/julius-router.ts \
  > src/relay/mission/julius/generation-a.repro.ts
# import validateArchitectPlan/safeReviewDiagnostics from BOTH and run one scenario
```

```
✓ GENERATION A — origin/main 872f1790, the code run 34186711214 ran
    ✓ REFUSES the plan that merely forbids the claim: the paid failure, reproduced
    ✓ could not have published a nested field even if the rule had named one
✓ GENERATION B — relay/julius-architect-gate-fix, the repair
    ✓ ACCEPTS the same plan, byte for byte
    ✓ still REFUSES a plan that actually claims the work, and now says where and which
    ✓ publishes what the walk emits, including nested and indexed paths
    ✓ and a refused plan is no longer terminal: the same input, corrected once
  Tests  6 passed (6)
```

The scratch files are untracked and were removed; the scenario itself is
committed as a permanent test (below), so the seam stays guarded without a copy
of `main` rotting in the tree.

**The plan run 34186711214 actually bought was never persisted** — the evidence
bundle is built by allowlist and a model's plan is not on it. The reproduction
uses the *shape* the rule could not distinguish, and says so in its comment.
Which field truly fired is unknown, and closing exactly that hole is repair 2.

## Regression tests

- `PAID RUN 34186711214 — a plan that forbids the claim at BOTH levels is
  accepted whole` — the whole document, not a mutated field. Verified against
  the code that failed: restoring `origin/main`'s `prompt-architect-plan.ts`
  under this test fails it with *"run 34186711214 would fail again: plan claims
  work that did not happen: \"files were edited\""*.
- The same document with `objectiveSummary` claiming the work is still refused,
  naming `plan.objectiveSummary` and `files_were_edited`.
- `julius-policy-router.test.ts` exercises the validator and the publisher
  **together** — the only place the two grammars meet.
- Six cases drive the architect correction through the real composition root,
  five the reviewer correction, two the budget guard.
- **Twenty-two mutations each turn the suite red**, among them: narrowing the
  field grammar, dropping the claim token, over-widening the exemption to
  `objectiveSummary`, removing the path truncation, unsorting the walk,
  publishing a raw model key, allowing two corrections, treating a timeout as a
  shape defect, giving every shape the same generic sentence, and relaxing the
  budget guard to admit a zero allocation.

## Relay Product Scope

Julius mission runtime only — the Prompt Architect plan gate, the Hermes
reviewer adapter, and the diagnostics allowlist that publishes their refusals.
No Alcatraz/Fusion implementation is included.

## Milestone / Capability

Julius Beta readiness: a paid mission survives a self-inflicted, correctable
refusal instead of dying on it, and an operator can read *which* rule and
*which field* refused without buying another paid run.

## Website Impact / CLI Impact / Website-CLI Parity Impact

None, none, none. `npm run relay:surface-parity:check:strict` — **OK**. No
surface file, CLI command or website entry point changed.

## Mission Operations Impact

An architect or reviewer dispatch may now make **two** provider calls instead of
one, bounded at exactly two and refused when the mission's allocation is
exhausted. Two diagnostics are added (`planAttempts`, `reviewAttempts`) and two
evidence columns (`plan_attempts`, `review_attempts`). No contract, status
model, command, Execution Capsule, economics rule or PSP behaviour changes.

## Requested vs Actual Agent Identity

**Stated plainly, because it is the blocker.** The provenance route requires the
candidate to be authored by `julius-worker[bot]`
(`julius-main-provenance.mjs:192`, `WORKER_AUTHOR_LOGINS`). This change was
written by a **Claude Code cloud session authenticating as `ohdieyuh-glitch`** —
the review authority. That session did not and must not open this PR: a PR it
authored would fail provenance at that line, and would place the approver in the
author slot. The worker session that authored PR #234
(`session_01Rg4GG4cY71gpyELD89PQkb`, local CLI) is the correct opener.

## Files Changed

12 files, +1388 −29. Production: `prompt-architect-plan.ts`,
`julius-router.ts`, `live-workers.ts`, `hermes-reviewer.ts`,
`julius-live-evidence-dump.sh`. Tests: five files. Docs:
`JULIUS_PAID_RUNS_2026_09_08.md`, this file.

Two of the seven commits are pre-existing test defects that made the gate red in
a cloud container and are **droppable on their own** — nothing depends on them:
`2f729388` (a case that assumed an auth precondition instead of establishing it)
and `7b2150fb` (a case that discarded the rejection it provoked, exiting 1 on a
green suite).

## Tests

`npm test` — **496 files passed, 1 skipped (497); 9,475 passed, 22 todo (9,497);
0 failed, 0 errors; exit 0.**

Real PostgreSQL 16, started locally: `real-infra-julius.test.ts` — **3 passed,
2 Docker-gated todo**. (The task-contract store's real-PG cases live on
`relay/julius-contract-stack-rebased`, which carries that store; they are not
part of this change.)

## Typechecks

`npm run typecheck` — **OK** (both passes, including the bridge tsconfig).

## Builds

`npm run build` — OK. `npm run relay:build` — OK. `npm run relay:bridge:build` —
OK.

## Security

No credential is read, written, logged or moved. The diagnostics allowlist is
**narrowed in behaviour and widened only in shape**: `safeFieldName` still
refuses prose and key shapes, and the new `validationClaimPhrase` is a closed
token from the validator's own set. Model-authored text cannot reach the
published evidence bundle: path segments are sanitized to `unnameable`, and the
reviewer's unreadable answer is structurally unavailable to the code that builds
its correction. `relay-repository-boundary.mjs` — **PASS** (1,584 files, 17 key
shapes, no deployment config).

## External Calls

**No new call type.** One additional call of an existing type, at most once per
dispatch: a corrected re-ask of the Prompt Architect (OpenAI Responses) or the
Hermes reviewer. Gated by `PLAN_ATTEMPT_LIMIT`/`REVIEW_ATTEMPT_LIMIT` = 2, by
the correctable-reason allowlist, and by `correctionAffordable` — no correction
is bought when the dispatch's allocation reports nothing left. The connector
sends `store: false` and no `previous_response_id`, so the second call is
independent.

## Database / Migration Changes

None.

## Environment Changes

None.

## Deployment Changes

None. No workflow file is touched.

## Independent Review

**None yet.** This change was implemented and self-reviewed by one agent, which
this repository's own rule says is not a review. The adversarial work that *was*
done is stated as what it is: twenty-two mutation checks, a two-generation
reproduction, and an audit of every `reasonField` source confirming none can
carry model-chosen text into a correction prompt.

## Blocking Findings

None open.

## Rollback

`git revert` the squash commit. Nothing is persisted by this change that
outlives it: no migration, no marker, no artifact. Reverting restores the
substring scan, the two-segment field grammar and the terminal refusal —
i.e. the behaviour of runs 34185920678 and 34186711214.

## What the next paid rerun will prove

Dispatch `julius-first-live-mission.yml` with `mission=julius-live-mission-2`,
`confirm_live=RUN LIVE MISSION`, `acknowledge_rerun=RERUN PAID MISSION`,
`max_ticks=32`, after a zero-spend preflight on the same inputs.

- **If the architect passes:** the run crosses the boundaries run
  `34037313976` failed at and run `34186711214` never reached — coder
  allocation, build waiting on an accepted plan, the stage-aware reviewer, a
  routable repair, a real diff reaching review, truthful verification. That is
  TASK 2.
- **If it is refused again:** the record now names the field and the phrase, and
  `plan_attempts` says whether a correction was bought — so the next repair is
  identifiable from the artifact instead of costing another paid run. That is
  the fix that matters most, whichever way the run goes.

Neither outcome is assumed here. **TASK 1 is not complete until a real paid
mission reaches verified completion**, and this PR does not claim it.

## Founder Merge Authorization

- [ ] The founder has explicitly authorized this merge.
