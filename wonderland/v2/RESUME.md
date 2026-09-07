# Wonderland V2 — resume point (2026-08-30, world-development phase)

## Where to pick up

| | |
|---|---|
| DATE | 2026-08-30, world-development phase (founder reopened it after locomotion closed) |
| BRANCH | `relay/wonderland-v2` |
| WORKTREE | `~/wonderland-ca-fixes` on the Chromebook — CPU work needs no Studio |
| AUTHORITATIVE MAP | `/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2` — **classic (non-WP) container** |
| CONTENT ROOT | `/Game/WonderlandV2` |
| PRIMARY REFERENCE | `v2/reference/marble-royal-garden-cam0-founder-reference.png` (the founder's cam0 view) plus the three boards in `v2/reference/boards/` |
| CAMERA SUITE | **eleven** now: the eight locked arrival cameras, plus FlankLeftCam08, FlankRightCam09, RearWorldCam10 added in PASS 09 for the new ground. None of the original eight moves. |

## The tool that decides things now

`v2/tools/gap_v2.py RENDER.png [REFERENCE.png]` — measures the six things that
decide whether a frame reads as the reference world: per-band luma/chroma/edges,
the palette split by colour family, cloud share of the sky, ground variation,
gridness, foreground tonal span and clipping. **Impressions drift; pixel
populations do not.** It is what redirected PASS 08 away from the carried gap
list, and every pass since states its predictions in these units BEFORE the
render and scores them after. The predictions and scores live in
`v2/WORLD_LEDGER.md`.

Two measured caveats are recorded in the tool: `cloud_fraction` is only
meaningful on a camera with real sky above the horizon (pale horizon haze
scores as cloud), and its whole-band figures differ from a hand-placed
rectangle — quote the tool's.

## What has happened in this phase

- **PASS 08 (`b3ec99a`) — the look.** Triplanar projection replaced a world-XY
  UV that smeared every vertical surface in Wonderland; the shadowless fill
  was cut so shade exists; the grade and sun were warmed; stone albedo came
  down; trees stopped ending outside their own leaves; clouds became lit
  geometry because VolumetricCloud has now failed twice on this runtime.
  Five of eight predictions met.
- **PASS 08b (`427438e`) — the overshoots**, sized from PASS 08's frame:
  warmth 1.36× the reference and shade 1.32×, both pulled back; the ground had
  become a brown void instead of a green one; the plaza's four tints were
  drawn from a sum of uniforms against thresholds calibrated as if uniform, so
  the grey stone meant to be a fifth of the pavement was one slab in
  twenty-seven.
- **PASS 09 (`5581796`) — the flanks and the rear world.** 305 new placements
  turning 23,300 m² of lawn into authored garden: threshold → parterre → rose
  walk → grove → landmark → boundary on each flank, and a second gate with a
  hedged avenue behind the spawn. Density 1 per 178 m² → 1 per 41.

## Three traps this phase found, worth not re-learning

1. **The gate read a different list from the builder.** `build_v2` walked a
   hand-written band list and `layout_v2.ALL` was another; PASS 09 added 305
   placements to ALL alone, the layout gate counted them and PASSED, and the
   generator placed four. One list now (`LAYOUT.BUILD_BANDS`), ALL derived.
2. **The fps harness was measuring an empty world.** `measure-fps.sh` was the
   only launcher that never forwarded `${WL_MAP_ARG}`, so it booted the empty
   World Partition container. Its numbers looked excellent because there was
   nothing in them. It now forwards the map and prints the world it measured.
3. **A threshold on a derived random variable does not mean its share.** See
   the plaza tints above.

## Build and capture (the Studio must already be on the L4)

```bash
bash wonderland/v2/tools/ship_v2.sh --ship-only          # incremental, ~30 KB
ssh wonderland-l4 'cd .../src && WLV2_REBUILD="<recipes that changed>" \
  setsid nohup bash wonderland/v2/tools/pass_chain.sh > ../run/pass.log 2>&1 &'
WL_CAMS="0 8 9 10" WL_RES_X=1280 WL_RES_Y=720 bash wonderland/v2/tools/round.sh
```

`ship_v2.sh` now bundles incrementally by asking the Studio what commit it
holds and proving locally that it is an ancestor — the full-branch bundle
stopped fitting in a ten-minute upload once the reference art landed on the
branch. `WL_STUDIO_FULL=1` forces the old behaviour.

## Permanent principles

- Wonderland **V1 is archived / read-only**; the write-guard stays.
- **Marble designs and may accelerate distant scenery; Unreal owns the
  playable world.** No raw Marble geometry in the player-facing foreground.
- Visual progress requires a **real Unreal render**. Offline traces, contact
  sheets and Python rasterisations are diagnostics, never acceptance.
- The locked cameras are a **regression system**. Fix the world, not the
  framing. A new area earns its own cameras once it has a real composition.
- **Art and navigation together**: every environment pass keeps the routes
  walkable, and clearance at a point proves nothing about the ground between
  points — only a walk does.


---

# Update — 2026-08-30, end of the world-development stretch

## The three tools that now decide things

Each was written after making the same mistake twice, and each immediately
found something I had not.

| tool | question it answers | what it caught |
|---|---|---|
| `tools/gap_v2.py RENDER [REF]` | does the frame read as the reference? | the world was unshaded and cool, not over-exposed — which redirected PASS 08 away from the carried gap list |
| `tools/camera_framing.py` | where does a camera's picture of the ground begin? | two passes of foreground planting placed **under the lens** and therefore invisible |
| `tools/walkable.py [--routes]` | can the Dog get there, and by what route? | a landmark placed **inside a tower**, and both flanks being cul-de-sacs |

Run all three before believing a plan. `--routes` also derives the flank walk's
waypoints; `FLANK_ROUTE` in layout_v2 is that output and must be regenerated
if the flank planting changes.

## Arithmetic worth not re-deriving

- A camera's ground begins at `eye_z / tan(-(pitch - vfov/2))`. Nearer than
  that is invisible.
- At 90° horizontal fov the visible half-width **equals** the depth. A clump
  30 m off-axis at 8 m out is not in the picture.
- `yaw=90` swaps which scale axis is which. terrace_platform is 1,440 along X
  and 740 along Y; turned, its X extent comes from `sy`.
- `garden_lawn`'s top surface is at its local z=0 with all thickness below.

## Build

```bash
bash wonderland/v2/tools/ship_v2.sh --ship-only        # incremental, seconds
ssh wonderland-l4 'cd .../src && WLV2_REUSE_MATERIALS=1 \
  WLV2_REBUILD="<recipes that changed>" \
  setsid nohup bash wonderland/v2/tools/pass_chain.sh > ../run/pass.log 2>&1 &'
WL_CAMS="8 9 10" WL_RES_X=1280 WL_RES_Y=720 WL_V2_FPS=0 \
  bash wonderland/v2/tools/round.sh
```

`WLV2_REUSE_MATERIALS=1` takes the generate from ~15 min to ~6 by skipping the
master rebuild and shader recompile. Use it on any pass that does not change a
tint or a master graph. **Do not ship while a capture round is running** — the
source pin will correctly refuse the frame, which cost one capture.

## State

Golden Arrival has two flank gardens and a rear world where there was lawn.
1,479+ placements against 787 at PASS 08; flank density 1 per 178 m² → 1 per
41. Eleven cameras (the original eight unmoved, plus FlankLeftCam08,
FlankRightCam09, RearWorldCam10). 0 of 18 named destinations unreachable.

Open, in order: the ground BETWEEN the garden rooms is still plain lawn; the
distant world beyond the 1.2 km ground slab still ends at a visible edge;
`palette.rose` remains ~0.45× the reference.

---

# Update — 2026-08-30, PASS 22: the quarter hierarchy

## The five tools that decide things now

| tool | question | what it caught this pass |
|---|---|---|
| `tools/gap_v2.py RENDER [REF]` | does the frame read as the reference? | (needs a GPU frame; not run this pass) |
| `tools/camera_framing.py` | where does a camera's ground begin? | the two world cameras' near bands THINNED, correctly |
| `tools/walkable.py [--window=world]` | can the Dog get there? | the outer world had never been tested at all |
| `tools/emptiness.py [--scaled] [--window=]` | where is the world *not*? | its own window held 4,832 m2 of a 461,488 m2 problem |
| **`tools/hierarchy.py`** | does the world have a hierarchy, or one density tiled? | **core:far 1.10x**; a nested pair; landmarks in other people's geometry; roads |
| **`tools/plan_view.py OUT.png`** | what does the plan look like? | far woods drawing as scattered dots, not woodland |

Two of these are new and two grew a window. **An audit's window is part of its
measurement** -- `emptiness` sampled +/- 120 m and `walkable` +/- 90 m of a
world that reaches 450 m, so both were answering a question about Golden
Arrival while reporting on Wonderland.

## The hierarchy, in one line

`layout_v2.HIER(x, y)` returns a continuous score and twelve derived
quantities. Everything the outer world has -- how many pieces a quarter is
made of, how far apart they stand, how big, how likely a landmark, how much
empty ground is correct there -- comes from that function and from nothing
else. `emptiness.py --scaled` reads `empty_tol` from the same call, so the
audit and the generator cannot disagree about how sparse the horizon should be.

Placement is greedy and sequential (`_separate`): duplicates dropped, authored
sites before generated, each taking its own position if it clears, then the
nearest ring position that does, then a smaller size, then a drop with its
name printed. Every kept site is conflict-free by construction.

## Arithmetic worth not re-deriving

- A quarter's REACH (its furthest piece) and its BODY (the mass that must not
  overlap a neighbour) are different numbers and answer different questions.
  Using one for both either fills the core with collisions or empties it.
