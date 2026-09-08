# Wonderland — world state, current

**This file is the recovery point.** `/resume` history disappears; the
repository must be enough. Update it before ending any significant world
session.

| | |
|---|---|
| SESSION | 2026-09-06/07 — world / Unreal stream, Signal Cycle #1 Task 4, then the reference-fidelity crunch |
| CHECKOUT | `/home/thomasajvt13/dev/sunday-relay` (git worktree; the primary checkout is `sunday-relay-main`, detached at `b2dc9f2`, and is the Julius/platform stream) |
| BRANCH | `relay/wonderland-v2` |
| SHA AT START | `d9245bf` |
| SHA AT END | `385c1ff` (pushed). `git log --oneline -12` walks PASS 30-38: 993385e, e3952ae, 9655bad, 200aeff, 9086b78, 09b5349, 28c4d30, 0250fa2, 6738435, b43de04, f67a9f0, b2f0d54, 385c1ff. |
| LOCK | `wonderland/.gauntlet-lock` = `writer=claude step=0 since=2026-08-25`. Unchanged. `gauntlet-check.py` clean on every commit. |
| MAP | `/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2` (classic container) |
| RENDERED THIS SESSION | **Nothing.** No engine, no Studio, no GPU frame. Every number below is offline, measured off `layout_v2.ALL` and the built meshkit geometry. |
| AMENDED 2026-09-08 | by the kit stream on `claude/wonderland-blender-forge-pjinco` at `7842b9e3` — additive only. See "The forge kit is in the world". Still no engine, no GPU frame. |

---

## How to recover the world state from scratch

1. `cd /home/thomasajvt13/dev/sunday-relay` — this is the world worktree.
2. Read `wonderland/v2/RESUME.md` (PASS 08 → PASS 28) and the tail of
   `wonderland/v2/WORLD_LEDGER.md` (PASS 29 →). Then this file.
3. Read `wonderland/.gauntlet-lock` **before writing anything**. If it names
   `aura`, stop.
4. The world is a Python description. `import layout_v2` takes ~22 s and
   yields `ALL` (13,686 placements). Nothing needs Unreal to audit.

---

## The instruments

Six now. Each was written after making the same mistake twice.

| tool | question | run |
|---|---|---|
| `v2/tools/gap_v2.py` | does a frame read as the reference? | needs a GPU render |
| `v2/tools/camera_framing.py` | where does a camera's picture of the ground begin? | offline |
| `v2/tools/walkable.py --window=world` | can the Dog get there? | offline, ~3 min |
| `v2/tools/emptiness.py --scaled` | is there ground with nothing on it? | offline |
| `v2/tools/hierarchy.py` | does density fall outward; is anything nested? | offline |
| **`v2/tools/region.py`** *(new, 2026-09-06)* | **can you stand somewhere and have nothing to walk to?** | offline, ~3 min |

Also `skyline.py` (heights, off the built mesh), `occlusion.py` (what a camera
sees), `plan_view.py`, `route.py` (the walkable tour, ~6 min).

### Why region.py exists

On 2026-09-06 all four of the older audits **passed** on a world containing
three neighbouring quarters made entirely of plants:

```
emptiness --scaled        304 m2 empty in the whole world
walkable --window=world   0 of 60 quarters unreachable, 0 of 30 stops
hierarchy                 GROUND core:far 10.05x, 0 nested, 0 stray roads
camera_framing            every camera's near band accounted for
```

Every one of them was right. **A place can be full of actors, reachable,
correctly sparse for its own tier, and still be nothing to arrive at.**
`region.py` measures three distances over the whole accessible world — to a
built silhouette ≥ 25 m, to any architecture at all, to a road — and calls
ground FORSAKEN where all three are past the world's own 90th percentile.

Two traps it had to be built around, both already in this project's ledger:

- **BUILT, not tall.** Its first version's worst region had "81 m of
  silhouette" in it and the 81 m was a hot-air balloon, with four tree
  canopies behind it. Vegetation and balloons are excluded.
- **A self-calibrating bar cannot compare two worlds.** Repairing a region
  pulls the whole distribution in and the bar tightens with it, so an
  untouched region reads as having grown. `--bar built,arch,road` pins it.
  **Quote the pinned number for a change; the recomputed one for "where is
  the world worst now".**

---

## What this session did

### 1. The instrument (`1c0576d`)

`v2/tools/region.py`. 79 of 3,936 ground cells forsaken; 84% of them one
region.

### 2. A classifier repair (`d7879e1`) — bigger than the region fix

`hierarchy.py`'s `ARCH` tuple carried a note about this exact failure, added
when the signature skyline would otherwise have "registered as zero
architecture". PASS 29 then authored a whole architectural vocabulary and
**none of it was added**: `floating_stair` 124.6 m, `key_colossal` 84.0,
`clock_grand` 54.4, `glass_pavilion` 54.0, `teapot_pavilion` 48.2,
`gear_monument` 31.0, `gatehouse_district` 28.4, `orrery_gold` 26.4,
`glass_screen` 23.9, `lantern_strange` 21.8, `cloister_square` 20.2,
`tower_clock` 11.9, `arch_stone`, `column_ornate`, `bridge_arc`,
`stairs_broad` — every one classed `prop`, beside the garden benches.
`flower_colossal` was worse: `VEG` matches `"flower_"`, so the Royal Gardens'
district landmark was **vegetation**.

