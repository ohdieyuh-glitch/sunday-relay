# Wonderland world completion matrix

**Owner of this file: CORE ("Wonderland core continued").** The WORLD session ("Second wonderland session") edits
only the rows and specs marked WORLD. Founder directive 2026-09-28: *"COMPLETE WONDERLAND AS AN ENTIRE WORLD ...
Use WORLD-SCALE auditing ... Do not use a single vague percentage to hide unfinished regions."*

Map: `/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2` (World Partition). Status words, per the founder:
NOT STARTED · IN PROGRESS · STRUCTURALLY COMPLETE · VISUALLY COMPLETE · VERIFIED.

## How this was measured (2026-09-28, first cut)

- **Every region loaded in the editor first** (`zc_wp_regions`, commit e090f630): 20,916 / 20,916 spatially
  loaded descriptors resident, so nothing below is an artefact of streaming.
- **Census of every placement** (`zc_world_census`, WORLD session): 179,135 rows (17,247 actors, 161,839 instances),
  all 21,543 descriptors matched. CSV: `Tools/captures/zc/census/world_census.csv.gz`.
- **Emptiness** (`Tools/world_audit/emptiness.py`, the forge method on the census: 5 m cells, 9 m reach, disc of
  1,480 m, structure-only): **3.96 km² of 6.88 km² (57.5 %) empty.** Map: `captures/zc/census/emptiness_structure.png`.
- **Aerial photographs** from the level viewport: `captures/zc/wp_regions_0928/highres_*.png`
  (whole world from 1.5 km, the three nation edges, the plaza).
- **Pass attribution**: every census row carries its authoring pass tag, so each region's row below names what
  actually stands there, not what a spec says.

The whole-world photograph says it before any number: a dense core of ~400 m radius, then a ~4 km² plain of
flat ground with ~100 lone skyline towers, three nation districts standing as islands along three radial avenues.

## Structure found in the map

| element | passes (placements) | where | state |
|---|---|---|---|
| Golden Arrival (axis, plaza, flank gardens, rear world, flower border, parterres, walls) | GA02/04/07, FL04, LF01, GF01/02, BC01, WB01, SD01, FD01-05 ... | 0-150 m | built |
| The core quarters | CQ01/02 Clock Quarter, EQ01 East Quarter, SM01-03 South Meadows, TC01-03 Teapot Court, CL01 Cloister, CK01-03 Colossal Key, ER01-03, WW01-03, WG01/03, RG01, FO01/02, LH01/02, DC01 | 100-320 m | built; **forge canon names 24 quarters -- reconciliation OPEN** |
| Radial avenues | AV01 Icarus (90°), AV02 Noctis (210°), AV03 Tartarus (330°) | 599-1,060 m | built, one per nation |
| Arrival approaches | AP01 | 384-500 m, 91° | **Icarus side only** |
| Checkpoints | CP02/03/04 | ~527 m on each avenue | built |
| Nation quarters | IC02; NC01+NC02; TQ01+TQ02 | 500-850 m, along each avenue | built, **narrow strips** |
| Nation bands | IC03/04, NC03/04, TQ03/04 | 820-1,200 m | built |
| Marches | IC01 | 500-640 m | **Icarus only** |
| Frontiers | FR02 (+FR01/03/04 small) | 1,000-1,300 m | thin |
| Dubel Forest | DF01 | 1,231-1,479 m, 90° | built |
| Skyline towers | SKY05 | 425-1,458 m, all bearings | ~100 lone towers |
| **Ring circuit** | RR01 march ring, RR02 outer ring (`Rings/ring_probe.py` -> `ring_roads.py`) | 548-722 m, 980-1,250 m | **specs built, apply pending** |
| Outer-ring garden fills | GF03/04/05, re-seated on the real ground (`City/outer_ring_ground.py`) and tiled to 200 m | 400-500 m | **applied 2026-09-28**: 3,071 pieces, 174 batches |

## Where the world is empty (60° wedges × radial bands, structure-only)

