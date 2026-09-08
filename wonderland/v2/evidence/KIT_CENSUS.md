# The forge kit against the 33-camera census

`framescape_BEFORE.txt` and `framescape_AFTER.txt` are the raw runs. This is
what happened between them, because the interesting part is the four cycles
where a pass measured as **zero** and the reason each time was an instrument,
not the placements.

| | placements | mean built | cameras moved | one piece holds a third | frames over half green |
|---|---|---|---|---|---|
| before | 13,816 | 67.78% | — | 10 | 9 |
| after | 15,170 | **75.38%** | 25 of 33 | 9 | 4 |

The founder's reference, classified from its own pixels, is built **71.5%**.

## The four times a pass measured zero

**1. The census could not see the kit.** `skyline.bboxes()` built its table by
running every `assets_v2` recipe, so a forge mesh had no bounding box and was
invisible to every instrument that reads one. Seven 60 m towers changed the
census by nothing. Fixed at the root: `build_assets.py` now measures a
`profile_uu` per mesh into the manifest and `skyline._kit_bboxes()` reads it.

**2. The towers were 131 degrees off axis.** `framescape` computes a bearing as
`atan2(dx, dy) - (yaw - 90)`, so forward is `(-cos yaw, sin yaw)` — not
`(cos yaw, sin yaw)`, which is right only for the two cameras whose yaw is 90
or 270. `kit_layout.forward()` carries the derivation now.

**3. The frames targeted had no headroom.** `census` clips elevation to the
frame's top edge and awards a column on a strict `>`, so a frame already
reading `+29.4` cannot be moved by anything taller. Only frames whose median
top is *below* their own edge can be filled; `HEADROOM_FRAMES` is that list.

**4. `tops_at` ignored pitch.** The census reports elevations relative to a
camera's own axis. Written without the pitch term, the helper read WorldCam12
— which looks 16 degrees down — a full 16 degrees high, and every window
matched against it was that far out. The two cameras whose pitch is 0 hid it.
`HEADROOM_FRAMES` no longer carries typed windows for the same reason: they are
derived from the median and the frame edge.

## What the last pass attacked, and what it could not

The world's mismatch #4 is *ten frames have ONE piece holding a third of the
ceiling*. Measured per column, those ten split in two:

- **six are edge-pinned** — the incumbent already reads the frame's top edge,
  so no piece placed can ever take the column. `TeapotCam24`'s gatehouse tops
  at `+50.0` against an edge of `+33.8`; `WorldNorthCam19`'s spire at `+63.2`
  against `+31.5`. Adding towers to those frames costs a pass and changes the
  census by zero. `kit_layout.EDGE_PINNED` records all six with their numbers.
- **four have real room**, and two of those are held by *vegetation* — the
  district's own fungus and an avenue cone out-topping their architecture,
  which is mismatch #2 as well. Those are what `_ceiling_break` answers.
  `ClockQuarterCam13` fell off the list: its mushroom went 35% → 26%.

Of the other two, `ClockGrandCam23` and `GateArchCam30` are held by the SAME
swag standing 15 m from two cameras 1.7 m apart. Out-topping a foreground piece
at 1,535 uu from behind needs `(h - 170) > 0.70 · r`; at any distance a stand
may legally occupy that is a 400 m tower. **The swag has to move or shrink, and
it is the world stream's asset, not the kit's.** It still went 71% → 61%,
because the depth stands took columns beside it.

## The fifth and sixth zeros: an angle measured as a distance, twice

Both are the same confusion in different clothes, and both cost stands that
fitted.

**The bearing step.** It is derived from the ground two stands need between
them -- 2,600 uu at 11 km is 13 degrees. On an arc 11 degrees wide that tries
exactly ONE bearing, and one blocked bearing reads as "no clear ground" for the
whole arc. It refused the founder's reference frame.

