# The Relay Stage

**Status: IMPLEMENTED. ONE ACTOR ON IT. TWO BACKDROPS, SELECTABLE FROM THE
WORKSPACE AND LISTED BY `relay project stage`. NOTHING SELECTED UNTIL SOMEONE
SELECTS IT. THE CHOICE SURVIVES A RELOAD IN THE BROWSER THAT MADE IT, AND
NOWHERE ELSE.**

Those are five different claims and this file keeps them apart. The last one
carries the honest limits: the preference is stored per BROWSER, so it does not
cross to another one and no account syncs it; `relay project stage` cannot read
it at all and reports `Unknown` rather than guessing `None`; and where the
browser denies storage — private mode, or over quota — the session runs in
memory and nothing reports the failed write.

This header said "THE CHOICE DOES NOT SURVIVE A RELOAD" for three commits after
it began surviving one. It under-claimed rather than over-claimed, which is the
gentler direction and still the same defect: a reader who trusts the summary —
which the sentence above invites — was told the feature this document goes on to
describe had not shipped.

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

**One actor: the Relay Dog** — and it is now DERIVED rather than declared.

The cast was a frozen one-row constant. A constant cannot be wrong, but it also
cannot be right: it said the same thing whether the coding agent was
implementing or the project had only just been configured.

`projectWorkspaceCast` (`src/relay/shared/relay-stage-cast.ts`) places an actor
for every role that **belongs on the stage** and that this build can draw.

The field is `onStage`, not `working`, and two failed attempts are why. A literal
`working: true` was a constant input replacing a constant cast. Deriving
`dogState !== 'wandering'` was worse in a quieter way: `verified_complete` maps
to `complete`, so it claimed the coding agent was working *after the mission
finished*, and `architect_working` maps to `trotting`, so it claimed the coding
agent was working when *the architect* was — while deleting the Dog entirely
from an idle workspace.

