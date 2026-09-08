# Wonderland ↔ Unreal — the integration handoff

**Audience: the Wonderland World stream (Session 2).** This is written so you
never have to read Session 3's source to build the receiving side. Everything
below is either a contract you can import or a rule you can implement against.

**Status of the sending side:** the contracts exist, are tested and are
mirrored into `wonderland/Source/Wonderland/*.h`. **No live Julius mission has
ever driven any of it** — see "What is and is not real" at the end. Build
against this expecting real events later; do not describe it as connected.

---

## 1. The event schema

One shape crosses the boundary: `WonderlandEnvelope`, in
`src/relay/mission/wonderland/wonderland-envelope.ts`.

| field | type | note |
|---|---|---|
| `schemaVersion` | `'relay-wonderland-envelope.v1'` | bump = breaking change |
| `eventId` | string | stable; the same delivery twice carries the same id |
| `projectId` | string | **the only never-null identifier** |
| `worldSessionId` | string \| null | the viewing session |
| `juliusInstanceId` | string \| null | WHICH Julius |
| `missionId` | string \| null | |
| `runId` | string \| null | the ordering scope — see §4 |
| `taskId` | string \| null | |
| `workerRole` | enum \| null | see below |
| `state` | `JuliusVisualState` | one of 11, see §2 |
| `stateSource` | enum | `julius_run_state` \| `relay_phase` \| `event_type` |
| `sourceState` | string \| null | the upstream word, so the collapse loses nothing |
| `terminal` | boolean | set only by a real ending |
| `sequence` | number | per **run**, monotonic |
| `revision` | number | `julius_runs.version`, per run |
| `occurredAt` | ISO string | |
| `metadata` | `Record<string, string\|number\|boolean\|null>` | sanitised, bounded |
| `metadataDropped` | number | entries removed; never what they were |

**`workerRole`** is `PROMPT_ARCHITECT` \| `CODING_AGENT` \| `INDEPENDENT_REVIEWER`
\| `SPECIALIST` \| null. The first three are derived from Julius's own
`JULIUS_DEFAULT_ROLES`. A specialist's run-time NAME never crosses — Julius
names specialists freely and letting the name through would make it a de-facto
vocabulary.

**Nothing else crosses.** `metadata` admits primitives only, ≤120 chars per
string, ≤16 entries, with secret-shaped keys dropped. A prompt, a completion, a
stack trace and an API key are structurally unable to travel. **Do not add a
field for provider output.**

---

## 2. The state enum

`JuliusVisualState`, 11 members, mirrored as `EWonderlandJuliusState` in
`WonderlandJuliusState.h` with `Unobserved` at ordinal 0:

`idle` · `attention` · `prompt_architect` · `coding` · `handoff` ·
`independent_review` · `repair` · `verifying` · `complete` · `blocked` · `error`

**Ordinal 0 is `Unobserved`, not `Idle`.** A zero-filled struct means Relay has
not spoken. Never render it as an idle agent.

Each maps to exactly one `EWonderlandDogActivity` (a bijection), then to one
motion, then to one clip. `WonderlandAnimationForJuliusState` composes the
chain — do not add a fourth table.

---

## 3. Legal transitions

`JULIUS_VISUAL_TRANSITIONS` in `wonderland-visual-transitions.ts` is **derived
from Julius's own guard**, not declared. The rules you can rely on:

- `complete` → nothing. `error` → nothing.
- **`blocked` → `complete` is NOT reachable.** A blocked run must be observed
  recovering (→ `coding`, `repair` or `handoff`) and then verified.
- No kernel state maps to `idle` at all. A Julius *run* is never idle; a
  *mission* is. `idle` arrives only from the Relay phase `ready`.
- `repair` is its own state, so a repaired run never looks like one that never
  failed.

**Only readings whose `stateSource` is `julius_run_state` are held to that
table.** The other two sources are coarser and legitimately produce e.g. `error`
mid-run without the kernel being FAILED.

Two rules hold at every source and you should implement them too, as belt and
braces: nothing un-completes a completed mission, and a second *different*
ending never replaces the first.

---

## 4. Ordering — read this before writing a receiver

**`sequence` is per RUN, not per project.** `stream_id` is the run id on every
Julius write path, so two runs in one project both count 1, 2, 3. **A
project-wide cursor is wrong**, not merely imprecise.

Two axes, and neither subsumes the other:

