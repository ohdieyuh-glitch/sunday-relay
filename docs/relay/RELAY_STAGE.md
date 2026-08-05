# The Relay Stage

**Status: IMPLEMENTED. ONE ACTOR ON IT. NO BACKDROP YET.**

Those are three different claims and this file keeps them apart.

---

## What it replaces, measured rather than remembered

The Relay Dog lived in a band. Measured in `main` at `390660d`:

| Element | Where | What it did |
|---|---|---|
| `.rpw-dogzone` | `relay-project-workspace.css` | a flex row that centred the dog |
| `.rdm` | `relay-dog-motion.css` | `width: 100%`, `overflow-x: hidden` — the band |
| `.rdo` | `relay-dog-motion.css` | `position: absolute`, **fixed `128px × 90px`**, `overflow: hidden` — the scenery box |

Ninety pixels of usable height **at every viewport**, one occupant, and anything
that left `128 × 90` was cut. There was no vertical room for a jump, no depth
axis, and nowhere to put a second actor. It read as a rectangle because it was
one.

## What the Stage is

A **frameless region that owns space and layers.** Nothing else.

It does not own animation. `RelayDogMotionBoundary` already owns patrol, facing
and the activity animation, is proven by four test files, and keeps that job.
The Stage decides where an actor stands and how much room it has; what the actor
does inside that room is the actor's business.

### Frameless means frameless

No border, no background panel, no radius, no shadow, and no `overflow: hidden`
around the cast. The stage is a region of the page, not a widget on it. Depth
comes from layered content and from the backdrop, never from a container edge.
A test asserts the stylesheet declares none of those four properties on `.rst`,
because "frameless" is a requirement rather than a preference.

### Six layers, and only one of them clips

```
backdrop    the selectable scene — CLIPS, so a scene never bleeds past the stage
far         parallax scenery belonging to that scene
ground      the surface actors stand on
actors      the Dog, a wider Leopard, cubs, vehicles — DOES NOT CLIP
effects     dust, sparks, exhaust, transformation flashes — DOES NOT CLIP
foreground  occluders that pass in front
```

An actor mid-jump or mid-transformation must not be cut by the thing that exists
to give it room — which is exactly what the old box did.

Only `actors` receives pointer events. Scenery and effects must never swallow a
click meant for a control.

### Actors are placed, not positioned

```ts
{ id, x, depth, width, layer }
```

`x` is 0–1 across the stage. `depth` is 0 (far) to 1 (near). `width` is in **dog
units** — the Relay Dog is 1, a wider Leopard 2, a cub 0.6, a vehicle whatever
it is.

**Depth scales and lifts together**, because they are one fact about distance. A
surface that applied only the scale would put a small dog floating in mid-air,
which is how a flat stage betrays that it has no depth model. At `depth: 0` an
actor stands at the horizon; at `depth: 1` it stands on the ground line. Nearer
actors paint later, so a cub in front of the Leopard is in front of it.

### Size

An aspect with a floor, never a fixed height:

| Viewport | Aspect | Floor |
|---|---|---|
| ≥ 640px | 16 : 5 | 14rem |
| < 640px | 4 : 3 | 11rem |

A narrow viewport gets a **taller** stage rather than a squeezed one. At the
floor alone the stage is 176px — already twice the old band, before the aspect
adds any more.

## What it refuses to do

- **Invent an actor.** An empty cast renders an empty stage that says why. It
  does not helpfully draw a Dog so the space looks used.
- **Hide an overflow.** `stageCapacity()` answers in dog units that actually
  fit. A cast that exceeds it is reported — two sprites drawn on top of each
  other is a surface lying about how much is there.
- **Animate on its own clock.** Movement is driven by state something else
  observed.
- **Measure anything.** The host passes the viewport width it observed. That is
  what makes a stage with a Leopard, three cubs and a vehicle testable without
  rendering one.

Reduced motion suppresses parallax and effects. The **layout is identical** — a
user who asked for less motion does not get a different scene.

## Who is on it today

**One actor: the Relay Dog.** The honest reason is that it is the only agent
this surface has artwork and a state model for. The Leopard, the cubs and the
vehicles have slots in the contract and no sprites yet, and a stage that drew
them from nothing would be inventing a cast — the same defect as a panel
rendering a run it never fetched.

A second actor arrives by adding a row to `RELAY_WORKSPACE_CAST`.

## Not implemented

The **Jungle** backdrop · the **Space Station** backdrop with visible outer
space · backdrop selection · parallax content for the `far` layer · the Leopard,
cubs, vehicle and transformation sprites · any cinematic sequence.

Backgrounds come after the stage on purpose. A scene painted into a 90px clipped
band would have to be redrawn the moment the band went away.

## Parity

The Stage is **not a capability of its own** — it is where an existing one is
presented. Its files are declared under `relay-dog-state-semantics`, whose
parity class is `semantic_visual_required` and which is tested on both surfaces.
Registering the Stage separately would have required a founder-approved
`surface_specific` exception, and inventing one to make a checker pass is the
kind of thing this repository's parity gate exists to catch.
