# Wonderland — world state, current

**This file is the recovery point.** `/resume` history disappears; the
repository must be enough. Update it before ending any significant world
session.

| | |
|---|---|
| SESSION | 2026-09-06/07 — world / Unreal stream, Signal Cycle #1 Task 4 |
| CHECKOUT | `/home/thomasajvt13/dev/sunday-relay` (git worktree; the primary checkout is `sunday-relay-main`, detached at `b2dc9f2`, and is the Julius/platform stream) |
| BRANCH | `relay/wonderland-v2` |
| SHA AT START | `d9245bf` |
| SHA AT END | `5a73259` |
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
   yields `ALL` (13,338 placements). Nothing needs Unreal to audit.

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

## The next worst region — start here

**Far Orchards, 1,600 m², centre (326, −86) m, r 337 m, bearing 345°**,
extent x 295..345, y −115..−75. At its worst 85 m from any architecture,
89 m from a silhouette, 94 m from a road. 64% of what forsaken ground is
left. Its nearest built things are `Way0358_Marker`, `Country078_Tower` and
`DPGatekeeperFields_Orrery`, all ~78–82 m away.

Likely the same shape as South Meadows and worth checking first:
`_DISTRICT_SEEDS` gives **The Long Woods** `("wood","meadow","wood")` and
**West Wood** `("wood","wood","meadow")` — two more districts whose palettes
contain no built kind at all. Far Orchards is `("meadow","wood","hamlet")`,
so it has one; the hole may be the ground *between* its quarters rather than
the quarters.

```bash
python3 wonderland/v2/tools/region.py --sectors        # where is it worst now
python3 wonderland/v2/tools/region.py --bar=70,37,63   # the pinned ruler for comparison
```

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
4. Two embedded landmarks, pre-existing (above).
5. `wonderland/infra/build/hero_shots.py` is **dirty in the worktree** — a
   one-line change from a previous session sending a NOTE to stderr. Not
   mine, not committed, left alone.
6. `verify_v2_textures.py` fails here for want of `/opt/wonderland/textures`
   — an environment gap on this machine, not a world defect.

## What has never been rendered

Everything since PASS 29's package `356fe89` is offline-only, and that
includes all of this. `region.py` is a plan-view instrument and makes no
visual claim. The next GPU session should capture the south: there is no
camera pointed at the South Ring, and by this project's own rule a new area
earns its own camera **once it has a real composition** — it now has one.

```bash
bash wonderland/v2/tools/ship_v2.sh --ship-only
ssh wonderland-l4 'cd .../src && WLV2_REUSE_MATERIALS=1 \
  setsid nohup bash wonderland/v2/tools/pass_chain.sh > ../run/pass.log 2>&1 &'
WL_CAMS="0 6 11 12" WL_RES_X=1920 WL_RES_Y=1080 bash wonderland/v2/tools/round.sh
```

`WorldCam11` (95 m up, pitch −19) and `WorldCam12` are the two cameras whose
frames changed at all this pass, and they are the ones that would show the
south reach and the colonnade at the world's edge.