`LANDMARK` gained the eight district landmark kinds, and `LANDMARK_RIDERS`
removes the glazing/gills that prefix-matching had been counting as separate
landmarks — every giant mushroom in Wonderland was counted four times.

On the unchanged world: **383 landmarks → 401**; wayfinding distance from a
road to the nearest landmark median 20 → 18 m, p90 43 → 32, worst 83 → 58;
arch per hectare at 175–200 m 21.1 → 36.7.

**Every arch/ha figure in WORLD_LEDGER.md written before this commit
under-reports.** Numbers below are all on the repaired classifier.

### 3. The worst region, and the fix (`5a73259`)

**BEFORE — South Meadows, 6,800 m², r 334 m, bearing 291°, centre (120, −312) m**

- 83% of all forsaken ground in Wonderland
- at its worst **105 m from ANY architecture**, **128 m from anything 25 m
  tall**, **109 m from a road** (world medians 10 / 33 / 20 m)
- extent x 35..205 m, y −355..−255 m
- the three quarters around it: `D02_grove` 14 placements, `D11_meadow` 28,
  `D18_meadow` 23 — **all 65 of them vegetation**, arch 0, prop 0
- root cause, not bad luck: `_DISTRICT_SEEDS` gives South Meadows the palette
  `("meadow", "wood", "meadow")`, which contains no built kind. Its one
  authored landmark stands at 260 m; its ground runs to 358 m; the last road
  on that bearing stopped at 259 m.

**THE FIX — the South Reach** (`layout_v2._south_reach`, band `SOUTH_REACH`,
128 placements). Not density: filling 6,800 m² with props would move the
number and make the world worse. What the region never had was a reason.

| | |
|---|---|
| THE SOUTH WAY | 84 m of road out of the ring circuit, in two legs, waymarked in the district's own glass |
| THE SOUTH GATE | a `gatehouse_district` astride it, dressed the way `_depth_build` dresses a gate |
| THE SOUTH RING | a 45 m arch on the approach axis inside a circle of eight 20.8 m arches; amber and rose glass screens between alternate pairs. The only thing in Wonderland made of nothing but arches, and you walk through all of it |
| THE LAST COLONNADE | 19 columns on an arc at 346 m, 12 m apart, so the world's southern edge is a made line rather than a fade |
| TWO THRESHOLDS | one each for `D11_meadow` and `D18_meadow` |

Sited at **the audit's own reported centre**, which is this file's existing
habit — `_QUARTER_SITES` says its coordinates are "the audit's own reported
centres … the difference between filling a world and filling the part of it
somebody happened to look at".

**AFTER — both worlds scored by the BEFORE world's own bar** (built > 70 m,
arch > 37 m, road > 63 m):

| | before | after |
|---|---|---|
| forsaken ground | 8,200 m² in 4 regions | **1,300 m² in 3** |
| the South Meadows region | 6,800 m² | **gone** |
| worst region | South Meadows 6,800 m² | Far Orchards 900 m² |

On each world's own recomputed bar the whole distribution moved:

| | before | after |
|---|---|---|
| to any architecture, p90 / max | 37 / 105 m | **30 / 85 m** |
| to a built silhouette ≥ 25 m, p90 | 70 m | **65 m** |
| to a road, p90 | 63 m | **59 m** |

Per quarter, one ruler:

| | before | after |
|---|---|---|
| `D11_meadow` | 28 pieces, arch 0, prop 0, 26.6/ha | 32, **arch 1, prop 4**, 39.1/ha |
| `D18_meadow` | 23 pieces, arch 0, prop 0, 19.2/ha | 28, **arch 1, prop 4**, 23.4/ha |
| `D02_grove` | 14 pieces, arch 0 | **unchanged — still all vegetation** |

### Regressions checked, all clean

- `route.py` — **identical tour**: 196 legs over 12 stops, 2,323 m, both
  before and after (obstacle field 9,752 → 9,829 placements)
- `walkable.py --window=world` — 0 of 30 stops, 0 of 60 quarters closed;
  flood 76% of sampled ground both sides
- `verify_v2_layout.py` — PASS; step height 0 violations over 914 surfaces;
  33 camera standpoints clear
- `verify_v2_dryrun.py` — PASS, 0 failures, 0 errors
- `hierarchy.py` — no new nested quarter; 0 roads crossing a quarter they do
  not serve; the two embedded landmarks are pre-existing
  (`Country039_Tower` / `_TowerSpire` inside `GreatSpire_Hall3`)
- `camera_framing.py` — no camera's band changed; only the two aerial world
  cameras' counts moved (WorldCam11 in 3661→3656, WorldCam12 under 155→150)
- `emptiness.py --scaled` — 304 m² both sides (unchanged, as expected: the
  scaled tolerance was never what caught this)