- `sequence` orders **events** within one run.
- `revision` orders **states**. Several events share one revision; a snapshot
  carries a revision and no sequence at all.

`wonderlandOrderingVerdict` checks in this order, and the order matters:

1. `foreign_project` — another world. Not late, misrouted.
2. `foreign_julius` — a different Julius instance. Never merge two streams.
3. `foreign_run` — a run this cursor is not following.
4. `malformed` — unusable sequence/revision/eventId.
5. `duplicate` — the same `eventId` again.
6. `stale_revision` — **checked before sequence.** A stale replica can deliver
   an event whose sequence is genuinely ahead on its own stream while the run
   has moved on; the sequence check alone would accept it and the world would go
   backwards.
7. `stale_sequence`.

Count each refusal **separately**. Forty stale sequences is a chatty replay and
is fine; one `foreign_project` is a routing bug and is not.

---

## 5. Rehydration — joining mid-mission

Take the **snapshot first**, then replay. Never the other way round.

1. `inspectRun` → state + `revision`. **Set** the visual state from it. Do not
   replay the transitions that led there; they happened while nobody was
   watching and performing them now is theatre presented as observation.
2. Then ask the timeline for **everything** (`afterSequence: 0`). A snapshot has
   no sequence, so any other cursor would either skip events or claim to have
   applied events never seen.

That full replay is safe **because** every event carries its revision and
anything below the snapshot's is refused. The world holds COMPLETE and watches
its whole history arrive without moving.

**One subtlety you must implement:** an event at the snapshot's *own* revision
is also stale. A snapshot is the run's row at that revision and is strictly
newer than any event of its generation. Without this, a replayed revision-6
CODING event overwrites a COMPLETE recovered at revision 6. Two *events* at one
revision are peers; a snapshot outranks its generation. `revisionFromSnapshot`
on the cursor carries this, and an accepted event clears it.

---

## 6. Transport

Use the smallest seam that exists; do not build a second one.

- `GET /wonderland/events` (`relay-bridge/wonderland-routes.ts`) — SSE,
  `?projectId&cursor`, replays then subscribes, `id: <sequence>` per frame.
- **There are no Julius HTTP routes on the bridge.** `JuliusRuntimeApi` is not
  mounted anywhere. Snapshot access needs that route to be added — it is not
  yours or mine unilaterally; raise it with the Julius stream.
- **The replay query does not filter `event_type`.** Julius rows land in the
  same table prefixed `julius.`. Use `readWonderlandLedgerBatch`
  (`wonderland-ledger-adapter.ts`) — it refuses non-Julius rows by default and
  handles **both** persisted payload shapes. Reading the rows directly will
  silently lose run-state precision; see §9.

Reconnect backoff: double from 1s to a 30s ceiling, no jitter
(`wonderlandReconnectDelayMs`).

---

## 7. Animation intents

`planWonderlandAnimation` (`wonderland-julius-animation.ts`) returns a
`WonderlandAnimationPlan`, mirrored as `FWonderlandAnimationPlan`:

| transition | blend | when |
|---|---|---|
| `Hold` | 0 | same clip — **do not restart it** |
| `Wake` | 260ms | from `Dormant` |
| `CrossFade` | 180ms | ordinary work → work |
| `Interrupt` | **0 — a cut** | a state that needs a human |
| `Settle` | 420ms | into a real ending |
| `Dormant` | 520ms | back to no observation |

**The one rule that is not aesthetic: a state that needs a human CUTS.** A
failure that is also an ending still cuts — the person outranks the ceremony.
Ordinal 0 is `Hold`, so a zero-filled plan says "keep playing".

Eleven states need **nine clips plus `dormant`** — ten slots total
(`WONDERLAND_REQUIRED_CLIPS`). There is no smaller honest first set: a state
shown by a clip that means something else is worse than a placeholder.
`attention`, `verifying` and `complete` all share `stand_still`, which is why
`terminal` and `attentionRequired` travel *with* the plan and must not be read
off the clip.

---

## 8. HUD bindings — THE GEOMETRY IS FROZEN, AND THE HUD IS BUILT

**This HUD is an Unreal surface. It is mounted on no web page.** Both meters
report what a Compound Agent is spending *while it works*, so they live where
the work happens. The website's landing is an arrival and its Relay stage is
where an agent is named before it has done anything; a meter on either would be
furniture. The React component in `src/relay/ui/wonderland-hud/` exists only as
the REFERENCE rendering — it pins the geometry by digest and drives the preview
harness (`npm run wonderland:hud:preview`), and
`wonderland-hud-placement.test.tsx` fails if any production surface mounts it.

