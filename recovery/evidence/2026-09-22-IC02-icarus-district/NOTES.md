# IC02: the Icarus first district, and what the walk found underneath it

## Why here, and not another polish of the core

`world_coverage.py` is new: it lays a 100 m grid over the whole 3 km map and counts every instance in every cell,
then names each cell's nation. The answer was not close.

| region | cells | empty cells | instances | architecture |
|---|---|---|---|---|
| NEUTRAL (Golden Arrival) | 80 | **1** (1.2%) | 126,008 | 30,055 |
| ICARUS | 294 | **200** (68.0%) | 2,903 | 1,653 |
| NOCTIS | 263 | 188 (71.5%) | 2,286 | 1,398 |
| TARTARUS | 263 | 189 (71.9%) | 2,408 | 1,471 |

The core is finished and the three nations are empty. The ceremonial gate built by IC01 opened onto nothing. That
is the largest single gap in Wonderland, so that is where the work went.

## What was built

2,432 instances in 114 batches plus 21 tagged anchors, all `WL_NATION_ICARUS` / `WL_DISTRICT_ICARUS_FIRST`:

- **Arrival court** — the march's paving widens past the gate, colonnaded both sides, closed by a ceremonial arch.
- **Simulation dome** — the grand glass dome on the axis, the largest glass volume in the nation.
- **Two great halls** — palace wings flanking it, a matched pair: design and build.
- **Studio rows** — 60 terraced houses, gabled/hipped/jettied alternating, with shopfronts, broken by side streets
  every seventh house so a row reads as a terrace and not a wall.
- **Proving court** — a wide flagged court ringed by balustrade and pinnacles and deliberately left EMPTY.
- **Tower cluster** — 8 towers assembled from the kit's own socket chain, joined at height by sky bridges.

**Towers are stacked by their sockets, not by eye.** `kit_modules.json` gives every module a bottom and top socket
with a kind and a rung (ground → tower/XL → L → M → crown). `stack()` walks that chain and raises if a join does
not match, so a crown cannot end up floating over a gap. That is what makes "readable construction logic" checkable
rather than a hope.

## Three faults found by looking, and fixed

1. **Buildings stood on a golf course.** The first cut paved only the avenue and courts; the halls, studio rows and
   towers sat on open lawn. Now the district floor is tiled exactly — every band a whole number of 14.4 m plates
   measured out from the axis, so bands meet instead of leaving green stripes — and it is BANDED by use: a warm
   carriageway, cream civic courts, cooler shade across the studio blocks.
2. **The sky bridges were an aqueduct.** They ran at a flat 26 m between tower centres, crossing open air and
   passing through the shafts where they met one. Now the deck height is the lowest shared JOINT of the two towers
   a bridge joins — a height where both towers actually have a floor — the span is inset by the shaft radius so a
   bridge starts and stops at masonry, and any pair more than 80 m apart is dropped.
3. **`veg_anchor` rendered as green slabs.** The kit ships a flat panel on planters and verges marking where
   planting belongs. Given a leaf material it draws as a bright green rectangle, visible down both verges. The
   anchor is an instruction, not geometry: it is skipped and real topiary is placed at those runs instead.

## Architectural detail, derived from real footprints

Every building records its footprint as it is placed, so detail cannot drift from the architecture it belongs to:
**768 plinth blocks** as base courses (the cheapest thing that makes a building read as built rather than dropped),
arched windows and wall lanterns on the great halls' long flanks, verge runs with tree grates and trees down the
avenue, and drain channels where the courts shed water.

## Performance: not measurably more expensive

`perf_remove_ab` destroyed the 135 pass actors in the PIE copy and measured the same three cameras with and without,
twice:

| camera | with | without | with | without |
|---|---|---|---|---|
| IcPerfOver | 35.72 | 39.10 | 37.54 | 32.08 |
| IcPerfCourt | 36.92 | 39.41 | 35.51 | 34.92 |
| IcPerfTowers | 75.29 | 80.12 | 58.95 | 71.21 |

The district is FASTER than its absence in four of six comparisons, which is not a claim that it speeds the world
up — it is the honest reading that **2,432 instances are below the noise floor here**. The same camera with nothing
changed measured 33.33 and 41.47 in two passes of the same run, so noise is about ±8 ms and the pass is somewhere
inside it. Everything is instanced, shares the nation's four material instances, and carries cull distances.

## What the walk found, which no screenshot would have

Driving the Relay Dog from the march through the gate and up the district: **six of eight legs stuck.** The two it
reached — the arrival court and the proving court — it reached standing at z=101, on the new paving. The leg into
the gate stuck at z=75: the world slab, 26 cm below the pavement.

That sent the investigation under the surface, where `collision_geometry.py` (new) measured all 252 meshes actually
placed in this map:

- 134 meshes `CTF_USE_COMPLEX_AS_SIMPLE` — collision is the render mesh, so arches keep their holes;
- 118 meshes `CTF_USE_DEFAULT`, of which most carry convex hulls and **19 carried no collision geometry at all**.

Those 19 are fixed to complex-as-simple by `fix_mesh_collision.py`, reversibly: no new asset, no extra memory, and
an arch keeps its passage, which a fitted box never would. My first reading of this audit was wrong and is worth
recording — I read "118 USE_DEFAULT" as "118 meshes cannot collide", and most of them collide perfectly well.

The larger cause was simpler: **45 batches holding 1,405 instances were still set not to collide**, including
ground the march itself is paved with. BR01 turned collision on for 687 batches; these had drifted or were never in
that sweep. They are on now.

## Still open

- 861 "other" batches (lanterns, banners, urns) still do not collide, unchanged since BR01.
- Editor-world line traces do NOT see instanced-batch collision — `spawn_audit` reported the world slab under every
  district point while PIE had the Dog standing on paving 115 cm higher. PIE is the authority for traversal, and
  the trace-based probe should not be trusted for batches.
