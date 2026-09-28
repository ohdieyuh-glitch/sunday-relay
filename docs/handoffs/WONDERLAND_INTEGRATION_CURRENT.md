# Wonderland integration — current

**This file is the recovery point for the INTEGRATION stream.** `/resume`
history disappears; the repository must be enough. Three Claude sessions run
concurrently on this product and this is the only one that owns the seam
between them, so a reader who has never seen the others must be able to
continue from here alone.

| | |
|---|---|
| SESSION | 2026-09-07 → 2026-09-08 → **2026-09-10** — Relay's Wonderland **integration** stream |
| THE MISSING PORT | **CLOSED.** Membership is wired and the route authorises per request. See §31–37, and §45–49 for what came after. |
| CHECKOUT | `/home/user/sunday-relay` (cloud session, fresh clone; no worktrees) |
| BRANCH | `claude/julius-wonderland-integration-khaqs3`, continuing `relay/wonderland-integration` from `03fe982` |
| BASE | `origin/main` at `b2dc9f2`, **merged up to `5909ae0` on 2026-09-10** — the branch is 0 behind trusted main |
| SHA AT END | check `git log -1 claude/julius-wonderland-integration-khaqs3`, which is authoritative |
| WHAT RAN LIVE | **Nothing.** No provider call, no Julius mission, no Unreal build, no GPU frame. Every figure in the HUD is a labelled simulated fixture. **A real PostgreSQL 16.13 now runs in this environment** — that is a database, not a provider. |
| WHAT RUNS OFFLINE | **five harnesses that COMPILE AND EXECUTE the real C++**, reached by nine npm commands: `wonderland:cpp:syntax`, `:geometry:verify`, `:usage:verify`, `:ordering:verify`, `:julius:verify`, `:wire:verify`, plus `:geometry:check`, `:ordering:check` and `:wire:fixtures:check` for generated-artefact staleness. **1,019 checks** (152 usage + 90 run + 450 ordering + 327 wire) and a 66-sample geometry fixture. |
| WHAT IS STILL UNPROVEN | the Slate paint in `WonderlandUsageHudWidget.cpp`. It parses; no engine here can run it, and the file says so in its own header. |

---

## 2026-09-27 — the founder's five Wonderland ↔ Julius decisions, as built

The header table above is the 2026-09-10 cloud session. This section is the
laptop session that followed it: branch `relay/wonderland-julius-integration`
in worktree `C:\dev\iwonder\wonderland-julius-integration`, local only.