- `emptiness.py --radius=900` — the 17,712 m² south region is gone from the
  table; world total 59,712 → 51,376 m²

---

## PASS 31 — the reference is a city behind a garden (`e3952ae`, `9655bad`)

The brief changed mid-session from "fix the worst region" to **maximum visual
fidelity to the founder's reference images**. From here the authority is
`wonderland/v2/reference/marble-royal-garden-cam0-founder-reference.png`, and
the audits are guardrails rather than goals.

**The one honest reference pair.** Only HeroCam0 has real pixels on both
sides: the founder reference above against
`reference/renders/V2_MILESTONE26_HeroCam0_1080p.png`. Every other camera has
a render but no reference. Colour and tone claims in this file come from
classifying those two images; geometry claims come from `layout_v2.ALL`. The
offline mass model (`tools/frame.py`) is only good for same-model before and
after — its own docstring records that it over-fills so badly 411 new towers
moved nothing.

`e3952ae` — a far city at 360–580 m under a +15° ceiling solved from the
measured stack; a bearing bias in `_horizon` that was inverted (multiplying
the pick made ridges *commoner*); a cloud retune; two audit leaks closed
(`hierarchy` was counting 495 backdrop towers as landmarks, `region` had no
radius filter); and `tools/frame.py`.

`9655bad` — gold at four depths in the left garden, an airborne-prop fix, and
the far city stopping standing inside itself.

| | before | after |
|---|---|---|
| far-city pieces | 566 | **289** |
| arc held above +6° | 78.0% | **79.2%** |
| median far-city top | +13.4° | **+13.0°** |
| embedded landmarks | 191 | **6** |

277 of 566 pieces were pure interpenetration — draw calls producing no
silhouette. Cluster centres are 2,600 uu apart while a cluster scatters
members to 2,800, so adjacent clusters fully interleaved.

**The airborne-prop fix is older than this pass and worth knowing about.**
`solid_boxes` gave a ground footprint to 27 placements that hang in the air
(20 clock faces up trees, 3 urns on columns, the floating teapot and its
cups), so *every traversal audit this world has ever run* was walling off
ground under things you can walk beneath. Anything above 400 uu no longer
blocks.

---

## PASS 32 — a tree was standing in front of the city (`200aeff`)

One question asked of the reference: **what owns the top of the frame?** In
the reference it is a warm, dense, continuous city between two dark trees.
Measured per degree across HeroCam0's 100° arc, ours was vegetation 69.8% /
built 30.2%.

`Garden_L_Tree_Canopy0` — one crown at 28 m — owned the ceiling from +11.8°
to +46°, and the city stood at +19° to +28° in those same columns, present
and hidden. PASS 28 had already found these crowns (the eight largest
presences in the frame) and made them *blossom* rather than move them: that
fixed their colour and left them a roof.

The reference's foliage is **asymmetric** — its left margin carries foliage
only from about +50° to +36°, its right is one huge dark tree from −16° to
−50°. Ours was the mirror: heavy left, light right. `ClockTree` already runs
−29° to −50° and was left alone; the left group moved out as one rigid piece
by `_GLT_DX, _GLT_DY = 900, 200` uu.

The same profile found the two lowest ceilings in the whole frame — City1 and
City2, the two smallest clusters of the founder-approved focal plane, exactly
where the reference's spire field is densest.

| | before | via `scale` | via `spire` |
|---|---|---|---|
| ceiling at −15..−11° | +16.8 | +22.9 | **+24.5** |
| ceiling at +11..+15° | +19.1 | +26.3 | **+26.6** |
| route legs / length | 190 / 2,306 m | 377 / 4,878 m | **190 / 2,306 m** |

**Read that middle column.** Lifting the two clusters by `scale` closed the
notches and *doubled the walking tour*, because scaling a cluster grows its
hall, arcade, bays, dome, bridge and every tower offset — two palaces at
100 m had grown across ground the world walks through. The gap being measured
was elevation, so `_castle_group` gained `spire`: tower bodies scale
`(s, s, s * spire)`, caps and finials ride up at their own scale, no
footprint changes. It closed the notches *further* and cost the walk nothing.
**If you need a silhouette taller, reach for `spire`, never `scale`.**

Result: topmost silhouette owner **built 30.2% → 43.8%**, vegetation
69.8% → 56.2%.

---

## PASS 33 — the reference's city is taller than its trees

The premise of PASS 32 was checked against the reference **image itself**
rather than against an impression, by classifying the top-most non-sky pixel
of every column:

| ceiling owner | reference | our PASS 26 render | offline model |
|---|---|---|---|
| built | **71.5%** | 33.0% | 30.2% |
| vegetation | 28.5% | 67.0% | 69.8% |

Two things fall out. First, **the offline silhouette model tracks the real
render within three points**, which is the first time anything here has been
cross-checked against pixels — use it with more confidence than `frame.py`.
Second, the reference's trees are *enormous* and still own only 28.5% of its
ceiling, because the spire field behind them out-tops them. The target was
never "less green".

