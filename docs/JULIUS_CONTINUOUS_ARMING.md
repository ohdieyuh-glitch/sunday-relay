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
- **Mutation campaign**: 24 mutations across the research policy, the protocol,
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

## 7. What has NOT been done

- No provider call. No paid dispatch. No mission has a research policy.
- The live composition still allocates under v1 (§4.1).
- The paid qualification has not been dispatched.
