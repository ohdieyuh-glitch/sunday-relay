# Wonderland integration — current

**This file is the recovery point for the INTEGRATION stream.** `/resume`
history disappears; the repository must be enough. Three Claude sessions run
concurrently on this product and this is the only one that owns the seam
between them, so a reader who has never seen the others must be able to
continue from here alone.

| | |
|---|---|
| SESSION | 2026-09-07 — Relay's Wonderland **integration** stream (session 3 of 3) |
| CHECKOUT | `/home/user/sunday-relay` (cloud session, fresh clone; no worktrees) |
| BRANCH | `relay/wonderland-integration`, also pushed to `claude/relay-wonderland-integration-ojr5x6` (the harness's designated branch — same commits, two refs) |
| BASE | `origin/main` at `b2dc9f2` |
| SHA AT END | see `git log -1 relay/wonderland-integration` |
| WHAT RAN LIVE | **Nothing.** No provider call, no Julius mission, no Unreal build, no GPU frame. Every figure in the HUD is a labelled simulated fixture. |

---

## The three development lines, as they actually stand

| line | branch | relationship to this work |
|---|---|---|
| Julius runtime / platform | `main` (`b2dc9f2`) | this stream's base. Julius core, the Bridge, the website and the v1 `wonderland/` C++ module all live here. |
| Unreal world | `relay/wonderland-v2` | **939 commits ahead of the merge base**, `main` 50 ahead of it. A different machine, a different checkout, its own lock (`wonderland/.gauntlet-lock`, `writer=claude`). Owns `wonderland/v2/**`, `wonderland/marble/**`, the world design and the world's own Unreal sources. |
| this stream | `relay/wonderland-integration` | branched from `main`. Touches the seam only. |

**Nothing was merged between lines and nothing should be.** The two Unreal
lines share `wonderland/Source/Wonderland/` as a directory and disagree about
almost everything in it: v2 has `RelayDogCharacter`, `WonderlandRelayLink`,
`WonderlandProjectAvatar` and a dozen more files `main` has never seen. The two
files this stream added there are NEW NAMES on both lines, so they merge
cleanly in either direction; nothing existing in that directory was edited.

---

## What was built

### 1. The Julius → Wonderland state seam (`48d70ba`)

`src/relay/mission/wonderland/wonderland-julius-state.ts`
`src/relay/mission/wonderland/wonderland-julius-normalizer.ts`

The chain, of which only the first arrow is new:

```
runtime event / phase / kernel state
  -> JuliusVisualState        (new: the product's FUNCTION, never a vendor)
  -> OfficialRelayDogActivity (existing, shared with the 2-D website dog)
  -> OfficialRelayDogMotion   (existing)
  -> WonderlandDogAnimation   (existing: the clip Unreal plays)
```

Eleven visual states — `idle attention prompt_architect coding handoff
independent_review repair verifying complete blocked error` — in a **bijection**
onto the eleven `OfficialRelayDogActivity` members, so the browser dog and the
world dog cannot show different behaviour for the same Relay state. The
interrupt order is DERIVED through that bijection rather than restated.

Three links to the runtime, most precise first, declared as data in
`JULIUS_STATE_SOURCES`:

1. `juliusRunState` — the kernel's guarded 13-state machine (`JULIUS_MISSION_STATES`)
2. `relayPhase` — the live runtime's persisted 28-member `MissionPhase`
3. the Wonderland event type — lossy, and the only one reachable before this

Each map is TOTAL over its vocabulary, so a phase or state added upstream fails
`tsc` here rather than rendering as ordinal 0.

`applyJuliusEvent` is the reducer: rejects a foreign project without moving the
cursor, rejects a stale or duplicate sequence, counts (never hides) a gap, skips
a foreign mission while advancing, and latches `terminal` only from
`mission.completed` / `mission.failed`. Reconnect is the same fold over a replay
from `juliusReplayCursor(state)` — not a special case.

### 2. The usage HUD (`86fcae2` and follow-ups)

`src/relay/mission/wonderland/wonderland-usage-meter.ts` (domain)
`src/relay/ui/wonderland-hud/**` (the website presenter)
`wonderland/Source/Wonderland/WonderlandUsageHud.h` (Unreal's mirror)

Top-left. Two channels, bound separately: **green Compound Agent** (the
dominant outer frame, longer tail) and **blue single agent** (a concentric
inner ring, thinner, shorter). Both swoop.

The composition is the Kingdom Hearts reference MIRRORED — the whole layout,
not just the curve. There: a thick green ring wraps a portrait at the RIGHT-hand
end of the HUD, its gap opens LEFT, a long tail leaves the ring and sweeps away
to the left while descending, and a blue MP bar runs along the bottom with
its near end passing BEHIND the ring. Here: the ring sits in the anchored
top-left corner, its gap opens RIGHT, the tail leaves travelling RIGHT while
descending, and the blue SWOOPS left to right — diving out of the frame's left
side, under the ring's lower arc, and away to the right.

The blue swoops rather than running straight, and that is the direction in as
many words: "the single-agent bar swoops right, behind the Compound frame". A
dead-straight bar beside a ring reads as two widgets placed together; this is
one drawing and the blue is its second stroke. BEHIND is literal, not adjacent —
the stroke starts on the frame's own stroke and crosses under the ring, so the
frame occludes it, and the frame's `emphasis` is what makes that true rather
than accidental. Most of the sweep sits in the RIGHT half deliberately: the left
half is behind the ring, and a swoop nobody can see is a straight line as far as
a viewer is concerned.

Five facts are MEASURED rather than trusted, because a mirrored figure is the
easiest thing to get half-right:

- the aperture faces right — the spine's extreme point is interior and on the
  left, and both ends sit well right of it
- the swoop travels right — the tip is the right-most point in the shape
- the swoop descends — the tip sits BELOW where the tail leaves the ring
- the ring is a RING — constant radius over 305 degrees, and a circle rather
  than an ellipse
- the blue starts BEHIND the frame — its first point is inside the frame's own
  stroke, not merely near it — and CROSSES it, entering the ring's footprint and
  leaving, so the occlusion happens rather than being implied
- the blue swoops — its midpoint sits well off the chord between its ends, by
  more than a hint

`taperStart` sits at almost exactly the ring's share of the arc length. A tail
that kept the ring's weight for another fifth of the stroke stopped reading as a
flick and made the whole figure read as a wave rather than as a ring with a
tail, which is what the reference is.

`WONDERLAND_USAGE_VIEWPORT` is the window onto the unit box, and it is part of
the contract rather than a number each renderer picks — the drawing is a ring
with a bar beside it, so it fills the width and occupies a band of the height at
roughly the reference's own 2.1:1. A window, never a squash: the aspect is
preserved, so a stroke's thickness means the same thing in both axes and the
ring does not render as an ellipse it was never authored as.

The meaning is not a percentage:

```
capacitySpan     = capacity / reference    the meter's PHYSICAL LENGTH
remainingFraction = remaining / capacity   how much of it is LEFT (what is drawn)
fillFraction     = used / capacity         how much has been SPENT
```

`referenceCapacityUnits` is **per channel**, from that channel's own tier
ladder — one shared ceiling drew a single agent on its top tier as a quarter of
a bar because a Compound Agent can buy more.

The shape is DATA: a poly-Bézier spine plus a hold-then-taper width profile,
sampled by **arc length** (Bézier `t` runs fast through gentle stretches, so raw
`t` would draw a different length for the same spend depending where it fell).
Both surfaces read the same struct, so a redraw is editing those numbers once.

### 3. The link — the piece that composes the seam

`src/relay/mission/wonderland/wonderland-julius-link.ts`

`createWonderlandJuliusLink` → `observeJuliusEvents(link, kernelEvents, …)` runs
the whole chain in one call: normalize, fold, and return the world events for
the caller's own durable log (a link that kept them would be a second event
store with no replay). Immutable — `observe` returns a NEW link — which is what
makes "the stream arrived in two pieces" testable as the normal case it is.

**Its label is the point.** A link declares `live_runtime` or
`development_fixture`, the label travels on the status, and a surface reaching
the embodiment has necessarily passed it. `WONDERLAND_JULIUS_DEV_SCRIPT` is a
scripted twelve-event run in the kernel's own shape (`run.transitioned` with
`facts.to`, exactly as the runtime emits it), and `wonderlandJuliusDevLink()`
returns the LINK rather than the embodiment so nothing can reach the state
without the label saying it is not a mission.