At −43..−23 and +23..+29 the tallest built thing was a **district tower**
losing to a canopy by 0.4° to 4.3°. `tower_district` is the mid-distance
landmark rung, 4,130 uu at scale 1.06–1.35. `_DT_LIFT = 1.25` stretches the
whole rung vertically — footprint untouched, same lesson as `spire`.

Applied to the **rung, uniformly**, not to the two towers standing in
HeroCam0's flanks. Tuning individual pieces to win named columns of one
benchmark frame is how a world comes to look right from exactly one place,
which is what the 33-camera suite exists to prevent.

Ceiling owner: **built 43.8% → 55.8%**, vegetation 56.2% → 44.2%. Every gate
byte-identical: route 190 legs / 2,306 m, walkable 0 of 30 and 0 of 60,
region 1,800 m², hierarchy 302 landmarks, wayfinding worst 64 m.

### What PASS 33 found and deliberately did NOT do

The remaining losses were sorted against the reference rather than swept up:

- **−45..−49 and +43..+49** — the frame's extreme margins. The reference's
  own trees own these. **Correct as-is; leave them.**
- **−33..−25** — `Tower_R0/R1` at 51–76 m lose by 5.6–8.7°, but the
  reference's right tree covers −16° to −50°, so vegetation owning this is
  faithful. **Leave.**
- **+31..+41** — the one genuine hole. The reference has dense spires there;
  our city at those bearings tops at only +14.4°. A siting probe over the
  wedge (26–46°, 120–300 m) found **no free ground**: every candidate centre
  falls inside an existing quarter, with the nearest placement 97–693 uu
  away. What stands there is the **Royal Gardens landmark, `S17_garden`,
  `S16_meadow` and a ring road** — a coherent *garden* district, not empty
  ground. Dropping a city cluster on it would overwrite a district's identity
  and its road tree to win six columns of one frame. **This is a district
  palette decision for a considered pass, not a quick fix.**

Two near-misses were also left alone on purpose: `SkyGold0` at +37..+39 loses
by 1.5° and `GiantMushroom_Vine1` at +43..+49 by 1.9°. Both would flip by
nudging a floating prop upward, and that is benchmark-gaming, not world-building.

---

## PASS 34-38 — the world measured from all thirty-three cameras

**Everything before PASS 34 was measured at HeroCam0.** The suite exists so
the world is judged as a world; `tools/framescape.py` is the instrument that
finally asks it. Two modes:

- **census** — walk each camera's arc in columns, report who holds the top of
  each: built, vegetation, or open sky. The founder's reference, classified
  from its own pixels, is **built 71.5% / veg 28.5% / sky 0%**.
- **`--crowd`** — intersect each nearby piece's angular box with the frame's
  and report the fraction of frame AREA one piece takes.

### The headline

| | PASS 33 | PASS 38 |
|---|---|---|
| mean built share of the ceiling, 33 cameras | **56.6%** | **67.8%** |
| frames more than half roofed by vegetation | 11 | **9** |
| pieces taking >14% of a frame from inside 40 m | 44 | see below |
| route | 190 legs / 2,306 m | **179 legs / 2,123 m** |

The reference is 71.5%. The world went from 56.6 to 67.8 and the walking tour
got *shorter*.

### PASS 34 (`0250fa2`) — the instrument, and a regression of mine

`verify_v2_layout`'s camera-standpoint check asks whether a piece reaches INTO
a lens; all 33 pass. It is the wrong question by a few metres. PASS 31 sited
the gold screens against HeroCam0 and nothing else, and `GoldScreen0`'s run
passed **2.0 m from GardenLeft04's lens**, `GoldScreen0_Leaf1` taking 55% of
that frame. No gate could see it. `_GS_LENS = 900` uu; the screen moved 12 m
along its own perpendicular — which is also further frame-left, where the
reference's gold lives.

**The crowd measure was wrong twice before it was right** and both errors are
in the tool's docstring, because both turned a real defect into a fake one:
first clamping a piece's angular width to the fov (calling a tree 73° off-axis
"90 degrees wide"), then filtering on elevation above +40° when a 90° fov at
16:9 has a **vertical** field of 58°, so the frame's top edge is +29 and
everything that filter kept was above the picture. The census had the same
hole; it is closed. I acted on neither wrong number.

### PASS 35 (`6738435`) — fourteen landmarks hidden by their own avenues

`_lm_setting` gave every district landmark an approach dressed with
`_tree_group` copses 21 m either side — and the district cameras stand back
along that same approach. Measured per district, the avenue **out-topped its
own landmark**: WaterGardenCam15 −19.9°, ClockQuarterCam13 −10.2°,
GroveRoadCam18 −7.3° (CloisterCam31 +30.9° was the control).

The cause is a shape. `canopy_large` is 8.4 m across with an aspect of 0.46;
`column_ornate` is 5.13 and `topiary_cone_plain` 1.29. All fourteen approaches
are now columnar processional ways.

Two wrong turns, both caught: the copses were first *kept* and moved "to the
far station" — station 6 is the end nearest the **origin**, so I moved
fourteen copses toward the cameras. And the offset was solved against both
audits rather than picked: at 16 m the composition is best by 0.2 points and
the tour is **430 m longer**; at 27 m the frames are the same and the tour is
shorter than baseline.