**The Unreal side now exists.** What is in the client, and what each piece is:

| file | what it is |
|---|---|
| `WonderlandUsageGeometry.h/.cpp` | the arc-length poly-Bézier sampler, the draw plan, the ribbon strip, the band builder |
| `WonderlandUsageGeometry.canonical.cpp` | **GENERATED** — the control points, the palette in linear, the viewport crop |
| `WonderlandUsageGeometry.golden.tsv` | **GENERATED** — 66 samples of the TypeScript sampler |
| `WonderlandUsageSubsystem.h/.cpp` | the GameInstance subsystem that holds the reading. The only authoritative client-side state |
| `WonderlandUsageHudWidget.h/.cpp` | the `UUserWidget` that paints both meters. Owns nothing |

Regenerate the two generated files with `npm run wonderland:geometry:export`;
`npm run wonderland:geometry:check` fails when they are stale. **Never hand-edit
them** — the control points are founder-frozen and digest-pinned on the
TypeScript side, so a hand-kept copy would drift while that digest went on
passing.

Three commands verify it without an engine, and it is worth knowing what each
one does and does not claim:

| command | proves | does not prove |
|---|---|---|
| `wonderland:cpp:syntax` | every header and translation unit parses | that anything behaves |
| `wonderland:geometry:verify` | the C++ sampler computes the same curve as the TypeScript, to 1e-4 (observed 1e-6) | that a widget draws |
| `wonderland:usage:verify` | 152 checks over the ordering rules, the draw plan, the bands and the composition | that a widget draws |

**The Slate calls in `WonderlandUsageHudWidget.cpp` are proven by nothing.**
There is no Unreal Engine in this repository; that file has never been compiled
against real UMG headers or seen to put a pixel on a screen. It is the part that
still needs you.


The founder has settled the usage HUD and declared it permanent. **Do not
redesign it, do not reintroduce the crossing variant, do not change its
geometry.** `wonderland-hud-canon.test.ts` pins every control point by digest.

- GREEN = Compound AI Agent. BLUE = single agent. Top-left.
- Green is the outer ring/swoop; blue is the concentric inner hook at ~⅔ radius.
- **Zero overlap, zero occlusion.** Blue is readable across its whole range.
- Tail rises to the right. Viewport `{x:0, y:0.06, w:1, h:0.88}`, derived from
  the measured extent of both strokes.

Data bindings per channel: `current` (the **remainder**, never the spend),
`maximum`, `reference` (per-channel ladder ceiling), `tierId`, `tierLabel`,
`unitLabel`. Readings: `not_reported` (ordinal 0) · `known` · `stale` ·
`unavailable`.

**UNKNOWN IS NOT ZERO.** Every figure is a carrier (`known`/`value`/`reason`),
never a bare number. Never draw a missing authority as an empty valid meter.

Accounting rule (`wonderland-usage-accounting.ts`): **attribution follows the
orchestrator, not the worker.** Every worker slot's spend inside a run is
COMPOUND. An agent working alone is SINGLE. Anything unattributable is reported
and never assigned, and makes the account `partial` — in which case **both**
channels read UNKNOWN rather than showing subtotals whose meaning depends on
what was left out.

---

## 8b. WHO IS AUTHORITATIVE FOR WHAT

The one table to read before adding a field anywhere. Every row names the system
that DECIDES the thing; everything downstream of it holds a copy and may not
argue with it.

| the fact | decided by | held by | never decided by |
|---|---|---|---|
| units spent | Julius / the usage authority | the subsystem's `FWonderlandUsageHud` | the client, the widget, a fixture |
| capacity for this tier | the usage authority | same | the client |
| subscription-tier maximum (`ReferenceCapacityUnits`) | the usage authority | same | the client — it is a billing fact, not a display constant |
| how much to believe the figures (`Reading`) | the usage authority | `FWonderlandUsageAuthorityStatus`, verbatim | the client. A dropped link is reported in the LINK status beside it, never by editing this |
| whether this client's socket is alive | **the client** | `FWonderlandLinkStatus` | Relay — it cannot see the world's socket |
| which reading this client currently holds | **the client** | the subsystem's revision + counters | Relay — pushes arrive out of order and only the receiver knows what it has |
| mission state | the Julius kernel's guarded machine | `FWonderlandJuliusEmbodiment.VisualState` | the world. A renderer may not move a run |
| which visual state a mission state maps to | `wonderland-julius-state.ts`, derived from the kernel | same | the widget |
| Compound Agent state / Single Agent state | Julius | the embodiment | the HUD. The meters report SPEND, not activity |
| the active agent | Julius | the embodiment's `AgentId` | the client, which must render `Unknown` when none travelled |
| the curve, the palette, the crop | the contract (`wonderland-usage-meter.ts`) | generated into `WonderlandUsageGeometry.canonical.cpp` | either renderer |
| the arithmetic from a reading to arcs | `wonderlandMeterDrawPlan`, mirrored as `WonderlandMeterDrawPlan` | both renderers, identically | either renderer alone |
| where the two meters sit relative to each other | the palette's `Emphasis` | both renderers | a Z-order or a canvas ordering |

