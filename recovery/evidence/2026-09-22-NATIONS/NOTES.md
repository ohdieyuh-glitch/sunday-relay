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

## Honest state

**NC01 and TR01 are generated and placed, not yet judged.** Their captures were queued when the editor hung during
a PIE walk and had to be restarted, so no render of either has been looked at. They are committed as generators
and specs. They get the same treatment IC02 got — capture, look, fix what is wrong, or reject.

## A tool lesson worth keeping

`walk_route.py` hung the editor. The PIE walk ran for over half an hour, the heartbeat froze at 10:27, the log
stopped growing and the process stopped responding; it had to be killed. Nothing durable was lost, because the
passes regenerate from JSON and the material and collision changes had already been saved to their assets — but
long routes through a dense world are a real risk to the session, and the walks that have been useful were short.
Short routes over the specific junction being tested, not grand tours.