### PASS 36 (`b43de04`) — the flank cameras found a walk nobody had built

The founder's camera siting scored 91 stations by clearance and put **both**
flank cameras at |x| = 4350, in the middle of a 35 m planted band. `framescape`
found those the most vegetation-roofed frames in the world. Two instruments
pointing at the same 14 m of ground: there is a lane there, and nothing was
built on it.

`_flank_walks` lays 62 m of paving down each flank with plinthed urns,
cypresses and a column every fourth station. Kerbs are 380 uu, not 620 — at
620 the inner kerb closed a 67-cell pocket and `walkable` lost "R lane
y=4500".

Note also that "batch B" had already recomposed this band once, pushing the
tall mass past |x| 4200 — measured on SkylineCam06 alone, which is exactly
where the flank cameras live. **That is the third time this session a fix
measured at one camera moved the problem to another.**

### PASS 37 (`f67a9f0`) — the rear avenue

`TeaTerraceCam16` is locked at (−1579, −4603) and `Avenue_TreeR1` stood at
(−1500, −4400): **2.2 m apart**. The camera was not beside the avenue, it was
in the tree row — 12.5% built, the worst frame in the world. The tree lines
moved out to ±23 m, and the line they vacate became a colonnade: seven
stations a side of `column_ornate` with gold finials and lanterns, running
from the gate down to the two towers at (±2600, −8200) that had been
terminating an avenue with nothing in it.

    TeaTerraceCam16   12.5% -> 50.0%      RearWorldCam10   45.8% -> 61.7%
    MushroomGrove14   30.8% -> 40.8%      ReverseCam03     39.2% -> 45.0%

### PASS 38 (`385c1ff`) — a frame edge is not a lid

`_cam_foreground` plants the two garden cameras' near field "low at the centre
and taller at the edges". The intent was right and the arithmetic never
checked the top of the frame: it stood a `canopy_medium` topping **10.7 m only
8.3 m from a 2.0 m eye**, when a 90° fov at 16:9 puts the picture's top edge at
+26.2° — 6.1 m of height at that distance. Everything above was outside the
frame; everything below was the frame. The piece meant to frame a corner was
roofing the shot.

Also the right garden's tree, the move PASS 32 made on the left one for
HeroCam0 and never made on its mirror. It had a cost worth naming first — from
HeroCam0 that tree sits at −43.8°, where the reference carries its heavy
foliage — so it was measured rather than assumed, and **HeroCam0 did not move
at all**, because `ClockTree` already holds that edge.

    GardenRight05   15.0% -> 29.2%      GardenLeft04   35.8% -> 40.0%

**Two frames were looked at and deliberately not changed.** `GroveRoadCam18`
is roofed by a giant mushroom cap over a grove road in the Mushroom Grove
district — that is the district's identity, and 71.5% is the number for a
frame looking at the city, not for every frame. `ClockQuarterCam13` is held by
`mushroom_landmark`, **1,743 uu tall at scale 1 against `tower_clock`'s
1,190** — a real finding about the recipe hierarchy, and a bigger question
than that pass should absorb.

---

## OFFLINE VERIFIED vs VISUALLY PROVEN

**Visually proven: nothing since PASS 26.** There is no engine, no Studio and
no GPU in this environment; `hero_shots.py` cannot run here. Passes 28, 29,
30, 31 and 32 are all unrendered.

**Offline verified** (every one of these was run and green at `200aeff`):

| gate | result |
|---|---|
| `verify_v2_layout` | PASS — 13,686 placements, 914 surfaces, 0 step violations, 33 camera standpoints clear |
| `verify_v2_dryrun` | PASS — 0 failures, 0 errors |
| `verify_v2_marble_paths` | PASS |
| `walkable --window=world` | 0 of 30 destinations, 0 of 60 quarters |
| `route` | 190 legs, 2,306 m |
| `region --bar=70,37,63` | 1,800 m² in 4 regions |
| `emptiness --scaled` | 3 regions over 3 cells, 6 in all |
| `hierarchy` | 302 walkable-world landmarks, 0 of 414 road segments without one |
| `camera_framing`, `occlusion` | PASS |

`verify_v2_textures` fails here for want of `/opt/wonderland/textures` — an
environment gap, not a world defect.

---

## The five largest remaining mismatches, measured

**1. LIGHT — the ground carries no cast shadow. Still the biggest, still
blocked.** Reference vs our PASS 26 render: dark share 42.9% vs 27.1%, median
luminance 81 vs **120**, p10 23 vs **43**, ground row dark 11.7/19.5/42.4% vs
**0.5/3.3/8.9%**. The cause is the shadowless fill budget in `v2_config.LOOK`
(`canopyFillLux` 9,000 + a second PASS 26 fill + `bounceLux` 2,400 +
`skyLightIntensity` 1.6 against a 60,000-lux key). **Not touched, deliberately**
— tuned across PASS 08/08b/08c/24/26 against real renders, with a founder
judgement in that history (the right side reading "excessively dark" is what
caused the hemisphere lift). It needs a render in the loop.

