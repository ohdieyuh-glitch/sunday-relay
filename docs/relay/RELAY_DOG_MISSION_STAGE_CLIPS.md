# Relay Dog mission-stage animations — the clip contract

**Status: the STATE LAYER is built and tested. The CLIPS are not authored.**

This document is the handoff from the core-systems session to the Unreal session.
It is the authoring specification for four locked animations, and it is written
against the founder direction of 2026-09-15, which is the current canonical
authority and supersedes earlier Relay Dog mission-animation descriptions.

**The Relay Dog is PROCEDURAL C++, not imported clips.** `RelayDogStride.cpp` is a
pose solver and `RelayDogCharacter.cpp` drives named scene-component pivots, with
every pose computed from the clock. So `animationId` below is a **performance
selector**, not an asset path: `dog_verify_beam` names which procedural
performance to run. Every other field is substrate-neutral and drives pivots as
well as it would drive an animation graph. Nothing in this contract assumes an
imported asset. Procedural is also the better substrate for this specification —
a cross-faded clip could not hold the verification beam for an arbitrary
verification duration, and a continuously driven performance can.

The state layer that drives these lives in
`src/relay/mission/wonderland/wonderland-dog-stage.ts` and is proven by
`wonderland-dog-stage.test.ts` (25 assertions) and
`src/relay/ui/relay-dog-motion/dog-stage-parity.test.ts` (3 assertions).

---

## The architecture, and where the seam is

```
JULIUS EVENT / MISSION STATE
  -> Wonderland mission-state adapter      wonderland-dog-stage.ts   [BUILT]
    -> Relay Dog animation state           WonderlandDogPresentation [BUILT]
      -> animation + props/effects         Unreal clips + props      [TO AUTHOR]
```

The adapter hands Unreal a `WonderlandDogPresentation` per stage. Every field is
already decided and tested; the Unreal side binds `animationId` to a clip and
reads `prop`, `locomotion`, `emission`, `contractPresent` and
`headTracksContract` to drive props, root motion and effects.

**Provider names never reach this layer and must never reach a clip.** The stage
vocabulary is closed and the presentation table is total over it; a test greps
the serialized table for seven vendor names. Which model answered is a billing
fact, not a scene.

---

## The four locked animations

### A. `mission_start` — `dog_mission_activation_float`

| Field | Value |
|---|---|
| `prop` | `none` |
| `locomotion` | `floating` |
| `emission` | `none` |
| `contractPresent` | `true` |
| `headTracksContract` | `false` |

The Dog **floats up into the air**. Entire body suspended above the ground, body
relatively upright, **head tilted/raised upward**, both forelimbs extended
outward and **slightly downward — roughly 30–45° below the shoulders**. Chest
open, body calm and centred, legs suspended naturally underneath.

It must carry a **subtle vertical hover/breathing motion** — never frozen.

Explicitly NOT: meditation, a grounded pose, arms straight down, a horizontal
T-pose, a book, a paintbrush. A test asserts `locomotion !== 'grounded'` and that
`animationId` does not match `/medit/i`.

The floating glowing **RED** Mission Contract diamond is visible nearby.

### B. `planning` — `dog_planning_read_orbit`

| Field | Value |
|---|---|
| `prop` | `book` |
| `locomotion` | `orbit_contract` |
| `emission` | `none` |
| `contractPresent` | `true` |

The Dog holds an **open book and READS it** — eyes/head tracking the pages,
turning or shifting pages where practical. It is **not writing**.

It must visibly **walk around / circle the Mission Contract while reading**.
Standing beside the diamond holding a book does not satisfy this. The Contract is
the centre of the activity and the movement should read as deliberate and
thoughtful.

**BOOK = PLANNING.** A test asserts exactly one stage in the whole table carries
the book. Do not bind the book prop to any other clip.

### C. `implementing` — `dog_implement_paint`

| Field | Value |
|---|---|
| `prop` | `paintbrush` |
| `locomotion` | `orbit_contract` |
| `emission` | `none` |
| `contractPresent` | `true` |