| wedge | 400-500 | 500-600 | 600-900 | 900-1000 | 1000-1200 | 1200-1480 |
|---|---|---|---|---|---|---|
| SEAM 30° (TARTARUS / ICARUS), 0-60° | 22 % | 35 % | 49 % · 11.5 ha | 33 % | 50 % · 11.5 ha | 69 % · 29.4 ha |
| ICARUS centre, 60-120° | 53 % | 53 % | 43 % · 10.2 ha | 31 % | 54 % · 12.4 ha | 24 % |
| SEAM 150° (ICARUS / NOCTIS), 120-180° | 37 % | 38 % | 53 % · 12.6 ha | 22 % | 51 % · 11.9 ha | 76 % · 32.2 ha |
| NOCTIS centre, 180-240° | 25 % | 50 % | 66 % · 15.5 ha | 47 % | 56 % · 13.0 ha | 83 % · 35.2 ha |
| SEAM 270° rear (NOCTIS / TARTARUS), 240-300° | 16 % | 68 % | **86 % · 20.3 ha** | 57 % | 73 % · 16.9 ha | 85 % · 35.9 ha |
| TARTARUS centre, 300-360° | 26 % | 44 % | 68 % · 16.1 ha | 33 % | 61 % · 14.0 ha | 88 % · 37.4 ha |

Total empty: 394 ha. The core (0-400 m) is 0-6 % empty everywhere.

**Is any of it intentional?** Not by any design record: `CANON/NATIONS.md` says beyond 500 m "the map is nearly
empty ... so each nation gets open ground to be built into" -- open *because nobody has built it yet*, which the
founder's rule does not allow. Negative space that IS intended will be declared per row as it is designed
(vistas along the avenues, the ceremonial clear ground at each checkpoint, forest clearings), never by default.

## Region completion matrix

Columns: STRUCTURE · LANDSCAPE · ARCHITECTURE · VEGETATION · ROADS/PATHS · LANDMARKS · ENV DETAIL · TRAVERSAL ·
DISTANT VIEWS · WORLD PARTITION · VISUAL PROOF.