**2. A recipe-hierarchy defect: `mushroom_landmark` is 1,743 uu tall at scale
1 and `tower_clock` is 1,190.** A district's fungus out-tops its clock tower
before either is scaled, which is why `ClockQuarterCam13` is 18.3% built and
held by a mushroom at 33 m while its city stands at 171 m. This is the honest
version of "nine frames are still veg-roofed": three of those nine
(`GroveRoadCam18`, `MushroomGroveCam14`, and arguably `GardenRight05`) are
garden and grove cameras where green is correct, and the ones that are wrong
are wrong for this reason.

> **PARTLY ANSWERED** by the forge kit (branch
> `claude/wonderland-blender-forge-pjinco`). `ClockQuarterCam13` is now **80.0%**
> built, up from 18.3%, and its mushroom no longer holds a third of the ceiling — five spelled towers stand in the Clock Quarter and two more break the
> mushroom's own arc. **The recipe inversion itself is untouched and is still
> yours**: 1,743 vs 1,190 is a recipe question, and a kit tower standing beside
> a mushroom does not make the district's clock tower taller than its fungus.

**3. The 180–360 m band is the thinnest part of the world's silhouette** —
tops at +7.9° and +5.6°, against +14.0° nearer and +13.2° in the backdrop.

> **ANSWERED** (`f6e7bb9d`). Fifteen spelled towers of 54–63 m now stand at
> 9–12 km on the axes of the six frames whose median top was below their own
> edge. `depth_stand` is that batch; `kit_layout.HEADROOM_FRAMES` is the list
> and why each is on it.

**4. Nine frames have ONE piece holding a third of the ceiling** —
`ClockGrandCam23` 71%, `TeapotCam24` 68%, `WorldNorthCam19` 58%. Procedural
monotony: the same great spire or the same swag roofing frame after frame.

> **MEASURED PER COLUMN, AND IT SPLITS IN TWO** (`f6e7bb9d`). This is the most
> useful thing this stream can hand back, because it says which half is worth
> anyone's time.
>
> `framescape.census` clips every elevation to the frame's top edge
> (`el = min(el, hv)`) and awards a column on a **strict `>`**. So where the
> incumbent already reads the edge, **no piece placed anywhere can ever take
> that column** — not a taller one, not a nearer one. Six of the ten are pinned
> that way:
>
> | frame | holder | raw top | frame edge |
> |---|---|---|---|
> | `TeapotCam24` | `DPTeaTerraces_Gatehouse` 68% | +50.0 | +33.8 |
> | `WorldNorthCam19` | `GreatSpire_Body` 58% | +63.2 | +31.5 |
> | `GroveRoadCam18` | `Q03_grove_Giant_Cap` 57% | +51.9 | +29.4 |
> | `GreatSpireCam22` | `GreatSpire_Body` 47% | +33.5 | +33.8 |
> | `WaterGardenCam15` | `Rear_FrameR_SlimCanopy2` 43% | +34.7 | +29.4 |
> | `EastReachCam20` | `NorthWay8_VergeCanopy2_1` 40% | +55.7 | +30.2 |
>
> **Adding anything to those six costs a pass and changes the census by zero.**
> They move only if the incumbent moves or shrinks. `kit_layout.EDGE_PINNED`
> carries the table so nobody re-derives it.
>
> Of the four with real room, `ClockQuarterCam13` came off the list (35% → 25%).
> `ClockGrandCam23` went 71% → 61% and `GateArchCam30` 41% → 39%, but **both
> are held by the same swag standing 15 m from two cameras 1.7 m apart** —
> out-topping a foreground piece at 1,535 uu from behind needs
> `(h − 170) > 0.70·r`, which at any legal distance is a 400 m tower.
> `DPClockQuarter_Swag` has to move or shrink. **That is a world-stream asset,
> not a kit one.** Count now 9 of 33.

**5. HeroCam0 itself is 56.7% built against the reference's 71.5%** — now
*below* the suite mean, which it was above three passes ago. Its remaining
ceiling holders are `ClockTree_Canopy0` and the `ApproachSide` canopies.

> **60.0% as of `201e9e6b`, and this is now the most valuable number in the
> suite.** Every other camera is judged against a reading; this one is judged
> against a picture. It is still 11.5 points short. Its remaining green is
> `ClockTree_Canopy0` topping at +29.1 from 29.7 m, which needs a 63 m tower
> inside 10.9 km on two narrow bearings (−49.6..−43.8 and −36.2..−23.8), and
> the ground there is nearly all spoken for — one stand fitted, at 9,200 uu on
> bearing −36.2. **Closing the rest of that gap is the first job of the next
> pass.**

## The forge kit is in the world (a different branch — read this before merging)

**Branch `claude/wonderland-blender-forge-pjinco`, SHA `7842b9e3`.** Not on
`relay/wonderland-v2`. This section is additive: nothing the world stream wrote
above was changed except the five mismatches, which carry `>` blocks saying
what moved and what is still yours.