| decision | state |
|---|---|
| 1. Packaged Development build; the bridge address is configuration, never hard-coded localhost | **the configurable bridge is built and compiled (game target), not yet proven in-engine** (c638c830). `UWonderlandJuliusLinkSettings.BridgeUrl` (Config=Game) with `wl.Julius.Bridge.Url` overriding it; https to any host, plain http only to 127.0.0.1 / localhost / [::1], anything else refused with the reason (`GetBridgeUrl` / `GetBridgeProblem`); Pair / Follow / Stop / CreateMission are UFUNCTIONs, so no console is needed. Acceptance clause A01b. **The packaged build itself is not built.** |
| 2. Pairing code 5 min, single use, bound to player + project; native session 8 h, renewable by re-pairing, revocable, project-scoped | **built and proven over the wire.** `browser-session/grants.ts` (`NATIVE_PAIRING_TTL_MS`, `NATIVE_SESSION_TTL_MS`, `projectId` on grant and session), `wonderland-native-pairing-routes.ts` (`/pair` needs a `projectId` the player is a MEMBER of: 400 `project_required`, 403 `not_a_project_member`, 503 with no membership source), `wonderland-julius-routes.ts` (a native session is refused for any other project, before membership). Drill clauses N03, N03b, N04, N11, N12; unit suite `wonderland-native-pairing-routes.test.ts`; `mission-ownership.test.ts` proof 33b shows the one credential carrying a project reaches no mission route. Browser lifetimes are unchanged (2 min grant, 30 min session). |
| 3. Friendly state AND Julius's raw state; BLOCKED ≠ Paused, WAITING ≠ Running, CANCELLED ≠ Failed; no UNOBSERVED headline over a followed run | **proven in-engine** (c54e1205, Core build 3d4081ee, acceptance attempt `016644cf8dedceda`): A06f — the strip's headline reads QUEUED under "JULIUS LIVE · RUN … · READY", and the photographs agree (archived in `C:\dev\iwonder\_qa_handoff\acceptance-captures\attempt-016644cf8dedceda`). The Live Terminal (be295423) is **proven in-engine too** (Core build 1bc2131f, acceptance attempt `b4e24b8d29fc3433`, 26/26): A06g — JULIUS 3.3 [QUEUED] "Following …", no STANDBY, the banner names the run; photographs archived in `…\acceptance-captures\attempt-b4e24b8d29fc3433`. |
| 4. Only OWNER / authorised ADMIN causes paid execution; an operator-controlled Project Execution Profile holds every execution-sensitive value | **built and proven over the wire** (a212315f + cd142264). Migration 027: append-only `project_execution_profiles` (operator-only PUT/GET `/relay-api/julius/projects/:id/execution-profile`) and `player_mission_contracts` (who created which mission, as what contract). Player route `POST /relay-api/wonderland/julius/missions`: OWNER only (`create_mission`), four fields only, the rest from the enabled profile, mission id from sha256(project, player, idempotency key), created through Julius's own `createJuliusMissionFromTrustedContract`. The run lands READY and is NEVER dispatched; paid execution stays the operator's `julius-live-mission run --confirm-live` with the contract exported by `GET /relay-api/julius/missions/:id/contract`. Drill P01–P04, C01–C07. A criterion carries only `id`, `text`, `blocking`: any other key inside one (Julius's `requiredEvidence`, which decides what verifies the build) is refused `forbidden_field` by name, never silently dropped. |
| 5. The world shows a USER RESULT — never reasoning, secrets, credentials or needless host paths; cost to OWNER/ADMIN only; UNKNOWN tokens stay UNKNOWN | **route built and proven over the wire** (3e837764): `GET /wonderland/julius/result` projects Julius's `inspectResult`; drill R01–R04. **In-world display proven** (acceptance `b4e24b8d29fc3433`, A06h): the terminal's row reads "Result: not final · 0 of 2 criteria met … tokens UNKNOWN · cost $0.0000". |

### Priority 9 — creation from inside Unreal: ready, waiting on a build

- **Client** (c638c830, game target compiled 392 s): `CreateMission(IdempotencyKey, Objective, Requirements, Constraints, CriterionIds, CriterionTexts, CriterionBlocking)` sends the player's fields only, into the project `Pair` established. On 201 it follows the server's `runId`, never one of its own. A refusal is named on the terminal ("Create: Not created · <kind>") and creates nothing locally.
- **Acceptance #5** (a798bfdd):
  - job clauses A01b, A06k/l/i/j/m/n, with photographs 03a–03d;
  - orchestrator checks J05 (same run, READY, three roles NEVER_DISPATCHED, $0), J06 (provenance from the operator's contract export) and J07 (one run, one record after a retry and four refusals).
- **Proven offline, not the acceptance:**
  - the job on the stub engine: 20 scenarios, including four mutants that each turn their clause red;
  - the orchestrator against the real bridge and isolated Postgres with a fake editor half (attempt 14511d90cbe4506b): J05–J07 pass on real reads.
- **Blocked on:** an editor built with c638c830. Merging the lane into `local/wonderland-task3` was refused by this session's permission layer (a shared branch: kaisi-1f commits there too), and Wonderland Core will not merge without the founder. Merging c638c830 onto task3 at b2f352ad is clean (`git merge-tree`: no conflicts; 19 files, none with uncommitted changes in task3 at the time). Recompute it at the moment of merging. **The founder decides who merges.**
- **For Priority 10, from Julius** (`docs/JULIUS_GENERALITY_CLASSIFICATION.md` on their branch):
  - An empty `testCommand` is accepted only after #288 AND the generality PR (`relay/julius-task-generality` 83395f20) land. Until then the paid preflight refuses it. After that, every blocking criterion must declare `requiredEvidence`, the vocabulary is `TEST` and `DIFF` only, and `TEST` is never allowed with an empty command. The profile composes it; the player never does.
  - Four blockers for paid player missions: no network; a Node-only image; the Coding Agent cannot create a file (deliverables must be seeded stubs); and the 4 MiB workspace ceiling is measured against filesystem size. The last two mean a player's "add a settings page" cannot express its own deliverable.

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

> **Superseded.** Both ports were built in the sessions below (38–40 and 41).
> The route reads through `WonderlandJuliusReaderPostgres` when `DATABASE_URL`
> is set, and answers 503 when it is not.


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

### 41. The reader, and the contract change it forced (session of 2026-09-08, fourth part)

**The last cloud-side port.** `WonderlandJuliusReaderPostgres` implements the
two reads the world routes have been written against for three sessions, and
`server.ts` constructs it with the membership source — from ONE pool, so a
membership answer and the read it authorises come from one database.

#### One statement per answer

A hydration carries a run's STATE, its REVISION and the ledger POSITION that
state includes. Read in three statements those describe a run that never
existed. So `hydrate` issues one query with the counts and the `MAX(sequence)`
hanging off the run row as sub-selects, and `events` is anchored on the RUN with
a `LEFT JOIN LATERAL` onto the events — which is also why the revision comes
back when the page is empty, where a query anchored on the events table returns
nothing and leaves the caller inventing one.

The activity fold is the one thing SQL cannot do, and it is bounded by the
position that same statement returned. Unbounded, it would see events written
since, the client would be told about them here AND receive them again in the
tail, and the subagent counters — which move up as well as down, unlike the
signals — would be applied twice.

#### The contract change: a slot that nobody read is not an empty slot

Building the reader turned up something the contract could not express.
`julius_runs.card_revision` is **free text with no foreign key**, and **nothing
in the persistence layer reads `relay_wonderland.card_versions`** — the type
lives in `wonderland-backend.ts`, the in-memory battle backend. So no reader can
resolve which roles a run's C.A.R.D. fills.

`WonderlandCardScope.hasCodingAgent` was a `bool`, so the only thing the reader
could have said was `false`: three unfilled roles, drawn as a fact, about a
record nobody had seen. The three fields are now `boolean | null`, mirrored as
`FWonderlandFlag` rather than `bool` — a zero-filled USTRUCT would have handed a
renderer the same lie on the C++ side. `scopeWonderlandCard` distinguishes a
slot the record says is EMPTY (the property is present and blank) from one
nobody read (the property is absent), because those are different facts and only
one of them may be drawn.

This is the ordinary shape of the rule that runs through the whole product —
unknown is not zero — arriving at a place nobody had looked.

#### What it refuses to make up

| part | what it reports | why |
|---|---|---|
| usage | UNKNOWN, every figure | no authority attributes spend into the contract |
| Project Brain | nothing cited | see below — a vocabulary mismatch, not an absence |
| C.A.R.D. slots | null | nothing can resolve the record |
| C.A.R.D. revision | the real handle | `julius_runs.card_revision` IS that, opaque and carried |

**The Project Brain mismatch is a finding, not a gap.**
`julius_context_snapshots` holds almost exactly what a citation wants — revision,
character count, redaction count, truncation, content hash. Its kinds come from
`julius_brain_entries.entry_kind`, whose vocabulary is not the citation's:
`RESEARCH_NOTE` and `ACCEPTANCE_UPDATE` have no counterpart, and `OBJECTIVE`,
`REQUIREMENT` and `EVIDENCE` have no source. `scopeWonderlandBrain` silently
drops kinds it does not know, so citing on the overlap would report a smaller
retrieval than happened, as a fact. **Reconciling the two vocabularies is the
next contract decision on this seam** and it is deliberately not guessed at.

#### The first end-to-end proof over real HTTP

`relay-bridge/wonderland-julius-server.test.ts` boots the actual bridge, mints a
real browser session through the real pairing flow, and drives
`/wonderland/julius/hydrate` and `/events` — the streaming one read a chunk at a
time, because it is SSE and stays open. Only the database is a stub, answering
the shapes `pg` actually returns (`bigint` as a string, `timestamptz` as
something `new Date()` parses). It proves the hydration crosses with its
revision and position intact, that `null` survives JSON as `null`, that a
non-member and a non-existent run get the same answer, and that no provider name
appears on either path.

The world had to become injectable for that. Without it, an unwired bridge, a
wired one whose database is unreachable, and a wired one missing HALF its
dependencies all answer 503 — indistinguishable from outside, which is exactly
how a half-wired route survives. Three mutations of `server.ts` escaped every
test until the injection existed.

#### Two lines nothing can distinguish

Recorded so nobody re-derives them. `applyWonderlandOrdering`'s `Math.max` on an
accepted envelope's revision is unreachable (the verdict already refuses
anything lower), and skipping the pool construction when `DATABASE_URL` is
blank changes no observable behaviour (both paths 503). Both are left as
documented defence rather than covered by tests that only appear to cover them.

---

### 42. The decode contract nobody had written down

`Wonderland.Build.cs` has depended on `Json` and `JsonUtilities` since the
module existed. **No C++ file uses them.** The wire → USTRUCT decode is
unwritten, and the two shapes do not correspond one to one in two places that
both fail quietly:

- **90 nullable fields** cross as a value or `null` and land in a carrier with
  its own `bKnown`. A name-matching decoder leaves it zero-filled, which reads
  as "Relay did not say" for a figure Relay did say.
- **41 enums** carry `snake_case`, `SCREAMING_SNAKE` and — in one vocabulary —
  `SPACE SEPARATED` tokens against `PascalCase` members. An unmatched token
  leaves ordinal 0, which is `Unobserved` everywhere it matters. A broken
  decoder therefore produces a world that looks like Relay is silent.

`docs/handoffs/WONDERLAND_WIRE_CONTRACT.md` publishes the whole mapping and is
GENERATED from the same parity tables the headers are held to, so it cannot
describe a seam that no longer exists. `wonderland:wire:check` fails when it
drifts, the same shape as the ordering fixture.

**The mapping is now held to the real headers in the DIRECTION a decoder runs
it.** Every other parity check normalises both sides to a common token and
proves they agree; a client has to PRODUCE a member from a token, land on a
name that exists, and that is a different question. The new check found a real
gap on its first run: `PROVENANCES` holds `LIVE LOCAL` with a SPACE, and a
mapping that split on underscores alone produced `Live local` — a member no
header declares, which a decoder would have left at `Unobserved`.

That is the argument for the whole exercise. The gap had been there since the
enum was written, every existing test passed, and it would have surfaced as
"Relay isn't reporting provenance" during the paid engine hours.

---

### 43–44. The real database, and the decoder (session of 2026-09-08, fifth part)

Two gaps that had been described as closed by proxy: SQL proven by a stub, and
a decode contract proven by a document.

#### The reader, against a real PostgreSQL

`wonderland-julius-reader-real-postgres.test.ts` runs the PRODUCTION class —
not a re-spelling of its query — against a cluster built by the real migration
chain from empty. Thirty tests, gated on `JULIUS_TEST_DATABASE_URL` — since
2026-09-27 the ONE switch every real-PostgreSQL suite in the repository reads
(Julius 6d960b03 retired `JULIUS_REAL_POSTGRES` and `DATABASE_URL` as
switches, because the inherited `DATABASE_URL` on the development laptop is the
persistent Julius store). Without it they report as **todo**: visibly not run,
rather than passing on nothing.

To run it here: `initdb` as the `postgres` user (it refuses to run as root),
start on a spare port, create a database, then

```
JULIUS_TEST_DATABASE_URL=postgres://… \
  npx vitest run src/relay/persistence/wonderland-julius-reader-real-postgres.test.ts
```

**The real schema corrected the fixture three times**, and each is the sort of
thing only a cluster says out loud:

| constraint | what it caught |
|---|---|
| `CHECK((state='ACTIVE')=(lease_owner IS NOT NULL))` | a seeded task that was ACTIVE with no lease |
| `CHECK((state='PENDING')=(decided_at IS NULL))` | a decided approval that named nobody |
| `UNIQUE(stream_id, sequence)` | a Julius append landing on a battle row's number |

That last one is worth keeping: **the sequence space is per stream and shared
across writers.** Julius allocates from `relay_wonderland.stream_sequences`;
anything writing to the same `stream_id` without that allocator can collide
with it.

#### Five mutations escaped, and every one was the FIXTURE

With one run per project, run-scope and project-scope are redundant — either
can be deleted with every test still green. With one approval and it PENDING,
the state filter is decorative. With only `julius.%` rows, the prefix filter is
too. The seed now carries a second run inside project A at higher sequences,
rows written onto project A's stream id **under project B** (`stream_id` has no
foreign key, so nothing in the schema stops that), battle rows from the other
writer on the shared table, and approvals on three runs across two projects.
Fifteen mutations, all caught — including one proving the reader still refuses
an unknown kernel state on a database that has genuinely lost its CHECK.

