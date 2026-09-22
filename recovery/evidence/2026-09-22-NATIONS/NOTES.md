# NC01 / TR01: the other two nations stop being empty

## The measurement that set the priority

`world_coverage.py`, run before any of this was built:

| region | cells | empty | instances |
|---|---|---|---|
| NEUTRAL (Golden Arrival) | 80 | 1 (1.2%) | 126,008 |
| ICARUS | 294 | 200 (68.0%) | 2,903 |
| NOCTIS | 263 | 188 (71.5%) | 2,286 |
| TARTARUS | 263 | 189 (71.9%) | 2,408 |

## They were unbuildable, not merely unbuilt

`CANON/nations.json` listed `materials_existing: []` for both Noctis and Tartarus. A nation with no materials can
only be built by tinting at placement time — which is the precise trap `make_nation_materials.py` exists to avoid,
because the moment a tint lives in a placement pass, every later pass has to remember it. Ten instances were built
first, each copying a source's already-earned tuning and overriding only what makes it the nation's own.

**The founder's two warnings are in the material values, not in a mood.**

- *"Cinematic and elegant. NOT gloomy generic evil architecture."* → Noctis's obsidian is **polished**: roughness
  0.17, specular 0.78. It catches light and reads as black glass rather than as a hole cut in the world. The
  nation also ships a luminous accent, because the canon says "luminous details" and something has to be bright.
- *"Engineering-focused. NOT demonic generic evil architecture."* → Tartarus's ember is a **forge glow at the base
  of working buildings** (2300 in scene units), never a fire in the sky, and its metal is worked bronze at
  metallic 0.86 rather than anything molten.

## What each nation says in architecture, never in a label

**NOCTIS — content creation.** An approach lit down both sides, because Noctis is the nation you arrive at in the
evening and its road should say that before any building does. A screening court walled with the kit's great dark
glass screens, where work is shown. An amphitheatre of curved colonnade closing a half-round space left EMPTY in
the middle — performance needs a room made of people, so the architecture makes the room and then stops. The
obsidian hall. Gallery walks of long arcades: covered walls to hang work on. Broadcast towers whose crowns carry
the only material in the nation allowed to be bright.

**TARTARUS — software and application creation.** A foundry approach. Assembly yards of market canopies and corner
storefronts in ranks, the most-repeated building in the nation because that is where work happens. Proving halls
facing each other across the road, since an application is finished when it has been tested and not when it has
been written. The forge, with ember lanterns around its base. Engine towers joined at height.

## Built in a local frame and rotated

Neither sector is axis-aligned — Noctis runs out at bearing 210, Tartarus at −30. Both quarters are laid out in
(u along the nation's axis, v across it) and rotated into the world. That is what let the second nation reuse the
first one's shape in an afternoon rather than a day, and it is the reason Tartarus exists at all today.

Placement is verified rather than assumed: `nations.zone_at` reports the Noctis quarter centre at
(−62977, −36360) → NOCTIS/heartland, and Tartarus at (62977, −36360) → TARTARUS/heartland.

## Every IC02 lesson applied rather than rediscovered

Plates tiled exactly on the grid so bands meet and no lawn shows through; floors banded by use; towers stacked on
the kit's own sockets with a raise on a mismatched join; plinth base courses derived from footprints recorded as
buildings are placed; `veg_anchor` panels skipped because they render as bright green slabs; kerb RUNS rather than
kerb stones, because the run carries its own gutter course.

## Judged, and two faults fixed

**Both quarters rendered with their floors STRIPED WITH LAWN.** The paving plate is 1440 along its own X and 740
along its Y. In a rotated quarter the local frame turns with the nation's bearing, so at yaw 0 the plate's long
side ran ALONG the axis while the grid spaced columns 1440 apart ACROSS it — a 700 mm gap between every pair of
columns, the whole quarter striped green. IC02 never showed this because Icarus is axis-aligned and the same
numbers happen to be right there. Turning each plate 90 degrees puts its long side where the column spacing
actually is. This is the kind of fault only a render finds: the generator's numbers were self-consistent, every
band was contiguous in local coordinates, and no check that avoided looking at the world would have caught it.

**Tartarus rendered fire-engine red**, not the deep crimson masonry the canon asks for — and a saturated bright
red is exactly the reading the founder's "NOT demonic generic evil architecture" warning is about. Taken deeper
and less saturated, with the roofs darker still so the silhouette reads black-red rather than uniformly bright.

Retuning it cost an editor. `make_nation_materials.py` with `FORCE=True` deletes the instance and rebuilds it,
which is harmless while a nation's materials are new and nothing references them — and deadlocked the game thread
once 1,641 placed instances were drawing `MI_V2_TartarusCrimson`. The frame counter stopped at 750 while the audio
thread kept logging, so the process looked alive and responsive for eight minutes with its tick frozen. Tuning a
colour is not a reason to destroy an asset: `Tools/editor_jobs/tune_nation_material.py` sets parameters on the
instance that is already there, keeps every reference intact, and records the prior values for an exact revert.

## State

Saved. `WL_V2_GoldenArrival_WP2.umap` was rewritten with 331 nation pass actors across the three nations and
nothing left dirty.

Both quarters were judged the way IC02 was: captured, looked at, and fixed where they were wrong. The first
attempt at judging them was lost when the editor hung during a PIE walk and had to be restarted.

## A tool lesson worth keeping

`walk_route.py` hung the editor. The PIE walk ran for over half an hour, the heartbeat froze at 10:27, the log
stopped growing and the process stopped responding; it had to be killed. Nothing durable was lost, because the
passes regenerate from JSON and the material and collision changes had already been saved to their assets — but
long routes through a dense world are a real risk to the session, and the walks that have been useful were short.
Short routes over the specific junction being tested, not grand tours.