- Both are LINEAR in `H["spacing"]`, because the builders are.
- `HIER` is called ~1.3 million times while the world is placed. It is
  memoised on the exact coordinate; without that, importing `layout_v2` takes
  25 seconds.
- Roads *inside* the quarters they serve are 45% of all road segments and are
  correct. The question worth asking is about the quarters a road does NOT
  terminate in -- currently 0 of 263.

## State

`relay/wonderland-v2`. 44 quarters from 65 m to 345 m; the outer world's
density falls monotonically from its peak at 100-150 m to the horizon, GROUND
core:far 5.19x. 5,673 placements in **1,541 actors** -- fewer actors than the
4,590-placement world had, because the woods are instanced. Golden Arrival:
twelve of thirteen bands byte-identical, GROUND_QUILT extended on purpose.

**Nothing rendered.** Next GPU session: cams 0 / 6 / 11 / 12.

Open, in order: the far world is 8.5% empty by its own tier's tolerance; ten
authored sites could not be placed and should be re-sited; the 50-75 m band is
Golden Arrival's own outskirt and closing it is a founder decision. Full list
in `WORLD_LEDGER.md`.

---

# Update — 2026-08-31, PASS 28: ENCHANTMENT + VERTICALITY

## Where to pick up

| | |
|---|---|
| BRANCH | `relay/wonderland-v2`, HEAD `dfda8c9` |
| WORKTREE | `~/wonderland-ca-fixes` |
| MAP | `/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2` (classic) |
| CAMERAS | **30**: the eight locked (unmoved), 9-20 as before, plus SkylineRiseCam21 and eight landmark cameras 22-29 |
| PLACEMENTS | 12,658 in ~803 actors |

