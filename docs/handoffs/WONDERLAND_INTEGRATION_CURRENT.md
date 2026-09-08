# Wonderland integration — current

**This file is the recovery point for the INTEGRATION stream.** `/resume`
history disappears; the repository must be enough. Three Claude sessions run
concurrently on this product and this is the only one that owns the seam
between them, so a reader who has never seen the others must be able to
continue from here alone.

| | |
|---|---|
| SESSION | 2026-09-07 → **2026-09-08** — Relay's Wonderland **integration** stream (session 3 of 3) |
| THE ONE MISSING PORT | a project-membership check. `/wonderland/julius/*` answers 503 without it, deliberately. See §31–37. |
| CHECKOUT | `/home/user/sunday-relay` (cloud session, fresh clone; no worktrees) |
| BRANCH | `relay/wonderland-integration`, also pushed to `claude/relay-wonderland-integration-ojr5x6` (the harness's designated branch — same commits, two refs) |
| BASE | `origin/main` at `b2dc9f2` |
| SHA AT END | `075113e` — and check `git log -1 relay/wonderland-integration`, which is authoritative |
| WHAT RAN LIVE | **Nothing.** No provider call, no Julius mission, no Unreal build, no GPU frame. Every figure in the HUD is a labelled simulated fixture. |
| WHAT RUNS OFFLINE | **five harnesses that COMPILE AND EXECUTE the real C++**, reached by seven npm commands: `wonderland:cpp:syntax`, `:geometry:verify`, `:usage:verify`, `:ordering:verify`, `:julius:verify`, plus `:geometry:check` and `:ordering:check` for generated-artefact staleness. 652 checks (152 usage + 50 run + 450 ordering) and a 66-sample geometry fixture. |
| WHAT IS STILL UNPROVEN | the Slate paint in `WonderlandUsageHudWidget.cpp`. It parses; no engine here can run it, and the file says so in its own header. |

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

### 5. The HUD, frozen (`a15d251`, geometry settled later — see "The permanent HUD")

`src/relay/mission/wonderland/wonderland-hud-canon.test.ts` (15 tests)

The founder settled the geometry and then said: **do not redesign it.** The
shape they settled on is the NESTED CONCENTRIC form — see "The permanent HUD"
below for what it is and why the crossing variant was rejected. The geometry is
pinned by a digest — every control point
formatted at `toFixed(6)` and joined into one string, with the canonical value
written into the test. A 0.0004 nudge to any point fails it (verified). The
viewport, anchor, hues, emphasis order, channel order, the six shape invariants
(opens right / travels right / tail rises / is a ring / blue nests inside /
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

### 14. The HUD reads from the authority (`2a3fbd8`) — AND IS NOT A WEB SURFACE

`src/relay/ui/wonderland-hud/useWonderlandUsage.ts` (+ 10 tests)

The HUD was mounted in `RelayWorld` and handed a simulated fixture directly, on
the normal production path — `#/relay` is the Relay experience, not a preview
route. That broke this repository's own rule, which the OTHER usage bar already
obeys and tests (`usage-integration.test.tsx`).

The deeper problem: a fixture passed straight to the view meant the authority's
REFUSALS never ran. A surface able to put figures on screen without passing
through `applyWonderlandUsageReport` is a second, unguarded way in. Everything
now goes through one door.

**SUPERSEDED IN PLACEMENT, NOT IN CONTRACT.** The founder has since ruled that
both meters belong to WONDERLAND, the Unreal world — they report what a Compound
Agent is spending *while it works*, and the landing is an arrival while the
Relay stage is where an agent is NAMED before it has done anything. A meter on
either is furniture reporting on work that has not started.

The HUD is therefore mounted on no web surface. It is gone from the shipped
bundle entirely — component, stylesheet and all. What survives is everything the
Unreal side is built from: the frozen geometry and its digest, the usage
authority and its four readings, the accounting boundary, and the C++ mirror.
The React component remains as the REFERENCE rendering that pins the geometry
and drives the preview harness. `wonderland-hud-placement.test.tsx` fails if any
production surface mounts it again.

The authority wiring below still stands and is the contract Unreal consumes:
figures reach the HUD only through `applyWonderlandUsageReport`, so its refusals
cannot be bypassed.

---

### 15–23. The integration spine (session of 2026-09-07, second half)

Nine layers, built after a READ-ONLY audit of the Julius kernel. See
`docs/handoffs/WONDERLAND_UNREAL_HANDOFF.md` for the receiving side's copy.

| module | what it is |
|---|---|
| `wonderland-envelope.ts` | the only shape that crosses into a world |
| `wonderland-ordering.ts` | which fact is newer, on two axes |
| `wonderland-rehydration.ts` | joining a mission already under way |
| `wonderland-ledger-adapter.ts` | reading the ledger as it is really written |
| `wonderland-visual-transitions.ts` | legality derived from the kernel's guard |
| `wonderland-usage-accounting.ts` | which meter a unit of work belongs to |
| `wonderland-diagnostics.ts` | what an operator may safely be shown |
| `wonderland-session.ts` | the fold that composes all of it |
| `WonderlandEnvelope.h/.cpp` | the Unreal mirror, held by parity |

**Three findings from the audit changed the design, and two were defects in
this stream's own earlier work.**

1. **`sequence` is per RUN, not per project.** `stream_id` is the run id on
   every Julius write path, so two runs in one project both count 1, 2, 3.
   `JuliusEmbodiment` documented its cursor as "highest applied PROJECT
   sequence", which is not imprecise but WRONG: run B's third event would be
   refused as stale because run A had already reached three. `WonderlandCursor`
   is per run.

2. **`run.created` / `run.transitioned` are persisted in a different payload
   shape with NO `facts` key.** `juliusTransitionState` reads `facts.to`, so
   against the real database the reading degraded from `julius_run_state`
   precision to `event_type` precision — for exactly the two event types that
   carry the run's state machine. The dev fixture carries `facts.to` and
   therefore passed. Green in the suite, degraded in production: the worst shape
   a defect can have. `wonderland-ledger-adapter.ts` handles both shapes and its
   tests are built from the real writers' payloads, not the fixture.

3. **`JuliusRuntimeApi.inspectRun` + `timeline(sinceSequence)`** is already the
   snapshot-plus-tail pair rehydration needs, and `julius-state-path.ts` exposes
   the kernel's own legality guard for probing. Both are now used rather than
   reimplemented.

**Two things the composition taught me by failing tests I wrote from
assumption:** a mission does not go `prompt_architect → coding` (planning hands
off first: PLANNING → READY → EXECUTING), and `settle` cannot fire on a
kernel-path completion, because `complete`'s only kernel predecessor is
VERIFYING and both draw `stand_still`.

---

### 24–30. The Unreal runtime layer (session of 2026-09-08)

The founder directive moved the usage HUD out of the landing page and into the
Unreal world, and expanded that into a full integration mandate. Seven commits.
**This is the session where the world stopped being headers.**

| what | where | verified by |
|---|---|---|
| the arc-length sampler, ported | `WonderlandUsageGeometry.h/.cpp` | 66-sample fixture, worst deviation 1e-6 |
| the shapes, palette and crop | `WonderlandUsageGeometry.canonical.cpp` | **GENERATED**; `wonderland:geometry:check` fails when stale |
| the draw plan, shared | `wonderlandMeterDrawPlan` + `FWonderlandMeterDrawPlan` | 13 TS cases and the same cases again in C++ |
| usage runtime state | `WonderlandUsageSubsystem.h/.cpp` | 152 checks |
| the HUD widget | `WonderlandUsageHudWidget.h/.cpp` | draw plan + bands + composition. **Slate calls unverified** |
| the ordering rule, ported | `WonderlandOrdering.h/.cpp` | 26 generated cases, 450 checks |
| run runtime state | `WonderlandJuliusSubsystem.h/.cpp` | 50 checks, full reconnect walk |
| the activity axis | `wonderland-julius-activity.ts` + C++ mirror | 28 tests |
| the Project Brain scope | `wonderland-brain-scope.ts` + C++ mirror | canary test, O(kinds) bound |

**The arithmetic between a reading and a drawing now exists once.** Until this
session the browser component converted `capacitySpan` and `remainingFraction`
into arcs itself and an Unreal widget would have done the same — one reading,
two rounding rules, two visibility thresholds, and nobody able to say which was
canon. `wonderlandMeterDrawPlan` owns it, the TSX consumes it (the frozen
geometry digest is unchanged, which is the proof it moved no pixels), and the
C++ mirrors it field for field.

**A bigger tier is now a physically longer track**, which is the founder's §2
requirement expressed as geometry rather than shading: the tier ceiling moves
the track's own arc length, so two untouched tiers differ in length rather than
in fill. Asserted on both sides.

**The ordering rule is the one thing written twice, and it is held numerically.**
Only the receiver can decide which of several envelopes arriving over a network
to apply — Relay is not in the process. So `WonderlandOrdering.cases.cpp` is
GENERATED by running the real `applyWonderlandOrdering` over a matrix, and the
C++ is replayed through every case comparing the verdict AND the whole folded
cursor. Regenerate with `npm run wonderland:ordering:export`; **read the diff**,
because it is a change to how a world decides what it has seen.

#### Four defects found, and where they were

Three were in the VERIFICATION rather than the product, which is worth noting:
the harnesses were the thing under test as often as the code.

1. **`FMath::Max` in the syntax stubs returned a dangling reference.**
   `decltype(a>b?a:b)` for two lvalues is `int&`, so the function returned a
   reference to its own parameter. Every check passed at `-O0` and the same
   build aborted at `-O1` with a `Reserve()` of -1073741824. Both harnesses now
   build and run at `-O0` and `-O2` and require the two to agree; ASan names it
   precisely, but only in the `-O2` build, so the levels and the sanitizers need
   each other.

2. **Both harness scripts swallowed their own failure output.** Under `set -e` a
   failing run exited before anything printed, so four deliberate mutations came
   back as a bare exit code with the diagnosis stuck in a temp directory the
   EXIT trap then deleted. A check that cannot say what failed is worse than no
   check, because it looks like one.

3. **The ordering fixture did not distinguish the file's most important rule.**
   Reordering the C++ to check sequence before revision passed everything: an
   envelope behind on only one axis falls through to the other either way, so
   only one behind on BOTH separates the orderings. That case now exists.

4. **`FWonderlandMeterBands` was a `USTRUCT` with no reflected members**, which
   the parity test correctly rejected. Transient render buffers want no
   serialisation, no Blueprint exposure and no place in a parity table — plain
   struct now, as `UWonderlandRelayLink` already does for its pawn array.

#### The directive sections this closed

| § | what was done |
|---|---|
| 1 | HUD is an Unreal surface; `wonderland-hud-placement.test.tsx` fails if a production web surface mounts it |
| 2 | both meters curved, layered by the palette's `Emphasis` rather than a Z-order; tier ceiling moves physical length |
| 3 | three-layer split — backend decides, subsystem holds, widget draws. The widget owns nothing |
| 4 | seven activity signals on a second axis, **and five gaps recorded rather than fabricated** |
| 5 | `WonderlandBrainCitation` — counts, revisions and flags; no project text crosses |
| 6 | signals are per worker, tested with three concurrent clones |
| 9 | `wonderland-card-vocabulary.test.ts`; four prose migrations, ceiling 76 → 73 |
| 10, 15 | authority table and layer chain in the Unreal handoff, §8b |
| 11 | canonical repository names reused throughout — see the reconciliation below |
| 12 | disconnect, reconnect, snapshot, replayed tail, foreign fan-out, malformed push — all executable |
| 13 | no Tick, no polling, no per-frame backend call, bounded payloads |
| 14 | all fourteen validations covered |

#### §11 — the directive's example event names, reconciled

The directive lists `agent.state.changed`, `agent.usage.changed`,
`compound.capacity.changed`, `mission.*`, `worker.*`, `review.*`, `repair.*`,
`approval.required`, `project_brain.updated`, `mas.*` and says plainly they are
**examples, not requirements** — reuse canonical repository conventions where
they exist. They do. `JULIUS_OPERATIONAL_EVENT_TYPES` is a 34-member catalogue
audited in both directions by `julius-event-coverage.test.ts`: a type declared
and never emitted fails, and so does one emitted and never declared.

So none of the example names were introduced, and the mapping is:

| directive example | what the repository already calls it |
|---|---|
| `agent.state.changed` | `run.transitioned`, plus `EWonderlandJuliusState` as the world's reading of it |
| `agent.usage.changed` | not an event — usage is a REPORT with a revision, not a stream. See `wonderland-usage-authority.ts` |
| `compound.capacity.changed` | the same report; capacity and spend travel together or neither means anything |
| `mission.*` | `run.*` — the kernel's noun is a run |
| `worker.*` | `worker.selected`, `worker.dispatched`, `worker.completed` — already exact |
| `review.*` | `review.started`, `finding.recorded`, `verification.decided` |
| `repair.*` | `repair.scheduled` |
| `approval.required` | `approval.requested`, cleared by `approval.decided` |
| `project_brain.updated` | no such event. Context COMPILATION is reported (`context.compiled`); brain mutation is not, and the citation carries `brainRevision` so a stale context is visible without one |
| `mas.*` | `subagent.spawned` / `subagent.denied` / `subagent.completed` |

**Adding an alias for any of these would be the drift the coverage audit
exists to prevent.** If a name genuinely needs to change, change it in the
kernel catalogue and let both audits fail.

#### §8 — Wonder Web does not exist

Searched: no file, symbol, route or document in this repository mentions Wonder
Web, wonder-web or any variant. **Nothing was built for it and nothing should be
claimed about it.**

What matters for this stream is that nothing built here forecloses it. The
directive describes an in-Wonderland browser/workspace layer that Unreal can
invoke and Julius can hand artifacts into, and the shapes added this session are
compatible with that by being narrow rather than by anticipating it: the
envelope carries no rendering instruction, the subsystems hold state rather than
own transport, and the brain citation deliberately carries no content that a
workspace would later need to fetch properly.

The one thing a future session must NOT do is the thing §8 warns about
explicitly: turn it into the marketing website. The landing page is layer A and
Wonder Web would be layer D-adjacent; they are different products that happen
both to render in a browser engine.

---

### 31–37. The runtime path (session of 2026-09-08, second half)

**This is the session the chain was joined.** Everything before it was built
from both ends: a ledger adapter that read rows, an envelope that worlds
consume, ordering, rehydration, two Unreal subsystems — and
`wonderlandEnvelope()` with NO PRODUCTION CALLER. Seven commits.

| module | what it is |
|---|---|
| `wonderland-envelope-producer.ts` | a real kernel event becomes an envelope. THE JOIN |
| `wonderland-hydration.ts` | the snapshot half: usage, brain, C.A.R.D., activity, in one payload |
| `wonderland-ingress.ts` | the transport boundary: scope → decode → validate → order → fold |
| `wonderland-activity-animation.ts` | the seven signals as ordered animation intents |
| `wonderland-world-session.ts` | the door bound to the stream, project and run together |
| `relay-bridge/wonderland-julius-routes.ts` | hydrate + SSE over the transport that existed |

#### The transport question, answered by audit rather than by building

`/wonderland/events` already serves SSE with replay-from-cursor, live subscribe
and a heartbeat. `PostgresWonderlandFanout` already pushes identifiers over
LISTEN/NOTIFY, so nothing polls. Browser sessions already authenticate,
origin-bound and revocable. All deployed. **What it serves is BATTLE events** —
that was the whole gap, and the fix was a Julius path onto the same transport
rather than a second one. A Pixel Streaming data channel carries pixels and
input; mission state has a durable ordered source already.

#### The defect, found by wiring it up

**Only a state TRANSITION bumps `julius_runs.version`.** `review.started`,
`finding.recorded` and both subagent writers do not — checked in the
persistence layer, none of them touch it. So a snapshot at revision 10 and a
burst of genuinely new review activity, also at revision 10, collided: the
revision tie-break refused every one and **the world went deaf until the run
changed state.** Reproduced end to end through the real production path before
anything was changed.

`WonderlandRunSnapshot.atSequence` closes it, and the field did not exist for a
good reason that turned out to be answerable: inventing a sequence skips events
if guessed high and claims applied events if guessed low. The answer is that
the READER supplies it — `MAX(sequence)` alongside the run row — rather than the
adopter inventing it.

#### What the routes refuse to do

The browser session names a PLAYER and an ORIGIN and **not a project**, so
nothing in the Bridge can answer "may this player read this project's runs?".
`/wonderland/julius/*` therefore answers **503** until a membership port is
wired. The default everyone reaches for — any authenticated player may read any
project — is a cross-tenant read of mission state, C.A.R.D. slots and spend, and
a route that opened when its authorisation was unconfigured would work
perfectly wherever nobody had wired it.

> **Superseded.** That port was built in the session below (38–40). What is
> still missing on this path is `WonderlandJuliusReader`, and the route still
> answers 503 — for a different reason.


#### Two narrowings worth knowing about

`CardVersion` carries `models` — provider and model names — plus tools,
permissions and budgets. **None of it crosses.** Role slots are reported as
FILLED OR NOT, never by whom, because the visual vocabulary is provider-free by
construction and leaking the names through the C.A.R.D. would undo that from
the side door, on the surface a player can inspect. Budgets are absent because
the usage authority already owns capacity.

Activity accents are INTENTS, not clips. `awaiting_input` says a person is
being waited on; whether that is a raised head, a pip or a colour is the
renderer's business. A test forbids the words clip, colour, sprite, mesh,
texture and montage in the vocabulary, because naming one would be inventing
animation assets without the engine.

#### Process notes, including one failure

Six modules, all mutation-verified — 38 deliberate breakages, every one caught
after the gaps they exposed were closed. Several escaped on a first pass and
every one of those was a gap in the TEST rather than the code: a blank-vs-blank
comparison invisible unless both sides are blank, a redundant clause shadowed by
one checked earlier, and a scope-before-fold ordering invisible unless the
foreign rows would actually raise a signal.

**One commit went out with a failing typecheck.** The world-session tests passed
at runtime and did not compile — extra properties are ignored by JavaScript and
rejected by tsc — because I read a batch of gate results and pushed on the test
count without reading the `tsc` line in the same output. Fixed in the commit
after, with the isolating mutation re-verified against the corrected fixtures.

### 38–40. The authorisation seam, the chain proof, the cursor matrix (session of 2026-09-08, third part)

Three commits: `501f5c5`, `5a49b81`, `b9f6324`.

#### The membership authority already existed, and was reused

The instruction was to find the canonical authority rather than invent one, and
there was one: **`relay_wonderland.project_members`**, since migration 001, and
already read in production by `julius-tool-postgres.ts` to decide whether a
tool invocation's tenant is a member. Nothing new was modelled.

Two facts about that table shaped the capability design. It has **no CHECK
constraint on `role`**, and **only `OWNER` is ever written**. So the capability
table names OWNER and nothing else, and every absent role — a `VIEWER` the
product starts writing next month included — grants nothing until somebody
teaches this build about it. Denying an unknown role is the only safe reading
of a column that can hold anything.

| layer | file | what it owns |
|---|---|---|
| domain | `wonderland-authorization.ts` | roles → capabilities. Holds NO records; reaches nothing |
| port | `WonderlandProjectMembershipSource` | `lookup({playerId, projectId})` |
| adapter | `wonderland-membership-postgres.ts` | the query. **Throws** rather than returning null when it cannot answer |
| route | `wonderland-julius-routes.ts` | asks per request; 503 without the port |

**`null` and a throw mean different things and the route treats them
differently.** Null is "there is no such row" — a denial, 403. A throw is "the
authority could not be reached" — 503, because calling that a denial sends an
operator hunting permissions that were never the issue, and calling it a grant
is the worst outcome available.

#### The attack the route is shaped around

Name somebody else's run id, be authorised for a project you genuinely DO
belong to, and read a run you do not. It works against any design that resolves
a project FROM a run id, because the attacker then chooses the project they are
authorised against.

**Nothing here resolves a project from a run.** The project comes from the
query and is authorised on its own; the run is then checked against THAT
project. A run in another project and a run that does not exist get the same
answer — 404, `{"error":"permission denied"}` — so the route is not a
membership oracle either.

#### The chain, driven by the real kernel

`wonderland-chain.e2e.test.ts` runs the actual `JuliusRunLoop` through
`createJuliusHarness`, takes the **23 real events** it emitted, shapes them the
way `julius-postgres.ts` actually persists them, and pushes them through
producer → ingress → hydration → reconnect → animation intent. No hand-written
event anywhere in it.

Two of its assertions were wrong on the first pass and both are worth
recording. `retrieving_context` nets to EMPTY across the run, because
`context.compiled` raises it and `worker.dispatched` clears it — the assertion
was rewritten to watch the raise and the clear at the real events. And a
secret-leak test **passed with the sanitiser removed**, because this kernel's
event facts never carried brain text in the first place: it proved the fixture,
not the boundary. Replaced with structural assertions (primitives only, ≤16
entries, ≤120 chars) and confirmed by raising the sanitiser's cap and watching
it fail.

#### The cursor matrix, and two tests that looked stronger than they were

Ordering has two clocks with three positions each, so the space is nine cells
and every earlier test covered a corner. **Three cells had no coverage
anywhere.** The interesting one is a revision AHEAD of a sequence already
passed — a pair that cannot occur in a healthy ledger, since both clocks are
per-run and monotonic. It is refused on sequence, and what matters is that the
refusal carries nothing: had it moved the held revision past the run's real
one, one bad frame would leave a client silently deaf for the rest of the
mission.

The invariants are now swept over the whole space rather than sampled:

- **A refusal restores byte-identically** once its one counter is put back —
  a whole-object comparison, so a refusal that helpfully updates a timestamp,
  or a cursor field added next year, is caught with nobody editing the test.
- **Every refusal counts under its OWN name.** The first version summed the
  counters, and a `foreign_julius` filed as `foreign_project` still added up.

Both of those escaped as mutations until the tests were made structural, which
is the same lesson as every other escape in this stream: the gap was in the
TEST.

**Project switches re-authorise.** Same session, same origin, same player —
none of it carries a permission across a project boundary. The route asks its
membership port about the project in each query, in order; on the client side a
grant re-pointed without a fresh cursor draws nothing rather than folding two
projects together.

#### A gate I did not run, and what it caught

`scripts/ci-test-accounting.test.ts` flagged the chain proof from `5a49b81`:
`drain()` exited its tick loop with a bare `if (report.claimed === 0) return;`,
and the rule refuses that in a test file because it ends a test with whatever
assertions happened to run first. It was right for a reason beyond the pattern
— the loop ALSO gave up silently at its tick ceiling, so a kernel that never
quiesced would have handed every assertion below a partial event stream, and
most of them would still have passed. Restructured so the loop condition is the
exit and the ceiling throws.

**I found it two commits late because I ran the wonderland and bridge suites
and not `scripts/`.** That is the same failure as the typecheck miss recorded
above: reading part of a gate and pushing on the part that was green. The gate
set in `CLAUDE.md` is a list, and a list read partially is not a gate.

#### One line deliberately left uncovered

`applyWonderlandOrdering` takes `Math.max(cursor.revision, envelope.revision)`
on an accepted envelope. It is unreachable: the verdict already refuses
anything below the held revision, so the max is always the envelope's. A
mutation of it escapes the entire 900-test Wonderland slice, and **no test can
distinguish it** — so it is left as documented defence rather than covered by a
test that only appears to cover it. Recorded here so nobody spends an afternoon
rediscovering that.

---

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
| the envelope, ordering, rehydration and the composed session fold | **real**, tested; ordering verified by mutation on both axes |
| visual-transition legality | **real**, DERIVED from the kernel's own guard rather than declared |
| the ledger adapter | **real**, and tested against the persistence layer's actual payload shapes |
| the usage accounting boundary | **real** contract; no authority attributes spend into it yet |
| per-project isolation across many worlds | **real**, proven by referential identity, mutation-verified |
| the entry contract (admission vs presentation) | **real**, and its honest answer today is `ADMITTED · NOTHING CAN SHOW IT` |
| HUD geometry, palette, capacity model | **real** and shared with Unreal by bidirectional parity |
| the usage authority (KNOWN / NOT-REPORTED / STALE / UNAVAILABLE) | **real** contract; **no authority reports into it** |
| the numbers in the HUD | **NOTHING REPORTS THEM**, and the HUD is not a web surface at all — it belongs to the Unreal world. Component, stylesheet and fixture are all absent from the shipped bundle. |
| the entry path (`ENTER WONDERLAND`) | **real** as far as `admitted`; the button runs the state machine and posts to the real bridge route |
| the honesty ladder itself | **real and executable** — `verifyWonderlandCapture` grades a capture, and `real` is unreachable from it by construction |
| the Unreal usage geometry | **real**, and proven numerically against the TypeScript sampler — 66 samples, worst deviation 1e-6 |
| the Unreal usage and run subsystems | **real**, 213 executable checks over refusals, held state, snapshot adoption in both modes, and reconnect (152 + 61) |
| a real Julius event becoming an envelope | **real** and tested — and nothing has ever fed it a row from a live database |
| the transport boundary (scope, decode, validate, order, fold) | **real**, tested against reconnects, mis-routed fan-outs and replayed tails |
| the Julius world routes | **real**, authorised per request against `project_members` — and answering 503 until a `WonderlandJuliusReader` exists |
| the Unreal ordering rule | **real**, replayed through 26 cases generated from the TypeScript, 450 checks |
| the Project Brain scope | **real** contract, canary-tested; no authority cites into it yet |
| Unreal DRAWING any of it | **not proven.** `WonderlandUsageHudWidget.cpp` parses and has never been compiled against real UMG headers or seen to put a pixel on a screen. |
| a live Julius mission driving the world | **NO. Not once.** |

**Do not describe this as "Julius is connected".** The honest word is
INTEGRATION-READY. Using the brief's own five-way scale:

| level | what is at it |
|---|---|
| REAL (live Julius drove it) | nothing. Unreachable from any replay, by construction |
| RECORDED-EVENT VERIFIED (a captured real event replayed through it) | nothing — no capture has ever been taken. The machinery to grade one now exists |
| INTEGRATION-READY (contract + reducer + parity, exercised by constructed events) | the state machine, the normalizer, the bridge session, the usage authority, the entry contract, the worlds record, the animation plan |
| SIMULATED (labelled fixture) | the dev event script, and nothing a production surface loads |
| BUILT AND VERIFIED WITHOUT AN ENGINE | the usage geometry, both subsystems, the ordering rule, the draw plan, the bands, the composition — 652 executable checks, plus a 66-sample geometry fixture and a 26-case ordering table, both generated from the TypeScript |
| BUILT AND UNVERIFIED | the Slate paint. It parses; nothing here can run it |
| NOT BUILT | the world snapshot route, the dog renderer, the swarm, Wonder Web, every widget other than the usage HUD |

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

   **Both are now DEFENDED on the consuming side, and neither is fixed.**
   `wonderland-ledger-adapter.ts` refuses non-Julius rows by default (defending
   against (a) reaching a consumer at all) and reads both persisted payload
   shapes, and `WonderlandCursor` is scoped per run (defending against (b)).
   The SQL and the sequence allocation are still wrong and are still the Julius
   session's to fix. **Raise both with them.**

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

## The permanent HUD — SETTLED, DO NOT REDESIGN

**The founder has declared the current shape the health bar "until I say
otherwise."** It is the nested concentric form: a green Compound frame whose
ring sits in the top-left with its gap opening RIGHT and a tail that leaves the
ring tangentially and RISES away to the right; and a blue single-agent stroke
that is a CONCENTRIC inner hook at about two thirds of the radius, sharing the
frame's centre and gesture, with its own tangential tail stopping short of the
frame's tip.

Do not redesign it, do not "improve" the curve, and do not re-derive it from any
reference image. `wonderland-hud-canon.test.ts` pins every control point by
digest and fails on a nudge of 0.0004 (verified).

### Why nested rather than crossing — this was tried both ways

An intermediate design ran the blue UNDER the green so the frame occluded it at
two crossings. It looked better in a still and it broke the instrument. Measured
off the real geometry:

| single-agent remaining | visible fill, crossing design |
|---|---|
| 3% | **0.0%** of the stroke |
| 20% | **0.0%** |
| 35% | 1.7% |
| 100% | 66.7% |

The frame covered the first **33.3%** of the blue spine, so every reading at or
below about a third drew identically to empty — exactly the range where "you are
nearly out" has to be legible.

**The permanent nested design has zero overlap.** Measured edge-to-edge, the two
strokes never come within 0.048 of touching, and no part of the blue spine is
ever covered. The canon test asserts both, so anyone who widens a stroke, moves
the inner radius, or tidies the two curves toward each other will fail it.

### What the geometry actually is, measured

- Compound ring: centre ≈ (0.3225, 0.500), radius ≈ 0.267, 255 degrees
- Single ring: same centre, radius ≈ 0.180 — about two thirds
- Both strokes, half-widths included, occupy x 0.035..0.959 and y 0.101..0.805
- `WONDERLAND_USAGE_VIEWPORT` is `{ x: 0, y: 0.06, width: 1, height: 0.88 }`,
  framed from that measured extent rather than chosen by eye

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
| a control point of the permanent geometry nudged by 0.0004 | 1 (the digest) |

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

**Implement `WonderlandJuliusReader` and construct it, with
`WonderlandMembershipPostgres`, in `server.ts`.** That is the whole remaining
cloud-side gap: the route is written, authorised and tested; every test supplies
a fake reader; nothing builds a real one, and `server.ts` passes neither
dependency — so the deployed route answers 503, correctly.

Two methods, and the hard part is in the first:

```
hydrate({ projectId, runId, worldSessionId }) -> WonderlandHydration | null
events({ projectId, runId, afterSequence, limit }) -> { rows, revision }
```

1. **`events` is nearly written already.** `julius-timeline-postgres.ts` reads
   `relay_wonderland.events` by `stream_id + project_id + sequence >` with an
   `event_type LIKE 'julius.%'` filter; this needs the same query returning the
   RAW row shape `WonderlandLedgerRow` rather than a projected timeline entry,
   plus `julius_runs.version` read in the same statement.

2. **`hydrate` must read the run row and `MAX(sequence)` IN ONE PASS.** A
   revision from one moment and a sequence from another describe a run that
   never existed. This is not a style preference — it is the field that closed
   the post-snapshot deafness defect, and a torn read reintroduces it.

3. **Do not guess `atSequence`.** Null is a supported answer and the
   conservative tie-break handles it. Guessing high skips events; guessing low
   claims to have applied events nobody saw. Both are demonstrated as executable
   tests in `wonderland-cursor-hardening.test.ts` — read them before deciding
   this is over-cautious.

4. **The honest answers for the parts with no authority.** Usage has no
   authority reporting into it and the Project Brain has nothing citing into it,
   so `emptyWonderlandUsageAuthority` and `noWonderlandBrainCitation` are the
   TRUE readings today, not placeholders — they render UNKNOWN, which is what
   is actually known.

5. **`WonderlandCardScope` is the one place this gets awkward.**
   `hasPromptArchitect` and friends are booleans, not nullables, so a reader
   that cannot resolve `julius_runs.card_revision` against
   `relay_wonderland.card_versions` has no way to say "I could not look" — it
   would report the slots EMPTY, which is a claim. Either resolve the card
   properly or widen the contract to nullable. **Do not report false.**

6. **The activity fold is server-side, and must be over the whole run.** Signals
   are set/clear, not monotonic — `context.compiled` raises `retrieving_context`
   and `worker.dispatched` clears it — so a partial fold can report a signal
   that was cleared an hour ago. Folding the run's events on the server is
   exactly how the client is spared the transcript; it is not a contradiction of
   the reconnect rule, which is about what crosses the wire.

Then, and only then, drive a real mission through it and record the evidence
here. **Do not claim Julius is connected before a real mission moves the
world.**

### The older next-task, still true and now second

Wiring the normalizer into a composition root so an ordinary Julius run
produces world events on `GET /wonderland/events` remains open —
`observeRelayTransition` is battle-scoped and returns `[]` for an ordinary run.
The reader above is the narrower path to a moving world, because it reads the
ledger directly rather than depending on that route.

---

## Final report (the brief's A–L)

**A. Starting SHA** — `b2dc9f2` (`origin/main`, unchanged throughout; this
stream never merged into or from `relay/wonderland-v2`).

**B. Ending SHA** — `e8a09ec` on `relay/wonderland-integration`, pushed to both
that ref and `claude/relay-wonderland-integration-ojr5x6` (same commits).

**C. Integration layers completed** — twenty-three, listed under "What was built":
the state seam, the HUD, the link, the Unreal receiver, the HUD freeze, the
usage authority, the bridge session, the ending guards, the animation plan, the
entry contract, the wall between worlds, the executable honesty ladder, the
entry button, and the HUD's authority wiring.

**D. HUD data progress** — the geometry is frozen and pinned by digest. Beneath
it there is a provider-neutral usage contract with four readings, per-channel
tier ladders that change PHYSICAL capacity, three rejection counters, and an
authority id carried for traceability and never interpreted. **The HUD is an
UNREAL surface and is mounted on no web page** — the founder ruled that both
meters live in the world, where the spending happens. The React component is the
reference rendering that pins the geometry and drives the preview harness, and a
test fails if a production surface mounts it. **No authority reports into it
yet.** The visual layer knows nothing about billing or providers, and a test
sweeps its output for provider names and key shapes.

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
`npm test` at the final SHA: **9,877 passing, 1 failing across 514 files**.

The failure is environmental and not this stream's:
`claude-code.test.ts > classifies an API-key environment as disallowed` sets
`ANTHROPIC_API_KEY` and expects `sourceClass === 'api_key'`, but this cloud
sandbox has Anthropic **gateway** variables set, so the classifier correctly
answers `gateway`. `git diff <base>..HEAD -- src/relay/connectors` is empty.

An earlier full run in the same session failed one DIFFERENT test — a
floating-promise race in `executor-repair-regression.test.ts`, which passes
14/14 alone and only fails under parallel load. Both are pre-existing, both are
in subtrees this stream does not touch, and the pair of them is worth knowing
about: this suite has at least two failures that depend on the machine and the
scheduler rather than on the code.

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