This is the shape the Bridge wiring will take. The next session's task is to
swap the in-memory source for the real one, not to invent a composition.

### 4. The Unreal receiver

Two new headers, mirrored field-for-field and enforced by
`wonderland-cpp-parity.test.ts`:

- `WonderlandJuliusState.h` — `FWonderlandJuliusEmbodiment`,
  `EWonderlandJuliusState`, `EWonderlandJuliusStateSource`
- `WonderlandUsageHud.h` — `FWonderlandUsageHud`, `FWonderlandUsageMeter`,
  `FWonderlandUsageSwoosh`, `FWonderlandSwooshSegment`,
  `FWonderlandUsageChannelStyle`, `EWonderlandUsageStatus`,
  `EWonderlandUsageChannel`, `EWonderlandHudAnchor`

`WonderlandJuliusState.cpp` makes the state machine executable in Unreal:
`WonderlandActivityForJuliusState`, `WonderlandMotionForActivity`,
`WonderlandAnimationForJuliusState` (COMPOSED from the other two and the
existing motion→clip resolver, never a fourth table) and
`WonderlandJuliusStateAsksForAHuman`. Each switch is compared case by case
against the TypeScript map it mirrors, and the parity test asserts that no
direct state-to-clip switch exists — not merely that the composed one is right.

The parity test now merges `wonderland-integration-parity.ts` with the
document's own table and applies every check to the union, in both directions.
Verified by injecting a `bWonderlandApproved` field and watching three
assertions fail, and by flipping one resolver case and watching the failure
name it.

---

### 5. The HUD, frozen (`a15d251`)

`src/relay/mission/wonderland/wonderland-hud-canon.test.ts` (15 tests)

The founder settled the geometry over five messages and then said: **do not
redesign it.** So the geometry is pinned by a digest — every control point
formatted at `toFixed(6)` and joined into one string, with the canonical value
written into the test. A 0.0004 nudge to any point fails it (verified). The
viewport, anchor, hues, emphasis order, channel order, the six shape invariants
(opens right / travels right / swoops down / is a ring / blue crosses behind /
blue swoops) and the four approved readings are all pinned alongside it.

**Treat the HUD as a frozen presentation component.** Work below it, not on it.

### 6. The usage authority (`a15d251`)

`src/relay/mission/wonderland/wonderland-usage-authority.ts` (27 tests)

