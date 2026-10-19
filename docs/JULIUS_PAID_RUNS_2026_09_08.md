# Paid runs 34185920678 and 34186711214 — the architect gate, and what it cost

**Trusted main:** `872f1790465c4d519d9a89c7e525fdaf23f5c3d0` (PR #234, squash
merged, founder-approved at the exact head `be949de2`).
**Mission:** `julius-live-mission-2` — `mission:julius-live-2`, project
`prj-julius-live-2`.
**Provider calls made: two.** Both to OpenAI, both at the Prompt Architect. No
coder and no reviewer was ever dispatched.

This document is the durable per-run record and the reasoning behind the repair
that accompanies it. It exists because the two runs below produced a failure
the uploaded evidence could not explain.

---

## Trust inputs, verified independently before any dispatch

| Gate input | Verified |
|---|---|
| main's tree | `80d0cbe5…` — identical to the reviewed head's tree |
| main's parents | exactly one (`b2dc9f23`), a squash |
| candidate author | `julius-worker[bot]` |
| approval | `APPROVED` by `ohdieyuh-glitch` at `commit_id be949de2`; author ≠ approver |
| parent containment | `b2dc9f23` contained in the reviewed head |
| monotonicity | both live checkpoints (`f131098c`, `67ade6ea`) contained in main |

The workflow's own gate agreed on every dispatch: *"the code this job will run
is reviewed, current and not rolled back" — success*.

## Run 34185756926 — zero-spend preflight — PASS (2m07s)

`mission=julius-live-mission-2`, `confirm_live=""`,
`acknowledge_rerun="RERUN PAID MISSION"`, `max_ticks=32`.

Every stage green: trust gate, input gate, PostgreSQL 16 and the independent
executor, Julius unable to reach the executor signing key, receipt transport
private to root and the executor, durable store, attestation, sandbox,
in-sandbox git, Hermes install, ephemeral reviewer profile, a valid and bounded
Mission Contract, and all three roles resolving —
`architect=gpt-5.6-sol coder=claude-fable-5 reviewer=xai/grok-build-0.1`.
The LIVE step was skipped and the attempt marker was not written.
**Provider calls: zero.**

## Run 34185920678 — PAID — FAILED at the Prompt Architect

Inputs identical except `confirm_live="RUN LIVE MISSION"`.

| Field | Value |
|---|---|
| durable run | `run:4bf13d0e833a042c74f57555` |
| budget | ceiling $20, 3 repair cycles; architect allocated **300,000 µUSD**, basis `ESTIMATE`, policy `julius-allocation.v1`, remaining 20,000,000 µUSD |
| provider call | one — OpenAI `gpt-5.6-sol`, response `resp_06601f0695580df5016a9f8ad2a46487d1b9328985008d1eb9` |
| actual cost | **not reported by the provider** — Unknown, not zero; no settlement row |
| architect output | 14,581 bytes; `json_detected=true`, `json_parseable=true` |
| architect state | `validation_passed=false`, `validation_reason_code=plan_false_work_claim`, `validation_field=` **empty** |
| coding agent | never dispatched |
| diff | none — `workspace.diff` and `workspace-status.txt` both empty |
| reviewer | never dispatched — no stage, no input, no findings |
| repair trajectory | none minted |
| verification | no decisions |
| final durable state | `plan` FAILED, `build` BLOCKED, run FAILED after 1 tick |

**Three of #234's four repairs are visible in this record and all held:** the
build stayed BLOCKED rather than running against an unreviewed plan (defect 4);
no unroutable `repair:plan` was minted (defect 3); the allocation came from the
mission's own contract through `julius-allocation.v1` (defect 1's chain, as far
as the architect's own reservation). The stage-aware reviewer (defect 2) was not
reached.

## Run 34186711214 — PAID — FAILED identically

Dispatched to answer exactly one question: is the trip a property of the model's
sampling, or of the rule? Inputs identical.