#### And two of my assertions were wrong

A snapshot's `atSequence` is `MAX(sequence)` over the ledger; an ordering
cursor's `sequence` is the last APPLIED envelope. Silent events move the first
and not the second, so **they legitimately differ** — the snapshot is never
behind, which is the direction that matters. What converges between a cold
hydrate and a folded stream is the REVISION, not the position. And the run row
and the event stream can legitimately disagree about the phase: a review
starting under an EXECUTING run is exactly what the second axis exists to show.

#### The decoder, which did not exist

`Wonderland.Build.cs` had depended on `Json` and `JsonUtilities` since the
module was written and **no C++ file used them**. The path from an SSE frame to
a USTRUCT was unwritten.

It exists now, it does not map by name, and it parses its own JSON — so the
code that ships is the code the harness runs at -O0 and -O2 under ASan and
UBSan. A decoder on the engine's JSON API could not have been executed in the
environment that wrote it.

Twelve named refusals, nothing defaulted, identity validated before a subsystem
could be reached. An unknown token is refused BY NAME rather than left at
ordinal 0 — zero is `Unobserved` everywhere here, so the fallback would make a
broken client look like a silent Relay, which is the hardest symptom there is
to diagnose with an engine open.

**The delivery's two halves must agree about whose run it is.** Nothing
downstream compares them; every later check reads the envelope alone.

