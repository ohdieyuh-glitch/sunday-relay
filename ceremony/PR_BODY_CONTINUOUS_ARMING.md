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

**Allocation v2, wired to the real money.** Three peer slots drawing envelopes
out of one ceiling — and the per-slot accounts are now PROJECTED from the run's
own durable `budget.reserved` / `budget.settled` rows rather than from a proxy
for them. No new table, so nothing can drift from the money record, and a
restarted process re-reads the same events and reaches the same accounts. Where
no timeline reader is bound the round-counting fallback remains and reports an
`_ESTIMATED_FROM_ROUNDS` basis, so a reader can tell a decision made against the
money from one made against an estimate. A run whose rows name v1 is read under
v1: the ledger records every policy its rows mention and refuses a v2 decision
over v1 evidence.

**An unknown settlement is not a refund.** It CONVERTS the hold rather than
releasing it — the money leaves `outstanding` and enters `settledUnknown`, where
it is still gone. The cost is stated rather than hidden: a slot whose provider is
silent is charged what it RESERVED, which over-charges the mission's own
accounting and never under-charges it. `RESERVED_UNSETTLED` joins the cost
vocabulary for money held and not yet accounted for, beside `PROVIDER_REPORTED`,
`MEASURED_FROM_USAGE`, `ESTIMATED` and `UNKNOWN`.

**Effort telemetry, per slot, nothing inferred.** One `worker.effort` row per
dispatch carrying what the provider reported, every dimension nullable, and the
0.8x–1.2x band kept strictly diagnostic: it classifies as `PEER`,
`ABOVE_OBSERVED_RANGE`, `BELOW_OBSERVED_RANGE` or `INDETERMINATE`, and no
success path reads the verdict. A worker above the band is not called
inefficient and a worker below it is not asked to burn tokens.

See "Two decisions" below: the live composition deliberately still ALLOCATES
under v1, while now binding the timeline reader the v2 ledger projects from.

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

**The bundle can now say what each slot DID, not only what it spent.**
`checkpoint.recorded`, `checkpoint.verdict` and `contract.disposition` have been
written durably for some time and nothing read them back per slot, so a report
could state precisely what a worker cost and not whether it had ever stopped,
asked, or been made to wait. Each slot now carries `participation`:
`checkpointsRaised`, the `routes` Julius chose, `barriers`, and the
`continuations` a barrier actually minted — counted separately, because a
barrier that minted nothing stopped a worker without giving it anywhere to
resume, which is a stall rather than a barrier working.

Attribution is by the row, never by proximity. A checkpoint names its SUBJECT
task and the subject's own effort row names the role; a checkpoint whose subject
never recorded one is reported as UNATTRIBUTED rather than assigned to a likely
slot. A `contract.disposition` is written against the subject task — the
CODER's — so attributing it by task id would report the coder as having
challenged its own contract; dispositions are therefore reported at mission
level, keyed by the `evaluatorId` the row actually names, as an id and never as
a role the report would have to guess.

**A denied dispatch now says which rule denied it.** The dispatch path collapses
every ledger refusal into `EXHAUSTED`, which is what it needs; that collapse lost
the one distinction the paid proof most needs afterwards. `slotRefusal` keeps the
ledger's own reason on the row, so `MISSION_CAPACITY_EXHAUSTED` is
distinguishable from a slot the rule does not treat as a peer — and both from a
slot that was simply granted a small share. Absent, `null` and a code are three
different answers and are kept that way: absent is v1, which has no per-slot
ledger and so no refusal to report; `null` is a ledger that GRANTED.

## The wiring found a 67% overspend

Every slot settling UNKNOWN for forty rounds committed **49,998,000 against a
30,000,000 ceiling**. The reserve rule checked mission capacity only when a slot
BORROWED, on the reasoning that the envelopes sum to the ceiling, so a slot
inside its own envelope cannot overspend. That is false the moment anyone
borrows: the borrower spends an envelope some other slot has not started, and
that slot's `remainingOwnEnvelope` — a per-slot view — still counts the same
dollar as its own. Every grant is now bounded by what the MISSION has left.

The borrowing order is proven rather than asserted: own share, then own
envelope, then genuinely unheld mission capacity — never another slot's live
reservation, and never capacity that is only conservatively outstanding. A
compare-and-swap revision guard refuses `LEDGER_REVISION_STALE` when the ledger
moved under a caller, so two concurrent reservations cannot borrow the same
dollar, and a restart re-projects spent capacity rather than recreating it.

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

- Full suite green on the exact head: **10,280 passed, 0 failed, 527 files, 3 skipped, 30 todo**.
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
- **Participation and refusal mutations: 9 run, 8 killed on the first pass.** The
  survivor was real: every ledger refusal could be rewritten to one generic code
  with the suite still green, because nothing drove the pipeline to an actual
  refusal. A test that spends the whole ceiling and reads the denial row closes
  it. Among the eight: the mission-capacity guard removed entirely — the 67%
  overspend, reintroduced — which now fails two tests by name.
- **Research mutation campaign: 24/24.** Twenty-two died on the first pass; both
  survivors were real test gaps and were fixed. The serious one would have let
  an SSRF-blocked name burn a mission's entire research allowance without a
  request leaving the process.
- **Budget and telemetry mutation campaign: 25 run, 23 killed, 2 proven
  EQUIVALENT.** v1/v2 confusion, slot misclassification, unknown cost read as
  zero, double borrowing, the concurrency race, a stale reservation surviving a
  restart, one slot taking another's hold, the export dropping a slot, null
  metrics coerced to zero, a ratio with a missing denominator. The two survivors
  were not recorded as caught: each was applied and the projection output diffed,
  byte-identical both times. Six earlier survivors were real test gaps and were
  closed — the worst was a ceiling proof that passed only because its fixture's
  borrowing landed on exactly zero, where the outer refusal already stops
  everything.

## The paid proof was designed before it is run

Eight questions were named in advance, and each is answered by a NAMED FIELD of
`julius-slot-report.v1` or it is not answered at all — the table is §6.5 of
`docs/JULIUS_CONTINUOUS_ARMING.md`. Five were already answerable. Three needed
the work above: whether the reviewer independently challenged, whether checkpoint
barriers actually moved the coder, and whether a slot stayed shallow because of
the architecture rather than because the mission needed less.

One is still NOT answerable and is named rather than glossed: "did all three
work THROUGHOUT the mission". The report is totals plus the rows behind them and
carries no ordering, so a slot that did everything early reads identically to one
that worked evenly. The fix is a position per row; it changes the row contract
every reader shares and is deliberately not in this change.

Equal tokens are not required and are not measured for. The parity band stays
diagnostic and no success path reads its verdict.

## What has not been done

No provider call, no paid dispatch, no mission with a research policy, and the
live composition still ALLOCATING under v1 — it binds the timeline reader the v2
ledger projects from, but the allocation decision itself is unchanged, because
switching it is the rule change described above and that is the founder's call.

Four effort dimensions — `brainRetrievals`, `checkpoints`, `guidanceConsumed`
and `evidenceInspected` — are declared and carried but not yet instrumented.
They arrive ABSENT and read as unknown. None of them reads as zero.

Per-slot attribution on PostgreSQL is projected through the timeline reader
rather than served by a dedicated table. That is a deliberate choice — it cannot
drift from the money record — but it means the projection pages the event log.

`docs/JULIUS_CONTINUOUS_ARMING.md` is the full record.
