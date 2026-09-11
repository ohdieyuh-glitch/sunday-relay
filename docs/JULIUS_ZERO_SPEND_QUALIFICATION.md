# The zero-spend qualification, and the five blockers it found

Run against trusted main `ca77604a7197be0937c0ae82f968987496c82513`, before any
paid continuous-Julius proof. No provider was contacted. No mission spent
anything. The point was to find out whether the architecture could support the
claim the paid run is meant to demonstrate:

> Julius operated as one Compound AI Agent with three peer-grade persistent
> intelligence workers — Prompt Architect, Coding Agent and Independent Reviewer
> — participating causally throughout a real mission, each capable of serious
> tools/research and substantial production effort.

**It could not.** Five things were in the way, three of them invisible from
reading the code.

---

## How this was run

Not by re-running unit tests. The runtime under drive is
`assembleLiveJuliusRuntime` — the one live composition root — with the REAL
production worker registrations (`ARCHITECT_WORKER`, `CODER_WORKER`,
`reviewerWorker`), the real registry, router, budget port, research mediator and
run loop. Fakes sit at exactly two genuine boundaries: the provider adapter, and
`fetch`.

That placement is what made the findings possible. A registration missing from
the production tables fails here. A route the production wiring cannot serve
fails here. Blocker 5 in particular is invisible to every domain test, because
the domain is correct and the composition never reached it.

Zero spend is structural rather than promised: `scriptedAdapter` never opens a
socket and the injected `researchFetch` is a local function.

**Causality is read from the durable ledger, never from callback timing.** Every
ordering claim resolves against `timeline()`'s `sequence`. Asserting on the
order the fakes happened to be called would prove the harness, not the mission.

---

## The five blockers

### 1. Governed research was unreachable — nothing could research at all

Every governed retrieval was refused `capability_unavailable` — *"Web has not
been observed answering read_item"* — by Live Reach's readiness gate, decided
BEFORE the mission allowlist was consulted. A paid mission authorising research
for all three slots would have received zero retrievals.

The cause was a seam wired only in a test. `createJuliusResearchMediator` takes
`retrievalContext` for exactly this and `live-composition.ts` never supplied it.

**Fixed.** `assembleLiveJuliusRuntime` takes `researchProbes` and passes them
through. Absent still means refused: readiness is an operational fact an
operator asserts by having seen a backend answer; mission authority is a
separate decision; neither may stand in for the other.

### 2. The allocation rule starved the work it was meant to fund

v1 has no per-slot dimension at all — the coder draws an equal share of the
whole ceiling and the peers take a flat estimate out of the same pot. v2 capped
every dispatch at one per-round share of a per-slot envelope: **2,499,750 against
Mission 5's real 5,177,120**, with peer money unspent and out of reach, because
the cap was on the DISPATCH rather than on the mission.

**Fixed** by allocation **v3**: each slot holds a floor no other slot may take,
everything above the floors is one shared pool, and a dispatch draws its own
unspent floor plus whatever of the pool is genuinely free. Floors and the repair
reserve are basis points the mission supplies — 5/90/5 is refused at
construction, and so is any split leaving no pool, which would be v2 again.

Two defects surfaced while building it, both the shape of the 67% overspend — a
quantity real in two places at once:

- The shared pool included the asker's own floor, which the asker then also
  received separately. The coder could be granted 18,000,000 of a 30,000,000
  ceiling while 15,000,000 was supposedly protected.
- **Reservation and permission were one line.** `resources.usdMicros` became the
  allocation, so whatever a dispatch was permitted was also HELD, and whatever
  was held was what a silent provider consumed. Granting a peer its whole draw
  cost the mission a third of its ceiling on one planning dispatch that reported
  nothing. They are now separate: `usdMicros` is what may be spent,
  `reserveUsdMicros` what is held.

The grant is deliberately not the estimate. `resources` is one fixed number —
300,000 for every role — a placeholder for the shape of a request, not a model
of cost, and Mission 5's coder settled seventeen times it.

### 3. Research accounting reset on every restart

The meter enforcing per-role and per-mission research budgets lived in a `Map`
on the mediator, held for the process lifetime. A bridge restart forgot what
every slot had spent and the budget began again at zero. A budget that binds
within a process is not a budget.

Worse, `serve()` reached the outside world BEFORE the idempotent `addTask`, so a
replayed tick re-fetched every ask, re-charged the budget, then found the
continuation already existed and threw the answer away. The retrieval was the
one step in that function that was not idempotent, and the only one that costs
money and touches a third party.

