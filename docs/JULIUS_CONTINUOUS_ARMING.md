# Julius continuous-worker arming — the record

Branch `relay/julius-continuous-arming`, based on trusted main
`9eab011735130ab382868854ed05b24756765da3` (ADR-021, PR #251). Every commit is
authored **and** committed by `julius-worker[bot]`.

This is what was armed, what it cost to find out that parts of it were not
really armed, and the two decisions that are the founder's rather than mine.

---

## 1. What the three slots can now do

| | before | after |
|---|---|---|
| **Prompt Architect** | `plan`, `repair:plan` | also `guidance`, `repair:guidance` — registered live |
| **Coding Agent** | `build`, `repair:build` | unchanged, plus segments and research asks |
| **Independent Reviewer** | four review stages | all six, including `review:guidance` with a GUIDANCE rubric |
| **research** | nothing; Live Reach unreachable from Julius | one governed door, all three slots, mission-sealed allowlist |
| **economics** | coder drew from the ceiling, peers took a fixed estimate | allocation v2 available; per-dispatch effort telemetry recorded |

## 2. The ASK-vs-ANSWER family, found five more times

ADR-021 shipped with the ability to ASK and without the ability to WAIT. The
same shape turned up in five more places, and every one of them was found by
WIRING the path rather than by reading it:

1. **A checkpoint was not a barrier.** A `guidanceRequest` arrives on the result
   of a dispatch that has already finished. Fixed by bounded resumable segments:
   segment N+1 is a task that does not exist until Julius has recorded the
   participation, so nothing has to trust a model to stop.
2. **The barrier list was `readonly string[]` and two of its four entries were
   not routes.** `REQUIRE_REVIEW` and `REPAIR` are not names any router
   produces. The test looped over the list asserting each member was a barrier,
   which is true of any list of any strings. Now typed against
   `JuliusCheckpointRouting['route']`.
3. **`REQUIRE_CONTRACT_REVISION` was not a barrier at all** — the most serious
   of the three, because work produced past that point is bound to a revision
   about to stop being current.
4. **Segments nested instead of chaining.** A continuation that yielded again
   became the root of its own lineage, each level counting from one, so the
   ceiling never bound. The proof that should have caught it filtered on
   `startsWith('segment:build-1:')`, which also matches each continuation's own
   review task.
5. **A guidance review could approve what it could not see.**
   `charge.requires` has named the guidance packet since the stage vocabulary
   was written; the live adapter read only the plan, and the prompt branched on
   PLAN-versus-everything-else so a GUIDANCE subject got the implementation
   rubric and an empty diff.

## 3. Governed research

One mechanism, three slots, no capability hierarchy.

```
worker ask → Julius authorization → mission source/host allowlist →
per-slot retrieval budget → Live Reach (SSRF, redirects, bounds) →
redaction → injection detection → renderForPrompt → evidence → bounded
observation on the requesting worker's continuation
```

- **The allowlist is mission authority, structurally.** A request has no field
  to carry one; retrieved content has no path back into a policy; a sealed
  policy is frozen and fingerprinted, and one the mission did not seal is
  refused as `policy_tampered`. There is no `allowHost`, no `addSource` and no
  `widen*` verb in the module's surface.
- **Eight distinguishable outcomes**, never collapsed into "no evidence":
  `observed`, `injection_signaled`, `policy_refused`, `budget_exhausted`,
  `unreachable`, `unauthenticated`, `throttled`, `unsupported_content`.
- **`injection_signaled` is a success**, not a failure: the observation is kept
  so a Reviewer can see hostile text was present, and refused only the power to
  TIP a disagreement.
- **Per-slot provenance**, never pooled; the mission total is derived from the
  three so it cannot drift from the sum of its parts.
- **`external_retrieved`** joins `JULIUS_MEMORY_PROVENANCE`, deliberately apart
  from `tool_observed`.
- **Disagreement is settled by evidence, not rank**: authority, then
  corroboration, then publication recency. `broughtBy` is recorded and never
  read — pinned by resolving the same pair under all nine role permutations.

### What it is wired to, today

The mediator is bound in the live composition and **every mission gets
`noJuliusResearch`**: allowlist empty, no slot authorised, budget zero. A
research ask is refused as `research_not_authorized` before a socket can exist.
The door is built, governed and closed; opening it for a mission is an act of
mission authority rather than a code change.

The executor sandbox keeps `--network none`. Mediation runs in the bridge, which
is what makes that boundary compatible with a worker needing to read a
specification.

## 4. Two findings that are decisions, not bugs

### 4.0 The money is now wired, and the wiring found a 67% overspend

Allocation v2 decides against the run's own durable budget rows rather than a
proxy for them: `budget.reserved` carries its role and amount, `budget.settled`
says whether the hold was RELEASED, and the per-slot accounts are **projected**
from those rows — no table, no drift from the money record, and a restarted
process re-reads the same events and reaches the same accounts. Where no
timeline reader is bound the round-counting fallback remains and reports an
`_ESTIMATED_FROM_ROUNDS` basis, so a reader can tell a decision made against the
money from one made against a proxy.

**An unknown settlement is not a refund.** It converts the hold rather than
releasing it — the money leaves `outstanding` and enters `settledUnknown`, where
it is still gone. The cost is stated: a slot whose provider is silent is charged
what it RESERVED, which over-charges the mission's own accounting and never
under-charges it. `RESERVED_UNSETTLED` joins the cost vocabulary for money held
and not yet accounted for.

**A ceiling test found a 67% overspend.** Every slot settling UNKNOWN for forty
rounds committed 49,998,000 against a 30,000,000 ceiling. The reserve rule
checked mission capacity only when BORROWING — on the reasoning that the
envelopes sum to the ceiling, so a slot inside its own envelope cannot overspend.
That is false the moment anyone borrows: the borrower spends an envelope some
other slot has not started, and that slot's `remainingOwnEnvelope`, a per-slot
view, still counts the same dollar as its own. Every grant is now bounded by
what the MISSION has left.

A historical run is read under the rule it ran beneath. The ledger records every
policy the run's own rows name and refuses to make a v2 decision over v1 rows.

### 4.1 Allocation v2 would have starved Mission 5's coder

Under v1 the Coding Agent's share is the **whole** ceiling divided by its
rounds. Under v2 it is a **third** of the ceiling divided by its rounds. For
Mission 5's $30 ceiling and three authorised repair rounds:

| | per coder dispatch |
|---|---|
| v1 | $7.50 |
| v2 (equal thirds) | $2.50 |
| what Mission 5's coder actually settled | **$5.177120** |

The hosted adapter is handed its allocation as a hard limit, and reallocation
from the peers' unused envelopes opens only after the coder's own envelope is
spent — four rounds later. So v2 as written would have capped that build below
its real cost on the first round.

`julius-slot-envelope.e2e.test.ts` pins this, and **the live composition
deliberately still allocates under v1**. The fix is a rule change — a dispatch
drawing from its slot's REMAINING envelope rather than from one round's share —
which trades against having anything left for repairs. That is a decision with
real consequences, not one to make silently inside a test.

### 4.2 The research ledger is per process

A bridge restart forgets what a slot has retrieved, so a research budget binds
within a process rather than across one. The Live Reach meter already carries
the same honest limit. Worth having — the alternative today is no cap at all —
and stated in a test so nobody discovers it from a bill.

## 5. Effort parity is measured, not assumed

`worker.effort` writes one row per dispatch carrying what the provider reported
and **nothing inferred**. It is deliberately not folded into `budget.settled`,
which reads the same usage object through a helper that substitutes zero for an
absent field: correct for a ledger that must not over-hold, and fatal for a
diagnostic, which would then call every provider that reports no token counts
*shallow* rather than *unmeasured*.

The founder's 0.8x–1.2x band is a diagnostic target and not a quota. No code
path reads the verdict, so nothing here can cause synthetic work.

## 6. Adversarial evidence

- **Research policy**: 48 cases — apex-vs-wildcard, `evilpython.org`,
  `python.org.evil.com`, schemes, inline credentials, a rebuilt policy carrying
  the old fingerprint, a request with widening fields bolted on at runtime.
- **The assembled seam**: 26 cases — a page that names a host and does not get
  it allowlisted, a page that grants a slot access and does not, a page that
  raises the budget and does not, content that closes the evidence fence and is
  defused, a secret redacted before anything renders it, a mission-allowed name
  whose address Relay still refuses, a redirect toward cloud metadata refused
  and charged.
- **The protocol**: 49 cases, including the nine-permutation role-swap
  invariance proof.
- **End to end**: proofs 31–34 — the barrier edge, the fenced answer reaching
  the continuation before it runs, all three slots served, the unserved default
  that never stalls a mission, the ceiling, the replay, true interleaving
  (proof 33 checks the ORDER of real dispatches: the architect is asked and the
  reviewer judges that answer BETWEEN the coder's first segment and its second,
  so a phased plan/build/review run fails it), and the founder's security list
  checked as a DIFF rather than by inspection (proof 34: against a page asking
  for admin access, a raised budget, a widened allowlist, a completion claim, a
  VERIFIED promotion, a skipped reviewer and a hidden task, the contract, the
  task set, every decision and the run state are byte-identical to a benign
  retrieval — and the hostile text is still kept, fenced and labelled).
- **Drill parity**: the three PostgreSQL drills keep their own worker tables,
  because each scripts its own adapters. `julius-drill-worker-parity.test.ts`
  holds them to SUBSET-not-equality against the production registrations: a
  drill may be narrower, never wider or different. A drill registering a route
  production cannot serve passes while proving something else, which is the
  most expensive kind of green. Verified by mutation: adding `review:cleanup`
  to one drill fails the guard by name.
- **Participation and refusal mutations**: 9 across the report's attribution and
  the denial row. 8 died on the first pass; the survivor was a real gap — every
  ledger refusal could be rewritten to one generic code with the suite still
  green, because nothing drove the pipeline to an actual refusal. A test that
  spends the whole ceiling and reads the denial row closes it. The other eight:
  a checkpoint silently dropped instead of reported unattributed, `barrier`
  counted unless explicitly false, raised-checkpoints not deduplicated, verdict
  rows counted as raises, dispositions attributed to the subject's slot, every
  verdict counted as a continuation, a grant omitting its refusal field instead
  of stating `null`, and the mission-capacity guard removed entirely — which is
  the 67% overspend, reintroduced, and it fails two tests by name.
- **Budget and telemetry mutations**: 25 across the slot ledger, the effort
  summariser, the report and the pipeline — v1/v2 confusion, slot
  misclassification, unknown cost read as zero, double borrowing, the
  concurrency race, a stale reservation after a restart, one slot taking
  another's hold, the export dropping a slot, null metrics coerced to zero, a
  ratio with a missing denominator, and a historical run reinterpreted under v2.
  **23 killed.** The two survivors were proven EQUIVALENT rather than missed, by
  applying each and diffing the output: dropping the `accounts.set` inside
  `accountFor` (the caller sets the account on the same row) and removing
  `JULIUS_BUDGET_SLOTS` from the report's slot set (the projection seeds all
  three peers regardless). Byte-identical both times. Six earlier survivors were
  real test gaps and were closed — the worst was a ceiling proof that passed
  only because its fixture's borrowing landed on exactly zero, where the outer
  refusal already stops everything.