#### The fixture pairing (§3)

46 envelope fixtures and 10 delivery fixtures, produced by calling the REAL
`wonderlandEnvelope()` and the REAL activity fold and serialising them exactly
as the bridge does, then damaged one field at a time for the refusals. Every
visual state, worker role and activity signal has one.

The link is load-bearing, and that was checked rather than assumed: adding a
state to `JULIUS_VISUAL_STATES` and regenerating only the fixtures made the C++
refuse `state-ascended` as `unknown_token` immediately.

They live in the source tree, not `generated/` — which is gitignored, so a
fresh checkout would find no fixtures and the harness would report success over
an empty file. A TypeScript test holds them fresh and sweeps them for provider
names and credentials; the `metadata-dropped` fixture is BUILT with a
secret-shaped key, and its absence is the sanitiser working on the real
construction path rather than a fixture that politely omitted one.

---

---

### 45–49. The hydration path, end to end (session of 2026-09-10)

The named remaining seam was "a decoder for the HYDRATION WRAPPER". It is
written, and closing it exposed four more things that were wrong or missing on
the same path. All five are done and all five are proven offline.

#### 45. The wrapper decodes (`194906f`)

`WonderlandDecodeHydrationBytes` — the snapshot, whole. The envelope, the
activity and the usage HUD already decoded; this is those three plus the Project
Brain citation and the C.A.R.D. scope, in ONE entry point rather than four calls
a client composes, because a hydration is adopted WHOLESALE and the cross-field
agreement has to be decided before any of it is visible.

Two readers were EXTRACTED rather than rewritten, so the activity here is the
delivery's and the usage here is the usage entry's. The refactor is
behaviour-preserving: 171 checks before and after.