Provider-neutral. A report carries a project, a revision, an observation
timestamp, an authority id, and per-channel `current` / `maximum` / `reference`
/ `tierId` / `tierLabel` / `unitLabel`. `current` is the REMAINDER, never the
spend; the one `maximum - current` conversion lives in `usedUnitsFrom` so the
bar and the readout cannot measure different things again.

Four readings, and `not_reported` is ordinal 0 so a zero-filled struct says
Relay has not spoken rather than claiming an empty meter. An unreadable
timestamp reads STALE, because "I cannot tell how old this is" is not "it is
current". A report from the future is NOT stale — clock skew is ordinary and a
healthy system should not flicker. Foreign-project reports, stale revisions and
malformed reports are each counted separately.

Tier changes move `maximum` and `reference`, not a percentage: the bar's
PHYSICAL capacity changes, which is what the founder asked for.

### 7. The bridge session (`eac4443`)

`src/relay/mission/wonderland/wonderland-bridge.ts` (28 tests)

Adopts Unreal's pre-existing `EWonderlandLinkState` rather than inventing a
seventh vocabulary, and moves it out of the C++-only allowlist. Reconnect delay
doubles from 1s to a 30s ceiling with no jitter (a client that jittered would
make a reconnect storm untestable).

Four rules, each tested: a lost connection never changes the visual state,
never sets terminal, never clears the usage figures, and never moves the
cursor. **A disconnection is never a completion**, mechanically.

### 8. The ending guards (`ea4fb36`)

The sequence check refuses events that arrive LATE. This is the other case: an
event delivered perfectly in order that still contradicts a completion the
founder already saw. Once a mission has ended, a later running state is refused
(`refused_would_uncomplete`), and a second DIFFERENT ending does not replace the
first (`refused_second_ending`) — a world showing whichever landed last would
flip its verdict on delivery order. Both are counted, and the cursor still
advances: refusing an event's CONTENT is not a reason to ask for it again.

The gate is `terminal`, not the visual state, so a mid-run `error` still
recovers into `repair` instead of freezing the world on a recoverable fault.

### 9. The animation plan (`ea4fb36`)

`src/relay/mission/wonderland/wonderland-julius-animation.ts` (34 tests)

STATE LOGIC and ANIMATION PRESENTATION are separated here. Six transitions —
`hold`, `wake`, `cross_fade`, `interrupt`, `settle`, `dormant` — with blend
durations both surfaces share, because if each renderer chose its own the
browser would ease into an error the world cut to.

The one rule that is not about aesthetics: **a state that needs a human cuts.**
A failure that is also an ENDING still cuts — the person outranks the ceremony.

Required clips are DERIVED: eleven states collapse to nine clips plus
`dormant`. There is no smaller honest phase one, because a state shown by a
clip that means something else is worse than a placeholder — a placeholder
reads as missing, a wrong clip reads as a fact. Three states share
`stand_still`, which is why `terminal` and `attentionRequired` travel with the
plan rather than being read off the body. The plan names no asset, no file and
no provider, and a test holds it to that: that is what keeps clips replaceable.

C++ ordinal 0 is `Hold`, so a zero-filled plan says "keep playing". `Interrupt`
at 0 would cut on a struct nobody wrote; `Dormant` would fade the dog out
whenever a message dropped, rendering a transport fault as a fact about the
mission.

### 10. The entry contract (`2758c0c`)

`src/relay/mission/wonderland/wonderland-entry.ts` (31 tests)
`src/relay/ui/wonderland-entry/wonderland-renderers.ts` (10 tests)

`ENTER WONDERLAND` had no `onClick`, and the reason it stayed that way matters
more than the fix: there is a real bridge route behind it,
`POST /wonderland/presence/join`, and it really can succeed. Wiring it to an
`entered` flag would produce a working request that leaves the founder looking
at the landing page.

So entry has two axes and neither may be inferred from the other:

| axis | question | who answers |
|---|---|---|
| ADMISSION | did the world let this person in? | the bridge |
| PRESENTATION | is anything actually SHOWING it? | a renderer, by claiming it |

Being in Wonderland is `presentation === 'presenting'` and nothing else,
defined in one place so no surface decides for itself that admitted is close
enough. `ADMITTED · NOTHING CAN SHOW IT` is a real state and today's true one.

The empty renderer list is pinned by a test, so whoever ships the first world
client must change the sentence people are told in the same commit. A second
test walks the whole path with a renderer handed in, proving the gap is the
ASSET and not the wiring.

### 11. The wall between worlds (`9891a79`)

`src/relay/mission/wonderland/wonderland-worlds.ts` (27 tests)

Every other module holds ONE world. A founder with three projects has three
worlds, one tab and one stream. Getting the routing wrong does not throw and
shows no red state — project A's mission animates project B's dog, which looks
exactly like the product working.

So the guarantee is **referential identity**: routing anything leaves every
other world the same frozen object. Equality would pass for an implementation
that rebuilt every world and got the values right; identity only passes if the
others were never touched. Mutation-verified both ways — routing by the focused
world fails four tests, and rebuilding every world while keeping every value
correct still fails three.

Routing goes through one function, so there is exactly one place that could
break it. Not mirrored into C++ deliberately: an Unreal client shows one world,
and a multi-tenant container has no business in a single-tenant process.

---

### 12. The honesty ladder, as a function (`a4672cb`)

`src/relay/mission/wonderland/wonderland-evidence.ts` (22 tests)