`wonderland/art/blender` had built 101 modules with measured sockets and a
manifest, and none of it was reachable from the world — Wonderland places by
KEY and a forge mesh had no key. It has one now.

| | |
|---|---|
| `layout_v2.ALL` | 13,816 → **15,390** |
| kit placements | **1,458** — **98 of 101** modules, in `V2_Arrival`, `V2_Castle`, `V2_Garden`, `V2_Props`, `V2_Skyline` |
| batches | `tea_terrace` 37, `water_court` 35, `depth_stand` 204, `clock_quarter` 43, `hamlet_street` 142, `ceiling_break` 42, `green_ceiling` 136, `castle_precinct` 108, `garden_levels` 117 |
| mean built across 33 cameras | 67.78% → **76.39%** (reference 71.5%) |
| cameras moved | 26 of 33 |
| frames more than half green | 9 → 4 |
| one piece holding a third | 10 → 9 |

Only three files outside `wonderland/v2/kit_*` changed: `assets_v2.py` (two
guarded hooks — `known_asset_keys` admits the kit, `build_assets` merges the
import), `layout_v2.py` (one `try` block appending the bands), and
`tools/skyline.py` (reads the kit's measured bounding boxes).

### Five times a placement pass measured as ZERO, and why

Each was an instrument, not the placements. Worth knowing before the next pass
spends itself the same way.

1. **`skyline.bboxes()` could not see the kit.** It built its table by running
   every `assets_v2` recipe, so a forge mesh had no bbox and was invisible to
   the census. Fixed at root: `build_assets.py` writes a measured `profile_uu`
   per mesh, `skyline._kit_bboxes()` reads it.
2. **Forward is `(−cos yaw, sin yaw)`, not `(cos yaw, sin yaw)`.**
   `framescape` computes a bearing as `atan2(dx, dy) − (yaw − 90)`. The obvious
   spelling is right only for the two cameras at yaw 90 and 270; seven towers
   stood 131° off the axis of the camera they were meant to fill.
3. **A frame at its own top edge cannot be moved by anything taller** — the
   strict `>` above. `HEADROOM_FRAMES` is the list of frames that can be.
4. **`tops_at` ignored pitch**, reading `WorldCam12` — which looks 16° down — a
   full 16° high. The two cameras whose pitch is 0 hid it. **`WorldCam12` turns
   out to be unreachable by any ground-standing tower:** it stands 62 m up
   looking down, so the tallest 63 m spelling tops out at +18.6 even at the
   clearance limit.
5. **A 13° bearing step samples an 11° arc once.** One blocked bearing then
   reads as "no clear ground" for the whole arc — and the arc it refused was
   the founder's reference frame.

### One rule of the world's that turned out to be the wrong shape

A flat camera clearance cannot tell a 3 m retaining wall from a 63 m tower. At
2,600 uu it refused the ground the Tea Terraces are named for while waving
through any tower that cleared the same circle. `kit_layout.clearance_for()`
is the distance at which a piece's **own height** subtends 45°, screened per
placement downstream of every batch — because a batch clears its CENTRE and
then lays a retaining run 2,400 uu either side of it, which is how the tea
terrace came to stand 2,272 uu from `TeapotCam24`. `verify_kit_bridge` caught
that by walking placements rather than decisions.

### Two batches that measured nothing, kept and labelled

`castle_precinct` puts three walled precincts on ground `emptiness.py` found
empty, at the distance mismatch #3 calls thinnest. Measured against that ring
afterwards: p50 top +0.4 → +0.5, built 65.0% → 65.3%, census unchanged to the
decimal. **631 pieces into a ring holding 67,608 cannot move a percentile.**
It is kept for the coverage it does answer — five kit families had zero
presence in the world — and its docstring now says that instead of claiming the
band. `garden_levels` is the same: three terraced gardens with a flight up each,
in the two districts whose ground is densest and whose structure was nothing but
planting; mean built 74.82% before and after, to the decimal. Ground structure
3–6 m tall cannot hold a column in a frame roofed at +29°. Recorded here so the
next pass does not re-derive either null result.

### What is NOT proven, stated plainly

**No mesh has been in an editor and no frame has been rendered.** There is no
Unreal Engine, no `unreal` module and no GPU in the container this was written
in. `wonderland/art/unreal/import-plan.json` still reads
`imported_into_an_editor: false`, and `assets_v2.build_assets` logs
`V2 KIT: no unreal module; 0 forge meshes imported` on every offline run — the
dry run's summary reads `assets=149/462` for exactly that reason, and that is
the honest number, not a bug. Everything above is arithmetic over
`layout_v2.ALL` and measured bounding boxes: the same arithmetic the engine
would use to place the actors, run without one.

The first thing a session with an editor should do is
`python3 wonderland/art/unreal/import_kit.py --plan`, then `--execute` inside
the editor, then re-run `verify_kit_bridge.py` — its `plan is honest` check
reads the `proven` block and will say what the editor actually claimed.

---

## The exact next pass

0. **From the kit stream** (`claude/wonderland-blender-forge-pjinco`): close
   `HeroCam_V2_MarbleReference`'s remaining 11.5 points — it is the only camera
   with a ground truth. Then `DPClockQuarter_Swag`, which holds two frames at
   61% and 39% from 15 m and cannot be beaten from behind. Do **not** spend a
   pass on the six edge-pinned frames; the table above says why.
1. **Get a render.** Ten passes now sit unrendered (28–37). Nothing in
   mismatch 1 can be judged without one, and the palette comparison that drove
   PASS 31–33 is only trustworthy with real pixels on both sides.
2. **PASS 38 = light**, with a render between every change. Reduce the
   shadowless fill budget until the ground row reaches roughly the reference's
   12/20/42%. One light at a time — this project has broken shade three times
   by moving two knobs at once.
3. Then mismatch 2 — the mushroom/clock-tower height inversion. Note this is
   a RECIPE question, not a placement one: check `mushroom_landmark` and
   `mushroom_giant` against `tower_clock` and `tower_district` before moving
   anything, because a district whose identity is fungus should still not
   out-top the architecture that names it.
4. **Run `framescape.py` before and after every composition change from now
   on.** Three separate fixes this session were measured at one camera and
   moved the problem to another; the census is the cheapest way to not do that
   a fourth time.

## Other open world problems

1. **`D02_grove` is still 14 placements and all of them vegetation.** It was
   outside the repaired region (129 m from its centre) and was deliberately
   left alone rather than swept in.
2. **Three district palettes contain no built kind** (`South Meadows`,
   `The Long Woods`, `West Wood`). South Meadows now has authored
   architecture on top of its palette; the other two do not. Changing
   `_DISTRICT_SEEDS` would regenerate those districts and is a bigger,
   riskier move than authoring a reach — worth a decision, not a reflex.
3. **A landmark's approach spur is not a road.** `_lm_setting` labels its
   paving `_Spur%d`, and every audit here counts a road by `_Seg` in the
   label. Fourteen district landmarks are therefore approached by something
   no audit calls a road. Not wrong on the ground; wrong in the measurement.
4. Six embedded landmarks (above) — instrument margin, not mesh overlap.
5. **The Wonderland usage meter (health bar) is founder-locked** (2026-09-07):
   "This is the permanent health bar usage until I say otherwise." Four states
   — TYPICAL / NEARLY SPENT / UNTOUCHED / NOTHING REPORTED, twin arcs, green
   compound-agent outer and blue single-agent inner, counted in WONDER. Its
   geometry and palette live in
   `src/relay/mission/wonderland/wonderland-usage-meter.ts`, regenerated with
   `npm run wonderland:hud:preview`. **That file is on no branch this checkout
   can see** — it is the platform stream's working tree in `sunday-relay-main`,
   not the world tree. A world session should not restyle it, add states, or
   build a second usage display anywhere.
6. `wonderland/infra/build/hero_shots.py` is **dirty in the worktree** — a
   one-line change from a previous session sending a NOTE to stderr. Not
   mine, not committed, left alone.
7. `verify_v2_textures.py` fails here for want of `/opt/wonderland/textures`
   — an environment gap on this machine, not a world defect.

## Render-ready: the exact commands and the camera list

Everything since PASS 29's package `356fe89` is offline-only. `region.py`,
`hierarchy.py` and the per-degree profiles are plan-view/silhouette
instruments and make **no visual claim**.

```bash
bash wonderland/v2/tools/ship_v2.sh --ship-only
ssh wonderland-l4 'cd .../src && WLV2_REUSE_MATERIALS=1 \
  setsid nohup bash wonderland/v2/tools/pass_chain.sh > ../run/pass.log 2>&1 &'
WL_CAMS="0 1 3 4 6 11 12" WL_RES_X=1920 WL_RES_Y=1080 \
  bash wonderland/v2/tools/round.sh
```

**The camera list, and why each one is on it:**

| cam | tag | what it must show |
|---|---|---|
| 0 | `HeroCam0` | **the benchmark.** Every number in this file is from it: the left tree moved, the two city notches closed, four gold screens, the far city |
| 1 | `PlayerCam01` | the gameplay POV through the gate — proves the arrival still reads at eye height |
| 3 | `ReverseCam03` | the backside truth test; the left tree moved *toward* this frame |
| 4 | `GardenLeft04` | looks up-garden past the tree that moved. `camera_framing` 'in' went 18 → 22 |
| 6 | `SkylineCam06` | 24 m up, pitch −22 — the far city's spacing fix |
| 11 | `WorldCam11` | 95 m, pitch −19 — the south reach and the world's edge |
| 12 | `WorldCam12` | 62 m, pitch −16 — the same, lower |

**Then immediately re-run the comparison that drove PASS 31–32**, because it
is the only trustworthy instrument for tone and palette (real pixels on both
sides). Classify the new HeroCam0 render and the founder reference into the
same buckets and compare against the tables above: dark share, median
luminance, p10, the ground row, and the eight-way palette split. If the
ground row is still near zero, the lighting pass has not landed.

There is still no camera pointed at the South Ring. By this project's rule a
new area earns its own camera once it has a real composition — it has had one
since `5a73259`.
