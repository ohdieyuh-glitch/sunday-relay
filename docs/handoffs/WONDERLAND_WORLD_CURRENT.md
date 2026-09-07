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
| SHA AT END | `09b5349` (pushed). A fresh session should `git log --oneline -6` — 993385e, e3952ae, 9655bad, 200aeff, 9086b78, 09b5349 are PASS 30–33. |
| LOCK | `wonderland/.gauntlet-lock` = `writer=claude step=0 since=2026-08-25`. Unchanged. `gauntlet-check.py` clean on every commit. |
| MAP | `/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2` (classic container) |
| RENDERED THIS SESSION | **Nothing.** No engine, no Studio, no GPU frame. Every number below is offline, measured off `layout_v2.ALL` and the built meshkit geometry. |

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

Real pixels, founder reference against `V2_MILESTONE26_HeroCam0_1080p.png`.
Note that render **predates PASS 28's blossom change**, so the colour half of
mismatch 2 is already partly closed and unrendered.

**1. LIGHT — the ground carries no cast shadow. This is the biggest one.**

| | reference | ours |
|---|---|---|
| dark (<70/255) | 42.9% | 27.1% |
| median luminance | 81 | **120** |
| p10 (shadow depth) | 23 | **43** |
| ground row, dark (L/C/R) | 11.7 / 19.5 / 42.4% | **0.5 / 3.3 / 8.9%** |
| near-black share | 20.1% | 5.1% |

The cause is the shadowless fill budget in `v2_config.LOOK`:
`canopyFillLux` 9,000 + a second PASS 26 fill + `bounceLux` 2,400 +
`skyLightIntensity` 1.6, all against a 60,000-lux key. **It was NOT touched
this session, deliberately.** Those values were tuned across PASS 08, 08b,
08c, 24 and 26 *against real renders*, and a founder judgement is in that
history — the right side reading "excessively dark" is what caused the
hemisphere lift. Moving them blind risks re-breaking a call the founder
already made. **PASS 33 should be the lighting pass and it must have a render
in the loop.**

**2. Vegetation owns 44.2% of the ceiling against the reference's 28.5%,**
and the honest remainder is small. PASS 33 sorted every losing column: the
frame margins are faithful and should stay, and the one real hole is
frame-left +31..+41, which needs a **district palette decision** (see PASS 33
above) rather than more tree-moving. Do not move `ClockTree`, `Tower_R0/R1`
or the margin canopies — they match the reference.

**3. The low row is pale where the reference is grey — and that is
mismatch 1 again, not a material.** Ours pale/stone 42.3% + gold 48.0% +
grey 4.1%; reference gold 57.9% + grey **21.2%** + pale **4.1%**. The two
buckets differ only in luminance — "pale" is bright-and-desaturated, "grey"
is dark-and-desaturated, and the gold shares are already close (48.0 against
57.9). So this is the same paving under different light, not different
paving. **Do not darken the paving albedo to close it** — that bakes an
exposure error into a material and will read wrong the moment the lighting is
fixed. Re-measure this row after PASS 33 and only then ask whether any
material work is left.

**4. A dip in the middle distance.** Silhouette tops by depth band:
0–40 m +12.3°, 40–90 m +21.2°, 90–180 m +14.0°, **180–260 m +7.9°,
260–360 m +5.6°**, 360–600 m +13.2°. The 180–360 m band is the thinnest part
of the world's profile.

**5. Six embedded landmarks remain** — the audit's `FOOT` margin (400 uu, a
walker-clearance number) rather than mesh overlap (178 uu). Two are
pre-existing `Country039`/`GreatSpire`; one is far-city against `_horizon`,
which does not share the far city's occupancy list.

---

## The exact next pass

1. **Get a render.** Nothing below can be judged without one, and five passes
   of geometry now sit unrendered.
2. **PASS 33 = light.** Reduce the shadowless fill budget so the ground takes
   cast shadow, re-measure the same table above, and stop when the ground row
   reaches roughly the reference's 12 / 20 / 42%. Change one light at a time
   and render between changes — this project has broken shade three times by
   moving two knobs at once.
3. Then mismatch 4 (the 180–360 m band is the thinnest part of the world's
   profile, +7.9° and +5.6° against +14.0° nearer and +13.2° beyond).
4. Only then the frame-left +31..+41 hole, and only as a considered decision
   about what `Royal Gardens` / `S17_garden` / `S16_meadow` should be. It is
   a district-identity question, not a hole to plug.

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
5. `wonderland/infra/build/hero_shots.py` is **dirty in the worktree** — a
   one-line change from a previous session sending a NOTE to stderr. Not
   mine, not committed, left alone.
6. `verify_v2_textures.py` fails here for want of `/opt/wonderland/textures`
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