| Field | Value |
|---|---|
| provider call | one — `gpt-5.6-sol`, response `resp_09fd5357c9101906016a9f8dc0f38087d1928c14addf805e51` |
| architect output | **14,550 bytes** (against 14,581) — a different sample of the same mission |
| architect state | `validation_passed=false`, `validation_reason_code=plan_false_work_claim`, `validation_field=` **empty** |
| everything downstream | identical: no coder, no diff, no reviewer, no repair, no decisions |

**Two independent samples, same rule, same wall.** That settles it as systematic
rather than sampling-dependent, and it is why no third paid attempt was made on
unrepaired code: a third would have been the *"endlessly rerunning an unchanged
failure"* the paid-run authorisation explicitly excludes.

---

## The first causal blocker

`plan_false_work_claim` was a substring scan over `JSON.stringify(plan)` for
four phrases — *files were edited*, *tests were run*, *i ran the tests*,
*i edited*. The architect's charter named all four **inside the prohibition
itself**, and the plan schema then asks the architect for `prohibitedActions`
and `handoff.prohibitedActions`, lists whose entire purpose is to state what
must not be done. A plan that FORBIDS claiming work and a plan that CLAIMS it
serialise the same.

Fourteen of the fifteen validation rules carry a `reasonField`. This one carried
none, so the bundle could say only that a banned phrase appeared somewhere in a
14 KB document. #234's reason-code instrumentation is what made the rule
identifiable at all — before it the record said `plan_validation_failed` and
stopped.

## The repair, in four parts

**1. The rule is aimed, not weakened.** The scan is a structural walk, and the
exemption is drawn where the distinction actually lies: a completion claim is an
**assertion about the state of the work**, and a field that **enumerates a
condition** is not one. Exempt, by exact path and never by key name:
`prohibitedActions` at both levels, `acceptanceCriteria` at both levels,
`testPlan`, `handoff.requiredTests`, `handoff.expectedEvidence`, `risks`. *"The
tests were run and exited zero"* is the correct English for an acceptance
criterion and could not mislead anyone about what has already happened. Still
scanned: everything the Coding Agent reads as its charge — `objectiveSummary`,
`handoff.objective`, `handoff.boundedTask`, every implementation step,
assumption, requirement, architecture decision and rationale — plus any field a
model invents, and any deeper copy of an exempt path
(`handoff.extra.testPlan` is scanned; the exemption matches the whole join).

**2. The diagnostic now survives the allowlist, which the first draft did not.**
The draft reported `plan.testPlan[1] :: tests were run` in `reasonField`. That
value would have been **dropped to null** by `safeFieldName`, whose grammar
admitted at most two dotted segments and no index — and the operator would have
read an empty `validation_field` for a **third** time. That grammar is a
pre-existing defect: `plan.handoff.boundedTask` is three segments, so no nested
refusal has ever been publishable. Now:

- `safeFieldName` accepts a bounded **structural path** — identifier segments,
  decimal indices, 160 characters — and still refuses prose, the composite
  `path :: phrase` form, and key shapes.
- `reasonField` carries the path alone; `reasonClaim` carries **which of the
  four phrases** as a closed token, published as `validation_claim_phrase`.
- A model-chosen key renders as `unnameable`; a path deeper than eight segments
  is truncated with a `.deeper` tail; keys are walked **sorted**, so two runs of
  the same model report the same path.
- `julius-policy-router.test.ts` exercises the validator and the publisher
  **together** — the only place the two grammars meet.

**3. The charter stops handing the model the banned strings.** It quoted all
four verbatim, so echoing them back was the most obedient possible answer. It
now states the rule in the abstract — *write the entire plan in the future
tense* — and asks the model not to quote it back.