## Three new instruments, and they are the point

Every audit in this project measured the world in PLAN. None could answer how
tall it is, what a camera sees, or how much sky has a leaf in front of it.

| tool | question | what it caught |
|---|---|---|
| `tools/skyline.py` | how tall, and is anything dominant? | the second-tallest thing in Wonderland was a HOT-AIR BALLOON |
| `tools/skyline.py --site X,Y,H` | what would this do to all 30 cameras? | set the great spire's height from HeroCam0's frozen half-field, before it existed |
| `tools/occlusion.py` | what does each camera actually SEE? | seven of the eighteen largest presences were TREE CANOPIES |
| `tools/occlusion.py --cover` | how much ground has a crown over it? | 57-67% where the city is -- a closed woodland |

Heights are MEASURED off the shipped geometry: every recipe is built on the
offline meshkit backend and its bounding box plus a twelve-slab radius profile
read. Never a table beside the code.

## The rule this pass is really about

**Angular height is not enough to size a landmark by.** The great spire
landed exactly where it was computed to land -- +32.0 deg in HeroCam0 against
a 33.8 deg half-field -- and read as a HAIRLINE, because it subtended 30.4 deg
of height on 2.9 deg of shaft. 1:10.4, against the castle hall beside it at
1:2.3. A navigation anchor needs MASS, and mass is width. Now 1:3.2, placed
with a non-uniform scale because height was already at the camera's ceiling.