The five-rung table below is now executable. A CAPTURE of Julius events carries
where it came from; `verifyWonderlandCapture` replays it through the real
normalizer and the real reducer — not a simplified fold, which would measure
code that does not ship — and says which rung it establishes.

Two properties make it worth having:

- **`real` is unreachable from this module**, by construction and by test.
  `real` means a live run drove the world AS IT RAN; a replay is not that,
  however genuine the recording. No input produces it.
- **Claiming a live origin costs something.** A capture may only call itself
  recorded from a live run if it names the run AND when it was taken. Without
  both it is downgraded to `synthesised` — at CONSTRUCTION, so a file on disk
  cannot sit there claiming a live origin and survive being read by something
  that never called the verifier.

A capture can only ever establish two of the five rungs, exported as data. A
real recording of events the model does not map lands on `integration_ready`:
it proves the code runs and nothing about a mission.

`wonderlandEvidenceClaim` holds the sentence a person may say, because that
sentence is what gets copied into a demo script and is the exact point where
"real events, replayed" becomes "Julius is connected". A test asserts the word
"connected" never appears in it.

### 13. ENTER WONDERLAND does something (`6f6f854`)

`src/relay/ui/wonderland-entry/join-wonderland.ts` (10 tests)
`src/relay/ui/wonderland-entry/useWonderlandEntry.ts` (10 tests)

The button now runs the entry state machine. One network call, and it is the
only thing in the path that touches the network. **The only route to `admitted`
is a 2xx that NAMED a session** — not a 200 with an unreadable body, not a 200
with no session in it, not the request having been sent. A request that never
completed says "could not be reached" rather than "refused", because a founder
acts on those differently.

The hook holds no `isLoading`, no `error` and no `entered`: a hook with its own
flags beside a state machine will eventually disagree with it. A second click
in the same frame cannot post twice — guarded by a ref, because React batches
and a second join is a second presence.

**Verified in the shipped bundle**: the label, the route and the renderer gap
are all present, with no Node-only code or credential name alongside them.

### 14. The HUD reads from the authority (`2a3fbd8`)

`src/relay/ui/wonderland-hud/useWonderlandUsage.ts` (+ 10 tests)

The HUD was mounted in `RelayWorld` and handed a simulated fixture directly, on
the normal production path — `#/relay` is the Relay experience, not a preview
route. That broke this repository's own rule, which the OTHER usage bar already
obeys and tests (`usage-integration.test.tsx`).

The deeper problem: a fixture passed straight to the view meant the authority's
REFUSALS never ran. A surface able to put figures on screen without passing
through `applyWonderlandUsageReport` is a second, unguarded way in. Everything
now goes through one door.

**What a founder sees today is UNKNOWN, labelled NO USAGE AUTHORITY
REPORTING** — the true state, and what the HUD was designed to say. Confirmed
in the shipped bundle: the label is present and `wonderlandUsageHudFixture` is
gone from it entirely.

---

## What is REAL and what is not

Read this table before saying anything about this stream out loud. The
distinction between the middle two rows is the one that gets misreported.

| | state |
|---|---|
| Julius phase → visual state mapping | **real**, total over the live runtime's own 28-member union |
| Julius kernel state → visual state | **real**, total over `JULIUS_MISSION_STATES` |
| `JuliusOperationalEvent` → `WonderlandEvent` normalizer | **real**, pure, tested — **and nothing calls it yet** |
| the event reducer, the ending guards, the reconnect fold | **real**, tested against events constructed in the test files |
| per-project isolation across many worlds | **real**, proven by referential identity, mutation-verified |
| the entry contract (admission vs presentation) | **real**, and its honest answer today is `ADMITTED · NOTHING CAN SHOW IT` |
| HUD geometry, palette, capacity model | **real** and shared with Unreal by bidirectional parity |
| the usage authority (KNOWN / NOT-REPORTED / STALE / UNAVAILABLE) | **real** contract; **no authority reports into it** |
| the numbers in the HUD | **NOTHING REPORTS THEM.** Production shows `UNKNOWN` / `NO USAGE AUTHORITY REPORTING`. The simulated fixture is no longer reachable from the app and is gone from the shipped bundle. |
| the entry path (`ENTER WONDERLAND`) | **real** as far as `admitted`; the button runs the state machine and posts to the real bridge route |
| the honesty ladder itself | **real and executable** — `verifyWonderlandCapture` grades a capture, and `real` is unreachable from it by construction |
| Unreal rendering any of it | **not built.** Headers parse; no widget, no client, no frame. |
| a live Julius mission driving the world | **NO. Not once.** |

**Do not describe this as "Julius is connected".** The honest word is
INTEGRATION-READY. Using the brief's own five-way scale:

| level | what is at it |
|---|---|
| REAL (live Julius drove it) | nothing. Unreachable from any replay, by construction |
| RECORDED-EVENT VERIFIED (a captured real event replayed through it) | nothing — no capture has ever been taken. The machinery to grade one now exists |
| INTEGRATION-READY (contract + reducer + parity, exercised by constructed events) | the state machine, the normalizer, the bridge session, the usage authority, the entry contract, the worlds record, the animation plan |
| SIMULATED (labelled fixture) | the dev event script, and nothing a production surface loads |
| NOT BUILT | the Unreal client, the world snapshot route, any renderer at all |

A test that manufactures its own input and then reports the world connected is
exactly the untruth this repository is built to refuse, so every suite in this
stream carries that statement in its own header comment.

---

## The gaps this stream found and did NOT close

Ordered by how much they block the next step.