**The separation test.** Same number, same error: two stands 2,600 uu apart on
the ground are 15 degrees apart at 10 km, so a stand on one arc of a frame
silently refused every spot on the arc 13 degrees away. What a frame cares
about is how far apart two towers LOOK; what the ground cares about is that
they do not intersect, and that is a much smaller number. Separation is now
`MIN_SEP_DEG` in the frame plus 1,400 uu on the ground.

Together: `HeroCam_V2_MarbleReference` 57.5% -> 61.7%, `TeaTerraceCam16` 82.5%
-> 95.8%, `ClockGrandCam23` to 100%, mean built 73.61% -> 74.82%.

## The founder's reference frame, in detail

It is built **61.7%** against the 71.5% of the image it reproduces, and it is
the most valuable number in this file: every other camera is judged against a
reading, this one against a picture. Its ceiling, per column:

| columns | holder | elevation | distance | room to the frame edge |
|---|---|---|---|---|
| 26 | `GiantMushroom_Spots` | +33.8 | 34.8 m | **0.0 — pinned** |
| 13 | `ClockTree_Canopy1` | +29.1 | 29.7 m | +4.7 |
| 8 | `ClockTree_Canopy0` | +29.1 | 29.7 m | +4.7 |
| 1 | `Approach_Canopy2` | +18.3 | 63.9 m | +15.6 |

**More than half its green is one giant mushroom at 35 m, reaching above the
top of the picture.** No placement can move it — see the strict `>` above. Both
`ClockTree` arcs now carry a stand. The rest of the gap is the mushroom's, and
the mushroom is the world stream's asset: this is world mismatch #2 (a
district's fungus out-topping its architecture) standing on the one frame with
a ground truth.

## Three batches that measured nothing, kept anyway, and labelled

`castle_precinct` puts three walled precincts -- curtain runs, mural towers,
corner bastions, a postern gate, a colonnade and a ceremonial arch, weathered
at the far end of each run -- on ground `tools/emptiness.py` found empty, at
the distance the world's mismatch #3 calls its thinnest.

Measured against that ring afterwards, it did nothing:

| ring | p50 top | built% |
|---|---|---|
| 180-360 m | +0.4 -> +0.5 | 65.0% -> 65.3% |

and the 33-camera census is unchanged to the decimal. 631 pieces into a ring
holding 67,608 cannot move a percentile, and a 40 m precinct at 300 m reads at
+8 degrees against frame edges of +29.

**It is kept, and relabelled.** Five families had ZERO presence in the world --
`walls`, `thresholds`, `civic`, `variants` (all nine weathered modules) and
most of `civic` -- and three audited-empty regions had no built edge. That is a
coverage gap in a castle world, and it is a different thing from a silhouette
defect.

`garden_levels` is the same shape: three terraced gardens, each a held edge
with a flight up it, in the two districts whose ground is the densest in the
world and whose structure was nothing but planting. Mean built 74.82% before
and after, to the decimal -- ground structure 3 to 6 m tall cannot hold a
column in a frame roofed at +29 degrees, and was never going to.

Seven of the eight stair modules had never been placed. The forge's own rule is
that stairs to a flat plane are stairs to nowhere, so neither batch places a
flight anywhere it has not first built the edge for it to climb: `top_route` on
a retaining run is 310 uu, which is exactly the `top_route` of a T2 flight and
the `landing` of the half-turn.

`street_fabric` is the third: three lanes with laid ground -- a verge between
kerbs, a runnel down the fall, tree grates, broad steps at the level change --
and houses of three roof types facing them. Mean built 74.82% before and after,
to the decimal, for the same reason: a house is 10 to 13 m under a frame roofed
at +29 degrees.