## Four things that failed OPEN and said nothing

Worth re-reading before writing any filter or gate here.

1. **The reveal filter knew one tree naming scheme of two.** `_tree` writes
   `<TAG>_T<i>`; `_tree_group` writes `<TAG>_Trunk`. The eight tree groups
   between the plaza and the castle were invisible to the filter written to
   open that sightline, and it reported success.
2. **The occlusion camera basis was mirrored AND inverted.** `right` was
   (sin, -cos) and `up` derived from it pointed down. Every share it reported
   was measured from a scene projected below the frame.
3. **One bounding cylinder per piece.** A giant mushroom's cap is 20 m across
   and 13 m up; as a column from the ground it reported 556 buildings hidden
   behind one fungus.
4. **Camera siting checked the standpoint, not the sightline.** Three of six
   landmark cameras could see 0-21% of the thing they are named for.

## Frozen until the capture

Content is frozen at `dfda8c9` while the L4 builds it. The next actions are:

```bash
WL_CAMS="0 1 2 6 7 21 22 23 24 25 26 27 28 29" WL_RES_X=1920 WL_RES_Y=1080 \
  bash wonderland/v2/tools/round.sh
python3 wonderland/v2/tools/perf_split.py        # the performance guardrail
bash wonderland/v2/tools/capture_locomotion.sh   # the Dog walks it
```

Baselines for before/after are `~/wonderland-v2-renders/V2_PASS26_*.png` (all
eight locked cameras) and `V2_PASS_170/171/172` (cam 0/6/2, mid-pass).


---

# Update — 2026-09-06/07, PASS 30: the region nobody could see

**The durable handoff for the world stream now lives in
`docs/handoffs/WONDERLAND_WORLD_CURRENT.md`.** Read that first; this file is
the history behind it.

Branch `relay/wonderland-v2`, HEAD `5a73259`, worktree
`/home/thomasajvt13/dev/sunday-relay`. Nothing rendered.

A sixth instrument, `tools/region.py`: **can you stand somewhere and have
nothing to walk to?** All four older audits passed on a world with three
neighbouring quarters made of nothing but plants, because presence is not a
destination and none of them could tell the difference. It found one region
holding 83% of the world's forsaken ground -- South Meadows, 6,800 m2 at
(120, -312) m, 105 m from any architecture -- and the South Reach was built
there: a way, a gate, a 45 m arch inside a ring of eight, a colonnade at the
world's edge, and a threshold for each of the two meadows. 8,200 m2 forsaken
-> 1,300 on one pinned ruler; the region is gone; the tour is byte-identical.

It also found that `hierarchy.py` classed all sixteen of PASS 29's
architectural recipes as `prop` and the Royal Gardens' district landmark as
VEGETATION. Every arch/ha number in `WORLD_LEDGER.md` before PASS 30
under-reports.

Full detail: `WORLD_LEDGER.md`, PASS 30.