- **Research mutations**: 24 across the research policy, the protocol,
  the segment lineage, the slot envelope, the reviewer adapter, the Live Reach
  service and the pipeline. 22 caught on the first pass; both survivors were
  investigated and were real test gaps:
  - an undated page could win a recency contest through the NaN branch, because
    no assertion distinguished "the source said nothing" from "the date could
    not be read";
  - an SSRF-blocked URL that never opened a socket could be charged against a
    slot's budget, because the test asserted only the refusal code. That one
    mattered: it would have made an unreachable host a way to burn a mission's
    whole research allowance without a request leaving the process.
  Both tests were strengthened and both mutations then died. 24/24.

## 6.5 What the paid proof has to be able to answer, and from which field

The paid continuous-Julius run has not been designed as "run it and look at the
logs". Eight questions were named in advance; each one is answered by a NAMED
FIELD of `julius-slot-report.v1` or it is not answered at all. Designing this
before the run is the point — a question nobody can answer from the bundle
afterwards is a question the run was never instrumented for, and by then the
money is spent.

Three of the eight needed work to become answerable. They are marked.

| | Question | Answered from | State |
|---|---|---|---|
| **A** | Did all three slots perform meaningful work throughout? | `bySlot[*].effort.dispatches`, every dimension's `measured`/`unknown` split, `participation`, `ledger.reservationsOpened` | **Partly.** "Did work" is answerable per slot. "THROUGHOUT" is not: the report carries no position, so a slot that did everything in the first two minutes and nothing after reads identically to one that worked evenly. See the gap below. |
| **B** | Was the Architect substantially more active than in Mission 5? | `bySlot.PROMPT_ARCHITECT.effort` against the Mission 5 replay control (§5) | Yes. The control is a historical record, not a target — Mission 5 was valid under the architecture it ran beneath. |
| **C** | Did the Coder research independently when useful? | `bySlot.CODING_AGENT.effort.researchCalls`, and the mediator's own observation outcomes | Yes. `researchCalls` is emitted per dispatch and is `unknown` — never `0` — when the adapter reported nothing. |
| **D** | Did the Reviewer independently research and challenge rather than trust the Architect? | `dispositions.byVerdict` / `byEvaluator`, plus the reviewer's own `researchCalls` | **Now yes.** `contract.disposition` rows were durable already and the report discarded them. It reports the evaluator by ID, not by role: the row names an `evaluatorId` and nothing in it says what role that id holds. |
| **E** | Did causal checkpoint barriers actually affect coder progression? | `bySlot[*].participation.checkpointsRaised` / `routes` / `barriers` / `continuations` | **Now yes.** `barriers` and `continuations` are counted separately on purpose: a barrier that minted no continuation stopped a worker without giving it anywhere to resume, which is a stall and not a barrier working. |
| **F** | Did all three have sufficient budget? | `bySlot[*].ledger` — `remainingOwnEnvelope`, `borrowed`, `outstanding`, `settledKnown`, `settledUnknown` — and the `budget.denied` rows | Yes, with §4.0's caveat: a slot whose provider never reported is charged what it RESERVED, so its figure is an upper bound on what it actually cost. |
| **G** | Did any slot stay shallow because of architecture or budget rather than because the mission needed less? | `budget.denied.slotRefusal` beside `shareUsdMicros` and `allocationBasis` | **Now yes.** The dispatch path collapses every ledger refusal into `EXHAUSTED`; `slotRefusal` preserves the ledger's own reason, so `MISSION_CAPACITY_EXHAUSTED` is distinguishable from a slot the rule does not treat as a peer, and both from a slot that was simply granted a small share. |
| **H** | Cost per VERIFIED successful mission? | `bySlot[*].ledger.settledKnown` + `settledUnknown`, against the run's verification decision | Yes — as a RANGE, not a number. Known settlements are the floor; unknown ones are held at what was reserved. A single figure would have to guess which. |