**It is the batch that mattered most for coverage, because five of its modules
CANNOT BE PLACED ALONE.** `Roof_Dormer`, `Roof_Chimney`, `House_Shopfront`,
`Detail_Oriel_Bay` and `Detail_Balcony_Bracket` publish a `back` socket and no
`bottom`: the manifest is saying they are carried by a facade. Until this batch
there was no facade in Wonderland carrying one. Every mount height is the
host's own published socket -- the gabled house's `eaves` at 610 uu, the
hipped's at 915 -- so the dormer and the chimney sit where the house says, and
the chimney tops out at 1,351 against a 1,257 house because a stack rises above
its ridge.

Modules placed went 42 of 101 to **77 of 101**.

### THE COVERAGE BATCHES ARE A DIFFERENT KIND OF WORK, and mixing the two is
how a placement pass fools itself. Seven batches answer a measured census
number and are judged by whether it moved. Three answer "this module has never
been in the world" and are judged by coverage; all three moved the census by
zero and each says so in its own docstring. **A batch that produces no number
is not automatically waste, and a batch that claims a number it did not produce
is worse than one that admits none.**

The reason this is written down rather than quietly dropped: a batch that
produces no number is not automatically waste, and a batch that claims a number
it did not produce is worse than one that admits none.

## The other half of mismatch #4, which needed a new instrument

`framescape` asks "what holds THIS frame" thirty-three times. The world
handoff's complaint is different -- "the same great spire or the same swag
roofing frame after frame" -- and that defect lives ACROSS frames, where every
per-frame number for it can be small. `tools/monotony.py` asks it directly, and
groups pieces by the SITE they stand on rather than by parsing their labels
(`GreatSpire_Body`, `GreatSpire_TowerCap2` and `GreatSpire_WayTree4_1_Canopy0`
share a prefix and are a tower, its cap, and a tree beside it).

    site                        frames  columns  pinned   holds 20%+ of
    GreatSpire_Body                 14      323     71%   WorldNorth19 58%,
                                                          GreatSpire22 46%,
                                                          FloatingStair26 30%,
                                                          GiantBloom29 27%
    DistrictTower_RoyalGardens       8       73     53%   -
    KitDepth05_4                     7      112     76%   RearWorld10 35%

**Exactly one site holds a fifth or more of three or more frames, and it is the
great spire.** 71% of its columns are pinned to their frames' top edges, so no
placement can moderate it: it is a 194 m landmark and how far it reaches is a
siting decision, not a layout one.

A landmark roofing many frames is not automatically a defect -- being seen from
everywhere is what a landmark is for. `evidence/monotony_AFTER.txt` is the run.

**And the kit is now on that list.** `KitDepth05_4` holds 35% of
`RearWorldCam10` and 20% of `MushroomGroveCam14`; three more kit stands roof
five or six frames each. They are each a different spelling, so they are not
the same OBJECT frame after frame -- but a future pass adding more depth stands
should run this tool first, because the batch that fixed monotony is two frames
away from causing it.

## The camera-clearance rule, wrong three times

Worth the space because each version was wrong in a different, instructive way,
and the last one is calibrated against the world rather than chosen.

**1. A flat 2,600 uu.** It cannot tell a 3 m retaining wall from a 63 m tower.
It refused the ground the Tea Terraces are named for and waved through any
tower that cleared the same circle.

**2. Height-aware, at 45 degrees.** `clearance_for(h)` is the distance at which
a piece's own height subtends `MAX_LOOM_DEG`. Better — but applied to all
thirty-three cameras regardless of where they point, it required 61 m of
clearance from every lens in the world and left `_ceiling_break` with nowhere
at all to stand. Most of what it refused was **behind** a camera.

**3. Height-aware AND bearing-aware.** A camera looking away cannot have
anything loom in it, which is the same test `framescape.census` applies before
it counts anything. `looms()` checks the fov first (plus a 12-degree margin,
because a camera can be re-aimed and a placement is forever) and the distance
second.

### AND IT COST 2.5 POINTS OF CENSUS, WHICH IS THE HONEST PRICE

An earlier version of this file reported mean built **74.82%**. That number was
inflated and this one is not. The flat rule had let `green_ceiling` put 63 m
towers on ground like this:

