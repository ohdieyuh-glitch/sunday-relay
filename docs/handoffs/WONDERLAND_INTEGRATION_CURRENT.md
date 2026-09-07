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
to the left while descending, and a straight blue MP bar runs along the bottom
with its near end passing BEHIND the ring. Here: the ring sits in the anchored
top-left corner, its gap opens RIGHT, the tail leaves travelling RIGHT while
descending, and the blue bar runs left to right with its LEFT end behind the
ring — which is also the direction given in as many words, "the single-agent bar
swoops right, behind the Compound frame". The frame's `emphasis` puts it last in
the draw order, so behind is literal rather than approximate.

Five facts are MEASURED rather than trusted, because a mirrored figure is the
easiest thing to get half-right:

- the aperture faces right — the spine's extreme point is interior and on the
  left, and both ends sit well right of it
- the swoop travels right — the tip is the right-most point in the shape
- the swoop descends — the tip sits BELOW where the tail leaves the ring
- the ring is a RING — constant radius over 305 degrees, and a circle rather
  than an ellipse
- the bar starts BEHIND the frame — its first point is inside the frame's own
  stroke, not merely near it

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

## What is REAL and what is not

| | state |
|---|---|
| Julius phase → visual state mapping | **real**, total over the live runtime's own 28-member union |
| Julius kernel state → visual state | **real**, total over `JULIUS_MISSION_STATES` |
| `JuliusOperationalEvent` → `WonderlandEvent` normalizer | **real**, pure, tested — **and nothing calls it yet** |
| the event reducer / reconnect fold | **real**, tested against constructed events |
| HUD geometry, palette, capacity model | **real** and shared with Unreal by parity |
| the numbers in the HUD | **SIMULATED FIXTURE.** No usage authority exists. The HUD says so on its own face. |
| Unreal rendering any of it | **not built.** The headers exist; no `.cpp`, no widget, no client. |
| a live Julius mission driving the world | **NO.** Not once. See "Live Run 2" below. |

**Do not describe this as "Julius is connected".** It is INTEGRATION-READY: the
contract, the reducer, the HUD and the Unreal structs all exist and are tested
against events constructed inside the test files. Every test in
`wonderland-julius-state.test.ts` says so in its own header comment.

---

## The gaps this stream found and did NOT close

Ordered by how much they block the next step.

1. **`observeRelayTransition` is battle-scoped.** `WonderlandBackend`'s
   Relay→Wonderland seam (`wonderland-backend.ts`) looks a BATTLE up by mission
   id and returns `[]` when there is none — so an ordinary Julius run, which is
   what a founder actually runs, produces no world events at all. The
   normalizer this stream added is the replacement path; **wiring it is the next
   task**. See "Exact next task".

2. **`server.ts` forwards 9 of 28 phases.** `relay-bridge/server.ts:1162`
   filters `onPhaseTransition` down to the nine members of the hand-copied
   `RelayMissionPhase`. The domain now handles all 28; widening that filter is a
   one-line change in a file the Julius session edits constantly, so it was
   deliberately left alone.

3. **A Julius payload can reach the browser malformed.** (Found, not fixed —
   it is in `src/relay/persistence/`, the Julius session's territory.)
   `PostgresWonderlandTransaction.replay()` selects from
   `relay_wonderland.events` with **no `event_type` filter**, while
   `JuliusEventPostgresRepository.append()` writes Julius events into that same
   table with `event_type = 'julius.…'` and `visibility = 'PROJECT'` — which is
   not a member of `WonderlandVisibility`. A Julius payload has no `eventId`,
   `eventType` or `sequence`, so `DistributedWonderlandRealtime`'s
   `event.sequence <= cursor` guard passes (`undefined <= n` is false) and the
   SSE wire would carry `id: undefined\nevent: undefined`.
   `JuliusTimelinePostgresRepository` filters `AND event_type LIKE 'julius.%'`
   correctly; the Wonderland replay does not. **Raise with the Julius session.**

4. **No Bridge route serves the world snapshot.** `projectWonderlandWorld` has
   no non-test caller anywhere. `wonderland/UNREAL_SESSION_CHECKLIST.md` records
   this and it is still true.

5. **No C++ client and no C++ HUD.** `HTTP`, `Json`, `UMG`, `Slate` are all in
   `Wonderland.Build.cs` and entirely unused. Nothing constructs an
   `FWonderlandWorld`; nothing calls `AWonderlandDogPawn::ApplyWorldState`;
   `FWonderlandLinkStatus` has no writer. On `relay/wonderland-v2` there IS a
   `UWonderlandRelayLink` GameInstance subsystem that pushes world state to
   registered pawns and is fail-closed without a configured Bridge URL — that
   is the right receiver to bind to, and it lives on the world session's line.

6. **`ENTER WONDERLAND` is a readiness label, not a launch.**
   `src/relay/ui/relay-experience/wonderland-handoff.ts` computes reachability
   and names `POST /wonderland/presence/join` as the entrance; nothing calls it,
   the button is disabled, and there is **no Pixel Streaming, WebRTC or
   signalling code anywhere in the repository**.

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

New, all passing:

- `wonderland-julius-state.test.ts` — 49 tests. Vocabulary, the bijection, the
  three derivations, event reading precedence, the reducer's ordering rules,
  reconnect equivalence, and the rules that must not bend (no transport
  condition produces a completion; `terminal` latches; blocked/error never
  reach complete).
- `wonderland-usage-meter.test.ts` — 46 tests. Capacity-vs-percentage, unknown
  is never zero, per-channel ceilings, drain/replenish and provenance
  degradation, arc-length uniformity, the measured right-facing reversal,
  nesting without crossing.
- `wonderland-julius-link.test.ts` — 16 tests. The whole chain from the
  kernel's event shape to the clip, the labelled fixture, dense sequence
  allocation, immutability, and the fold being identical whether the stream
  arrives whole or in pieces.
- `wonderland-hud.test.tsx` — 15 tests. Anchor, palette provenance, UNKNOWN,
  the drain agreeing with the readout, no animation loop, and the mask-id
  collision guard.

Extended: `wonderland-cpp-parity.test.ts` (union of both parity tables),
`wonderland/Tools/syntax-check.sh` (now checks every header standalone — it only
ever parsed the four `.cpp` files, so a header no translation unit includes was
never parsed by anything, which is exactly the shape of both new headers).

**Gates run green on this branch**: `typecheck` (all four projects), `build`,
`relay:build`, `relay:bridge:build`, `relay-repository-boundary.mjs`,
`relay-parity-gate.mjs`, `relay:surface-parity:check:strict`,
`relay:yc-demo:check`, `relay:cli:contract-verify`,
`relay:persistence:contract-verify`, `relay:persistence:recovery-drill`,
`relay:workspace:verify`, `relay:claude:contract-verify`,
`wonderland/Tools/syntax-check.sh`, `git diff --check`.

`npm test` is green **except one pre-existing environmental failure**:
`claude-code.test.ts > classifies an API-key environment as disallowed` expects
`sourceClass` `api_key` and gets `gateway`, because this cloud sandbox sets
Anthropic gateway variables. Confirmed unrelated — it fails identically with
`origin/main`'s connector code checked out.

`npm run wonderland:hud:preview` renders the HUD across four states —
typical, nearly spent, untouched, nothing reported — to
`generated/wonderland-hud-preview.html` for visual iteration without a GPU or a
session.

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