**4. A refused plan is corrected once, not fatal.** This is the defect the two
runs really exposed: a plan that parses and then breaks one of Julius's own
rules is a **self-inflicted, self-correctable** error, and it killed the mission
outright while every other recoverable failure in the run gets one bounded
attempt at recovery. The architect is now told what it broke — the rule as a
closed token and the field as a structural path, **never its own text back** —
and asked once more. Strictly once: a second refusal is the failure it always
was.

The correction spends inside the architect's **already-reserved** allocation
(300,000 µUSD against two calls of roughly 20,000 µUSD each). No ceiling is
raised and no budget rule is relaxed. `diag_planAttempts` records how many calls
one dispatch bought, because a retry the artifact could not show would be a
spend nobody could account for.

## The same defect on the other role that has killed a paid run

Paid run **33802017460** bought a real plan, a real diff and passing tests, and
then **both reviews failed to parse** — Julius never received a verdict and the
run ended FAILED with zero decisions. That is the identical shape: an answer
arrived, in the wrong shape, and the dispatch was terminal.

The reviewer's malformed shapes are `retryable: false` for a good reason, stated
in the code itself — *a plain retry asks the identical question and gets the
identical answer*. A **correction** is not a retry. So the reviewer now gets the
same one bounded corrected re-ask, on the six shapes where an answer ARRIVED in
the wrong shape (`review_json_absent`, `review_json_unparseable`,
`review_json_ambiguous`, `review_verdict_missing`, `review_verdict_invalid`,
`review_summary_missing`/`_invalid`), each told what it specifically got wrong.

**Never on the shapes a re-ask cannot fix.** A timeout, a 503, a refused
credential, a dead process, a rejected request: those describe an answer that
did not arrive. Two are already retryable at the *task* level, where the attempt
ceiling and the run spend budget govern, and re-asking inside the dispatch would
spend for nothing. `review_output_too_large` is excluded deliberately — a
runaway answer asked again is a second runaway answer.

**The unreadable text never travels back**, and that is structural rather than
intended: `review_incomplete` carries a safe message, a closed shape token and
diagnostics, and the review text is not among them. The adapter could not quote
it if it wanted to. `review_attempts` records the call count beside
`plan_attempts`.

## A correction is a spend, so it obeys the ceiling

Checked rather than assumed. `evaluateJuliusAllocation` gives every non-coder
role `basis: 'ESTIMATE'` at the pipeline's fixed estimate, and only the hosted
coder is handed its allocation as an actual spend LIMIT. So the architect's
300,000 µUSD is a **reservation against the run budget**, not a per-call cap,
and two calls inside one dispatch cannot exceed a reservation already made.

What they could do is buy a second call for a mission with nothing left — the
ceiling ignored rather than respected. So a dispatch whose allocation reports
`usdMicros <= 0` gets its first ask and **no correction**, on both roles, and
the original refusal surfaces exactly as it did before either loop existed. An
adapter handed no allocation behaves as it always has: Julius did not bound that
dispatch, and inventing a bound in the adapter would be the connector deciding a
budget it cannot see.

## What is proven, and what is not

Provider-free, through the real composition root: a plan refused for any of the
fifteen rules recovers on the correction and the mission reaches COMPLETED; a
plan refused twice fails exactly as before after exactly two calls; a valid plan
buys nothing extra; the correction names the rule and the field and contains
none of the model's own text. On the reviewer: prose first and a real verdict
second now succeeds; each correctable shape is told what it specifically got
wrong; a model that answers with prose twice fails as before, after two calls;
and a timeout, a 503 and a refused credential are each asked exactly once.
And the budget guard both ways: an exhausted mission is asked exactly once, a
funded one buys the correction. Twenty mutations across the four changes each
turn the suite red.

**Not proven:** that the specific plans runs 34185920678 and 34186711214
produced would now pass. Their text was never persisted — the evidence bundle is
built by allowlist and a model's plan is not on it — so the field that actually
fired is unknown, and that is precisely the hole part 2 closes. The next paid
run will say which field, if any, trips it.