**The Dog's presence is not conditional.** It is this product's avatar and owns
an idle animation: `wandering` is a state to show, not a reason to hide. It is
drawn whenever the workspace is, INCLUDING BEFORE THE FIRST MISSION —
`configured-state.ts` builds this screen for a configured project and fabricates
an "Awaiting first mission" record. Its STATE, not its presence, says what is
happening. (An earlier draft justified this with "the screen exists only for a
project with a mission", which that file refutes.)

The other two roles have no idle presence, so for them the question really is
"is it running" — and it is answered by an **exhaustive `Record` over each
status union**, not a chain of comparisons. Three commits running read a status
NAME as activity and got it wrong: `verified_complete` for the coder,
`dogState !== 'wandering'`, then `preparing_handoff` for the architect — which
the bridge assigns *after* that role's ledger reads `complete`. It is the
architect FINISHED, not finishing. The `Record` caught a ninth reviewer state
(`sign_in_required`) the moment it was written, and it fails the build when a
state is added rather than silently defaulting a role off the stage.

### Two questions, kept apart

*Is this role working?* and *can this build draw it?* are different questions,
and collapsing them produces the two opposite lies. Drop an undrawable working
role and the stage under-reports the team. Place one and the stage announces an
actor it renders as an empty box, while the overflow warning counts a sprite
nobody can see — which is exactly what the Stage says it refuses to do.

So a role with no sprite is **named** in `workingWithoutSprite`, and the
workspace RENDERS that name beneath the stage: *"Working, with no sprite on this
stage yet: Reviewer."* Review caught the first version computing it, unit-testing
it, documenting it as shipped, and showing it to nobody — which left a working
reviewer indistinguishable from no reviewer, the exact thing the field was added
to prevent.

The two empty-stage messages are wired through to `RelayStage` and **neither is
reachable anywhere in this build.** The workspace always places the Dog, and the
CLI always passes exactly one actor — and `StageViewInput` has no `emptyReason`
field at all, so even handed an empty cast it would print `layoutStage`'s own
default. They exist for a host that places no Dog, and there is not one. Saying
"reachable via the CLI" was the second wrong version of this paragraph; the first
claimed a founder sees them today.

**Relay runs three roles in production.** `relay-bridge/mission.ts` is a
three-role orchestrator — Prompt Architect → Coding Agent → Reviewer — and it is
what the website calls. An earlier draft of this section claimed the bridge
"drives one role"; that is true only of the **Loop** path
(`loop-routes.ts` reports `multiRoleSupported: false`), and lifting it out of
that scope stated something the production orchestrator contradicts.

The real reason only one actor is drawn is narrower and checkable: **the Relay
Dog is the only role with a sprite, a state model and a render branch.**
`relay-architect` and `relay-reviewer` exist as ids and as nothing else.

### Fixed slots, so a departure leaves a gap

Each role stands in the same place whenever it stands at all. Spacing actors by
how many are on stage meant a reviewer finishing slid the coding agent a quarter
of the stage sideways — motion nothing in the product performed, which is what
the Dog's motion system exists to refuse. The coding agent's slot is `0.5`,
exactly where the constant put it, so the shipped stage does not move.

### Why no cub and no Leopard

The contract sizes a Leopard at 2 dog-units and a cub at 0.6, and the projection
declares neither. A cub is a subordinate or temporarily-expanded agent —
**Unchain is the feature that would create one**, and `UNCHAIN.md` records that
its meter, session lifecycle and Rechaining execution are all unimplemented, so
no cub can exist to be drawn. Giving the architect a cub sprite because a cub
sprite was available would assign a meaning nothing produced: the same defect as
a panel rendering a run it never fetched, in artwork instead of data.

The three roles this product does have are **peers** — one dog-unit each, one
depth, one layer — because nothing makes one subordinate to another. The slots
stay open; the sizes are already agreed.

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

## The choice is remembered

`RelayPreviewApp` supplies `onSelectStageBackdrop` and stores the answer on
`RelayAppData.stageBackdrop`, beside the colorway — the same store, the same
localStorage envelope, the same commit path. It is **scenery in the store as
well as on the stage**: it gates nothing, enters no mission record, and
choosing one commits nothing else, which is asserted rather than asserted-of.

Two things a stored preference has to survive, both tested:

- **A payload written before this field existed.** The structural check does
  NOT require `stageBackdrop`, because requiring it would fail the check and
  recover to empty — discarding a user's real projects to recover a piece of
  scenery. Absent means no scene, which is exactly what those builds showed.
- **A backdrop this build does not have**, from a newer or forked build. It
  normalizes to None on load rather than to `jungle`, the rule
  `resolveBackdrop` already held: substituting a different scene would be the
  surface deciding something the user did not.

`null` means NO CHOICE HAS BEEN RECORDED — never picked, or what was stored is
not a scene this build has. Choosing "None" stores the string `'none'`, which is
a real catalog id. The two draw the same thing and are not the same fact.

ONE SOURCE OF TRUTH AT A TIME. When a host passes `onSelectStageBackdrop` it
owns the value, and the workspace's local state stands down. Reading
`localBackdrop ?? stageBackdrop` unconditionally was harmless while no host
stored anything and became a second source the moment one did — the local one
winning permanently, so a host could never move the scene again. Worse, a
handler that stored NOTHING still got the scene drawn, which is announcing an
intention as a fact. Without a handler the local state remains, and the picker
stays operable exactly as before.

THE CLI SAYS `Unknown`, NOT `None`. This preference lives in one browser's
storage and `relay project stage` has no reader for it. Printing `None` asserted
that no scene was selected, when the true statement is that this surface cannot
see the selection — a founder who picked Jungle on the website was told `None`
in the terminal. The two surfaces still read one projection; what differs is
that only one of them has the input, and it now says so.

## Not implemented

Parallax content for the `far` layer · SPRITES FOR THE ARCHITECT AND THE
REVIEWER: both roles genuinely work in production, the projection names them
when they do, and neither has artwork, a state model or a render branch — so
the stage reports them rather than drawing them · the Leopard, cubs, vehicle and
transformation sprites · any cinematic sequence · carrying the choice
BETWEEN browsers (it is a local preference, stored per browser, and no account
syncs it) · carrying it to the CLI, which reports `Unknown` rather than
guessing · remembering it AT ALL where the browser denies storage — private
mode, or over quota — in which case the session runs in memory and nothing
reports the failed write, exactly as for the colorway.

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
shape, the capacity, who is on the stage and what the scenes are — calling
`layoutStage` and `projectBackdropChoices`, the SAME functions the website calls.

WHICH SCENE IS SELECTED IS THE ONE IT CANNOT ANSWER, and it says so rather than
guessing. That question needs an INPUT, not a projection, and the input lives in
one browser's local storage. Both surfaces still compute from one projection;
only one of them is handed the preference.

Which is why the projection does not live under `ui/`. `relay-ui-boundary`
forbids any non-UI module importing the website tree, and the first version of
the CLI surface broke it: the rule is that the UI CONSUMES the domain and never
supplies it. `relay-stage-layout.ts` and `relay-stage-backdrop.ts` are in
`src/relay/shared/`, where both surfaces may reach them, and are declared as
`sharedDomainReferences` rather than as website entry points. A terminal cannot draw the stage; it can answer
every question the stage answers THAT IT HAS AN INPUT FOR, and `stage.test.ts`
asserts the two surfaces read one projection and so cannot disagree about
anything they both compute. Where the CLI has no input it reports `Unknown` — in
the header, in the choice list, and in `--json` — because a surface that
answered `None` there would be disagreeing with the website by inventing the
one fact it was never given.