**Equal tokens are not required and are not measured for.** The parity band
(§5) stays diagnostic: `PEER`, `ABOVE_OBSERVED_RANGE`, `BELOW_OBSERVED_RANGE`,
`INDETERMINATE`, and no success path reads the verdict. A worker above the band
is not inefficient and a worker below it is not asked to burn tokens. What is
being checked is comparable CAPABILITY and available EFFORT, not equal output.

**The one gap this leaves (A).** The report is a set of totals and the rows
behind them, with no sequence. Answering "throughout" needs a position per row
— the timeline's own append order, which `JuliusReportRow` currently drops. It
is a small change and it is deliberately not in this one: it alters the row
contract every reader shares, and there is no run yet whose shape would make it
worth reading. It is named here so the paid run is not dispatched in the belief
that A is answerable.

## 7. What has NOT been done

- No provider call. No paid dispatch. No mission has a research policy.
- The live composition still allocates under v1 (§4.1). It now binds the
  timeline reader the v2 ledger projects from, but the allocation DECISION is
  unchanged.
- The paid qualification has not been dispatched.
- Four effort dimensions — `brainRetrievals`, `checkpoints`, `guidanceConsumed`
  and `evidenceInspected` — are declared and carried but not instrumented. They
  arrive ABSENT and read as unknown. None of them reads as zero. (`checkpoints`
  as a per-dispatch counter is superseded in practice by §6.5's `participation`,
  which counts the same thing off the durable checkpoint rows instead.)
- Per-slot attribution on PostgreSQL is projected through the timeline reader
  rather than served by a dedicated table. That is deliberate — it cannot drift
  from the money record — but the projection pages the event log.
- Question A of §6.5 is not answerable: the report carries no row ordering.