Two gaps from earlier revisions are now CLOSED and are not repeated below:
"ENTER WONDERLAND is a readiness label, not a launch" (the button runs the
entry state machine and posts to the real route), and "the HUD is fed a
simulated fixture" (it reads from the usage authority and production draws
UNKNOWN). What remains is genuinely blocked on other sessions or on assets.

1. **`observeRelayTransition` is battle-scoped.** `wonderland-backend.ts` looks
   a BATTLE up by mission id and returns `[]` when there is none — so an
   ordinary Julius run, which is what a founder actually runs, produces no world
   events at all. The normalizer this stream added is the replacement path;
   **wiring it is still the next task.**

2. **`server.ts` forwards 9 of 28 phases.** `relay-bridge/server.ts:1162`
   filters `onPhaseTransition` down to the nine members of the hand-copied
   `RelayMissionPhase`. The domain handles all 28. Widening it is a one-line
   change in a file the Julius session edits constantly, so it was deliberately
   left alone.

3. **A Julius payload can reach the browser malformed. TWO separate bugs, both
   re-verified this session.** Found, not fixed — `src/relay/persistence/` is
   the Julius session's territory.

   a. **No `event_type` filter on replay.**
      `wonderland-postgres.ts:175` selects `payload FROM relay_wonderland.events
      WHERE project_id=$1 AND sequence>$2` with no type filter, while
      `julius-event-postgres.ts` writes into that same table with
      `event_type = 'julius.…'` and `visibility = 'PROJECT'` (not a member of
      `WonderlandVisibility`). A Julius payload is
      `{schemaVersion:'relay-julius-event.v1', …}` — no `eventId`, no
      `eventType`, no `sequence`. **The correct pattern already exists three
      files away**: `julius-timeline-postgres.ts:41` filters
      `AND event_type LIKE 'julius.%'`. The Wonderland replay is the one that
      forgot.

   b. **Sequences are allocated per stream and replayed per project.** Both
      writers allocate from `stream_sequences` keyed by a STREAM
      (`wonderland-postgres.ts:164` takes a `streamId`;
      `julius-event-postgres.ts` uses `event.runId`), but `replay()` orders by
      `sequence` scoped to `project_id`. Two runs in one project therefore both
      produce sequences 1, 2, 3…, so a project-scoped cursor sees duplicates and
      interleaving. **A cursor cannot be correct against this.**

   Our reducer is SAFE against (a) — `Number.isSafeInteger(undefined)` is false,
   so malformed rows are counted stale and dropped rather than rendered. It is
   not safe against (b), and neither is anything else. **Raise both with the
   Julius session.**

4. **No Bridge route serves the world snapshot.** `projectWonderlandWorld` has
   no non-test caller anywhere.

5. **No renderer exists, in any form.** No pixel-streaming player, no
   signalling client, no embedded world scene; `HTTP`, `Json`, `UMG` and
   `Slate` are in `Wonderland.Build.cs` and entirely unused. Nothing constructs
   an `FWonderlandWorld`. This is now written down as
   `BUILT_IN_WONDERLAND_RENDERERS = []` with a test pinning it empty, so it can
   no longer be forgotten — but it is still the largest missing piece by far.
   On `relay/wonderland-v2` there IS a `UWonderlandRelayLink` GameInstance
   subsystem that pushes world state to registered pawns and is fail-closed
   without a configured Bridge URL. **That is the receiver to bind to**, and it
   lives on the world session's line.

6. **No captured real Julius event exists.** Not one has ever been recorded, so
   even RECORDED-EVENT VERIFIED is out of reach without either a live run or a
   capture from one. This is the cheapest step up the honesty ladder and it
   needs the Julius session, not this one.

---

## One measured cost of the frozen HUD — A FOUNDER DECISION, NOT A BUG TO FIX

**Verified by rendering the real component in headless Chromium and measuring
the geometry numerically. Nothing was changed.**

The single-agent (blue) stroke swoops behind the compound (green) one, exactly
as asked. The price is that **the compound ring covers the first 33.3% of the
blue spine**, in one contiguous span from its tail:

| single-agent remaining | visible bright fill |
|---|---|
| 3% | **0.0%** of the stroke |
| 10% | **0.0%** |
| 20% | **0.0%** |
| 35% | 1.7% |
| 50% | 16.7% |
| 75% | 41.7% |
| 100% | 66.7% |

The HUD draws the REMAINING fraction from the tail, so **any single-agent
reading at or below about a third draws the same as empty** — and that is
precisely the range where "you are nearly out" needs to be legible. Above a
third the bar reads correctly and the design works.

This is recorded rather than repaired because the geometry is frozen by explicit
instruction. `wonderland-hud-canon.test.ts` now pins the measurement, so it
fails if anyone moves the two strokes relative to each other — including a fix.

**Two options that would NOT touch geometry**, if the founder wants it
addressed:

1. **Drain the blue from the tip instead of the tail.** The readable outer two
   thirds would then carry the low readings. Spine, widths, control points,
   overlap and draw order stay byte-identical and the canon digest still passes;
   what changes is which end the `stroke-dashoffset` starts from.
2. **Lift the blue's head marker above the ring in the draw order**, keeping the
   body behind it. The bar still passes behind the green; only the small bright
   head stays visible, so a low reading has something to point at.

Both are presentation changes. Neither is taken without the founder saying so.

---

## Landing → world, as it actually is

