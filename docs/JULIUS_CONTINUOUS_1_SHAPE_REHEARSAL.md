# The qualification's SHAPE, rehearsed provider-free

**Not a Julius mission and not a paid run.** Every adapter in this drive is a
local function and `researchFetch` is a local function, so nothing could reach a
provider. What it answers is narrower and worth knowing before money is spent:
**can a mission of this shape complete at all**, inside the ceilings the runtime
actually enforces?

Run on the rehearsed stack (`ceremony/landing-order`, head `45dee6a0`, tree
`12c25099`) — trusted main `9f155b91` with all twelve frozen candidates applied,
which is the state `julius-continuous-1` would be dispatched against.

## The rig

`assembleLiveJuliusRuntime` with the production worker registrations, the
production hosted coder adapter, and the production research mediator. The only
fakes are at two genuine boundaries: the provider runtime behind the coder
adapter, which supplies nothing but the text of a final message, and `fetch`.

## The shape, as measured

    state             COMPLETED        (Julius minted it; no reviewer verdict can)
    stalled           false
    haltCause         null
    ticks             10

    architect         2 dispatches     plan, then guidance
    coder             3 dispatches     build, then two continuation segments
    reviewer          5 dispatches     plan, build, guidance, and both segments

    checkpoints       RESEARCH_REQUESTED, then GUIDANCE_REQUESTED
    research served   1
    guidance issued   1

    tasks             plan-1
                      plan-1:review
                      build-1
                      build-1:review
                      segment:build-1:2:task
                      guidance:segment:build-1:2:task:1:task
                      segment:build-1:2:task:review
                      guidance:segment:build-1:2:task:1:task:review
                      segment:build-1:3:task
                      segment:build-1:3:task:review

The coder pauses twice — once to have Julius read something outside its
workspace, once to ask the architect a question only the architect can answer —
and resumes both times. Every pause is a real task under a lease, and the
architect's answer is independently reviewed like any other unit of work.

## How much room is left

A second rehearsal drove a coder that pauses a THIRD time. All three pauses were
served and the mission still reached `COMPLETED` on four coder dispatches. The
runtime's ceiling is `JULIUS_DEFAULT_MAX_CODER_SEGMENTS = 4`, so a FOURTH pause
is the one that would be refused — and a refused pause is recorded and carried
past rather than stranding the mission, which the second rehearsal confirms by
completing anyway.

**Ten dispatches is the shape's cost driver**, against roughly three for missions
2 through 5. Only the coder reports a price; the architect reports tokens and the
reviewer's harness reports an estimate, so the mission's settled cost will carry
UNKNOWN on two of three slots exactly as Mission 5's did. The $25 ceiling was
argued from Mission 4's $1.390954 for one file against roughly double the
dispatches; the measured count is 3 coder dispatches on one pure module, so the
ceiling has real headroom rather than being a guess dressed as a number.

## What this does NOT show

- **Not wall clock.** Scripted adapters return instantly. Whether ten dispatches
  fit the job's time shares is a separate question the rehearsal cannot answer.
- **Not real cost.** No provider was called; no figure here is money.
- **Not model behaviour.** Whether a real Coding Agent *chooses* to ask rather
  than guess is the capability the paid run exists to measure. This shows only
  that if it asks, the machinery carries the question and brings back an answer.
- **Not a substitute for the preconditions recheck**, which must run against
  trusted main after the candidates land.

---

# The six preconditions, rechecked on the same stack

Audited against trusted main `9f155b91` alone, two of these were FALSE in
production and two more sat unshipped in frozen candidates. Rechecked here with
every candidate applied — the state the qualification would actually run in.

| # | precondition | verdict | the proof, named |
|---|---|---|---|
| 1 | the ledger sequence is the canonical timeline for the paid evidence | **PASS** | all seven event dumps order on `e.stream_id AS run_id, e.sequence`; and `createJuliusPostgresRuntimeStore` now returns `JuliusTimelineReader`, so the production store can serve the timeline it is asked for. Both halves are needed: before the second, the reader existed with no production caller. |
| 2 | the mission SEALS a governed research policy rather than relying on ambient authority | **PASS** | the live entrypoint passes `researchPolicyFor: (id) => sealLiveMissionResearchPolicy(id, researchClause)`; with no clause the composition falls to `noJuliusResearch`. A contract cannot grant itself: the checker refuses a clause with no entry in the deployment's own table. |
| 3 | all three slots get tool/research capability under Julius policy | **PASS**, after the repair below | It read SPLIT when this table was first written: TRUE of the policy and the mediator, FALSE of the live transport for two of the three, because only the Coding Agent had a channel through which an ask reaches Julius. That is now closed — `relay/julius-architect-reviewer-participation` gives the Prompt Architect the ask as a required field of its own strict schema, on the plan branch and the guidance branch, and the Independent Reviewer the same field in its review object. One vocabulary, one set of bounds, one sanitizer for all three. |
| 4 | allocation v3 active on the qualification path | **PASS** | `julius-allocation.v3` is the shared-ceiling policy the live budget wires, and the qualification drive allocates under it and funds a real dispatch. |
| 5 | research consumption restart-durable | **PASS** | a second runtime — new mediator, empty meter — over the same durable store does not re-spend the allowance, and the refusal names the budget rather than something vaguer. |
| 6 | UNKNOWN telemetry stays unknown | **PASS** | by named proofs rather than by grep: a component nobody reported is unknown and never zero; a dispatch whose settlement basis nobody recorded counts as UNKNOWN; an unavailable dump reads as unknown and never as empty; a run with no observed final message reports every participation fact as unknown, not as "did not ask". |

Suites re-run on the stack for this table: the zero-spend qualification e2e, the
research-authority cases, the fixture's own proofs, and the live-timeline
binding — 102 cases, 0 failed. The `julius-continuous-1` contract passes the
real checker on this stack and reports `research: 1 allowance(s) for
CODING_AGENT`.

**The dispatch decision, stated in advance:** on this stack all six pass. It was
five-and-a-half when this was first written, and the half was not a rounding
error — the qualification's own required sequence opens with the Architect doing
serious pre-lock investigation, which a slot with no way to ask cannot do. That
is why the repair was made rather than worked around.

`julius-continuous-1` still grants `CODING_AGENT` only. The grant describes what
the mission needs, not the widest thing now possible; widening it is a separate
deliberate edit, which is the whole point of the grant table.
Nothing here authorises a paid run — that waits on the candidates landing on
trusted main and on the same checks passing there — but the answer will not have
to be worked out at that point.
