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