| ground | camera | distance | bearing | half-fov | its top reads |
|---|---|---|---|---|---|
| (6007, -14615) | GroveRoadCam18 | **27.8 m** | +23.9 | 45 | **+65.7** |
| (5590, -16337) | GroveRoadCam18 | **26.7 m** | -14.0 | 45 | **+66.5** |
| (931, -5388) | ScaleCam07 | 53.2 m | -10.1 | 45 | +49.1 |

Three towers standing in a camera's face, dead in shot, filling two-thirds of
its vertical field. They scored well because the census counts a held column
whether or not the thing holding it is a wall in front of the lens.

So the corrected figures, all against a `BEFORE` of 67.78%:

| | before | with the flat rule | calibrated | calibrated + ladder |
|---|---|---|---|---|
| mean built | 67.78% | 74.82% (inflated) | 72.33% | **75.38%** |
| frames over half green | 9 | 5 | 6 | **4** |
| one piece holding a third | 10 | 9 | 10 | **9** |
| frames below the reference | 16 | 14 | 14 | **13** |

The last column is the one to read. **The honest rule plus a better search
beats the wrong rule on every measure** — because the rule never made those
frames unfixable, it only made the tallest spelling the wrong tool for them.
See "Recovering the ground honestly" below.

**Is 45 degrees the right cap?** Measured, not chosen. Over the 45,924
piece/camera pairs the world's OWN placements make inside a frame:

| p50 | p90 | p99 | p99.9 | max |
|---|---|---|---|---|
| +2.2 | +8.6 | +22.5 | +43.2 | +76.2 |

A 45-degree cap refuses **38 of the world's own pieces, 0.08%**. The kit is
held to exactly the standard the world already keeps, and not a stricter one.

Two more things follow from it, both found by the screen firing:

- **A stack is one thing.** The rule refused a stand's CROWN and kept its base,
  leaving a decapitated tower — worse than either answer alone. `kit_v2.stack`
  now marks a spelling's rungs with a shared `unit` and the screen drops them
  together.
- **What looms is the top, not the module.** A 12 m sky bridge slung 30 m up
  reaches 42 m. Asking the module for its height alone would have let it stand
  10 m from a lens on the strength of being a small module.

## Recovering the ground honestly: search the ladder, not the top of it

The calibrated clearance rule cost census because it shrank the ground a 63 m
tower may stand on. It does not shrink the ground a **48 m** tower may stand
on, and elevation is a ratio: a 48 m tower at 8 km reaches what a 63 m one
reaches at 10.5 km, and needs 4,660 uu of camera clearance instead of 6,150.

`spots_on_bearing` asked only the tallest spelling and threw away every spot
where a shorter one fits — which, once the clearance rule was right, was the
majority of them. It now walks the whole ladder, tallest first, and takes the
first height that fits.

**And the height is part of the spot.** Both a spot's elevation in the frame
and its camera clearance were computed for one specific spelling, so handing it
a taller one afterwards invalidates both. The first version of the ladder
search did exactly that — rotating blindly through the spelling table — and the
screen refused 25 stands chosen for a 48 m tower and given a 63 m one.
`_spelling_of()` now picks a chain that really is the validated height.

    ceiling_break   42 (flat rule) -> 14 (calibrated) -> 41 (ladder)
    green_ceiling  136             -> 95             -> 139
    mean built      74.82% (bad)   -> 72.33%         -> 75.38%

Both above where the flat rule had them, on ground that survives the rule --
and the census above where the wrong rule ever got it. `ClockQuarterCam13`,
the worst frame in the suite when this branch started at 18.3% built, is
**75.0%**.

## Not proven

No frame here has been rendered. These are silhouette censuses computed from
`layout_v2.ALL` and the measured bounding boxes — the same arithmetic the
engine would use to place the actors, run without one.
`wonderland/art/unreal/import-plan.json` still reads
`imported_into_an_editor: false`.