The Dog **works a paintbrush** — it must not merely hold it. Painting strokes
through the air, brushing forms into existence, deliberate repeated strokes,
stepping and repositioning as implementation progresses, moving around the
Mission Contract while creating.

The brush should feel magical and Wonderland-native, and should read as
**software/creation implementation** — not an artist's easel scene. It may
interact with creation particles, code-like glyphs or geometric pieces.

A test asserts exactly one stage carries the paintbrush.

### D. `verifying` — `dog_verify_beam`

| Field | Value |
|---|---|
| `prop` | `none` |
| `locomotion` | `planted_facing_contract` |
| `emission` | `verification_beam` |
| `contractPresent` | `true` |
| `headTracksContract` | `true` |

The Dog faces the Mission Contract in a stable verification stance and emits a
**SUSTAINED** concentrated beam connecting it to the diamond. The beam stays
active **continuously for as long as verification runs**.

Explicitly NOT: a one-second projectile, repeated bullets, intermittent flashes,
or anything that reads as combat damage. This is **verification energy** —
analytical and magical.

The Contract may react while receiving it: brighter internal energy, controlled
pulses, rotating internal facets, verification particles, subtle surface
response.

`verifying` is the **only** stage in the table that emits anything, and a test
enforces that.

---

## Handoff: the event survives, the animation does not

There is **no dedicated Relay Dog handoff animation**, and none should be
authored.

`handoff` remains a real member of the stage vocabulary and resolves to
`{ kind: 'inherit' }`. The world keeps performing whatever stage it was already
performing. Deleting the member instead would have deleted a Julius event in
order to remove a visual, which the direction explicitly forbids — world
presentation and Julius internal events are separate layers.

Tests prove `handoff` is the only inheriting stage, that a handoff arriving
during `implementing` keeps the paintbrush on screen, that it triggers no prop
change and no Contract despawn, and that it falls back to the resting world when
nothing was playing.

**There is no `carrying_handoff` clip to unbind** — the Unreal session confirmed
the worktree contains no clip bindings of any kind. Do not invent one to remove.
**Do not delete the underlying activity.** `RELAY_DOG_ACTIVITIES` still
contains `handoff` and `WORKSPACE_ACTIVITY` still maps `carrying_handoff` to it;
that is deliberate.

---

## Transitions — no hard cuts

`wonderlandStageTransition(from, to)` returns exactly which prop leaves, which
enters, which emission ends and which begins, and whether the Mission Contract
spawns or despawns. Drive entry/exit from it rather than popping props.

| From → To | Prop exiting | Prop entering | Emission |
|---|---|---|---|
| `none` → `mission_start` | — | — | Contract **spawns** |
| `mission_start` → `planning` | — | `book` | — |
| `planning` → `implementing` | `book` | `paintbrush` | — |
| `implementing` → `verifying` | `paintbrush` | — | beam **begins** |
| `verifying` → `complete` | — | — | beam **ends** |
| anything → `handoff` | — | — | nothing changes |

The Mission Contract **does not exist** while the user is merely exploring: the
`none` stage carries `contractPresent: false`, and the diamond spawns on the
transition into `mission_start`. Do not restore the old grounded Contract dais.

---

## The PIE capture the founder asked for

Film these as **one continuous mission sequence**, not four disconnected
screenshots:

```
none -> mission_start -> planning -> implementing -> verifying -> complete
```

with a `handoff` injected during `implementing` to demonstrate that the
paintbrush scene continues uninterrupted and no handoff pose occurs.

While live Julius is not connected, drive it from the deterministic simulator and
keep **DEVELOPMENT PREVIEW / SIMULATED JULIUS EXECUTION** visible on screen.
Simulated animation must never be presented as live Julius behaviour.

---

## What is NOT decided here

The direction said to preserve existing behaviour for `researching`, `reviewing`,
`repairing`, `waiting_for_user`, `complete` and `error` until they get their own
specification. The table carries a placeholder presentation for each so it stays
total; those `animationId`s are **provisional** and should not be treated as
authored design.