Three carriers had no reader. `NullableInteger` (`atSequence: null` is "the
reader could not say"; `activeTasks: null` is "nobody counted"), `NullableFlag`
(the three-way C.A.R.D. slot), and `kindCounts` — an object keyed by kind,
stored INDEXED BY ORDINAL so no caller subtracts one. **A known kind must be
present; an unknown kind is TOLERATED**, the one place in the decoder where an
unrecognised token is not a refusal, because a world that went dark the moment
Relay learned a tenth kind is the more expensive failure.

`SchemaRejected` is new and LAST in the enum, so no ordinal moved.

Three enum tables were missing and are now generated — the usage reading, the
autonomy level, the brain kind. A decoder path added without its tables refuses
every token it reads.

#### 46. The citation became real, and the C.A.R.D. stopped guessing (`c4e74f2`)

The reader's own header said the citation was blocked on a vocabulary mismatch.
**It was not.** `scopeWonderlandBrain` was built for exactly that case: an
unrecognised kind is counted in `entryCount` and in NO bucket, and the gap
between the total and the sum IS the documented signal. So
`julius_context_snapshots` is read — revision, character count, redaction count,
truncation, content hash, and one row per cited entry through `WITH ORDINALITY`
over the packet's own `source_entry_ids`.

**Bounded by the hydration's own instant**, from the database's clock in the
statement that read the run. A compilation from a moment later describes a
retrieval the rest of the payload knows nothing about.

`safe_content` has no column in the query, no field on the citation and nowhere
to go — proven with a canary planted in every seeded entry.

And `swarmEligible` was a bare bool. C.A.R.D. policy is not persisted AT ALL —
`julius_runs` stores a `card_revision` and nothing stores the policy that
revision names, which `julius-events.ts` already says where it explains why
`autonomy.changed` is not an event type. So a reader passed no capabilities and
got `false`: "this run may not spawn a swarm", drawn beside three role slots
that correctly said UNKNOWN. It is `boolean | null` now, `FWonderlandFlag` on the
C++ side.

#### 47. What a run is waiting for a PERSON to do (`a65c4a4`)

The kernel already implements the whole intervention protocol — policy answers
REQUIRE_APPROVAL, `requestApprovalAndBlock` writes the gate and blocks the run in
one transaction, `decideApproval` records who decided, the run resumes. **What
did not exist is the projection.** A world was told `pendingApprovals: 3` and
shown `awaiting_approval`, and that was all: three of something, somewhere.

`WonderlandHumanGate` carries the operation C.A.R.D. gated, the task (or none —
run-level gates exist), the reason CODE and when the gate opened. It carries **no
prose**: `safe_rationale` is a real column and a genuinely safe sentence and it
still does not cross, and `decision_reason` and `decided_by` stay with it. The
narrowing function cannot be handed them.

**A gate this build cannot name is COUNTED, never dropped.** `run.pendingApprovals`
stays the authority on how many; the list says which, and both come from ONE
statement so they cannot disagree about a moment.

`WONDERLAND_GATED_OPERATIONS` is held to `JuliusPolicyOperation` in both
directions by a type assertion.

#### 48. A world hydrating cold had nothing to draw (`1be473a`)

`run.state` is the KERNEL's word — one of thirteen. What a world DRAWS is one of
eleven. A TypeScript caller imports the mapping; **an Unreal client cannot**,
because an adapter may not own a mission verdict. So a world was left to map
thirteen kernel words in engine code nobody reviewed, or to wait for the first
envelope — which for a COMPLETED run never comes.

`visualState` and `terminal` are on the hydration now. `terminal` cannot be
recovered from the drawing: `blocked` and `error` are drawn differently and only
one is terminal. The verdict RECOMPUTES both rather than trusting them.

#### 49. Adopting one, so a joining world is not deaf (`e7b81cc`)

The decoder produced an `FWonderlandHydration` and **nothing could apply one**.
`AdoptSnapshot` sets the run and nothing else, so a world that had just joined
held a correct phase beside an EMPTY ACTIVITY — a run waiting on a person drew
as a calm run. The server folds the activity precisely so a rejoining client
need not replay the transcript, and nothing applied what it folded.

`AdoptHydration` applies the run, the drawable state, the folded activity and the
gates together or not at all. It takes no embodiment (the payload answers that
now) and returns a verdict (a JOIN is a moment a caller waits on).

**Two defects it found in itself**, both from mutation runs. Its first guard read
`bStateApplied` to decide whether `AdoptSnapshot` had applied — but on a
RECONNECT that flag is already true, so a refusal would have been invisible and
another run's activity and gates would have gone on over the held ones. It
compares the cursor's refusal counters now. And its inner-identity check is
REDUNDANT today, which is labelled rather than left to look proven.

#### What this session did NOT do

- **No rebase onto the newer `main`.** This branch is still based on `b2dc9f2`
  while `origin/main` is at `5be73c5` (12 Julius commits ahead). Nothing here
  conflicts as far as this session can tell, but the merge has not been tried.
- **The three gaps in §"the gaps this stream found and did NOT close" are still
  open**, and item 3 (the Julius session's two persistence defects) is still the
  one worth raising with them.
- **No provider call, no Julius mission, no Unreal build, no GPU frame.**

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
| the usage accounting boundary | **real** contract; no authority attributes spend into it yet — STILL the case |
| per-project isolation across many worlds | **real**, proven by referential identity, mutation-verified |
| the entry contract (admission vs presentation) | **real**, and its honest answer today is `ADMITTED · NOTHING CAN SHOW IT` |
| HUD geometry, palette, capacity model | **real** and shared with Unreal by bidirectional parity |
| the usage authority (KNOWN / NOT-REPORTED / STALE / UNAVAILABLE) | **real** contract; **no authority reports into it** — STILL the case, and the one remaining placeholder in a hydration |
| the numbers in the HUD | **NOTHING REPORTS THEM**, and the HUD is not a web surface at all — it belongs to the Unreal world. Component, stylesheet and fixture are all absent from the shipped bundle. |
| the entry path (`ENTER WONDERLAND`) | **real** as far as `admitted`; the button runs the state machine and posts to the real bridge route |
| the honesty ladder itself | **real and executable** — `verifyWonderlandCapture` grades a capture, and `real` is unreachable from it by construction |
| the Unreal usage geometry | **real**, and proven numerically against the TypeScript sampler — 66 samples, worst deviation 1e-6 |
| the Unreal usage and run subsystems | **real**, 213 executable checks over refusals, held state, snapshot adoption in both modes, and reconnect (152 + 61) |
| a real Julius event becoming an envelope | **real** and tested — and nothing has ever fed it a row from a live database |
| the transport boundary (scope, decode, validate, order, fold) | **real**, tested against reconnects, mis-routed fan-outs and replayed tails |
| the Julius world routes | **real**, authorised per request against `project_members`, and READING through `WonderlandJuliusReaderPostgres` — proven end to end over real HTTP against a stubbed database |
| the two world reads | **real**, mutation-verified, and RUN AGAINST A REAL PostgreSQL 16.13 — real migration chain from empty, two seeded projects, 30 tests |
| the wire → USTRUCT decode contract | **real** and generated from the parity tables |
| the wire DECODER | **real** — envelope, activity, usage HUD, SSE framing AND THE HYDRATION WRAPPER; 327 checks at -O0 and -O2 under ASan/UBSan, driven by 146 fixtures the TypeScript generated. Never compiled against Unreal |
| the Unreal ordering rule | **real**, replayed through 26 cases generated from the TypeScript, 450 checks |
| the Project Brain scope | **real**, and CITED FROM A REAL DATABASE: `julius_context_snapshots` read per run, bounded by the hydration's instant, canary-tested against text really in the table. A kernel kind with no bucket is counted in the total and nowhere else |
| Unreal DRAWING any of it | **not proven.** `WonderlandUsageHudWidget.cpp` parses and has never been compiled against real UMG headers or seen to put a pixel on a screen. |
| the C.A.R.D. scope | **real** contract, and every judgement in it is honestly NULL — C.A.R.D. policy is not persisted anywhere, so there is nothing to resolve and nothing pretends otherwise |
| the human-gate projection | **real**, read from `julius_approvals` in the same statement as its count, provider-free and prose-free, 6 tests against a real PostgreSQL |
| the drawable state on a hydration | **real**, from Relay's own total mapping, proven for all thirteen kernel states |
| adopting a whole hydration in C++ | **real**, 90 executable checks including the reconnect case that found an unsound guard |
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

**989 passing across the Wonderland slice** (52 files: the mission modules, the
Postgres reader, and both bridge route suites), 0 failed. Plus the repository
boundary scanner, the core boundary test, the Julius harness drift gate, the
surface-parity gate, the C++ syntax check, the ordering and geometry fixtures,
the wire-contract freshness check, `npm run typecheck` (all four projects),
`npm run build`, `relay:build` and `relay:bridge:build` — all clean.

The gate list in `CLAUDE.md` is a LIST, and reading part of it is how two
defects reached `origin` in this stream: a failing typecheck under a green test
count, and a test that could pass on half a run under a green wonderland
slice. Run all of it.

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

**THE CLOUD SIDE OF THIS SEAM IS DONE.** As of 2026-09-10 the hydration path is
complete end to end — PostgreSQL → reader → route → wire JSON → C++ decoder →
subsystem adoption — and every link of it is executed offline rather than
described. What remains is ENGINE EXECUTION and things that need a live run.

In order:

1. **Set `DATABASE_URL` on the Railway bridge.** One environment variable; both
   world dependencies are built from it. Without it the route answers 503,
   which is correct rather than broken. **Not a code change — an operator's
   action, and the only cloud item left.**
2. **Run A–M** in the Unreal handoff. Nothing about it can be done here, and
   everything cloud-side it depends on now exists and is tested.
3. **Capture one real Julius event stream** and grade it with
   `verifyWonderlandCapture` — still the cheapest step up the honesty ladder and
   the only one that moves anything off INTEGRATION-READY. Needs a live run, so
   it needs the Julius session.
4. **An authority that reports usage.** The last placeholder in a hydration: the
   meters project from an empty authority and draw UNKNOWN, which is the true
   reading and not a stub, but nothing reports into the contract. Not blocking.
5. ~~Decide whether to rebase onto the newer `main`.~~ **DONE 2026-09-10** —
   merged (not rebased) up to `5909ae0`, zero conflicts. Nothing to do.

The Project Brain kind vocabulary is NO LONGER an open decision (section 46):
the kernel's vocabulary and the citation's differ, an unrecognised kind is
counted in the total and in no bucket, and the gap between them is the signal.
That is the design working rather than a decision deferred.

### The older next-task, still true and now second

Wiring the normalizer into a composition root so an ordinary Julius run
produces world events on `GET /wonderland/events` remains open —
`observeRelayTransition` is battle-scoped and returns `[]` for an ordinary run.
The reader above is the narrower path to a moving world, because it reads the
ledger directly rather than depending on that route.

---

## EDITOR / LAPTOP BLOCKPOINT (2026-09-10)

**Everything below this line needs a machine this session does not have.**
Nothing above it is waiting on anything.

### Where the work is

| | |
|---|---|
| branch | `claude/julius-wonderland-integration-khaqs3` (pushed) |
| continues | `relay/wonderland-integration` from `03fe982` |
| base | `origin/main` at `b2dc9f2`, **then merged up to `5909ae0`** (see below) |
| working tree | clean |
| synced with `origin/main`? | **YES — merged, not rebased, on 2026-09-10.** `origin/main` at `5909ae004f11ad88269159f0c30d505c8ca491ea` is an ancestor of this branch: **0 behind**. A MERGE rather than a rebase because this branch was already pushed and carries eleven reviewable commits; a rebase would rewrite published history and force-push over it. The merge was fully automatic — **zero conflicts**. |

### What is proven in the cloud, and how

| gate | result |
|---|---|
| `npm test` | **10,270 passing, 1 failing across 534 files** (261s). The failure is `executor-repair-regression.test.ts`, which passes **14/14 alone** and only fails under parallel load — a known pre-existing flake in a subtree this branch never touches (`git diff --name-only 03fe982..HEAD -- src/relay/workspace` is empty). |
| `typecheck` | PASS (all four projects, `import.meta` bridge pass included) |
| `build`, `relay:build`, `relay:bridge:build` | PASS |
| `relay-repository-boundary.mjs` | PASS |
| `relay-parity-gate.mjs` | PASS |
| `relay:surface-parity:check:strict` | PASS |
| `relay:cli:contract-verify` | PASS |
| `relay:yc-demo:check` | READY FOR FOUNDER ACCEPTANCE |
| `relay:persistence:contract-verify` | PASS (44 separate Node processes) |
| `relay:persistence:recovery-drill` | DURABLE LOCAL RECOVERY VERIFIED |
| `relay:workspace:verify` | PASS |
| `relay:claude:contract-verify` | PASS |
| `wonderland:cpp:syntax` | 32 files, all at baseline |
| `wonderland:wire:verify` | **327 checks, 0 failures** |
| `wonderland:julius:verify` | **90 checks** |
| `wonderland:usage:verify` | 152 checks |
| `wonderland:ordering:verify` | 450 checks over 26 generated cases |
| `wonderland:geometry:verify` | 66 samples, worst deviation 1e-6 |
| `:wire:check`, `:wire:fixtures:check`, `:geometry:check`, `:ordering:check` | all current |
| REAL PostgreSQL 16.13 | **50 passing** — `wonderland-julius-reader-real-postgres.test.ts` (47) and `real-infra-julius.test.ts` (3 + 2 Docker-gated todo), migration chain from empty, two seeded projects, both writers on the shared events table |
| `git diff --check` | clean |

**Roughly 20 deliberate mutations were run across this session's code and every
one was caught**, except three that were confirmed EQUIVALENT and are labelled
as such in the source rather than left looking proven.

### The sync to trusted main (2026-09-10)

`5909ae0` brings the Coding Agent execution-envelope repair (#249) and the
reviewer-deadline derivation (#248). The two diffs overlap in exactly TWO files,
both in the harness-manifest machinery — `scripts/export-julius-harness.mjs`
(main declared `julius-context-integrity.ts` and `reviewer-deadline.ts`; this
branch declared `wonderland-human-gate.ts`) and the generated
`JULIUS_HARNESS_MANIFEST.md`. Git resolved both automatically; all three
declarations were verified present afterwards, and `npm run julius:harness:export`
reported the committed manifest already current (**81 kernel dependants
classified**, up from 70).

Verified after the merge:

| gate | result |
|---|---|
| `typecheck` | PASS (all four projects) |
| `wonderland:wire:verify` | 327 checks, 0 failures |
| `wonderland:julius:verify` | 90 checks |
| `julius:harness:export` | current, no diff |
| the seam + everything the merge could disturb | **1,138 passing / 57 files** — the whole Wonderland domain, both reader suites (real PostgreSQL included), `wonderland-postgres`, both bridge route suites, the harness drift gate |
| what MAIN brought in, on the merged tree | **840 passing / 46 files** — `hosted-coding-agent`, `reviewer-deadline`, the whole Julius mission domain |
| `git diff --check` | clean |

**One pre-existing failure was chased down rather than accepted.**
`julius-live-chain.e2e.test.ts` fails in a combined persistence run
("VERIFIED COMPLETION: FAIL — run ended EXECUTING"). It fails **identically on
plain `origin/main` at `5909ae0`**, checked out and run on its own — so it is
main's, not the merge's. `real-infra-julius.test.ts` failed once in a combined
run and passes 7/7 alone against a fresh database; that is the same
database-reuse artefact this file already records.

### What is waiting for the editor

**Compile-only (needs UE headers and UHT, no PIE):**

- All 16 `.cpp` under `wonderland/Source/Wonderland/`. They are syntax-checked
  and six of them are COMPILED AND EXECUTED here against stubbed engine types,
  but never against real UE headers. Expect UHT to want `.generated.h` files
  that are one-line stubs in this repository.
- `WonderlandWireDecode.cpp` — the largest new surface. It parses its own JSON
  and depends on nothing from the engine but `CoreMinimal`, so it is the file
  most likely to compile unchanged and the one whose behaviour is already
  pinned by 327 executed checks.
- `WonderlandJuliusSubsystem.cpp` — `AdoptHydration` is new. 90 executed checks.

**Compile AND runtime, but still no pixels (PIE, no art needed):**

- `UWonderlandJuliusSubsystem` / `UWonderlandUsageSubsystem` as real
  `UGameInstanceSubsystem`s. Everything about them is proven as plain C++ here;
  what is NOT proven is that the engine constructs and finds them.
- `AWonderlandHubGameMode` spawning the Dog as `DefaultPawnClass` (checklist 7).
- The SSE socket. **The decoder is not the work** — `WonderlandWireReadSseData`
  plus `WonderlandDecodeDeliveryBytes` is the whole read path. What is missing is
  an HTTP client that holds a browser session token and pumps bytes into them.

**Visual verification (needs a GPU and, for 9, art):**

- `WonderlandUsageHudWidget.cpp` — **the only file on this seam never compiled
  against real UMG.** The Slate paint is the single genuinely unproven thing in
  the C++. The geometry underneath it is proven numerically (66 samples, 1e-6).
- Checklist 9: the hub blockout with the founder's art direction.
- A–M items G, H, I, L: animation following a phase, an accent riding on top
  without changing the base clip, both meters drawing with a bigger tier as a
  LONGER track, and the three endings drawn.

**Blender / GPU dependency:** there is **no Blender dependency anywhere in this
repository** — no file references it and nothing is blocked on a mesh. The GPU
is needed for PIE and for the HUD paint, not for any contract. `.umap` and
`.uasset` binaries are editor-authored and cannot be honestly written here;
that is checklist steps 6 and 8 and is unchanged.

### Exact laptop-only operations remaining

1. UE 5.4 install → generate project files → build `WonderlandEditor`.
2. Author `/Game/Wonderland/Maps/WonderlandHub` and the Enhanced Input assets.
3. Run A–M in `docs/handoffs/WONDERLAND_UNREAL_HANDOFF.md`, including the new
   **K2** (a cold join draws a COMPLETED run; a gated run shows its gate).
4. Capture evidence into `docs/relay/WONDERLAND_SLICE_EVIDENCE.md`.

### The one cloud thing that is NOT code

**Set `DATABASE_URL` on the Railway bridge.** One environment variable; both
world dependencies are built from one pool. Until then every `/wonderland/julius/*`
route answers 503, which is correct rather than broken. This is an operator
action and no session can do it without the founder's console.

### The first action when the laptop arrives

```
git clone … && git checkout claude/julius-wonderland-integration-khaqs3
npm ci
npm run wonderland:wire:verify && npm run wonderland:julius:verify
```

The branch already contains trusted main (`5909ae0`), so there is **no sync to
do first** — do not rebase, do not pull, just check out and build.

**Run the harnesses BEFORE opening the editor.** They take seconds, need no
engine, and if one fails the problem is the checkout rather than Unreal. Then
right-click `Wonderland.uproject` → Generate project files → build
`WonderlandEditor` (Development) and capture the build log: that is checklist
step 3 and A in the evidence chain, and everything else is behind it.

### Nothing else valuable remains cloud-only

The hydration path is complete end to end — PostgreSQL → reader → route → wire
JSON → C++ decoder → subsystem adoption — and every link is EXECUTED here rather
than described. The remaining cloud-side item is a usage authority, which is a
product decision rather than an integration gap and which does not block A–M;
until there is one the meters draw UNKNOWN, which is the true reading.

**TASK 3 IS NOT COMPLETE.** The cloud side of it is. Nothing on this seam has
been driven by a live Julius mission, no Unreal build has ever run, and no GPU
frame has ever been drawn — and no amount of further cloud work can change any
of those three.

---

## Final report (the brief's A–L)

**A. Starting SHA** — `b2dc9f2` (`origin/main`, unchanged throughout; this
stream never merged into or from `relay/wonderland-v2`).

**B. Ending SHA** — see `git log -1`, which is authoritative. This report's
figures were taken at `4a4ba77` on `relay/wonderland-integration`, pushed to
both that ref and `claude/relay-wonderland-integration-ojr5x6` (same commits).
Sections 38–42 above cover everything after the original A–L brief.

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

**K. Tests and evidence** — 989 passing across the Wonderland slice at the time
of writing; plus the repository boundary scanner, the core boundary test, the
Julius harness drift gate, the surface-parity gate, the C++ syntax check, the
ordering and geometry fixtures and the wire-contract freshness check. Roughly
seventy deliberate mutations across this stream confirmed the suites can
actually fail — with several escapes on first pass, every one of them a gap in
the TEST rather than the code. The HUD was rendered in headless Chromium and
measured rather than assumed. Full `npm test` at `1ad7160`: **10,186 passing,
1 failing across 530 files** (184s).

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

**L. The next five gaps** — REVISED after sessions 38–42, in order. The first
three are no longer software architecture:

1. **Set `DATABASE_URL` on the Railway bridge.** One environment variable; both
   world dependencies are built from it. Until then `/wonderland/julius/*`
   answers 503, correctly.
2. **Write the wire → USTRUCT decoder** against
   `docs/handoffs/WONDERLAND_WIRE_CONTRACT.md`. Unwritten, and the two traps in
   it fail quietly — see section 42. Needs the engine to prove, not to write.
3. **Run A–M** in the Unreal handoff. Everything cloud-side that A–M depends on
   exists and is tested; nothing about A–M can be done here.
4. **Capture one real Julius event stream** and grade it with
   `verifyWonderlandCapture`. Still the cheapest step up the honesty ladder and
   still the only one that moves anything off INTEGRATION-READY. Needs a live
   run, so it needs the Julius session.
5. **Two contract decisions**, neither blocking: the Project Brain kind
   vocabulary (section 41) and an authority that reports usage.

Two items from the original list are superseded rather than done. Wiring the
normalizer into `GET /wonderland/events` is no longer the path to a moving
world — the Julius reader reads the ledger directly — and `server.ts`'s
nine-phase filter belongs to the Julius session and does not gate this seam.

