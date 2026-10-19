# Relay Dog Motion System — Milestone 4.5

Status: implemented (visual only)
Module: `src/relay/ui/relay-dog-motion/`
Tests: `dog-behavior.test.ts`, `patrol-engine.test.ts`,
`relay-dog-motion.test.tsx` (jsdom, hand-driven frames),
`relay-dog-motion-boundary.test.ts` (source-level safety)

## Visual-only responsibility

The Relay Dog is a state indicator. It moves because Relay is in a state — it
never causes one. Nothing in this system changes mission, task, or command
state, creates a command or an execution capsule, appends an Aquala Trace
event, touches evidence, review, release, or budgets, calls a provider or an
agent, runs a shell command, or reads an environment variable. The boundary
test asserts every one of those at the source level.

Walking in particular is **not** a mission state, an execution state, a trace
event, a capsule fact, evidence, agent activity, or mission progress. It is
where the dog happens to be standing.

## Mission state → dog behavior

`projectRelayStateToDogBehavior(state)` (with the typed
`projectWorkspaceDogBehavior` / `projectHomeDogBehavior`) is a pure function
over the EXISTING visual state models — `WorkspaceDogState` and
`HomeDogState`. It introduces no competing mission-state system, reads no
clock, touches no browser API, and never mutates its input.

```ts
type RelayDogBehavior = {
  activity: 'idle' | 'thinking' | 'waiting_for_user' | 'researching'
          | 'implementing' | 'handoff' | 'verifying' | 'reviewing'
          | 'repairing' | 'complete' | 'error';
  patrolEnabled: boolean;      // idle only
  attentionRequired: boolean;  // waiting_for_user / error
  reducedMotionFallback: string;
};
```

| Existing state | Activity | Patrol |
| --- | --- | --- |
| `wandering` | idle | ✅ |
| `trotting` | thinking | — |
| `implementing` / `running` / `sprinting` | implementing | — |
| `carrying_handoff` | handoff | — |
| `researching` | researching | — |
| `verifying` | verifying | — |
| `reviewing` | reviewing | — |
| `repairing` | repairing | — |
| `waiting_for_user` | waiting_for_user | — |
| `stopped_safely` / `complete` | complete | — |
| home `ready` / `wandering` | idle | ✅ |
| home `waiting` | waiting_for_user | — |

An unrecognized state falls back to `idle` rather than leaving the dog without
a behavior.

## Animation priority

One primary activity animation at a time, resolved by a documented, tested
order (lower wins). Reduced motion is handled ahead of all of it by the
controller — it replaces the loop, it does not pick a different activity.

```
1 error · 2 waiting_for_user · 3 reviewing · 4 verifying · 5 repairing
6 implementing · 7 researching · 8 thinking · 9 handoff · 10 complete
11 idle patrol
```

A failure outranks everything; a blocked human outranks any machine work;
review and verification outrank the work they are judging. Idle patrol is
always last — it may only run when nothing else is happening.

## One controller

`useRelayDogPatrol` is the single authoritative motion controller. It owns
position, direction, patrol on/off, measured bounds, pause state, loop
identity, cleanup, and reduced motion. There is exactly ONE
`requestAnimationFrame` loop for the dog in the entire Relay UI, and the
boundary test proves no other UI module starts one.

Consequences that are tested: changing mission state never spawns a duplicate
loop, rerendering never restarts the walk from the centre, an in-flight frame
dispatched just before patrol stops cannot move the dog, and unmounting
cancels everything.

Frames are only scheduled when the dog could actually walk — patrol permitted,
motion not reduced, and a measured track wide enough. A container with no
usable width burns no animation frames at all.

## Layered transforms

Each layer owns a different transform, so patrol travel, facing, and the body
animation never overwrite one another:

```
.rdm            motion boundary — measured track, overflow-x: hidden
  .rdm-travel   horizontal patrol position (translateX)
    .rdm-facing direction (scaleX)
      .rdm-body activity animation (jump, tippy-toe reach)
        <RelayPixelDog/>   existing artwork, unchanged
```

## Idle patrol

The dog walks left and right inside its own container at a calm pace
(26 px/s), pausing naturally (4.2 s walking, 1.4 s paused) and turning AT each
boundary rather than teleporting. The engine (`patrol-engine.ts`) is pure and
deterministic: no clock, no randomness, no browser — the controller feeds it
elapsed milliseconds, so every movement, turn, pause, and clamp is exactly
testable. A single oversized delta (a backgrounded tab waking up) is capped so
it can never become a teleport.

## Direction and facing

Moving right faces right; moving left faces left, via a horizontal flip of the
dog wrapper. The caption and the marker glyph are counter-flipped, so no
label, status text, or badge is ever rendered backwards. The existing artwork
is used as-is — there are no new directional assets.