**Fixed.** `research.retrieved` joins the event catalogue — one durable row per
observation carrying the role, the outcome and a deterministic request key — and
the mediator projects its ledger from those rows by folding the same
`recordJuliusResearch` the live path charges with. One rule, two readers, so they
cannot disagree. The replay guard checks the continuation's deterministic id
against the durable task rows before anything leaves the process.

The projection is conservative: only a policy refusal and an exhausted budget
are free, because only they provably never left the process. An outcome the
build does not recognise is charged rather than ignored.

### 4. The bundle could not say WHEN anyone worked

`JuliusTimelineEntry.sequence` — a per-run monotonic position the ledger
allocates on append, `UNIQUE(stream_id, sequence)` in PostgreSQL — was being
discarded at the one line mapping a timeline entry into a report row. It is
emphatically not `occurredAt`: several events routinely share a millisecond
under the production clock, so a wall-clock sort has no deterministic tiebreak.

**Fixed.** `JuliusReportRow` carries an optional `sequence`, each slot carries a
`chronology` (positions, span, and a count of dispatches nobody could place), and
the mission carries an ordered `interleaving`. An unplaced row is counted, never
given position zero; a slot nobody could place gets a null span rather than one
reading as "worked at the very start".

### 5. Two effort dimensions were wired to a channel that could never fill them

`brainRetrievals` and `evidenceInspected` read from `result.usage` — the
PROVIDER's self-report. Neither is a provider fact: what reached a worker's
packet is Julius's own act, so both were permanently null.

**Fixed.** Both are measured at the context compile, which is the only point
that knows them, and threaded to the effort row the way `allocated` already was.
`brainRetrievals` counts the brain entries that SURVIVED the character budget,
intersected with the brain array so the repair FINDING entries compiled beside
them are not counted as retrievals. `evidenceInspected` is a REFERENCE count,
not a read receipt, and says so.

**`checkpoints` and `guidanceConsumed` remain unknown, deliberately.** Checkpoint
rows are written AFTER the effort row, so a per-dispatch count would have to be
taken before the thing it counts happens — they are carried per slot by
`participation` instead, off the real rows. Nothing in the runtime knows
`guidanceConsumed` at all: the guidance packet is never compiled into any
dispatch's context. Neither was invented.

---

## The qualification matrix

| | Question | Verdict |
|---|---|---|
| 1 | Can all three slots perform serious tools/research? | **Yes, now.** Was NO — blocker 1 refused every retrieval. |
| 2 | Can all three participate repeatedly? | **Yes.** Proven from ledger order, not callback order. |
| 3 | Are checkpoint barriers causal? | **Yes.** A barrier mints a continuation BLOCKED on the segment that asked; `evaluateJuliusRelease` is what starts it. |
| 4 | Is research governed and injection-safe? | **Yes.** An unallowed host costs nothing because the allowlist precedes the transport; a hostile page is signalled and changes no contract term. |
| 5 | Is research restart-durable? | **Yes, now.** Was NO — blocker 3. |
| 6 | Can the live budget fund peers without starving legitimate work? | **Yes, now.** Was NO — blocker 2. |
| 7 | Can the bundle prove chronological interleaving? | **Yes, now.** Was NO — blocker 4. |
| 8 | Can production effort be measured without turning UNKNOWN into zero? | **Yes**, for what is measurable; two dimensions stay unknown and say so. |
| 9 | Can only Julius mint terminal completion? | **Yes.** No reviewer verdict maps to an accepting action. |
| 10 | Does every deterministic gate pass on the final head? | See the report accompanying this document. |

---

## What this does NOT qualify

- **No paid run happened.** Everything here is provider-free; the qualification
  says the architecture can support the proof, not that the proof succeeded.
- **Question A of §6.5 in the arming record is now answerable** (blocker 4), but
  the evidence bundle's shell exporter still orders its event dumps by
  `occurred_at` and never selects `sequence`. The projection exists; the TSV
  export has not been moved onto it.
- **Effort parity stays diagnostic.** No success path reads the ratio. Equal
  tokens are not required and are not measured for. The three slots are
  peer-grade in capability and authority, not in arithmetic.
- **Nothing authorises research yet.** Every mission still gets
  `noJuliusResearch` — empty allowlist, no slot authorised. Arming a paid
  mission's research is a deliberate act of mission authority.