### The chain, end to end

```
Julius kernel                    run state, revision, operational events
  │                              julius-runtime-api.ts · julius-state-path.ts
  ▼
integration layer (pure TS)      normalize → order → rehydrate → visual state
  │                              wonderland-{normalizer,ordering,rehydration,
  │                              visual-transitions,session}.ts
  │                              usage: wonderland-usage-authority.ts projects
  │                              the meters and says how current they are
  ▼
envelope                         wonderland-envelope.ts — the ONLY shape that
  │                              crosses. No provider payload ever does
  ▼
transport                        the Bridge. See §6
  ▼
UWonderlandUsageSubsystem        RUNTIME STATE. Accepts or refuses the push,
  │                              holds one reading, counts what it refused,
  │                              broadcasts on change. Owns no arithmetic
  ▼
WonderlandMeterDrawPlan          the mirrored arithmetic: reading → arcs
  │
  ▼
WonderlandBuildMeterBands        arcs → unit-space vertex strips
  │
  ▼
UWonderlandUsageHudWidget        PRESENTATION. Scales to the widget, paints,
                                 decides nothing, keeps nothing
```

Read it as a one-way street. Nothing below a line may write to anything above
it, and the two places that could be tempted are the two the rules name
loudest: the widget may not hold a figure, and the client may not edit the
authority's verdict about its own numbers.

### What the layering means for /MAS

The swarm is not built and this document does not describe it. What matters
here is that nothing above **forecloses** it:

- Usage attribution already distinguishes `compound_orchestrated` from
  `single_agent`, and the rule is that attribution follows the ORCHESTRATOR.
  Two or three Compound clones spending under one primary all land in the
  Compound channel without a contract change.
- `EWonderlandWorkerRole` carries a `Specialist` token rather than a fixed list,
  so a spawned specialist has a slot the day it exists.
- The subsystem is keyed by PROJECT, not by agent, so more than one active
  agent inside a project needs no re-binding.

What would foreclose it, and is therefore not done anywhere: collapsing agent
activity into a single boolean, keying runtime state by "the" agent, or letting
the HUD assume exactly one worker.

---

## 9. Failure behaviour you must reproduce

| situation | required behaviour |
|---|---|
| duplicate event | refused, counted, state unchanged |
| late / out-of-order | refused on sequence, counted |
| stale replica ahead on sequence | refused on **revision** |
| wrong project / run / Julius | refused, counted **separately** |
| unknown event type | ignored, counted; never rendered |
| disconnect mid-CODING/REVIEW/REPAIR | state unchanged, `terminal` unchanged, usage figures unchanged, cursor unchanged. **A disconnection is never a completion.** |
| reconnect after COMPLETE | recover COMPLETE; replay moves nothing |
| usage source stale | `stale` + last-reported figures, labelled |
| usage source unavailable | `unavailable` + the reason; figures UNKNOWN |
| blocked / error | never silently become COMPLETE |

---

## 10. Acceptance tests

The sending side's suites are the specification. Mirror their intent:

| suite | proves |
|---|---|
| `wonderland-envelope.test.ts` | no provider payload can cross |
| `wonderland-ordering.test.ts` | a stale CODING event cannot overwrite COMPLETE |
| `wonderland-rehydration.test.ts` | reconnect-after-COMPLETE replays nothing |
| `wonderland-visual-transitions.test.ts` | `blocked`/`error` never reach `complete` |
| `wonderland-usage-accounting.test.ts` | the arithmetic closes; partial ⇒ UNKNOWN |
| `wonderland-ledger-adapter.test.ts` | both persisted payload shapes read correctly |
| `wonderland-hud-canon.test.ts` | the frozen geometry, by digest |
| `wonderland-cpp-parity.test.ts` | every struct and enum, bidirectionally |