## Position preservation

Horizontal position lives in a ref for the lifetime of the mounted component.
Entering thinking, implementing, reviewing, or any other state stops the walk
where the dog stands, and returning to idle resumes from that exact position —
never from the centre. It is never persisted to a database, local storage,
mission persistence, the Project Brain, the trace ledger, a capsule, the URL,
or server state.

## Boundary measurement

Bounds are measured from the real rendered container width and the real dog
width, recalculated on resize through `ResizeObserver` where available and a
`resize` listener otherwise (no dependency added). A resize re-fits the
preserved position instead of recentring. When the container becomes narrower
than the dog plus a meaningful walk, patrol is disabled and the dog is
anchored — it never overflows, and the boundary clips horizontally so patrol
can never introduce page-level horizontal scrolling.

## Per-state behavior

- **Thinking / researching / reviewing / verifying / repairing / handoff /
  complete** — existing behavior preserved exactly. The only change is
  controller integration: patrol stops immediately, position is preserved, the
  existing animation has exclusive control, and patrol resumes correctly
  afterwards.
- **Waiting for user** — the dog stops and bounces to ask for attention:
  noticeable, not violent, no drift, no flashing, no colour change. It stops
  the moment the waiting state resolves.
- **Implementing** — the newly required animation. The dog rises onto its hind
  toes (a new `reaching` sprite pose in the same pixel language, same
  silhouette and colorway), stretches upward, and its raised front paws tap
  repeatedly at an implied vertical work surface. There is no new prop, no new
  visible wall, and no horizontal movement. The rise animates the body
  wrapper and the paw taps animate the artwork, so the two compose instead of
  fighting.

## Operational animations (reviewing · repairing · coding)

Three states are animated so the operator can read them without the label:

| Activity | Pose | Website motion | Loop | Reduced motion |
|---|---|---|---|---|
| `reviewing` | `sleeping` | slow breathing, a late ear/tail twitch, three staggered `z` marks drifting up and fading, a resting review page | 5.4s (4–7s band) | static curled pose, eyes shut, ONE still `z`, no breathing |
| `repairing` | `digging` | body drops and rocks, front paws alternate left/right, five small clods thrown back, a hole and a mound, a beat spent looking into the hole | 3.0s (2.5–5s band) | static forward-leaning pose held mid-dig, static mound and hole, no particles |
| `implementing` | `coding` | a compact editor whose code crossfades through four experience levels — basic → intermediate → advanced → architecture — then restarts | 12s (8–15s band) | one static composition (the intermediate level), no changing text |

All three are **decoration plus pose**. The scenery lives in
`RelayDogOperationalDecor`, is `aria-hidden`, has `pointer-events: none`, sits
inside an `overflow: hidden` container, and is rendered behind the dog so it can
never cover a mission control. The four code levels are rendered ONCE and
switched by CSS `opacity` keyframes — there is no timer, no React state, no
per-frame re-render and no DOM rewriting.

Each state also plays one short (≤0.42s) enter beat as its class arrives, so
coding → reviewing → repairing → coding reads as one continuous dog rather than
a hard cut. The beats are fast on purpose: the current state must be
recognisable immediately.

**Truth boundary.** These animations receive the state; they never decide it. No
operational state renders a check marker, and none of their accessible sentences
name an outcome — "under review" is not "reviewed", "digging into" is not
"repaired", "writing" is not "complete".

## Reduced motion

`prefers-reduced-motion: reduce` is honoured from the system (watched at
runtime, with a guarded `matchMedia` read for environments that lack it) and
from an explicit prop. Under reduced motion the patrol loop never starts,
the jump and the scratch stop, the implementing pose is held statically, and a
compact status label carries the meaning instead. The dog is never hidden and
no state meaning is lost.

## Mobile and Demo Simulation

The same component, the same controller, the same CSS on every surface —
entry home, workspace, live terminal, console, and Demo Simulation. There is
no Demo-specific dog, no second controller for fixtures, and no separate
desktop/mobile loop. Demo Simulation drives the existing state adapter and
renders the shared dog; its sequencing and timing are untouched. On narrow
screens the measured track simply shrinks, and patrol disables itself rather
than overflowing.

## Why motion creates no trace events

A trace event is a claim about what the system did. Where the dog is standing
is not something the system did — it is decoration over state that is already
recorded properly elsewhere. Writing patrol positions into the ledger would
add noise to an append-only, hash-chained record whose value depends on
everything in it mattering.

## Extension boundary

Future PSP-customized Relay Dogs (per-product sprites, colorways, or extra
poses) would extend `PixelDogPose` and the behavior projection. **That
customization is not implemented in this milestone** — this milestone ships
one dog, the approved artwork, and the motion system above.
