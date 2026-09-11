# Julius: the continuous-worker architecture, armed

ADR-021 gave Julius three workers that could be ASKED things. This makes the
asking real: a worker that yields, an answer that exists before the work
depending on it, one governed door to the outside that all three slots use, and
a ledger that funds three peers rather than one worker with two commentators.

Nothing paid ran. No provider was contacted. No mission authorizes any research.

---

## What changed

**Governed research, one door, three peers.** A per-mission source and host
allowlist as sealed mission authority, per-slot retrieval budgets, and eight
outcomes that are never collapsed into "no evidence": `observed`,
`injection_signaled`, `policy_refused`, `budget_exhausted`, `unreachable`,
`unauthenticated`, `throttled`, `unsupported_content`. It is not a second
network guard — Live Reach already refuses loopback, link-local, private and
cloud-metadata addresses and re-checks every redirect hop. It adds the thing
`McpNetworkPolicy` genuinely lacks: a mission-scoped allowlist.

The allowlist is mission authority **structurally**, not by promise. A request
has no field to carry one. Retrieved content has no path back into a policy. A
sealed policy is frozen and fingerprinted, and one the mission did not seal is
refused as `policy_tampered`. There is no `allowHost`, no `addSource` and no
`widen*` verb anywhere in the module's surface.

**Research is a barrier, not a note filed afterwards.** `RESEARCH_REQUESTED`
routes to `SERVE_RESEARCH` — the one route that schedules no worker, because
retrieval is Julius's own act. The asking dispatch ENDS; the observation is
written to the Project Brain scoped to a continuation that is BLOCKED on the
segment which asked; `evaluateJuliusRelease` is what lets that work start.
Nothing trusts a model to wait.

**Live registration.** `guidance` and `repair:guidance` on the Prompt Architect,
`review:guidance` and `review:repair:guidance` on the Independent Reviewer —
added together, because a guidance task nobody can re-review is minted,
dispatched and never accepted, and the continuation blocked on it never
releases. That is a stalled mission rather than a refused one.

**Allocation v2 and effort telemetry.** Three peer slots drawing envelopes out
of one ceiling, plus one `worker.effort` row per dispatch carrying what the
provider reported and nothing inferred. See "Two decisions" below: v2 is built,
wired and provable, and the live composition deliberately still runs v1.

**`external_retrieved`** joins Julius's provenance vocabulary, deliberately
apart from `tool_observed` — collapsing them would make a forum post and
`git log` indistinguishable in the one field whose job is to say where a
sentence came from.

## Five more ASK-vs-ANSWER gaps, all found by wiring rather than reading

1. A checkpoint was not a barrier — a `guidanceRequest` arrives on a dispatch
   that has already finished. Closed by bounded resumable segments.
2. The barrier list was `readonly string[]` and two of its four entries were not
   routes any router produces. The test looped over the list asserting each
   member was a barrier, which is true of any list of any strings.
3. `REQUIRE_CONTRACT_REVISION` was not in it at all — the most serious of the
   three, because work produced past that point is bound to a revision about to
   stop being current.
4. Segments NESTED instead of chaining, so the ceiling never bound; the proof
   that should have caught it counted each continuation's own review task as a
   yield.
5. A guidance review could approve what it could not see. `charge.requires` has
   named the guidance packet since the stage vocabulary was written; the live
   adapter read only the plan, and the prompt branched PLAN-versus-everything so
   a GUIDANCE subject got the implementation rubric and an empty diff.

## Two decisions that are the founder's, not mine

**The envelope has a cost.** Under v1 the Coding Agent's share is the whole
ceiling over its rounds; under v2 it is a third of the ceiling over its rounds.
Mission 5 settled $5.177120 against a v1 share of $7.50; under v2's default
equal-third split its first dispatch would be capped at $2.50, and the peers'
unused money is out of reach until the coder's own envelope is spent four rounds
later. `julius-slot-envelope.e2e.test.ts` pins this, and the live composition
still allocates under v1. The fix is a rule change that trades against having
anything left for repairs.

**The research ledger binds within a process.** A bridge restart forgets what a
slot has retrieved. The Live Reach meter already carries the same honest limit;
it is proven in a test so nobody discovers it from a bill.

## Evidence

- Full suite green on the exact head: **10,231 passed, 0 failed, 525 files, 3 skipped, 30 todo**.
- Four-pass typecheck clean; `build`, `relay:build`, `relay:bridge:build` clean.
- `relay-repository-boundary.mjs`, `relay-parity-gate.mjs`,
  `relay:surface-parity:check:strict`, `julius:harness:check` all pass.
- Drills: `relay:cli:contract-verify`, `relay:yc-demo:check`,
  `relay:persistence:contract-verify`, `relay:persistence:recovery-drill`,
  `relay:workspace:verify`, `relay:claude:contract-verify` — all pass, no
  provider call.
- Adversarial: 48 research-policy cases, 26 on the assembled seam, 49 on the
  protocol including a nine-permutation role-swap invariance proof, and
  end-to-end proofs 31–34.
- **Mutation campaign: 24/24.** Twenty-two died on the first pass; both
  survivors were real test gaps and were fixed. The serious one would have let
  an SSRF-blocked name burn a mission's entire research allowance without a
  request leaving the process.

## What has not been done

No provider call, no paid dispatch, no mission with a research policy, and the
live composition still on allocation v1.

`docs/JULIUS_CONTINUOUS_ARMING.md` is the full record.
