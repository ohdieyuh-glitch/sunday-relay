# Julius sustained peers, PR 1: a typed peer channel, canonical reviewer verdicts on the live path, and Architect-Reviewer disagreement

Frozen candidate `relay/julius-peer-channel`, 3 commit(s) over trusted main `ad03df90`, authored and committed by `julius-worker[bot]`.

Provider-free development for the sustained Prompt Architect and Independent Reviewer: a typed, Julius-audited peer channel; the reviewer's canonical verdicts on the live path; and a bounded Architect-Reviewer disagreement. Three logical commits. No provider was contacted and no qualification semantics changed.

This PR is provider-free. No provider was contacted, and no qualification semantics or paid-lane behaviour changed except where noted under Live-path changes. It has three logical commits by julius-worker[bot] on main ad03df90.

## 1. Typed peer channel, derived peer states, authority guard (719dce71)

**The channel**
- Every exchange between the Prompt Architect, Coding Agent and Independent Reviewer is a ledger request.
- Kinds: GUIDANCE_QUESTION, REVIEW_REQUEST, CHALLENGE, EVIDENCE_CHALLENGE, REBUTTAL_REQUEST, REPLAN_PROPOSAL, CLARIFICATION.
- Statuses: OPEN, ANSWERED, REFUSED, SUPERSEDED, RESOLVED. Legal edges are closed, and only Julius reopens a rejected answer.
- Directions are closed per kind:
  - Coding Agent -> Architect
  - Julius -> Reviewer
  - Reviewer -> Julius
  - Reviewer -> Architect only through Julius
  - Architect -> Julius
  - Julius -> either peer
- Each request carries the mission and execution scope, source, target, reason, subject, carrier, context refs, the owed response type, checkpoint, evidence, contract binding digest, the tasks it pauses, and timestamps.

**State is derived, never stored**
- Request state is a fold over `peer.request.*` rows.
- Architect states: STANDBY / PLANNING / RESEARCHING / GUIDING / REPLANNING / WAITING_ON_EVIDENCE / CHECKING_ALIGNMENT.
- Reviewer states: STANDBY / OBSERVING / RESEARCHING / REVIEWING / CHALLENGING / WAITING_ON_REPAIR / REVIEWING_REPAIR / FINAL_REVIEW.
- Guidance states: PROPOSED / UNDER_REVIEW / ACCEPTED / REJECTED. Only ACCEPTED is authoritative.

**Authority guard**
- Refuses by name, at any depth and in any spelling, any peer output that names:
  - the objective, criteria, budget or permissions;
  - the security boundary, provider authority or contract ownership;
  - VERIFIED, TASK_VERIFIED, COMPLETE or another Julius-only outcome.

**Runtime wiring**
- Guidance questions are direction-checked before a task is minted.
- Every review opens a REVIEW_REQUEST naming the work it gates.
- Each move is written once per cause, read back from the ledger.
- The live entrypoint scopes every id to `gh-<run>.<attempt>`.

**Bug reproduced on ad03df90 and fixed: guidance lineage**
- `repair:guidance:*` and `segment:guidance:*` were refused `guidance_from_a_non_guidance_task`. Corrected advice and researched advice could never be issued.
- The same id shape made both run as unbound architect tasks.
- Both now resolve through the unit's lineage root, and packet revisions are counted from issued packets.

## 2. Canonical reviewer verdicts on the live path (c4b14a64)

**Verdict and routes**
- The reviewer declares CONTINUE / WARNING / CHALLENGE / REPAIR_REQUIRED / BLOCK. Julius applies the stricter of the declaration and the evidence.
- WARNING is retained as a non-blocking finding. Only Julius's policy promotes one.
- CHALLENGE is recorded as a challenge request, never as a contract revision. It holds dependent work only when the category is material.
- REPAIR_REQUIRED leads to a bounded repair and an independent re-review.
- BLOCK leads to a HALT that Julius writes.
- The reviewer never emits VERIFIED.

**Live-path changes**
- The Hermes JSON contract gains an optional `escalation` field, adding 1,371 fixed prompt characters.
- Minor findings become retained WARNINGs.
- The adapter's evidence is unchanged.

**Bug reproduced and fixed: reviewer research**
- A reviewer's pre-research approval was applied before its research answer arrived: the plan was decided at event 26, and the continuation ran at event 41.
- The continuation's finding was bound to the review task, not the plan.

**Provider failure is outside verdicts**
- A failed review has no declaration, finding or decision.
- Its request stays open.
- Hostile error text is proven absent from the record.

**Bug reproduced on ad03df90 and fixed: resume re-sweep**
- Every idle `advanceRun` re-verified every concluded review. A completed two-review mission wrote 18 decision rows.

