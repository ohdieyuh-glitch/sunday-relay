# The Relay Stage

**Status: IMPLEMENTED. ONE ACTOR ON IT. TWO BACKDROPS, SELECTABLE FROM THE
WORKSPACE AND LISTED BY `relay project stage`. NONE SELECTED BY DEFAULT. THE
CHOICE DOES NOT SURVIVE A RELOAD.**

Those are five different claims and this file keeps them apart. The last one is
the honest limit: the picker reports a selection and nothing stores it yet.

---

## What it replaces, measured rather than remembered

The Relay Dog lived in a band. Measured in `main` at `390660d`:

| Element | Where | What it did | Now |
|---|---|---|---|
| `.rpw-dogzone` | `relay-project-workspace.css` | a flex row that centred the dog | **removed** |
| `.rdm` | `relay-dog-motion.css` | `width: 100%`, `overflow-x: hidden` — the band | **clip removed**, still the motion boundary |
| `.rdo` | `relay-dog-motion.css` | `position: absolute`, fixed `128px × 90px`, `overflow: hidden` | **unchanged, and correctly so** |

Two of those three were replaced. `.rdo` was not, because it is not what it
looked like: it is a decor overlay that is a SIBLING of the dog, sized to the
sprite, and its clip exists to keep dig-clods and sleep-marks on the dog rather
than flung across the panel. It never clipped the dog. Removing it would not
free an actor; it would scatter particles.

`.rdm` is the one that mattered, and the reason is a CSS rule rather than a
layout choice: **`overflow-x: hidden` cannot leave the other axis visible** —
`overflow-y` computes to `auto`. So a declaration written to stop patrol travel
scrolling the page was also cutting the dog VERTICALLY. That is why there was no
room for a jump. The containment it provided now lives on `.rpw-stage-bounds` as
`overflow-x: clip`, which does leave `overflow-y: visible` intact.

`stage-real-actor.test.tsx` mounts the shipped dog on the stage, walks the real
ancestor chain, and fails if any element between the two matches a clipping
selector in either stylesheet.

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
A test asserts the stylesheet declares no framing property on `.rst` — matched
as a property pattern, so `background-color`, `border-top` and `outline` are
caught too, not only the four exact spellings someone thought of first.

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

Footprint and TRACK are separate: `width` is how much room an actor occupies,
`track` is how much of the stage it may move across. The Relay Dog is one dog
unit wide and patrols the whole stage. This is not a nicety — `.rst-actor` is
absolutely positioned, so with no width it shrink-to-fits, `.rdm { width: 100% }`
resolves to the sprite's own width, and the patrol engine measures a track below
its 24px minimum and stops patrolling with nothing failing anywhere.

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
  rendering one. The workspace does the observing, in `use-viewport-width.ts`;
  it previously passed a hardcoded 1440, so the projection knew a narrow
  viewport should get a taller stage and was never told one existed.

Reduced motion suppresses parallax and effects. The **layout is identical** — a
user who asked for less motion does not get a different scene.

## Who is on it today

**One actor: the Relay Dog.** The honest reason is that it is the only agent
this surface has artwork and a state model for. The Leopard, the cubs and the
vehicles have slots in the contract and no sprites yet, and a stage that drew
them from nothing would be inventing a cast — the same defect as a panel
rendering a run it never fetched.

A second actor arrives by adding a row to `RELAY_WORKSPACE_CAST`.

## The two scenes

Both are drawn entirely in **CSS and inline SVG**. No image, no external asset,
no font — a request that can 404 is a scene that sometimes is not there, and a
test asserts the stylesheet contains no `url(`, no `@import` and no `http`.

**Jungle.** Three canopy depths, undergrowth along the ground line so an actor
stands *in* the scene rather than in front of a picture of one, and one drifting
light shaft. Depth is carried by colour and height rather than blur, so the
silhouette stays crisp beside a pixel-art actor.

**Space Station.** The window is the point: a void with two star layers at
different sizes, and a planet limb with a **terminator** — the lit edge and the
shadow are one gradient, which is what makes a sphere read as a sphere instead
of a flat disc. The interior ribs and deck sit *in front of* the void, not
instead of it. That is what "visible outer space" means here: you are looking
through a window, not at a painted wall.

Both are `aria-hidden`, take no pointer events, and carry **no product
meaning**. A user choosing the Space Station has not put Relay in space.

### An unknown id resolves to NONE, never to a substitute

A stored preference naming a scene this build does not have is a fact about an
older build, not an instruction to show something else. Since `jungle` is first
in the catalog, a naive fallback would land there — so `resolveBackdrop` returns
`none` for anything it does not recognise, and a test asserts exactly that.

### The picker is mounted

`RelayProjectWorkspace` renders it, so both scenes are reachable in the shipped
website — asserted by `workspace-stage.test.tsx`, which clicks each radio and
checks the scene that appears. An exported component that nothing renders is not
a shipped capability, and the parity reachability walk cannot tell the
difference because it follows import edges rather than renders.

Selection is local to the screen. A host that wants it remembered passes
`onSelectStageBackdrop` and stores it; without one the scene still changes and
simply does not survive a reload.

### The picker says what is true

A radio group rather than a dropdown, because "None" is a choice and a hidden
option is one most people never learn they have. Each scene describes what it
**is**. A scene that animates says so — and says that reduced motion will still
it **only when that user's setting is actually on**. Without a handler the
picker draws no input at all: a control that cannot act is not drawn, the same
rule the run panel and the MCP settings surface hold.

## Not implemented

Parallax content for the `far` layer · the Leopard, cubs, vehicle and
transformation sprites · any cinematic sequence · **persistence of the backdrop
choice** (the picker reports a selection and changes the scene; no shipped host
stores it, so a reload returns to None).

Two things are asserted where the decision lives rather than in a browser,
because jsdom computes no cascade and reports `clientWidth === 0`: that `.rst`
declares no framing property, and that nothing between the stage and the dog
clips. Both are read from the stylesheets. Neither has been confirmed against a
real rendering engine.

Backgrounds came after the stage on purpose. A scene painted into a 90px clipped
band would have to be redrawn the moment the band went away.

## Parity

The Stage is **not a capability of its own** — it is where an existing one is
presented. Its files are declared under `relay-dog-state-semantics`, whose
parity class is `semantic_visual_required` and which is tested on both surfaces.
Registering the Stage separately would have required a founder-approved
`surface_specific` exception, and inventing one to make a checker pass is the
kind of thing this repository's parity gate exists to catch.

That argument is only honest if the CLI genuinely has an equivalent, so it was
given one. `relay project stage` (`src/relay/cli/product/stage.ts`) reports the
shape, the capacity, who is on the stage, which scene is selected and what the
other choices are — calling `layoutStage` and `projectBackdropChoices`, the SAME
functions the website calls. A terminal cannot draw the stage; it can answer
every question the stage answers, and `stage.test.ts` asserts the two surfaces
read one projection and so cannot disagree.