`index.html` → `src/relay/main.tsx` → `RelayBetaEntry` → `RelayPreviewApp`.
The decisive line is `RelayPreviewApp.tsx:1284`:

```tsx
if (route.screen === 'landing' || route.screen === 'experience') {
  return <RelayWorld initialStage={route.screen === 'experience' ? 'relay' : 'aquala'} />;
}
```

An **early return before all other chrome** — no header, no usage bar, no
notification host. `RelayWorld` owns one `<canvas>` for the whole journey and
renders `RelayLanding` (Aquala) and `RelayExperience` (Relay) as DOM layers over
it; the same element is returned for both routes so the WebGL context survives
the hash change.

The HUD is mounted **inside `RelayWorld`, gated on `stage === 'relay'`** — a
fixed overlay rather than a child of the Relay chrome, so the stage's opacity
fade cannot half-dissolve a number someone is reading. Aquala has no capacity to
report, and a meter there would be furniture pretending to be a reading.

The transition to an actual Unreal session does not exist and was not invented.
The seam that would carry it is `wonderland-handoff.ts`; the missing pieces are
a session launcher and a stream client, neither of which has a counterpart on
any branch.

---

## Tests

Every suite this stream added, with what each one is actually for:

| suite | tests | what it proves |
|---|---|---|
| `wonderland-julius-state.test.ts` | 59 | vocabulary, the bijection, three derivations, event-reading precedence, the reducer's ordering rules, reconnect equivalence, and the ending guards |
| `wonderland-usage-meter.test.ts` | 46 | capacity-vs-percentage, unknown is never zero, per-channel ceilings, drain/replenish, provenance |
| `wonderland-hud-canon.test.ts` | 15 | **the freeze.** Digest of every control point; fails on a 0.0004 nudge |
| `wonderland-usage-authority.test.ts` | 27 | KNOWN / NOT-REPORTED / STALE / UNAVAILABLE, skew, unreadable timestamps, the three rejection counters |
| `wonderland-bridge.test.ts` | 28 | link states, reconnect backoff, and the four things a lost connection may never do |
| `wonderland-julius-animation.test.ts` | 34 | transitions, the interrupt rule, derived clip coverage, no asset/provider leakage |
| `wonderland-entry.test.ts` | 31 | admission and presentation as separate axes; being admitted is not being there |
| `wonderland-entry-availability.test.ts` | 10 | this build ships no renderer, pinned against the repository |
| `wonderland-worlds.test.ts` | 27 | per-project isolation by referential identity |
| `wonderland-evidence.test.ts` | 22 | the honesty ladder; `real` unreachable; live claims that are not paid for |
| `join-wonderland.test.ts` | 10 | every possible bridge answer, folded; the only route to admitted |
| `useWonderlandEntry.test.tsx` | 10 | the button's state; no double post; never stranded on ENTERING |
| `wonderland-hud-production.test.tsx` | 10 | production loads no simulated figure; the authority's refusals actually run |
| `wonderland-cpp-parity.test.ts` | 41 | every struct and enum, bidirectionally, against the real `.h` files |
| `wonderland-hud.test.tsx` | 21 | the rendered HUD: mask region, per-instance ids, reading labels |
| `wonderland-julius-link.test.ts` | — | the composition and its `live_runtime` / `development_fixture` label |

**2,128 passing across the whole UI and wonderland slices**, 0 failed. Plus the
repository boundary scanner, the core boundary test, the Julius harness drift
gate, the C++ syntax check, `npm run typecheck` (all four projects) and
`npm run build` — all clean.

### The full suite, and its one failure

`npm test` at `9891a79`: **9,657 passing, 1 failed, 22 todo across 502 files**
(163s). The failure is **not this stream's** and is recorded here rather than
rounded off:

`src/relay/workspace/julius-tools/executor-repair-regression.test.ts` fails as
an **unhandled rejection**, not an assertion —
`RemoteExecutorControlPlane.call` throws `EXECUTOR_UNAVAILABLE` from a promise
that escapes the test
(`remote-executor-control-plane.ts:65`). Evidence it is pre-existing:

- the file passes **14/14 in isolation**; it only fails under full-suite
  parallel load,
- `git diff b2dc9f2..HEAD -- src/relay/workspace relay-bridge` is **empty** —
  this stream does not touch that subtree at all.

It is a genuine latent defect (a floating promise, surfacing as a race), and it
belongs to the **Julius session**. Worth raising with them; do not "fix" it from
this stream.

### What was mutation-verified

Passing tests are not evidence unless they can fail. These were each broken on
purpose and confirmed to fail:

| mutation | tests that caught it |
|---|---|
| HUD control point nudged by 0.0004 | the canon digest |
| ending guard bypassed in the reducer | 3 |
| interrupt rule disabled | 4 |
| a C++ field renamed, an enum member renamed | 2 parity tests |
| routing by the focused world instead of the event's project | 4 |
| every world rebuilt, all values still correct | 3 (identity, not equality) |
| the live-origin requirement dropped from a capture | 5 |
| the double-click guard removed from the entry hook | 1 |
| the simulated HUD fixture put back on the production path | 2 |

---

## Defects found while building, and fixed here

- **`nullableKeys` does not survive being called from another module.**
  `wonderland-contracts.ts` builds its nullability manifests with
  `exactKeys<Record<NullableNames<T>, unknown>>()`; `keyof` on that constructed
  record resolves to `never` once instantiated across a file boundary, so every
  name in the list errors and the obvious fix is to empty it — leaving a
  manifest that proves nothing while looking exactly like one that does. The
  integration parity module proves nullability by mutual assignability instead,
  and doing so immediately caught two nullable fields (`activity`, `motion`) the
  hand-written list had missed. **The existing manifests in
  `wonderland-contracts.ts` are fine** — they are used in their own file.