| region | owner | STRUCT | LAND | ARCH | VEG | ROADS | LANDMK | DETAIL | TRAV | DIST | WP | PROOF |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R00 Golden Arrival 0-150 m | CORE | VISUALLY COMPLETE | VISUALLY COMPLETE | VISUALLY COMPLETE | VISUALLY COMPLETE | STRUCT. COMPLETE | VISUALLY COMPLETE | VISUALLY COMPLETE | IN PROGRESS | IN PROGRESS | VERIFIED | IN PROGRESS |
| R01 core quarters 150-400 m | CORE | STRUCT. COMPLETE | VISUALLY COMPLETE | VISUALLY COMPLETE | VISUALLY COMPLETE | IN PROGRESS | STRUCT. COMPLETE | STRUCT. COMPLETE | IN PROGRESS | IN PROGRESS | VERIFIED | IN PROGRESS |
| R02 core rim 400-500 m | CORE | IN PROGRESS | IN PROGRESS | IN PROGRESS | IN PROGRESS (GF03-05 in: 29.8 -> 26.4 % empty) | IN PROGRESS | NOT STARTED | IN PROGRESS | IN PROGRESS | NOT STARTED | VERIFIED | IN PROGRESS (`captures/zc/gf_photos_0928`) |
| R10 ICARUS march + quarter 500-900 | CORE spine / WORLD fill | IN PROGRESS | IN PROGRESS | IN PROGRESS | IN PROGRESS | STRUCT. COMPLETE (AV01) | IN PROGRESS | NOT STARTED | IN PROGRESS | NOT STARTED | VERIFIED | NOT STARTED |
| R11 ICARUS band 900-1000 | CORE | STRUCT. COMPLETE | IN PROGRESS | STRUCT. COMPLETE | IN PROGRESS | STRUCT. COMPLETE | IN PROGRESS | IN PROGRESS | IN PROGRESS | NOT STARTED | VERIFIED | IN PROGRESS |
| R12 ICARUS frontier 1000-1200 | WORLD | NOT STARTED | NOT STARTED | NOT STARTED | IN PROGRESS | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | VERIFIED | NOT STARTED |
| R20 NOCTIS march + quarter 500-900 | CORE spine / WORLD fill | IN PROGRESS | NOT STARTED | IN PROGRESS | NOT STARTED | STRUCT. COMPLETE (AV02) | NOT STARTED | NOT STARTED | IN PROGRESS | NOT STARTED | VERIFIED | NOT STARTED |
| R21 NOCTIS band 900-1000 | CORE | STRUCT. COMPLETE | IN PROGRESS | STRUCT. COMPLETE | IN PROGRESS | STRUCT. COMPLETE | IN PROGRESS | IN PROGRESS | IN PROGRESS | NOT STARTED | VERIFIED | IN PROGRESS |
| R22 NOCTIS frontier 1000-1200 | WORLD | NOT STARTED | NOT STARTED | NOT STARTED | IN PROGRESS | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | VERIFIED | NOT STARTED |
| R30 TARTARUS march + quarter 500-900 | CORE spine / WORLD fill | IN PROGRESS | NOT STARTED | IN PROGRESS | NOT STARTED | STRUCT. COMPLETE (AV03) | NOT STARTED | NOT STARTED | IN PROGRESS | NOT STARTED | VERIFIED | NOT STARTED |
| R31 TARTARUS band 900-1000 | CORE | STRUCT. COMPLETE | IN PROGRESS | STRUCT. COMPLETE | IN PROGRESS | STRUCT. COMPLETE | IN PROGRESS | IN PROGRESS | IN PROGRESS | NOT STARTED | VERIFIED | IN PROGRESS |
| R32 TARTARUS frontier 1000-1200 | WORLD | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | VERIFIED | NOT STARTED |
| R40 SEAM 270° rear, 500-1200 | **WORLD (assigned #1)** | IN PROGRESS | IN PROGRESS | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | VERIFIED | NOT STARTED |
| R41 SEAM 150° (Icarus/Noctis), 500-1200 | WORLD (assigned #2) | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | VERIFIED | NOT STARTED |
| R42 SEAM 30° (Tartarus/Icarus), 500-1200 | WORLD (assigned #3) | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | VERIFIED | NOT STARTED |
| R50 WILD ring 1200-1480 (outside Dubel) | WORLD (after R40-R42) | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | VERIFIED | NOT STARTED |
| R51 Dubel Forest 1230-1480, 90° | CORE (review) | STRUCT. COMPLETE | STRUCT. COMPLETE | NOT STARTED | STRUCT. COMPLETE | IN PROGRESS | NOT STARTED | IN PROGRESS | IN PROGRESS | NOT STARTED | VERIFIED | IN PROGRESS |
| S01 ring circuit (march ring 548-722 m, outer ring 980-1,250 m; pinned to W270's plazas at 645 / 1,075 m) | **CORE** | IN PROGRESS | -- | -- | -- | IN PROGRESS (RR01 4,100 of 4,410 m paved; RR02 6,408 of 7,387 m) | -- | -- | NOT STARTED | -- | -- | IN PROGRESS (before photos) |
| S02 seam radials 30° / 150° / 270° | **CORE** | NOT STARTED | -- | -- | -- | NOT STARTED | -- | -- | NOT STARTED | -- | -- | NOT STARTED |
| S03 packaged world boots Golden Arrival | **CORE** | config correct (GameDefaultMap, MapsToCook, staging incl. RelayCubs b657b9b0) | | | | | | | | | | **no package built since the config change** |

WORLD PARTITION column: VERIFIED means the region's placements are resident in the editor (zc_wp_regions) and
the Dog survives far travel into it (3a54247e, zzV4_beta_walk W06 23/23 on the 11:02 binary).

## Assignments

| # | to | region | notes |
|---|---|---|---|
| 1 | WORLD | R40 SEAM 270° rear, 500-1,200 m | two nation halves (Noctis west of -90°, Tartarus east) and a designed seam; specs in `WorldDesign/Wedges/` |
| 2 | WORLD | R41 SEAM 150°, 500-1,200 m | Icarus / Noctis seam; hang layouts on the S02 seam radial once CORE publishes it |
| 3 | WORLD | R42 SEAM 30°, 500-1,200 m | Tartarus / Icarus seam; same |
| 4 | WORLD | R22 / R32 / R12 frontiers, then R50 wild ring | forest, mushroom woods, meadows with purpose -- Dubel's clearings are the model |
| C1 | CORE | R02 core rim: re-apply GF03/04/05 | **DONE 2026-09-28**, corrected and tiled; see the note on the corner-cell bug below |
| C2 | CORE | S01 ring circuit + S02 seam radials | the roads every fill hangs on; polylines to WORLD before their layouts |
| C3 | CORE | nation marches for NOCTIS and TARTARUS (Icarus has IC01) | gates/landmarks where each avenue enters its nation |
| C4 | CORE | forge-canon reconciliation: the 24 quarters, radial roads and ring circuit of the core | forge `WORLD_LEDGER.md` 611-616, `layout_v2.py` |
| C5 | CORE | traversal (walkable on the census), packaged build | |

## Map-writing protocol (agreed 2026-09-28)

One writer at a time, announced and serialized through the channel; never CONCURRENT, never beside the other's
PIE; `Tools/checkpoint_map.sh` before any save; every apply tagged `WL_PASS_<id>`; ask before each apply+save.

## Findings that change how this work is done (2026-09-28, evening)

- **Footprints must fill every cell they touch.** `outer_ring_ground.py` first registered each piece in the grid
  cells at its four CORNERS only, so the middle of anything wider than two cells (a 72 m lawn, a 100 m hedge run,
  a castle hall) was invisible to it. The first GF03-05 apply planted ~1,100 pieces inside hedges, giant mushrooms
  and tower bases before the fix; the corrected apply replaced it, and the map was hash-checked after
  (22,413 files byte-identical to the checkpoint, the only differences the 39 superseded GF actors).
- **Surfaces have pivots.** `SM_garden_lawn` hangs below its pivot (top = pivot - 0.5); `SM_terrace_platform` and
  the WL_ kit stand on theirs. Use `WorldDesign/mesh_bounds.json`, never pivot + half-height.
- **Batches are cut to 200 m tiles** (both lanes): World Partition pages by actor bounds, and one batch spanning
  hundreds of metres is promoted to a grid level that never unloads.
- **Save behaviour.** In an editor session, the FIRST `save_map` writes only dirty packages (14 for GF03, 8.9 s for
  W270G on a fresh editor); every later save re-wrote all ~22,000 actor packages (2-3 min) with byte-identical
  content. `get_dirty_map_packages()` DOES list external actor packages, and they were clean at each job's start,
  so the dirtying happens inside the job. Cause not found; hash-check against the checkpoint after every save.
- **Memory.** With every region loaded the editor grows to ~22 GB committed after a few applies and saves, and
  raised a Memory Pressure Warning at 43.8 / 48.8 GB system commit. Restart while clean: `quit_editor` job
  (refuses if dirty), count processes, relaunch `Tools/LaunchWonderlandEditor.ps1` DETACHED via WMI
  `Win32_Process.Create` (a child of a tool call dies with it). Back in 127 s at 9.2 GB with all 16 regions
  loaded. Stop map writes and PIE above ~42 GB commit.

## Ring circuit (S01), first build

`Rings/ring_probe.py` finds each ring as a Viterbi path around the whole world against the census (the WORLD
session's oriented-rectangle Occupancy; canopies not solid, trunks are; existing avenue/plaza floor is crossable).
It prefers the full 20 m road, narrows to a single lane where only that passes between towers, and reports what
blocks the rest. `Rings/ring_roads.py` paves the route with the nations' own floor (SM_terrace_platform, top +12,
colliding), kerbs flush on the ground, lantern standards every 24 m, each stretch in the palette of the nation
it crosses; it skips over existing floor (the junctions) and refuses anything standing.

Still broken (decisions, not roads through buildings):

| ring | bearing | at | what stands there | owner of the decision |
|---|---|---|---|---|
| RR01 | 27.7-29.5 | ~623 m | SKY05 tower base | WORLD (R42 seam design) |
| RR01 | 46.7-49.2 | ~600 m | V2 hedge mass | CORE (hedge gate, as W270) |
| RR01 | 88.5-91.5 | ~645 m | IC01 gatehouse (ICARUS gate) | none: the avenue is the junction |
| RR02 | 23.0-31.7 | 1,008-1,071 m | SKY05 tower cluster | WORLD (R42 seam design) |
| RR02 | 68.1-69.1 | ~1,102 m | V2 hedge mass | CORE (hedge gate) |
| RR02 | 140.4-148.3 | 1,045-1,075 m | SKY05 tower cluster | WORLD (R41 seam design) |
| RR02 | 149.8-153.1 | ~1,055 m | V2 hedge masses | CORE (hedge gate) |
| RR02 | 269.8-270.4 | ~1,078 m | W270 EXCHANGE pavilion | none: the plaza is the junction |