`wonderland-cpp-parity.test.ts` walks the real `.h` files, so **a field you add
on the C++ side without a TypeScript counterpart fails the suite**, and vice
versa. That is deliberate: it is how the two sides stay honest without a
meeting.

---

## 10b. The composed fold — start here

`wonderland-session.ts` is the one place the layers compose, and a receiver
should mirror its shape rather than re-composing them differently.

```
openWonderlandSession({ projectId })
  → recoverWonderlandSession(session, snapshot)   // sets the state, no plan
  → applyWonderlandEnvelope(session, envelope)    // ordering → legality → plan
```

`applyWonderlandEnvelope` returns `{ session, ordering, legality, plan, reason }`.

- `plan` is **null** when nothing was applied — not a `hold`. A hold is a real
  instruction ("keep playing, do not restart"); returning one for a refused
  event would say a decision was made about it.
- Recovery returns **no plan** either: arriving at a state you were never
  watching is not a transition, and a `wake` into the middle of a mission would
  perform an entrance that never happened. Show the clip; do not play into it.
- A refusal at any stage leaves the visual state exactly where it was.

**Two paths that are not what you would guess**, both enforced by the derived
table:

- `prompt_architect → coding` is **not** a move. Planning hands off first
  (PLANNING → READY → EXECUTING), so the real path passes through `handoff`.
- `coding → complete` is **not** a move. Verification stands between them.

And one consequence worth knowing before you tune blends: **`settle` never fires
on a kernel-path completion.** `complete`'s only kernel predecessor is
VERIFYING, and both draw `stand_still`, so the plan holds. The ending is told by
the readout and `terminal`, not by the body.

---

## 11. Recorded-real samples

**None exist.** No real Julius event has ever been captured
(`wonderland-evidence.ts` enforces this: `verifyWonderlandCapture` cannot return
`real` for any input, by construction).

The machinery to grade one is built and waiting. When a live run happens,
`wonderlandCapture({ origin: 'recorded_from_live_run', sourceRunId,
capturedAtIso, events })` produces a capture that can be graded. **A capture
claiming a live origin without both a run id and a capture time is silently
downgraded to `synthesised`** — at construction, so a file on disk cannot sit
there lying.

Until then, the only Julius event stream in the repository is
`WONDERLAND_JULIUS_DEV_SCRIPT`, hard-labelled `DEVELOPMENT FIXTURE · NOT A
MISSION`.

---

## What is and is not real

| level | what is at it |
|---|---|
| REAL — a live run drove the world | **nothing** |
| RECORDED-EVENT VERIFIED | **nothing** — no capture has ever been taken |
| INTEGRATION-READY | the envelope, ordering, rehydration, state machine, ledger adapter, accounting, animation plan, entry contract, HUD contract |
| BUILT AND VERIFIED WITHOUT AN ENGINE | the usage geometry (numerically, against the TypeScript), the usage subsystem's ordering and held state, the draw plan, the bands, the composition — 152 checks plus a 66-sample fixture |
| BUILT AND UNVERIFIED | the Slate paint in `WonderlandUsageHudWidget.cpp`. It parses; nothing here can run it |
| SIMULATED | the dev script |
| NOT BUILT | a world-snapshot route, the dog renderer, the swarm, every widget other than the usage HUD |

**Do not describe this as "Julius is connected."** The usage receiver now
exists and is tested; nothing has ever been sent to it, no provider call has
ever been made, and no real Julius event has ever been captured. The sending
side is ready for events it has never seen, and the receiving side is ready for
a push it has never had.

---

## 12. C.A.R.D., and the word it replaced

**C.A.R.D. is the vocabulary. Never PSP.** All new integration work uses it,
and `wonderland-card-vocabulary.test.ts` enforces that the Wonderland layer and
the Unreal client stay clean — a build failure, not a review comment.

The historical surface — `src/relay/psp/`,
`src/relay/ui/psp-import/` and their callers — predates the rename, is
load-bearing, and is **deliberately not renamed**: it would touch persisted
formats, boundary allowlists and a UI import flow for no behavioural gain. The
same test holds it at a counted ceiling so the old surface cannot grow, and the
ceiling is meant to be lowered whenever something legitimately migrates. Four
prose occurrences inside the new layer were migrated when the gate went in;
what remains is identifiers and paths.