- **The HUD's bar and its number measured different things.** Drawing
  `fillFraction` (spend) beside a readout of the remainder made an untouched
  meter read `480 / 480` next to an empty bar. Both halves were correct; together
  they were nonsense. The meter now drains: `remainingFraction` is drawn.
- **An SVG mask's default region is a percentage of the VIEWPORT.** Cropping
  the viewBox to a wide band left that default ending around y=52, while the
  ring's lower arc and the entire single-agent bar sit near y=66 — both masked
  away, both rendering as bare track. Every number on screen stayed correct and
  half the drawing went dark, which is the same class of defect as the shared
  mask id below and was invisible until the viewBox stopped being square. The
  region is stated explicitly now, and a test reads it out of the markup.
- **SVG mask ids are document-global.** Two HUDs on one page shared them, so the
  first one's mask painted both and the second showed the FIRST meter's
  remainder under its own numbers — every figure on screen correct and the
  picture wrong. `instanceId` now distinguishes them, and `useId` alone is not
  enough because it restarts per `renderToStaticMarkup` call.
- **Two tables disagreed about one kernel event.** `finding.recorded` resolved
  to `independent_review` read directly and to `verifying` after normalizing
  into `verification.finding` — so a finding recorded mid-review flipped the
  world to a stage nothing performed. A finding is EVIDENCE, not an activity,
  and it is produced during review AND during verification, so mapping it to
  either is a guess that is wrong half the time. Both mappings removed; a test
  now holds the two tables against each other for every kernel event that has
  both a world type and a visual state. Found by folding the dev script.
- **A preview runner that built its command at runtime.**
  `relay-repository-boundary.mjs` refuses a file run from package.json that
  assembles a child command, because a deployment-capable path must be readable
  without executing it — and the first preview had an `.mjs` wrapper doing
  `execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), …)`. The scanner was
  right; the wrapper is gone and the npm script carries two literal commands.
- **A frame loop in the HUD.** `relay-dog-motion-boundary.test.ts` allows
  exactly one `requestAnimationFrame` owner in the whole website. The first HUD
  draft added a second; the drain is now an SVG mask whose dash offset CSS
  transitions, with no script running per frame.

---

- **`WONDERLAND_ACTIVITY_CLIP` was used before it was declared, with the
  imports it needed sitting mid-file.** A temporal-dead-zone error at module
  evaluation. `tsc` did not object because the reference was inside an
  initializer it could not order; nothing caught it but reading the file.
- **Two comments in the animation module described code that did not exist.**
  A ten-item list described as "nine of the eleven", and "`verifying` and
  `complete` share `stand_still`" when `attention` shares it too. Both replaced
  with a derivation over the whole vocabulary, so the count cannot drift from
  the list again.
- **A test fixture claimed every visual state was reachable from an event
  type.** Three are not: `idle`, `handoff` and `blocked` arrive in the payload,
  and the kernel has no idle at all — a RUN is never idle, a MISSION is. A
  hand-built embodiment would have hidden that; driving the fixtures through the
  real reducer surfaced it immediately.
- **The C++ syntax check's baselines are hand-maintained, so a file added
  without an entry was silently unchecked.** Exactly the gap its own comment
  records having already cost two whole headers. It now enumerates the source
  directory and fails on anything unlisted.
- **`unofferedConfirmationsRefused` tripped the parity authority sweep.** The
  regex is deliberately broad, but the rename it forced produced the better
  word: what arrives from a renderer is a CLAIM this module weighs, not a fact
  it is obliged to record. Renamed rather than allowlisted.

---

## Conflicts avoided

- No file under `wonderland/v2/**`, `wonderland/marble/**` or the world
  session's design tooling was read for anything but recovery, and none was
  written.
- No existing file in `wonderland/Source/Wonderland/` was edited. Both new
  headers are names neither Unreal line has.
- `relay-bridge/server.ts`, `relay-bridge/mission.ts` and everything under
  `src/relay/mission/julius/` were **read only**. The Julius session edits those
  constantly and the integration needs nothing from them but their vocabularies.
- `scripts/export-julius-harness.mjs` gained two names in
  `KERNEL_DEPENDANT_EXCLUSIONS` plus one sentence on the existing Wonderland
  boundary — the mechanism that file provides for exactly this, and an append
  rather than a restructure.
- `wonderland-cpp-parity.test.ts` gained an import and three merged constants;
  its nineteen usage sites are untouched.

---

## Dependencies

**On the Julius session (session 1)**

- Live Run 2. Until a real mission runs end to end there is nothing authentic
  to drive the world with.
- The battle-scoped `observeRelayTransition` (gap 1) and the nine-phase filter
  in `server.ts` (gap 2) are both in their files.
- The malformed-Julius-payload replay bug (gap 3) is in
  `src/relay/persistence/wonderland-postgres.ts`.
- `repair` is currently only reachable from the kernel's `REPAIRING` state and
  from the browser's coarse union. The live phase model has no repair phase; if
  one arrives, add it to `JULIUS_PHASE_VISUAL_STATE` (the map is total, so `tsc`
  will insist).

**On the world session (session 2)**