## 3. Architect-Reviewer disagreement (846792dd)

**The record and the flow**
- A challenge opens a durable disagreement: subject, both positions and evidence, the Coding Agent's evidence, binding, category and target.
- Flow: ONE rebuttal task, then CONCEDES or MAINTAINS with evidence. A maintained position gets ONE independent re-review.
- Resolutions: CHALLENGE_UPHELD, ARCHITECT_UPHELD, or ESCALATED (when a mission-owned term must change).
- Bases: ARCHITECT_CONCEDED, RE_REVIEW_CONTINUED/MAINTAINED/BLOCKED, REBUTTAL_UNUSABLE/UNROUTABLE, MISSION_TERMS_MUST_CHANGE.

**Bound and consequences**
- The record refuses any second turn.
- Upheld and material: a blocking finding, then repair.
- Escalated, or a blocking re-review: HALT.
- The contract is never revised.
- Ids are scoped to the workflow attempt.

**Live path**
- No rebuttal charter is registered for the architect yet, so a live challenge resolves REBUTTAL_UNROUTABLE by Julius's rule instead of stalling. This is proven through `assembleLiveJuliusRuntime`.

## Proofs (founder's list)

| # | Proof | Where |
|---|---|---|
| 1 | Request opens, is answered, is resolved; rejected answers reopen | peer-channel e2e P1 |
| 2 | Illegal direction refused, nothing minted | peer-channel e2e P2 + 16 unit cases |
| 3 | Protected contract fields refused by name; contract byte-identical | peer-channel e2e P3; verdict e2e P4; disagreement unit |
| 4 | No peer mints VERIFIED | peer-channel e2e P4; verdict e2e P4; live composition |
| 5 | Mandatory request really pauses dependent work | peer-channel e2e P5 (claim-order invariant over the whole ledger) |
| 6 | Projections survive continuation, restart, reconstruction | peer-channel e2e P6 (every tick vs a store rebuilt from exported rows) |
| 7 | Role semantics survive a provider swap | peer-channel e2e P7 |
| 8 | Reviewer research waits for its answer | verdict e2e P8 (x3) |
| 9 | CHALLENGE opens a disagreement; contract untouched | disagreement e2e P9; verdict e2e P9 |
| 10 | Rebuttal bounded | disagreement e2e P10 + 9 refused-step unit cases |
| 11 | Maintained position independently re-reviewed | disagreement e2e P11 |
| 12 | REPAIR_REQUIRED -> repair -> independent re-review | verdict e2e P12 |
| 13 | WARNING visible, non-blocking unless Julius promotes | verdict e2e P13; live composition |
| 14 | BLOCK halts | verdict e2e P14; disagreement e2e (blocking re-review) |
| 15 | Provider failure outside verdicts; no secret text | verdict e2e P15 |
| 16 | No shared identity across workflow attempts | peer-channel e2e P16; disagreement e2e P16; live composition |

## Mutation testing

- **Per commit:** 18/18, 18/19 and 16/17 killed.
  - Commit 2's survivor was equivalent, and the edit was reverted.
  - Commit 3's survivor is equivalent: a non-material challenge's work is always decided before its disagreement resolves.
- **Combined head (846792dd):** 52 of 53 killed.
  - The last survivor is the commit-3 equivalent described above.
  - Mutant M3 (cause-once) survived the combined stack until commit 2 gained a direct runtime test. The resume-loop fix had removed the replay that commit 1's pipeline proof relied on.

## Gates on the exact head

- **Each commit position, checked on its own:**
  - Typecheck is clean across 4 projects.
  - Kernel and bridge suites: 1,690, 1,757 and 2,272 passing.
  - The only failures are Windows-local noise that fails identically on clean main: research-authority 22, and an F6 timeout under load that passes 170/170 alone.
- **Broad comparison against clean main ad03df90** (relay-bridge, scripts, Julius kernel):
  - Every head failure also fails on main, or passes when rerun at equal load.
  - These are the Windows spawn, ship and git transport tests.
- Repository boundary: PASS. `git diff --check` is clean. The harness manifest is regenerated at every commit.

## Deferred to PR 2

- Live Prompt Architect rebuttal charter: output schema, prompt and review stage. Until then live challenges resolve REBUTTAL_UNROUTABLE.
- Accepted-guidance-only delivery. Guidance still reaches the continuation before review, and a rejected packet stays in its context beside the correction.
- Finding resolution lifecycle. Findings stay OPEN.
- Tick allowance for disagreement tasks. None run live today.
- Structured persistent architecture state, drift and contradiction re-plan, dependency triggers, final architecture check, and repair-round diffs.
- A rebuttal that fails to run stays open, like a failed review. There is no default resolution on provider failure.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