- `UWonderlandRelayLink` on `relay/wonderland-v2` is the receiver these structs
  are shaped for. When the two Unreal lines reconcile, the parity table follows
  the headers.
- No Unreal widget exists for the HUD. `UMG`/`Slate` are already linked.

---

## Exact next integration task

**Wire the normalizer into the Bridge so an ordinary Julius run produces world
events.** Concretely, in a composition root (not in the kernel and not in
`WonderlandBackend`):

1. Subscribe to Julius operational events for a run.
2. Call `normalizeJuliusOperationalEvents(events, { baseSequence, nextEventId,
   identity })` — the ledger allocates the sequence; the normalizer must not.
3. Append the results where `GET /wonderland/events` can replay them. That route
   currently reads `WonderlandBackend.empty()`'s in-memory log
   (`server.ts:1153`); `DistributedWonderlandRealtime` +
   `PostgresWonderlandFanout` exist, are tested, and are **constructed nowhere
   outside tests**.
4. Fix gap 3 before step 3 reaches production, or Julius payloads already in
   `relay_wonderland.events` will be replayed onto the SSE wire as
   `id: undefined`.

Then, and only then, drive `rehydrateJuliusEmbodiment` from the real stream and
record the evidence here. **Do not claim Julius is connected before a real
mission moves the world.**

---

## Final report (the brief's A–L)

**A. Starting SHA** — `b2dc9f2` (`origin/main`, unchanged throughout; this
stream never merged into or from `relay/wonderland-v2`).

**B. Ending SHA** — `defe621` on `relay/wonderland-integration`, pushed to both
that ref and `claude/relay-wonderland-integration-ojr5x6` (same commits).

**C. Integration layers completed** — fourteen, listed under "What was built":
the state seam, the HUD, the link, the Unreal receiver, the HUD freeze, the
usage authority, the bridge session, the ending guards, the animation plan, the
entry contract, the wall between worlds, the executable honesty ladder, the
entry button, and the HUD's authority wiring.

**D. HUD data progress** — the geometry is frozen and pinned by digest. Beneath
it there is a provider-neutral usage contract with four readings, per-channel
tier ladders that change PHYSICAL capacity, three rejection counters, and an
authority id carried for traceability and never interpreted. The mounted HUD now
READS FROM IT — the simulated fixture is unreachable from the app and absent
from the shipped bundle. **No authority reports into it**, so production draws
`UNKNOWN` and says `NO USAGE AUTHORITY REPORTING`. The visual layer knows
nothing about billing or providers, and a test sweeps its output for provider
names and key shapes.

**E. Event bridge** — Julius events normalize to a provider-independent
contract; the reducer rejects stale and out-of-order deliveries, counts sequence
gaps, and rehydrates by folding a replay through the same function a live stream
uses. Reconnect backoff doubles to a 30s ceiling. No provider payload reaches
Unreal and nothing binds Unreal to PostgreSQL internals — the C++ side sees only
mirrored structs.

**F. State machine and animation** — eleven visual states, total over all three
Relay vocabularies, in the product's own words with no model brand mapped to any
animation. Impossible transitions are refused and counted rather than silently
dropped. `blocked` and `error` can never appear as `complete`. Animation
presentation is a separate module that names no asset.

**G. Landing → world** — built, not merely modelled. `ENTER WONDERLAND` runs
the entry state machine and posts to the real bridge route; admission and
presentation stay separate, and the honest end of the path in this build is
`ADMITTED · NOTHING CAN SHOW IT`. The empty renderer list is pinned by a test so
the first world client cannot ship without updating that sentence.

**H. Identity** — enforced at three levels: the reducer rejects foreign-project
events, the usage authority rejects foreign-project reports, and the worlds
record routes by the message's OWN project and leaves every other world
referentially identical. Mutation-verified.

**I. Genuinely connected to real Julius** — **nothing.** No provider call, no
Julius mission, no Unreal build, no GPU frame, no captured real event. This is
now enforced rather than merely stated: `verifyWonderlandCapture` cannot return
`real` for any input, and the only Julius event stream in the repository is
synthesised.

**J. Still simulated** — every event any test or demo folds. The HUD no longer
draws simulated numbers on any production path; it draws `UNKNOWN`.

**K. Tests and evidence** — 2,128 passing across the UI and wonderland slices; plus the repository boundary scanner, the
core boundary test, the Julius harness drift gate and the C++ syntax check. Nine
deliberate mutations confirmed the important suites can actually fail, and the
HUD was rendered in headless Chromium and measured rather than assumed. Full
`npm test` at the final SHA: **9,709 passing, 1 failing** — the pre-existing
floating-promise race in `executor-repair-regression.test.ts`, in a subtree this
stream does not touch.

**L. The next five gaps** — in order:

1. Wire the normalizer into a composition root so an ordinary Julius run
   produces world events (see "Exact next integration task").
2. Fix the two `relay_wonderland.events` defects (gap 3) — **Julius session.**
   Step 1 must not reach production before this.
3. Capture one real Julius event stream and grade it with
   `verifyWonderlandCapture`. The machinery is built and waiting; this is the
   cheapest step up the honesty ladder and the only one that moves anything off
   INTEGRATION-READY. It needs a live run, so it needs the Julius session.
4. Bind `UWonderlandRelayLink` on `relay/wonderland-v2` as the first renderer,
   and register it in `BUILT_IN_WONDERLAND_RENDERERS`.
5. Widen `server.ts`'s nine-phase filter to all 28 — one line, in a file the
   Julius session owns.

