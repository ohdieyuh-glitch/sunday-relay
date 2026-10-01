# Wonderland world completion matrix

> **STATUS (founder, 2026-09-29 evening)**
>
> **ENVIRONMENTAL WORLD COMPLETION: COMPLETE**
>
> **POST-COMPLETION GAMEPLAY REGRESSION: VERIFIED (2026-09-30 19:27) -- awaiting the founder's acceptance of the
> rebuilt package.** It began IN PROGRESS with three founder-observed player-facing regressions: Relay
> Dog skin locomotion on the non-OG skins, Jack Flame's secondary colour not reaching the tie, and teleport to
> the new world locations. The environmental baseline (world, package, traversal, landscaping) is frozen; see
> the POST-COMPLETION GAMEPLAY REGRESSION section at the end of this file.
>
> 2026-09-30: all three are fixed and proven in play in the editor build (Mission Contract on all five skins x 2
> deployments, Jack Flame secondary incl. save/reload, 33/33 teleport destinations). They reach players only once the
> packaged build is rebuilt, so this line stays IN PROGRESS until the founder accepts the rebuilt package.
>
> 2026-09-30 (later, founder priority update): the list grew to G1-G5 (the map declutter G5, the Jack Flame suit
> G2b, the far-origin teleport the founder hit G3b, and the Jack Flame head kept at the accepted plume G4). All five
> pass in the editor on DLL 11:05:45, and the REBUILT PACKAGE (`_wonderland_package_regression_0930`) passes its own
> in-game QA 11/11. Second Wonderland's independent falsification is running; the gate stays IN PROGRESS until it
> reports and the founder accepts. **The gates are reported separately** (founder rule): environmental 25/25, gameplay
> regression per the table below, Julius on its own ledger (accepted main 7c584df2, 82.00%).
>
> 2026-09-30 (evening): G1-G7 are FIXED (fdaa8ffe) and INDEPENDENTLY FALSIFIED by Second Wonderland on the final DLL,
> and the package REBUILT from them passes its own in-game QA 27/27 across two boots. That QA reads Jack Flame's colours
> off his materials, runs a Mission Contract on all five skins act by act, checks every body against Relay OG's
> 174.15 uu, and finds the chosen skin and colour back after a restart. One founder DECISION is open: the costume
> heads' proportions. Body height is exact; the face block sits 5.5 uu lower and is ~19% wider than Relay OG's.

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
| Arrival approaches | AP01 | 384-500 m at 90°, 210° and 330° | built on all three bearings (the first cut of this table said Icarus only: wrong) |
| Checkpoints | CP02/03/04 | ~527 m on each avenue | built |
| Nation quarters | IC02; NC01+NC02; TQ01+TQ02 | 500-850 m, along each avenue | built, **narrow strips** |
| Nation bands | IC03/04, NC03/04, TQ03/04 | 820-1,200 m | built |
| Marches | IC01; the NOCTIS and TARTARUS marches are the causeways of NC01 / TQ01 (508-815 m) through CP03 / CP04, with their gate arches at ~640 m | 500-640 m | built for all three |
| Frontiers | FR02 (+FR01/03/04 small) | 1,000-1,300 m | thin |
| Dubel Forest | DF01 | 1,231-1,479 m, 90° | built |
| Skyline towers | SKY05 | 425-1,458 m, all bearings | ~100 lone towers |
| **Ring circuit** | RR01 march ring, RR02 outer ring (`Rings/ring_probe.py` -> `ring_roads.py`) | 560-716 m, 980-1,246 m | **applied 2026-09-28**: plates, kerbs, lanterns, avenue trees; bend smoothing re-apply pending |
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
| R40 SEAM 270° rear, 500-1200 | **WORLD (assigned #1)** | STRUCT. COMPLETE (W270S/N/T + hedge gate W270G applied) | STRUCT. COMPLETE (flank groves, meadows, 2 mushroom woods) | STRUCT. COMPLETE (courts, halls, street houses, arches, gatehouse) | STRUCT. COMPLETE (garden rooms, groves) | STRUCT. COMPLETE (the seam way 511-1,111 m; floor re-yawed dca810ca, kerbs re-laid 786be14b) | STRUCT. COMPLETE (pocket watch, pavilion, gatehouse screen, ceremonial + rose arches) | IN PROGRESS | **VERIFIED** in play: zc_w270_proof 18/18 stands, 0 gaps / unpaved / steps / capsule blocks, GATE_OPEN (zzW24) | NOT STARTED | VERIFIED (200 m tiles, real streaming bounds) | IN PROGRESS (plate before/after in captures/passes; founder views to shoot) |
| R41 SEAM 150° (Icarus/Noctis), 500-1200 | WORLD (assigned #2) | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | VERIFIED | NOT STARTED |
| R42 SEAM 30° (Tartarus/Icarus), 500-1200 | WORLD (assigned #3) | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | NOT STARTED | VERIFIED | NOT STARTED |
| R50 WILD ring 1200-1480 (outside Dubel) | WORLD / SECOND | STRUCT. COMPLETE (window 1, class A: 6 woods WI030..WT330, 1,705 batches / 13,298 inst, 1,203-1,479 m) | IN PROGRESS (no ground shaping) | NOT STARTED (none planned: wild wood) | IN PROGRESS: 2,989 trees applied, but the frames show it SPARSE from the air (zzW106 wn150_aerial); densify R50b planned (cd9403fc: outer forest wall 1,420-1,478 m + fuller wood, 13,622 inst, NOT applied) | STRUCT. COMPLETE (7.5 km trail, 5 wood seams closed to 0.0 m; Dubel 58° 2.4 m; 122° sealed per the founder's hedge-ring decision) | STRUCT. COMPLETE (10 clearings, 10 landmark mushrooms, 14 patches) | IN PROGRESS | IN PROGRESS: TELEPORT proof zzW103, 116/117 stands on ground, 0 blocks except SKY05 at Dubel 122; no self-powered walk yet | IN PROGRESS (the edge reads as flat lawn to the horizon until R50b) | **VERIFIED** (1,705/1,705 resident in play, streaming complete) | IN PROGRESS (zzW106: aerial + trail per wood; trail level reads well, aerial sparse) |
| R51 Dubel Forest 1230-1480, 90° | CORE (review) | STRUCT. COMPLETE | STRUCT. COMPLETE | NOT STARTED | STRUCT. COMPLETE | IN PROGRESS | NOT STARTED | IN PROGRESS | IN PROGRESS | NOT STARTED | VERIFIED | IN PROGRESS |

**Heartland fills (WORLD, 2026-09-29; `WorldDesign/Wedges/sector_fill.py`).** The five empty heartlands between each
band avenue and its seams, filled as a GARDEN WALK (stepping stones from ring to ring, crossing both) with garden
quarters on it, rooms beside it, a mushroom wood at its end, groves in a belt and meadow drifts between; the rest
lawn on purpose. Planned against the census through the frame-aware load_census; an offline capsule sweep of each
walk runs in the generator (proven red on the first routing, green on the fix).

| heartland | spec | STATUS | TRAV | PROOF |
|---|---|---|---|---|
| HT356 TARTARUS 336-16°, 610-1,100 m | ht356_tartarus_heartland.json | **APPLIED** 2026-09-29 01:14, rooms v3 (floors, closed walls, rose borders, centre tree, benches): 238 batches / 2,943 inst; hash-clean. Bench delta APPLIED 01:44 (zzW50: 24 benches turned 180° to face the tree; hash-clean vs pre-bench-delta; frames zzW51) | **VERIFIED** SELF-POWERED zzW112 (walked 655/661 m, 0 stuck) + TELEPORT in play: zzW47 stands 11/11, walk capsule blocks 0, rooms 12/12, streaming complete | IN PROGRESS (room pairs zzW40/42/46; CORE before/after) |
| HN181 NOCTIS 159-203°, 620-1,150 m | hn181_noctis_heartland.json | **APPLIED** 2026-09-29 01:14, rooms v3: 170 batches / 2,339 inst; hash-clean. Bench delta APPLIED 01:44 (zzW50: 16 benches; frames zzW51) | **VERIFIED** SELF-POWERED zzW112 (walked 557/562 m, 0 stuck) + TELEPORT in play: zzW47 stands 9/9, walk capsule blocks 0, rooms 8/8, streaming complete | IN PROGRESS (CORE before/after frames) |
| HN238 NOCTIS 221-255° | hn238_noctis_heartland.json | **APPLIED** 2026-09-29 04:58 on the founder's explicit go, rooms v3: 232 batches / 2,933 inst; one save (zzW58, gate: 584 pass actors + 3 folder objects dirty, 0 unexpected); hash-clean vs 2026-09-29-pre-heartland3 | **VERIFIED** SELF-POWERED zzW112 (walked 702/710 m, 0 stuck) + TELEPORT in play: zzW59 stands 11/11 on ground, walk capsule blocks 0, rooms 12/12 (both doors), streaming complete, Dog alive, 232/232 batches resident | IN PROGRESS (before zzW54 / after zzW60 pairs; distant view: rooms read as bare plates past 120 m cull) |
| HI057 ICARUS 40-74° | hi057_icarus_heartland.json | **APPLIED** 2026-09-29 04:58, rooms v3: 164 batches / 2,301 inst; same save, hash-clean | **VERIFIED** SELF-POWERED zzW112 (walked 538/546 m, 0 stuck) + TELEPORT in play: zzW59 stands 9/9, blocks 0, rooms 8/8, streaming complete, Dog alive; 161/164 batches resident on the walk, the other 3 (one daisy drift 304 m off the walk) resident when stood on (zzW61) | IN PROGRESS (zzW54 / zzW60; same distant-view finding) |
| HT308 TARTARUS 294-322° | ht308_tartarus_heartland.json | **APPLIED** 2026-09-29 04:59, rooms v3: 188 batches / 2,301 inst; same save, hash-clean | **VERIFIED** SELF-POWERED zzW112 (walked 649/653 m, 0 stuck) + TELEPORT in play: zzW59 stands 10/10, blocks 0, rooms 8/8, streaming complete, Dog alive, 188/188 batches resident | IN PROGRESS (zzW54 / zzW60; same distant-view finding) |


**HN238 / HI057 / HT308 by dimension (WORLD, 2026-09-29 after the apply).** Same columns as the region matrix.

| heartland | STRUCT | LAND | ARCH | VEG | ROADS | LANDMK | DETAIL | TRAV | DIST | WP | PROOF |
|---|---|---|---|---|---|---|---|---|---|---|---|
| HN238 | STRUCT. COMPLETE | IN PROGRESS (10.6 ha lawn by design; no ground shaping) | STRUCT. COMPLETE (3 quarters, 12 rooms) | STRUCT. COMPLETE (14 groves, 90 trees, 16 drifts) | STRUCT. COMPLETE (645 m stepping-stone walk, joined 2) | IN PROGRESS (no mushroom wood or tall landmark placed) | STRUCT. COMPLETE (roses, benches facing the tree) | **VERIFIED** SELF-POWERED (zzW112: walked 702/710 m, 0 stuck; TELEPORT zzW59/zzW104 as well) | IN PROGRESS (culled past 120 m: plates read bare) | **VERIFIED** (232/232 resident in play) | IN PROGRESS |
| HI057 | STRUCT. COMPLETE | IN PROGRESS (6.8 ha lawn) | STRUCT. COMPLETE (2 quarters, 8 rooms) | STRUCT. COMPLETE (12 groves, 75 trees, 16 drifts, mushroom wood) | STRUCT. COMPLETE (510 m walk; 1 group not joined to paving) | STRUCT. COMPLETE (mushroom wood) | STRUCT. COMPLETE | **VERIFIED** SELF-POWERED (zzW112: walked 538/546 m, 0 stuck; TELEPORT zzW59/zzW104 as well) | IN PROGRESS (same) | **VERIFIED** (164/164: zzW59 + zzW61) | IN PROGRESS |
| HT308 | STRUCT. COMPLETE | IN PROGRESS (7.7 ha lawn) | STRUCT. COMPLETE (2 quarters, 8 rooms) | STRUCT. COMPLETE (13 groves, 84 trees, 16 drifts, mushroom wood) | STRUCT. COMPLETE (595 m walk; 1 group not joined) | STRUCT. COMPLETE (mushroom wood) | STRUCT. COMPLETE | **VERIFIED** SELF-POWERED (zzW112: walked 649/653 m, 0 stuck; TELEPORT zzW59/zzW104 as well) | IN PROGRESS (same) | **VERIFIED** (188/188 resident) | IN PROGRESS |

None is VISUALLY COMPLETE: at walk height the quarters read as gardens (zzW60 walk frames), but from the aerial
and distant cameras the room floors read as bare pale squares. The specs carry three cull tiers: floors (SM_terrace_
platform) 600 m, trees/topiary/mushrooms 260 m, hedges/roses/benches/flowers 120 m. The frames are consistent
with that (all batches were resident in play, so it is not streaming), but it has not been A/B tested in-engine.
Distant presence is the open visual item; before any change the cull tiers are a founder/Core look decision.
R41 / R42 (the 150° and 30° seams): the pockets P165N / P015T were WITHDRAWN (their clearance was tested against
an empty world -- load_census hard-coded the rear seam's wedge; fixed 786be14b). The seams' own axes are lined with
existing buildings between the rings (plans 2026-09-28); their open ground is what the heartland fills take.

**Emptiness, structure-only (emptiness.py --structure, 1,480 m disc).** 57.5% -> 50.1% after the ring roads -> 48.0% on the 01:54 census -> **45.1% actual** on the census re-exported 2026-09-29 05:05 after HN238 / HI057 / HT308 (3,103,775 of 6,881,500 m2; `captures/zc/census/emptiness_structure_0929_fill3.png`). The 1,200-1,480 m band holds 1.80 of the 3.10 km2 still empty. Projected from specs, not built: 27.0% with the wild ring as well. A projection counts ground within 9 m of a placement as covered.

| S01 ring circuit (march ring 560-716 m, outer ring 980-1,246 m; pinned to W270's plazas at 645 / 1,075 m) | **CORE** | STRUCT. COMPLETE | -- | -- | STRUCT. COMPLETE (487 avenue trees) | STRUCT. COMPLETE (RR01 + RR02 applied, smoothed; breaks only at SKY05 clusters, hedge gardens and junctions) | -- | STRUCT. COMPLETE (290 lanterns) | IN PROGRESS: **32/32 SAMPLED ROAD SURFACES PRESENT** (TELEPORT proof): zc_ring_walk proves plate presence at 32 teleported stands (16 per ring, ~260 m / ~450 m apart), streaming complete at each; it cannot see a gap between stands, so CONTINUITY IS UNPROVEN (instrument note, integration lane 2026-09-29). Walked-arc re-test: JUJU | -- | VERIFIED (tiled 200 m, real streaming bounds) | IN PROGRESS (before/after + in-play frames sent) |
| S02 seam radials 30° / 150° / 270° | **CORE** | NOT STARTED | -- | -- | -- | NOT STARTED | -- | -- | NOT STARTED | -- | -- | NOT STARTED |
| S03 packaged world boots Golden Arrival | **CORE** | **VERIFIED 2026-09-29 00:11**: BuildCookRun Win64 Development SUCCESSFUL (2 min; 285 streaming-cell packages generated for WL_V2_GoldenArrival_WP2; RelayCubs + RelaySkins staged); the packaged exe boots into Golden Arrival (LoadMap 4.45 s) and the runtime hash overlay shows 52 cells loaded around the player | | | | | | | | | VERIFIED | `Tools/boot_test_package.ps1`; frame `captures/zc/package_0929/packaged_boot_golden_arrival.png`; package `C:/dev/iwonder/_wonderland_package_20260929` |

WORLD PARTITION column -- **CORRECTED 2026-09-28 22:25.** It read VERIFIED on editor residency (zc_wp_regions) and
the Dog surviving far travel. Neither says the instanced world STREAMS IN PLAY, and it did not: every
WonderlandInstancedBatch reported a point at the origin as its streaming bounds, so all 4,826 spatially loaded
batches lived in the one cell at the origin, resident near the core and absent beyond it. The beta walk's stands
beyond ~700 m traced the -14 lawn in play (WORLD session, zzV4 re-read). Fixed in f97ba360 (GetStreamingBounds
returns the instances' covered box; all 5,033 descriptors re-saved and read back exact). Every region beyond the
core is **FIX LANDED, PIE RE-PROOF PENDING** until zzW10 / the walk re-run on the fixed map; the VERIFIED marks in
the table stand for the core only.

DISTANT VIEWS after the fix are a founder decision (runtime streaming): with the map's 512 m loading range and no
HLODs built, a vantage in the core holds ~85 % of the world's instances and one at 785 m ~35 % (WORLD session's
table). Options: raise the MainPartition LoadingRange (1,024 m -> ~99 % from the spawn; measure memory), build
HLODs (canonical, heavy), or keep landmark batches always loaded. Nothing changed until the founder decides.
**Measured 2026-09-28 23:36** (zc_distant_views, waiting on World Partition's own IsAllStreamingCompleted):
from the plaza 2,753 batches / 124k instances resident at 512 m vs 5,116 / 175k with a runtime-only 1,024 m
override; from the march looking down the rear seam 1,713 / 77k vs 4,979 / 167k. The VISIBLE difference is small
(a few far structures on the horizon): skyline batches sit on high grid levels and show at both ranges. CORE's
recommendation to the founder: keep the shipped 512 m. Frames: captures/zc/distant_views_0928.

## CURRENT REGION QUEUE (CORE, 2026-09-29 ~05:40, founder directive "COMPLETE WONDERLAND TODAY")

Start SHA b4c58c4a. Measured base: structure-only emptiness **45.1 %** (3.10 km²; 1.80 km² of it at 1,200-1,480 m).
Empty by wedge x band (ha, 05:05 census): 600-1,000 m 7.6-14.7 per 60° wedge; 1,000-1,200 m 6.0-9.3; 400-600 m 2.1-3.9.
Map: editor 33092 has used its ONE save (zzW58). **The next writer relaunches first.** Writes are serialized by
MAP WRITE REQUEST / COMPLETE messages. CORE = "Wonderland" session, SECOND = "New second wonder".

| # | region | owner | status | biggest missing element | dependency / blocker |
|---|---|---|---|---|---|
| Q1 | R50 wild ring 1,200-1,480 m (outside Dubel) + WORLD EDGE | SECOND | window 1: 6 woods (class A). R50b densify: WINDOW 4a APPLIED (class A, 635e8c7d): WX030/WX122/WX150 498 batches / 4,976 inst, 498/498 resident in play, 0 new trail blocks. WINDOW 4b APPLIED (class A): WX210/WX270 468 batches / 5,825 inst (memory gate 39.5 GB commit, ONE save 10.2 s, 470 dirty = 468 pass + 2 folders, hash +470 / -0 / stub only); TELEPORT proof zzW233: 468/468 batches and 5,825/5,825 inst resident in play, 46/46 stands on the -14 ground, 0 blocks on the WN210/WT270 trails; emptiness 19.0 -> 16.2 %, unintended 11.8 -> 10.2 % (emptiness_classes after its built-walks-only and checkpoint-ground fix; the unpatched audit credited the staged S3 walks: 11.3 -> 9.7). WINDOW 4c APPLIED (class A): WX330 227 batches / 2,821 inst (+ the S2N246 / S2I088 re-applies, Q2); ONE save 11.9 s at 37.2 GB commit; hash +325 / -147 (exactly the recorded replaced set) / stub only; TELEPORT proof zzW246: 24/24 stands, 0 blocks, 227/227 resident. The wild ring's six woods and their densify are all applied; emptiness 16.2 -> 15.0 %, unintended 10.2 -> 9.6 %. Dubel's inner edge (58-122 deg, 1,050-1,345 m) is S5 + S5b APPLIED in WINDOW 5d (class A): S5D090 Dubel's inner edge graded into the frontier (203 batches / 1,395 inst, 334 trees) and S5W090 Dubel's OUTER wall at 1,420-1,478 m in DF01's palette (152 batches / 1,207 inst, 544 trees), meeting WX030 / WX122 inside EDGE01; in play 458/458 resident, DF01's path swept (the one stop is DF01's own trunk between its path points). TREE CULL 260 -> 600 m on the wild ring, its densify, S2 / S3 and W270 (1,718 batches, CORE's A/B gate, dd496f0e): in PIE all 619 loaded tree batches read 60,000 (zzW447). EDGE01 APPLIED in 4a: 48 hidden pawn-only wall segments at 1,485 m; SELF-POWERED outward walks STOP at 1,481.9 m (1.75°) / 1,483.4 m (89.5°) -- JQ-F01 closed pending an independent re-test | -- (JQ-F01's independent edge re-test) | done |
| Q2 | Sector fill 2 (22 wedges inside 1,200 m, incl. the Q11 rim) | SECOND | **WINDOW 3 APPLIED** (class A, 01b9416b): 1,097 batches / 10,595 inst. TELEPORT 57/57 stands on ground, rooms 4/4, 1,097/1,097 resident; SELF-POWERED 12/13 walks arrived (2,531 m). S2N246's walk ran through a castle hall -> stones removed; S2I088 planted 19 plants 1.5-29 m off the 90 deg axis in front of CP05 -> removed (CORE's REMOVE). Both RE-APPLIED in window 4c (class A): S2N246 57 -> 17 batches, S2I088 90 -> 80; 0 S2I088 plants within 30 m of the axis from 1,060 m to CP05 (census); in play S2I088 2/2 stands, 0 blocks, 80/80 resident, S2N246 17/17 resident. The planner now reserves the sightlines and checkpoint grounds (15e5aafd). Sector fill 3 (38 wedges, TW03 band excluded): WINDOW 5a APPLIED (class A): 21 passes / 443 batches / 3,657 inst (ONE save 7.2 s at 37.1 GB; hash +464 by tag / -0 / stub only); TELEPORT 36/36 stands, 0 blocks, 443/443 resident. CORE's visual review (11:48): the fills read LOW at distance -- 5a is 57 trees against 1,795 flower-run pieces and 1,496 stones -- so the unapplied S3 second half and S4 are retired and re-planned as one MASSING round (groves at 13 m clearance, drifts capped), and the applied drift-heavy fills get a grove overlay. MEASURED: that re-plan still gave 118 trees, so it was dropped; the S3 second half and S4 are RETIRED unapplied and their ground goes to the S6 copse fill (Q3) | -- | done |
| Q3 | Frontiers R12 / R22 / R32, 1,000-1,200 m (+ heartland massing, 620-1,210 m) | SECOND | Frontier strips in S2 (window 3). TREE MASSING, S6 copse fill (copse_fill.py, b7004598; CORE's silhouette review): 17 passes / 1,010 batches / 2,490 trees seeded only on UNINTENDED cells. WINDOW 5b APPLIED (class A): S6T010 / I030 / I050 / I070 / I090 / I130 / N150 / N170, 437 batches / 2,163 inst (ONE save 10.0 s at 38.1 GB; hash +445 by tag / -0 / stub only); in play 86/86 stands, 0 blocks on 6 applied walks and 19 road stretches (RR01 / RR02 / SR030 / SR150), residency 437/437 with a settle over every 200 m tile (one mid-sector stand under-streams). Emptiness 13.8 -> 11.6 %, unintended 8.5 -> 6.6 %. WINDOW 5c APPLIED (class A): S6N190 / N210 / N230 / N250 / T270 / T290 / T310, 470 batches / 2,870 inst (ONE save 6.6 s at 37.7 GB; hash +477 by tag / -0 / stub only); in play PROVED: 95/95 stands, 0 blocks on 5 applied walks and 10 road stretches, 470/470 resident. Emptiness 11.6 -> 8.9 %, unintended 6.6 -> 4.3 %. **PERFORMANCE: the tree-cull gate (CORE's) PASSED** -- 14,699 of 25,634 tree instances culled at 260 m, hiding half of what 512 m streaming loads; A/B in PIE (zzW432, gameplay camera, B/R/B/R x 10 s, throttle off, no fps cap): frontier 36.0 -> 39.1 fps mean (p5 29.3 -> 32.3), heartland-to-ring 38.8 -> 40.0 (33.2 -> 34.7), RR02 38.9 -> 39.8 (33.3 -> 34.1), i.e. flat within noise; verified (zzW433): component culls read back 26,000 -> 60,000, and the raised heartland frame draws the ring (18,027 horizon px changed vs a 6,077 px noise floor). WINDOW 5d APPLIED (class A): S6T330 / T350 + S5 / S5b + the cull edit (SECOND's 41 passes, 1,718 tree batches); ONE save with the in-job memory gate (37.3 GB), hash +462 by tag / -0 / changed = exactly the 1,718 tree batches; in play 77/77 stands, 458/458 resident, 0 blocks by S5 / S6 (8 by DF01's trunk and SF03's retaining wall, CORE's list), cull read back 60,000 on all 619 loaded tree batches. **S6 COMPLETE: 17 passes, 1,010 batches, 2,490 trees, all applied and proven.** Emptiness after 5d: **7.0 % empty, 2.8 % unintended** (19.5 ha in 545 pockets; every pocket over 0.28 ha is core / march / TW03 ground, CORE's). Before/after frames: Tools/captures/zc/massing_0929/ | -- | done |
| Q4 | Distant readability of 5 heartland fills | SECOND | RE-APPLIED + SAVED window 1 (hedges/roses/benches 260 m, trees/topiary 600 m, 11 landmark markers; 11/11 resident in play zzW105) | A/B (zzW60 vs zzW106): the rooms now carry trees at range and hedge rims show on the aerials; hedges still drop at 600 m | none |
| Q5 | S02 seam ways 30° / 150° (270° = W270S) | CORE | **APPLIED + SAVED** (window 1, class A). SR030 joined to RR02 through gate GB and round its SKY05 tower by SX01 (window 2A). **SELF-POWERED: SR030 + SX01 + GB 564/568 m** (zzW113); SR150 TELEPORT 18/18 stands | SR150 self-powered walk | -- |
| Q6 | Tower identity outward: TW01 Tower Rise (111° 478 m), TW02 Tower Lane, TW03 Icarus tower approaches | CORE | **ALL APPLIED** (TW01 window 1; TW02 window 2B; TW03 window 2C, 8 hamlets; all class A). **SELF-POWERED: TW02 lane RR01 -> TW01 gate -> court 278/294 m**; TW01 gate stand TELEPORT | TW03 hamlet walks (8 joined walks, not yet walked) | -- |
| Q7 | MG01 Mushroom Grove (297° 984 m) + entry | CORE (+ SECOND's entry S2M297) | **APPLIED** (window 1; entry window 2A). **SELF-POWERED: entry 241/250 m** (zzW113) | mushroom identity spreads via SECOND's S4T294 mushroom wood | -- |
| Q8 | DESIGNED HEDGE GATES in the V2 hedge ring (founder 2026-09-29) | CORE | **ALL APPLIED** (2A: GB, GE; 2B: GA, GC, GD; class A; 12 hedges relocated, 3 trimmed by SINK_UU, guarded + reversible records). **SELF-POWERED through every gate: GA 113/117, GC 137/139, GD 189/194 (bypass), GB (SR030) 564/568, GE (Dubel 58°->122°->WI122) 1,553/1,576 m** | independent re-test | -- |
| Q9 | R41 / R42 seams 150° / 30°, 500-1,200 m (fills) | SECOND | UNBLOCKED (polylines sent 05:31; keep 20 m off each road's centreline) | seam identity between two nations | Q5 polylines |
| Q10 | R00 / R01 Golden Arrival + 24 quarters | CORE | **GA AXIS SELF-POWERED END TO END 32/32** after GS01 fixed the floating-flagstone ledge (GA-F01, window 2D). Core district walks 9/12 SELF-POWERED (CL02 ends at its landmark tower; WG02 / RG02 stops are route artifacts). 24 quarters classified (founder: preserve core, identities outward) | GA rear-world leg (a castle hall on the planned way; planner v2). Flanks SELF-POWERED 2/2 from the north arches (12:10) | -- |
| Q11 | R02 core rim 400-600 m | SECOND (in sector fill 2) | APPLIED in window 3: S2I073, S2N179, S2T300 (S2N246's walk to be removed in 4c); smaller rim pockets are in S3 (S3N232, S3N260, S3T002, S3I065, S3N152) | -- | 5a/5b |
| Q12 | P5 Bible reconciliation | CORE | **FIRST CUT DONE**: Bible features by census; Tower Rise / Mushroom Grove RELOCATED WITH INTENT and built; 24 quarters SUPERSEDED WITH DOCUMENTED REASON (founder); books/scrolls NOT IN KIT; GA08 arrival lamps HELD (lighting hold) | founder review of the table | -- |
| Q13 | Final gates: emptiness, beta walk on real streaming, packaged boot + streaming, independent qualification | CORE | PENDING: after SECOND's windows 4c / 5a / 5b / 5c / S5. Independent QA needs a separate session (founder: JUJU and the integration lane reassigned to Julius) | -- | everything above |

**The 24 core quarters, classified (CORE Q10, census re-exported 05:55 after window 1; founder decision 2026-09-29:
preserve the accepted core, carry missing identities outward).** Kind pieces counted by mesh: towers = castle_tower*,
tower_capped, tower_clock, WL_Tower_*, WL_Spire_* (castle HALLS are not towers); groves = mushroom giant / landmark /
medium / small; gardens = hedge, topiary, rose, flower, parterre, shrub, urn, planter, fountain. Survives: towers >= 3,
groves a giant or landmark and >= 6 mushrooms, gardens >= 50 pieces; PARTLY = some.

| site | bearing / r | original kind | current built identity (census within 25 m) | kind pieces | survives locally | carried outward |
|---|---|---|---|---|---|---|
| Q01 | 200° 110 m | garden | Grand Clock / Tea Terraces, lawn fill, V2 base garden (697 pieces) | 299 garden | YES | -- |
| Q02 | 232° 135 m | towers | V2 base garden, seat detail, city fill (383 pieces) | 0 tower | NO | TW01 Tower Rise (111° 478 m); SKY05 skyline towers; ICARUS march |
| Q03 | 263° 102 m | grove | Water Gardens, V2 base garden, lawn fill (1378 pieces) | 0 mushroom (0 giant/landmark) | NO | MG01 Mushroom Grove (297° 984 m); HI057 / HT308 mushroom woods; Dubel; wild-ring landmark mushrooms |
| Q04 | 295° 140 m | garden | V2 base garden, city fill, seat detail (198 pieces) | 19 garden | PARTLY | -- |
| Q05 | 326° 112 m | towers | V2 base garden, seat detail (124 pieces) | 0 tower | NO | TW01 Tower Rise (111° 478 m); SKY05 skyline towers; ICARUS march |
| Q06 | 356° 130 m | grove | Grand Clock / Tea Terraces, V2 base garden, Clock Quarter (923 pieces) | 0 mushroom (0 giant/landmark) | NO | MG01 Mushroom Grove (297° 984 m); HI057 / HT308 mushroom woods; Dubel; wild-ring landmark mushrooms |
| Q07 | 25° 115 m | garden | lawn fill, V2 base garden, seat detail (465 pieces) | 366 garden | YES | -- |
| Q08 | 56° 138 m | towers | Cloister, lawn fill, V2 base garden (1162 pieces) | 6 tower | YES | -- |
| Q09 | 128° 125 m | grove | V2 base garden (80 pieces) | 4 mushroom (1 giant/landmark) | PARTLY | MG01 Mushroom Grove (297° 984 m); HI057 / HT308 mushroom woods; Dubel; wild-ring landmark mushrooms |
| Q10 | 152° 108 m | garden | V2 base garden, lawn fill, seat detail (393 pieces) | 203 garden | YES | -- |
| Q11 | 176° 142 m | towers | lawn fill, V2 base garden, seat detail (524 pieces) | 0 tower | NO | TW01 Tower Rise (111° 478 m); SKY05 skyline towers; ICARUS march |
| Q12 | 108° 155 m | garden | V2 base garden, garden court, SKY (132 pieces) | 27 garden | PARTLY | -- |
| S01 | 324° 95 m | garden | V2 base garden, S, border course (115 pieces) | 33 garden | PARTLY | -- |
| S02 | 213° 93 m | towers | V2 base garden, lawn fill, tea set (368 pieces) | 1 tower | PARTLY | TW01 Tower Rise (111° 478 m); SKY05 skyline towers; ICARUS march |
| S03 | 47° 152 m | grove | lawn fill, V2 base garden, Cloister (1060 pieces) | 3 mushroom (1 giant/landmark) | PARTLY | MG01 Mushroom Grove (297° 984 m); HI057 / HT308 mushroom woods; Dubel; wild-ring landmark mushrooms |
| S04 | 133° 156 m | garden | V2 base garden, SKY, Way (74 pieces) | 18 garden | PARTLY | -- |
| S05 | 83° 131 m | towers | Royal Gardens, V2 base garden, border course (199 pieces) | 3 tower | YES | -- |
| S06 | 115° 98 m | grove | V2 base garden, SKY, border course (165 pieces) | 12 mushroom (3 giant/landmark) | YES | -- |
| S07 | 64° 98 m | garden | Royal Gardens, V2 base garden, seat detail (966 pieces) | 248 garden | YES | -- |
| S08 | 314° 137 m | grove | V2 base garden, wall border, lawn fill (164 pieces) | 5 mushroom (1 giant/landmark) | PARTLY | MG01 Mushroom Grove (297° 984 m); HI057 / HT308 mushroom woods; Dubel; wild-ring landmark mushrooms |
| S09 | 225° 134 m | garden | V2 base garden, seat detail, Teapot Court (423 pieces) | 124 garden | YES | -- |
| S10 | 13° 115 m | towers | Clock Quarter, V2 base garden, lawn fill (1163 pieces) | 1 tower | PARTLY | TW01 Tower Rise (111° 478 m); SKY05 skyline towers; ICARUS march |
| S11 | 169° 116 m | grove | V2 base garden, seat detail, lawn fill (574 pieces) | 0 mushroom (0 giant/landmark) | NO | MG01 Mushroom Grove (297° 984 m); HI057 / HT308 mushroom woods; Dubel; wild-ring landmark mushrooms |
| S12 | 270° 106 m | garden | Water Gardens, lawn fill, V2 base garden (1206 pieces) | 441 garden | YES | -- |


**Bible reconciliation (CORE Q12, first cut 2026-09-29, census 05:05).** The Bible is the board set in
`wonderland-blender-forge/wonderland/v2/reference/boards` (visual authority, not a district list); the district canon
is the forge's 14 districts + 3 nations. Features by census count and median radius:

| Bible feature | in the world | status |
|---|---|---|
| Gold gates & ornamental metalwork | SM_gate_arch_gold 387, gate leaves 375, piers 310, heart finials 7 (median ~330 m) | BUILT |
| Clocks & timepieces | 89 (SM_clock_ornate 46, SM_tower_clock 34; p90 647 m) | BUILT (core); TW01 adds a clock tower at 478 m |
| Giant mushroom landmarks | 129 pieces (p90 535 m) | BUILT in the core; outer world thin -> MG01 (984 m), heartland mushroom woods, wild ring landmark mushrooms |
| Royal gardens & topiary, heart topiary | topiary 1,323; SM_heart_topiary 5; GA06 heart arch | BUILT |
| Arches & bridges | 7,462 arch pieces; WL_Bridge_Sky 84 sets (median 885 m) | BUILT |
| Turrets & spires / distant skyline | 754 spire pieces; SKY05 ~100 towers to 1,458 m | BUILT |
| Columns & ornaments | SM_column_ornate 799 (p90 398 m) | BUILT (core) |
| Water features | fountains 66 pieces (p90 342 m) | BUILT (core only) |
| Floating islands / balloons | 22 island pieces, 54 balloon pieces (p90 <= 379 m) | BUILT (core sky) |
| Paths, plazas, medallions | medallions 172 (median 731 m); ring roads, avenues, seam ways | BUILT |
| Props: keys, teapots/tea sets, signs | keys 19, tea 181, signs 174 | BUILT |
| Props: books & scrolls | 0 -- no mesh in the kit | NOT IN KIT (small prop; add when the kit has one) |
| Butterflies / petals (atmosphere) | not census geometry | runtime effect, outside the world audit |
| Tower Rise (forge district) | none in the core | RELOCATED WITH INTENT -> TW01, 111° 478 m |
| Mushroom Grove (forge district) | none in the core | RELOCATED WITH INTENT -> MG01, 297° 984 m |
| 24 core quarters' kinds | built; towers 2 yes / 2 partly / 3 no, groves 1 / 3 / 3 (Q10 table) | SUPERSEDED WITH DOCUMENTED REASON: core preserved (founder 2026-09-29); tower identity carried to TW01, grove identity to MG01 and the mushroom woods |

Pattern: the Bible's landmark language (clocks, fountains, columns, giant mushrooms, sky islands) is almost all
inside ~650 m. The outer world's identity has to come from the heartland rooms, mushroom woods, TW01 / MG01, the
wild ring's landmark mushrooms and the skyline towers.

**R51 Dubel path (CORE).** DF01's path is 29 lawn patches 30 m apart. DW01 (`Districts/dubel_walk.py`, 442c89b4, NOT
APPLIED) lays 333 stepping stones on it, additive, joined to the WI030 / WI122 trail stones; 34 detour round a SKY05
tower base and hedge masses on DF01's own path line at 115-122°. For CORE's window 2.
**Dubel <-> wild ring at 122° is SEALED** (found 06:20): DF01's path ends between two SKY05 towers (bases ~110 m and
~175 m across) behind a V2 hedge-ring mass; no 1.8 m way round within 150 m (grid search on the post-window-1 census).
Dubel joins the wild ring at 58° only. Opening 122° means a V2 hedge-ring gate: **FOUNDER DECISION**, the same one as
the ring-road hedge barriers (Q8).

## Window 1 forensic record and founder process rules (2026-09-29 06:15)

**MAP RECOVERY: window 1 = A (CLEAN).** The editor (PID 70880) died 20 ms after `save_map` completed ("took 165.160"),
in an autosave assert (ExternalPackage->IsDirty(), FileHelpers.cpp:3527). Forensics against checkpoint
`recovery/_map_checkpoints/2026-09-29-2026-09-29-pre-window1`, from the files, not timestamps:
- every one of the 25,955 live actor and object packages carries the package tag 0x9E2A83C1 at header and footer; 0
  zero-byte; the .umap stub's header and footer are valid;
- full sha256 inventory: +2,782 actor packages, +10 folder objects, -992; only the stub changed among pre-existing
  files;
- ADDED by embedded WL_PASS tag = the 15-apply transaction exactly: WI030 200, WI122 168, WN150 368, WN210 348,
  WT270 317, WT330 304, HT356 241, HN181 172, HN238 235, HI057 165, HT308 190, TW01 17, MG01 13, SR030 21, SR150 23;
  0 unattributed;
- DELETED, attributed from the checkpoint copies: HT356 238, HN181 170, HN238 232, HI057 164, HT308 188 (the old
  heartland actors, their prior counts exactly); nothing from any other pass.
Autosave is now off (bAutoSaveEnable=False, SECOND). Script: CORE scratchpad forensic_w1.py (to be moved into Tools/).

**Founder process rules (06:13, via JUJU):**
- Future write windows are SPLIT into small transactions (e.g. A HN238+HI057+HT308 / B R50 / C TW01+MG01 /
  D SR030+SR150), smaller if needed.
- A MEMORY GATE is recorded before every save: editor private GB, system commit GB, dirty count; no save above the
  line.
- Every walk proof is classified SELF-POWERED / TELEPORT / MIXED in this matrix.
- The ring baseline reads "32/32 SAMPLED ROAD SURFACES PRESENT".

**Window 2A (CORE, applied 2026-09-29 06:38-07:00, class A).** Fresh editor (save count 0), checkpoint
`2026-09-29-pre-window2a`, zc_hedge_gates (2 relocations + 1 SINK_UU trim), HG2A 52 / DW01 120 / SX01 12 / S2M297 12
batches, ONE gated save (memory gate: commit 33.6 GB, 202 dirty = 196 pass + 2 hedge batches + 4 folders, 0
unexpected). Hash vs the checkpoint: +200 (the four passes to the unit + 4 folders), -0, changed = stub + the two
hedge batch packages. Editor closed and relaunched (PID 74528). Proof: **SELF-POWERED 3/3 ARRIVED** (SECOND zzW113, one placement per start,
0 stuck): SR030 + SX01 + GB 564/568 m; Dubel 58° -> GE -> 122° -> WI122 1,553/1,576 m; MG01 entry 241/250 m.
**TW02 Tower Lane (CORE, NOT APPLIED, window 2B).** TW01's gate joined to RR01 (285 m of stones), three small tower
groups (9 towers, three roof palettes) in the 111° pocket. TW01 is reached from the city by the 90° approach and
RR01; the direct leg to the core is sealed by the inner V2 hedge ring (400-550 m) and is not a required route.

**Window 2B (CORE, applied 2026-09-29 08:12-08:17, class A).** Fresh editor, checkpoint `2026-09-29-pre-window2b`,
zc_hedge_gates plan_2b (9 relocations + 1 trim), HG2B 28 / TW02 44 batches, ONE gated save (commit 31.8 GB, editor
10.3 GB, 76 dirty all matched), hash vs checkpoint +74 / -0 / stub + 2 hedge batches. Relaunched (PID 71964). Ring
continuity through GA / GC / GD: JUJU self-powered arcs -- pending.

**World edge (JQ-F01, JUJU 08:24; P2 walk-off-the-world; CORE decision).** The only floor is `V2_GroundSlab`, a
3,000 m SQUARE (ext 150,000 uu, z -44): it ends at 1,500 m on the axes and ~2,120 m at the corners, and nothing
confines the rim, so a walker heading out along 0/90/180/270 deg past the wild ring can fall off the world. The census
holds nothing beyond 1,485 m but sky clouds; the beta-walk tiles centred at ~1,552 m were off the floor. FIX
(SECOND, window 4): an invisible pawn-only blocking ring at ~1,485 m (continuous, <= 200 m segments with real
streaming bounds, not always-loaded) plus the R50b forest wall at 1,420-1,478 m. Proof: SELF-POWERED walk outward on
0 deg and 90 deg stopping at the ring; JUJU re-test.
**Gate retired with reason: beta walk W05** ("the wilderness belt has DF01's clearings" as >= 1 wholly empty 200 m
wilderness tile) was calibrated to the pre-wild-ring world: with R50 applied every wilderness tile is planted and the
clearings are sub-tile. Replaced by JUJU's direct clearing test (JQ22) against the clearing specs.

**Ring continuity through the new gates, SELF-POWERED 4/4 (CORE-run, builder-side, 09:33-09:38; zc_trail_walk,
one placement per start, 229.5 cm/s, 40-49 fps, 0 stuck):** GA RR01 43.5-52 deg 113/117 m; GC RR02 64.5-71.5 deg
137/139 m; GD RR02 146.5-155.5 deg with the SKY05 bypass stones spliced 189/194 m; TW02 lane RR01 -> TW01 gate ->
court 278/294 m. (GB was proven by SECOND's zzW113.) JUJU's handed-over jq_ring_arc_1..3 were run and are VOID: their
actuator probe needs the editor in the OS foreground (the founder was using the machine); every walk verdict was
withheld by the harness, PIE ended by CORE, nothing judged. Not independent qualification: a separate QA session is a
founder decision (JUJU and the integration lane were reassigned to Julius at ~09:00).
**Window 2C (CORE, applied 09:40-09:43, class A).** TW03 Icarus tower approaches, 290 batches / 1,006 inst: 8 tower
hamlets (courts, kit-stacked ivory towers, attendants, grove clumps, walks joined 8/8) on the unintended pockets of
100-135 deg. Fresh editor, checkpoint `2026-09-29-pre-window2c`, ONE gated save (commit 35.9 GB, 291 dirty all
matched), hash +291 / -0 / stub only. Projected: emptiness 21.8 -> 20.9 %, unintended 13.2 -> 12.3 %.
**Emptiness after window 3 (08:37 census): 21.8 % empty = 13.2 % UNINTENDED + 3.1 % meadow + 2.8 % traversal + 1.7 %
rim + 1.1 % forest / clearings.**

**Emptiness after window 4a (10:47 census, patched audit 12c2c67b): 19.0 % empty; UNINTENDED 11.8 %, vista 0.3 %, traversal
1.7 %.** (The patched classifier counts only BUILT walks -- the first reading credited traversal to planned S3 sidecars --
and gives each checkpoint its paving + 30 m of ceremonial ground.) **After window 4b: 16.2 % empty, UNINTENDED 10.2 %.
Staged (4c + 5a + 5b): 12.1 % / 7.5 %.** Audit fix 42e90c65: `emptiness.py` now skips hidden geometry --
the EDGE01 invisible edge ring (read as ~110 m discs it falsely "covered" the band inside the rim: 16.3 % before the
fix) and the V2_MarbleWorld_Scaffold (no numerical effect: the core is 0.0 % empty to 200 m either way). Figures
before window 4a are unaffected. Series: 45.1 % (morning) -> 26.3 % (window 1) -> 21.8 % (window 3) -> 19.0 % (4a) -> 16.2 % (4b).
**GA-F01 (Golden Arrival axis, CORE, P1 on the arrival spine).** The self-powered axis walk stops reproducibly at
(67, 6868): MQ04's first two palace-walk flagstones float at pivot z 19 (top +25) over the heart-garden lawn (-14), a
38.9 cm rise the Relay Dog does not step (found with a Pawn-profile sweep IN PLAY; editor-world traces do not see
instanced-batch collision). Fix GS01 (one flight of SM_path_steps up onto the walkway's south edge) for window 2D;
the floating slabs remain a visual flaw for founder review.

**Window 2D (CORE, applied 11:03, class A).** GS01 axis steps: 1 batch, fresh editor, ONE gated save (commit 32.8 GB,
dirty 2 all matched), hash +2 / -0 / stub only. **PROOF: the Golden Arrival axis walks end to end SELF-POWERED --
approach gate -> palace entrance, 32/32 waypoints, 169 m at 228 cm/s -- over the new steps (GA-F01 fixed;
CORE-run).** The integration lane's navigator harness was retried with MOVE_WALKING set at spawn and still could not
drive the Dog from the spawn point (peak speed 0); zc_trail_walk, which places the Dog off the spawn first, is the
working instrument. GA's rear-world and flank-garden legs need a navigator on the census-dense core and are OPEN.

**CORE self-powered proofs, 11:20-11:28 (zc_nav_walk, CORE-run):** SR150 seam way 428/432 m ARRIVED; all 8 TW03 hamlet
walks ARRIVED (gate -> nearest paving, 0 detours). GA rear-world / west / east flank legs still stop (castle hall,
planter) after 4 detours each -- they need an in-play planner through the arches; OPEN.

**GA flank gardens (CORE, 11:44-11:50, in-play).** BP_RelayDog_C measured in PIE: capsule r 35.9 / half-height 87.1,
MaxStepHeight 30 cm, walkable 46 deg. West leg: the Dog entered the west flank garden on foot (80 m, 23/26 waypoints),
stopping at a garden wall on the way north. East leg: the plaza's east edge is lined by forge-era RAISED PLANTER beds --
SM_side_steps (0 -> +60) each facing a SM_retaining_wall (+60 -> +144), continuous from y -9 to +11 m -- decorative, not
a route; the integration lane's east leg (plaza -> x 15 m at y 4 m) crosses them. Whether the east flank is reachable
from the clock plaza's east arch (its likely designed entrance) is the next self-powered test. OPEN.
**Visual review 11:48 (16 editor-world frames, `Tools/captures/zc/core_0929/`):** MG01, TW01/TW02, the GA west flank
and the new GS01 steps read authored. Two findings routed to SECOND: Dubel's OUTER edge (58-122 deg) ends in a hard
band -- the ground slab's edge -- with no forest wall (WX stops at Dubel's arc); and from ~1.3 km the outer world still
reads as lawn with lone skyline towers (the fills are low: drifts, stones, single trees), so remaining windows favour
grove massing. Two frames (SR150 road, gate GD) are bad camera poses, to retake -- not world findings.

**CORE read-only proofs, 12:05-12:40 (editor 76780 lent by SECOND between windows; zc_nav_walk, CORE-run; no writes,
no save):**
- **GA flank gardens reached from the clock plaza's NORTH arches, SELF-POWERED 2/2:** east 72.6 m, west 72.1 m, 13/13
  waypoints each. The arches are the designed entrances; the east plaza-edge planters are decorative. GA's REAR WORLD
  (behind the palace) stays OPEN: the palace-entrance -> rear leg meets a castle hall at (1,693, 9,638).
- **Landmark reachability, SELF-POWERED 62/66** (V2 mushroom and district landmarks, 745 m walked). The four misses:
  two placements set the Dog on a giant mushroom's cap 13 m up at (-5,427, 8,603), an instrument fault, not a world
  finding; one stopped at TC03's Landmark2 stones (164 m); one at V2 kerb stones at (11,530, -28,029) (303 m). All
  four are re-tested by planner v2.
- **Avenues AV01-AV03: NOT PROVEN.** The straight centrelines stop at the palaces standing on them: AV01 at the IC02
  dome (703 m), AV03 at the TQ01 dome (810 m). The census-paved lines stop in three places:
  - AV01 at 515 m. The route ran through CP02's 15 m stone ring base (the checkpoint's centrepiece), so this is a
    route artefact.
  - AV02 at 718-722 m, twice, with no blocker named.
  - AV03 at 811 m, at SF03's Garden_Retaining_Run.

  SECOND's census also puts V2 hedge masses on the AV01 line at 848 m and on RR02 at 205° (1,236 m).
  Next is `Tools/editor_jobs/zc_pie_planned_walk2.py`:
  - A* on play collision. A cell is free when a capsule standing STEP cm up overlaps nothing.
  - 25 cm midpoint step checks, both directions.
  - A target inside an obstacle snaps to the nearest free cell.
  - The planner hovers the Dog so streaming is complete before tracing.
  - Every stop gets a floor profile and eight named sweeps, then a placement-resume.

  Designed fixes follow the diagnosis: steps like GS01, hedge relocation like the ring gates, or detour paving.
- **Planner v2 smoke test (13:02, editor 77328 after SECOND's 5b, read-only):** the three landmark misses re-walked
  SELF-POWERED and ARRIVED: both giant-mushroom landmarks at (-5,427, 8,603) and TC03's neighbour. **Landmarks: 65/66
  reached on foot.** The 66th (V2 mushroom landmark at (11,292, -28,059)) stands in a raised planter inside the South
  Cloister: its kerb rim is at +130..+161 over a +15 floor. The Dog reaches the rim 2.4 m from the landmark's centre, so
  it counts as reached to its base, not stood beside. GA's designed rear leg (integration lane, zzJ01) runs into the V2
  palace complex (castle halls and towers from x -2,000 to +2,500, y 9,700-14,500), so there is no way along it at all.
  The rear world (y > 14,500) is being tested round the complex's west and east sides.
- **Core-to-nation traversal, planner v2 (13:07-13:42, 2,107 s, read-only):**
  - **GA REAR WORLD: SELF-POWERED ARRIVED** round the palace complex's WEST side: entrance (300, 9,650) -> (0, 16,500),
    156 m, 0 stops. The east side is closed by PL01's palace wing and castle halls; one designed way is enough.
  - **AVENUES WALKABLE ON PLANNED ROUTES, 0 stops:**
    - AV02: CP03 -> Noctis end (1,192 m).
    - AV03: AP01 -> CP04 -> end (1,162 m).
    - AV01: CP02 + 10 m -> end, through IC02, IC03's ceremonial arch (824 m) and the 848 m hedge.

    The morning's 515 / 703 / 718-722 / 810 m stops were artefacts of census-drawn routes, not world defects. The
    walks resumed by placement after earlier stops, so they are recorded as MIXED legs; the avenue stretches ran with
    0 stops.
  - **The open questions are the city -> checkpoint approaches, inside the V2 core (90-370 m):**
    - ICARUS (90°): the palace complex, the GreatSpire precinct (body centre (0, 33,000), a +216 podium ~49 m round,
      a ring of 20 rose cones at 75 m) and a castle hall at (0, 36,000) stand across the line. The AP01 causeway starts
      inside the cone ring at 385 m.
    - TARTARUS (330°): Gatekeeper Fields' gatehouse (12 x 30 m, (16,555, -8,899)) and glass screen (21 m,
      (19,194, -10,711)) cross the line at 185-220 m.
    - NOCTIS (210°): one snag in a narrow castle-arcade gap at 362 m, which the plan squeezed through diagonally.
    - CP02's side ground sits behind the causeway's 32 cm kerbs; the causeway runs straight on to AV01.

    Planner v2.1 (no corner cutting, 48 cm planning clearance, 80 m retry boxes, planned-z resume) re-tests all three
    approaches with targets round the precinct and the gatehouse.
- **CORE -> NATION END, planner v2.1 (14:11-14:44, 1,974 s, editor 78436 after SECOND's 5c, read-only; CORE-run):**
  - **ICARUS: SELF-POWERED ARRIVED, 0 stops**, 37/37 pairs planned on play collision, 1,442 m in 627 s. Route: GA
    (0, 2,000) -> axis -> palace entrance -> round the palace complex west -> rear world -> round the GreatSpire
    precinct -> AP01 causeway (385-500 m) -> CP02 -> AV01 -> IC02 / IC03 -> Icarus end (1,122 m).
  - **TARTARUS: SELF-POWERED ARRIVED, 0 stops**, 35/35 planned, 1,261 m in 548 s: core -> round the Gatekeeper Fields
    gatehouse (north end) -> AP01 -> CP04 -> AV03 -> TQ01 / SF03 -> end (1,162 m).
  - **NOCTIS: MIXED, 1 stop**, 33/33 planned, 1,257 m. The one stop is at r 32 m, still inside Golden Arrival: the
    stepped plinth of an AR03 trefoil screen at (-2,804, -1,710). The plinth rises 17 / 26 / 34 / 43 cm under a
    solid screen. From the resume point (~10 m on) to the Noctis end (1,192 m) the walk had 0 stops, including the
    castle-arcade gap at 362 m that snagged v2. A clean single-leg re-run with a start clear of the screen is next.
  - **No approach fix is needed.** The palace complex, the GreatSpire precinct and the Gatekeeper Fields are
    walked round on existing paving and lawn. The census-drawn and axis-straight routes of the morning were the
    only things that "failed".

**TREE CULL 260 -> 600 m (founder-rule performance change, CORE decision 2026-09-29 ~13:10).** With no HLODs and
512 m streaming, a 260 m tree cull hid more than half of the trees that were loaded (SECOND's measurement: 14,699 of
25,634 applied tree instances culled at 260 m).
- Gate, CORE's rule: the raised mean fps is at least 85 % of baseline and no view falls under 30 fps.
- SECOND's A/B, zzW432, in PIE on the gameplay camera, throttle off, t.MaxFPS 0, VSync 0:
  - frontier T316: 36.0 -> 39.1 fps mean (p5 29.3 -> 32.3), inside the view's own 16 % drift;
  - heartland N227 -> ring: 38.8 -> 40.0;
  - RR02 at 250°: 38.9 -> 39.8.
  **PASS, flat within noise.** zzW433 verified the instrument: the component read-back changed and back, and the
  horizon band showed 18,027 changed px raised against 6,077 px base -> restored.
- Applied in place:
  - SECOND 5d (zzW446): 1,718 batches / 13,609 inst in 41 passes. 10 W270T market awnings wrongly caught by a
    "canopy" substring were reverted before the save; the filter is now SM_tree_* / SM_canopy_*.
  - CORE 2F: RR01 56, RR02 88, SR030 6, SR150 6, IC02 2, S4N182 9 = 167 batches / 1,090 inst.
- Specs and generators were updated to match (dd496f0e SECOND; ring_roads.py + icarus_district.py 07e0a33f; the six
  CORE specs with 2F).
- The in-PIE read-back (zzW447): 619 loaded tree batches, all at 60,000 on both the actor property and the runtime
  component. CORE's read-back comes with the 2F proofs.

**Window 2F (CORE, applied 15:12-15:14, CLASS A).**
- Fresh editor (PID 57912, launched 15:07, save count 0), checkpoint `2026-09-29-pre-window2f` (30,308 actors / 445
  objects).
- C7 core copse: 17 passes, 393 batches / 1,836 inst / 820 trees, on the 350-620 m rim and marches. Regenerated on
  the post-5d census, 20 m corridors kept round the proven radial walks (`Districts/radial_routes.json`). Every
  apply removed 0.
- The in-place cull edit above: exactly 167 changed, no per-pass mismatch.
- ONE gated save (zc_gated_save.py): memory gate 36.9 GB commit / editor 13.9 GB / 577 dirty = 393 C7 + 167 edited
  batches + 17 folders, 0 unexpected, 7.4 s, 0 dirty after.
- Hash vs the checkpoint:
  - +410: 393 attributed by embedded tag, each C7 pass exactly its batch count, + 17 folders;
  - -0;
  - changed 168: exactly the 167 recorded packages + the stub.
- Editor closed (PID 57912, save count 1) and relaunched (PID 79588).
- **SECOND's queue is DONE**: 4a-5d all class A and proven (53372e30); the post-5d audit read 7.0 % empty / 2.8 %
  unintended, before C7.
- **8 more frames** (`core_0929`: the three nation bands and frontiers, SR150 from height, gate GD from above).
  - At the bands the nations read distinctly: ICARUS ivory and gold towers with giant-mushroom tables, NOCTIS black
    spires round a dark domed palace, TARTARUS red-brown towers on cream and pink terraces.
  - At the frontiers they read as woodland with nation accents: Noctis a mixed orchard with bush drifts, Tartarus
    autumn trees with a pink mushroom cluster, Icarus an orchard with a walled mushroom-capped tower.

## TRAVERSAL GRAPH -- the intended world joined by walks (CORE, 2026-09-29 15:30; builder-run)

Every region is a node, and an edge is a walk that was actually made in play. Proof classes follow the founder's
rule: only SELF-POWERED proves continuity. The graph is joined through the three radial walks: each crosses both
ring roads, and everything else hangs off a ring, a seam way or the core.

| edge | walk | class |
|---|---|---|
| GA arrival gate (0, -6,300) -> palace entrance (300, 9,650) | GA axis 32/32 over GS01 (window 2D) | SELF-POWERED |
| clock plaza north arches -> GA east / west flank gardens | 13/13 each (12:10) | SELF-POWERED |
| palace entrance -> GA rear world (0, 16,500), round the palace complex west | 156 m (13:42) | SELF-POWERED |
| GA core -> ICARUS end (1,122 m): rear world, GreatSpire precinct, AP01 causeway, CP02, AV01 x RR01 x RR02, IC02 / IC03 | 1,442 m, 0 stops (14:44; re-walked after 2F) | SELF-POWERED |
| GA core -> TARTARUS end (1,162 m): Gatekeeper Fields, AP01, CP04, AV03 x RR01 x RR02, TQ01 / SF03 | 1,261 m, 0 stops (14:44; re-walked after 2F) | SELF-POWERED |
| GA arrival axis (0, -2,500) -> NOCTIS end (1,192 m): AP01, CP03, AV02 x RR01 x RR02, NC01 / NC02 | 1,295 m, 0 stops (zc2F_63, post-2F); earlier starts through GA's west gardens snagged on topiary / hedge edges | SELF-POWERED |
| RR01 through hedge gate GA (43.5-52°) | 113/117 m | SELF-POWERED |
| RR02 through GC (64.5-71.5°) and GD (146.5-155.5°, SKY05 bypass) | 137/139 m, 189/194 m | SELF-POWERED |
| RR02 -> gate GB -> SX01 -> SR030 seam way | 564/568 m (zzW113) | SELF-POWERED |
| SR150 seam way | 428/432 m | SELF-POWERED |
| RR01 -> TW02 lane -> TW01 gate -> court | 278/294 m | SELF-POWERED |
| TW03 hamlets (8) -> nearest paving | 8/8 | SELF-POWERED |
| S2M297 entry -> MG01 Mushroom Grove | 241/250 m (zzW113) | SELF-POWERED |
| Dubel 58° -> gate GE -> 122° -> WI122 wild-ring trail | 1,553/1,576 m (zzW113) | SELF-POWERED |
| heartland walks x 5 (rooms 48/48) | zzW112 and the heartland proofs | SELF-POWERED 5/5 |
| sector-fill walks (S2) | 12/13 arrived, 2,531 m; S2N246's dead walk removed | SELF-POWERED |
| W270 rear seam | 18/18 | as recorded (W270 proof) |
| wild ring -> world edge | EDGE01 stops the walking Dog at 1,482-1,483 m (0° / 89.5°) | SELF-POWERED (the stop is the pass) |
| landmarks | 65/66 on foot + 1 reached to its raised planter's rim | SELF-POWERED |
| every applied walk sidecar (44) + whole-disc floor / residency | SECOND's final pre-package check (zzW470 / zzW471) | TELEPORT regression |

What the graph does not claim:
- The ring roads are not full circles. The SKY05 tower breaks are documented (RR01 ~28°, RR02 20-32° and 140-148°),
  and the radial walks join the rings on either side of them.
- The heartland and sector-fill walks prove their own ground. Where their ends meet a ring or an avenue, the join
  is by the sidecars' endpoints (paving within a few metres), not a separate walk.
- The whole graph is BUILDER-RUN: CORE and SECOND. Independent qualification needs a separate QA session, which is
  the founder's decision.

## DEFINITION OF WORLD COMPLETE -- tracking (CORE, 2026-09-29 12:00; founder's 25 conditions)

**ENVIRONMENTAL FINAL STATE, 2026-09-29 17:05 (CORE):** all 25 environmental conditions are MET. Most are MET (builder-run): proven by CORE and
SECOND, not by an independent QA session, which the founder must decide on. The residuals are listed on row 25. The
final package boots Golden Arrival and streams (row 24).

Status words: MET / MET (builder-run) / IN PROGRESS / OPEN / FOUNDER. "Builder-run" = proven by CORE or SECOND, not an
independent QA session (JUJU and the integration lane were reassigned to Julius ~09:00).

| # | condition | status | evidence / remaining |
|---|---|---|---|
| 1 | entire intended playable world audited | MET | census + emptiness_classes over the 1,480 m disc after every window; world-edge ring at 1,485 m |
| 2 | every major region has an owner and resolved status | MET | queue Q1-Q13 resolved: SECOND's 4a-5d all class A and proven; CORE's 2A-2F all class A; final gates run (this table) |
| 3 | major unintended empty regions authored | MET (builder-run) | 45.1 % empty (morning) -> 16.2 % (4b) -> 13.8 % (5a) -> 11.6 % (5b) -> 8.9 % (5c) -> 7.0 % (5d) -> **5.3 % after 2F; UNINTENDED 1.3 % of the disc**, 539 pockets, the largest 0.41 ha (core, 109° 340 m); no unintended region over half a hectare remains |
| 4 | remaining negative space explicitly intentional | MET (builder-run), residual listed | final classes (post-2F census, 264,246 rows): meadow 2.7 %, traversal 1.0 %, vista 0.3 %, clearing 0.1 %, rim 0.0 %; the 1.3 % unintended residual is small pockets, most in the TW03 Icarus tower band (100-135°), which the fills left to the tower hamlets (listed in the final audit) |
| 5 | Golden Arrival complete | MET (builder-run) | composition passes present (GA08 arrival lamps HELD by the lighting rule); axis SELF-POWERED 32/32 after GS01; flanks SELF-POWERED 2/2 from the north arches; rear world SELF-POWERED round the palace complex's west side (156 m); the GA core is the start of the ICARUS / TARTARUS core -> end walks |
| 6 | 24 quarters coherent | MET (founder decision) | classified per site; core preserved, identities outward (TW01-03, MG01) |
| 7 | three nations read distinctly | MET (builder-run) | band frames per nation distinct (ICARUS ivory / gold with giant-mushroom tables, NOCTIS black spires and dark domes, TARTARUS red-brown towers); frontiers woodland with nation accents after the massing; final frames final_0929/core |
| 8 | major seams complete | MET (builder-run) | W270 (18/18), SR030 + SR150 seam ways SELF-POWERED, R41/R42 seam ground filled by S2/S3 |
| 9 | radial roads connect correctly | MET (builder-run) | CORE -> NATION END SELF-POWERED, 0 stops, on the final (post-2F) world: ICARUS 1,442 m and TARTARUS 1,261 m (zc2F_62), NOCTIS 1,295 m (zc2F_63, from the arrival axis); SR150 / SR030 SELF-POWERED |
| 10 | ring circuits connect or gates intentional | MET (builder-run) | hedge gates GA/GB/GC/GD/GE SELF-POWERED; SKY05 tower breaks documented (RR01 ~28 deg, RR02 20-32 / 140-148 deg) |
| 11 | heartlands complete | MET (builder-run) | 5 heartlands applied, SELF-POWERED 5/5, rooms 48/48 |
| 12 | frontiers complete | MET (builder-run) | S2 strips + S3 (5a) + S6 copse fill (5b-5d, 620-1,210 m, trees at 600 m cull) + S5 Dubel edge (5d); all class A, residency 100 % in play |
| 13 | outer wild ring complete | MET (builder-run) | R50 + R50b (4a-4c) + Dubel's outer arc wall S5W090 (5d); EDGE01 stops the Dog at 1,482-1,483 m; the wild ring reads as forest after the cull change (SECOND's massing sheet) |
| 14 | missing Bible districts reconciled | MET | Tower Rise / Mushroom Grove RELOCATED WITH INTENT and built; books/scrolls NOT IN KIT; GA08 held (lighting) |
| 15 | major landmarks exist and are reachable | MET (builder-run) | TW01 gate, MG01 entry, TW03 x8, Dubel landmarks SELF-POWERED; landmark sweep SELF-POWERED 65/66 on foot, the 66th reached to its raised planter's rim (South Cloister, 1.3 m kerb) |
| 16 | traversal works across the intended world | MET (builder-run) | traversal graph (section above): the three radial walks join the core, both rings and every nation end; ring gates, seam ways, TW / MG01 / Dubel / heartland walks SELF-POWERED; SECOND's final regression zzW470b: 238/239 stands on ground, rooms 52/52 (the one miss is WI122's trail dressing over a SKY05 base at Dubel 122°, whose walkable way round is proven) |
| 17 | no major cul-de-sac / trapped landmark | MET (builder-run) | GA axis ledge fixed (GS01); GA rear world reached (west); GreatSpire precinct and Gatekeeper Fields walked round; landmarks 65/66 + 1 at its rim; S2N246's dead walk removed; no trapped landmark found |
| 18 | distant views composed | MET within the streaming limits (builder-run) | massing (S6, C7) + tree cull 600 m: every loaded tree within 512 m now draws; wild ring reads as forest, Noctis heartland as parkland, Dubel's outer edge closed (SECOND's sheets). Beyond 512 m nothing streams (512 m and no-HLOD are fixed constraints), so a 1.3 km oblique cannot show the outer woods -- a documented limit, not a composition gap |
| 19 | World Partition streams correctly | MET (builder-run) | every window's residency 100 % in play; SECOND's whole-disc zzW471: 12,310/12,310 batch owners + 17,270/17,270 StaticMeshActors resident at some tile, 0 floor holes (50 not-landed drops = 46 sky-cloud tiles, 2 outside the disc, 1 GA core, 1 unidentified; 11 streaming timeouts unattributed: instrument gap) |
| 20 | Golden Arrival in the packaged build | MET (builder-run) | final package (17:03) boots WL_V2_GoldenArrival_WP2 to the Golden Arrival garden, HUD 'WONDERLAND / GOLDEN ARRIVAL' (boot_test/packaged_boot_57684.png) |
| 21 | broad founder-facing visual evidence across regions | MET (builder-run) | 26 final CORE frames (captures/zc/final_0929/core: before/after-comparable poses + C7 / radial-route views) + SECOND's massing and C7 audit-map before/after sheets; frames sent to the founder through the day |
| 22 | final emptiness audit | MET | emptiness_classes on the post-2F census (15:24): 5.3 % empty, 1.3 % unintended (539 regions), top regions recorded; SECOND's 350-620 m audit-map before/after for C7 |
| 23 | final beta walk against real streaming | MET (builder-run) | final beta walk zc2F_64 against real streaming: 8/8 gates PASS (W01-W08), 15/15 stands measured and on ground, 15/15 authored-vs-resident, coverage 99.5 % (208 tiles: 201 built / 6 sparse / 1 empty clearing) |
| 24 | final packaged build boots and streams the completed world | MET (builder-run) | BuildCookRun of the completed world: BUILD SUCCESSFUL, 180 s, 1,790 packages cooked, 0 errors, archive C:/dev/iwonder/_wonderland_package_final_0929 (1.3 GB); boot test: World Partition runtime hash 'Streaming Status Idle, Performance Good', 52 cells Loaded Visible, 0 loading, 0 failed to load |
| 25 | no unexplained incomplete P0/P1 region | MET (builder-run), residuals listed | every region resolved (queue Q1-Q13); open residuals, none P0/P1: 1.3 % unintended in pockets <= 0.41 ha (TW03 band / core rim); WI122's trail dressing crosses a SKY05 base at Dubel 122° (walkable way round proven); GA08 arrival lamps held by the lighting rule; GA's floating MQ04 slabs (visual, stepped by GS01); 11 unattributed streaming timeouts in SECOND's disc instrument; independent QA = founder decision |

## Assignments

| # | to | region | notes |
|---|---|---|---|
| 1 | WORLD | R40 SEAM 270° rear, 500-1,200 m | two nation halves (Noctis west of -90°, Tartarus east) and a designed seam; specs in `WorldDesign/Wedges/` |
| 2 | WORLD | R41 SEAM 150°, 500-1,200 m | Icarus / Noctis seam; hang layouts on the S02 seam radial once CORE publishes it |
| 3 | WORLD | R42 SEAM 30°, 500-1,200 m | Tartarus / Icarus seam; same |
| 4 | WORLD | R22 / R32 / R12 frontiers, then R50 wild ring | forest, mushroom woods, meadows with purpose -- Dubel's clearings are the model |
| C1 | CORE | R02 core rim: re-apply GF03/04/05 | **DONE 2026-09-28**, corrected and tiled; see the note on the corner-cell bug below |
| C2 | CORE | S01 ring circuit + S02 seam radials | the roads every fill hangs on; polylines to WORLD before their layouts |
| C3 | CORE | nation marches for NOCTIS and TARTARUS | **not needed**: NC01 / TQ01 causeways + CP03 / CP04 + gate arches already are those marches (census, 2026-09-28) |
| C4 | CORE | forge-canon reconciliation: the 24 quarters, radial roads and ring circuit of the core | **first cut done 2026-09-28** (below): 12 of 14 forge districts have their passes; Tower Rise and Mushroom Grove have none |
| C5 | CORE | traversal (walkable on the census), packaged build | |

## Map-writing protocol (agreed 2026-09-28)

One writer at a time, announced and serialized through the channel; never CONCURRENT, never beside the other's
PIE; `Tools/checkpoint_map.sh` before any save; every apply tagged `WL_PASS_<id>`; ask before each apply+save.

**ONE SAVE PER EDITOR SESSION** (adopted 2026-09-28 23:20, both lanes). In one editor session the FIRST save
writes only dirty packages (86 packages / 30 s for the floor re-yaw; 5,033 / 16 s for the batch bounds), and
every later save rewrites all ~23,000 actor packages (23,158 / 111 s) and permanently adds ~15 GB private to the
editor (9.6 -> 25.1 GB). Relaunch between writers: `quit_editor` job (refuses if dirty), count processes, relaunch
`Tools/LaunchWonderlandEditor.ps1` detached via WMI `Win32_Process.Create`; ~2 min each way, 20 regions and every
actor resident again. Several applies meant for one save go in ONE session: all but the last with SAVE=False,
the last with SAVE=True and MAP_WAS_DIRTY_OK=True. Never PIE above ~42 GB system commit.
**Count saves yourself** (added 2026-09-29 after a second save slipped through on a peer's message): before any
SAVE=True job, count `saved: True` results in `_channel/done` finished after the editor PID's StartTime
(`Get-Process UnrealEditor`); never state or trust editor-wide save state from one lane's own jobs.

**Generators that lay SM_terrace_platform**: the plate is 1,440 along its local X and 740 along Y. Copy the
plate and kerb yaw from noctis_quarter.py / tartarus_quarter.py, then run the neighbour-spacing test on the
spec (the neighbour ACROSS the road at 740 cm, not 1,440). nation_band.py lost that fix and striped the three
nation bands and W270 with lawn (re-yawed in place 2026-09-28, dca810ca, WorldDesign/Wedges/floor_reyaw_record.json).

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

## Forge district reconciliation (C4, first cut, 2026-09-28)

The forge's `layout_v2.py` names 14 districts by seed bearing and radius (`_DISTRICT_SEEDS`) and assigns every
site by the metric in `_district_of` (angle weighed by mean radius, plus the radial difference). The same metric,
run over the centroid of every authored pass within 400 m of the shipping map's centre (census, 188,660 rows),
says which districts the Unreal core actually carries:

| forge district | seed | what stands there (pass, placements) | identity |
|---|---|---|---|
| Royal Gardens | 65 deg, 110 m | RG01 552, CL01 545, CL02 259, GA02/GA07/FL04 (the arrival itself) | present |
| Clock Quarter | 5 deg, 135 m | CQ01 515, CQ02 313, EQ01 524, EQ02 289, DC01 315 | present |
| **Tower Rise** | 120 deg, 130 m | nothing named for it; within 40 m of the seed: grass tufts 162, ground flowers, shrubs, a few kerbs and trees -- **no towers** | **missing** |
| Lantern Hamlets | 152 deg, 155 m | LH01 543, LH02 301 | present |
| Tea Terraces | 200 deg, 115 m | TC01-03 (Teapot Court) 1,279, DC02 270, OL01 144 | present |
| Water Gardens | 248 deg, 120 m | WG01-03 1,201 | present |
| **Mushroom Grove** | 300 deg, 140 m | CxCityS 262 only; within 40 m: grass tufts 586, kerbs, a glass screen facade -- **no mushrooms** | **missing** |
| Gatekeeper Fields | 340 deg, 150 m | CK03 397 (Colossal Key), DC03 221 | partly (Colossal Key is its own identity) |
| North Reach | 130 deg, 250 m | GF01 garden fill 2,549, skyline towers | generic fill |
| East Reach | 25 deg, 260 m | FillNE 1,202, FillEMN 769 | generic fill |
| The Long Woods | 210 deg, 250 m | GF02 2,377, SW 1,987, TG01 | generic fill |
| South Meadows | 278 deg, 270 m | South 1,446, GT01, GC01 | present |
| West Wood | 170 deg, 300 m | WW01-03 1,234 | present |
| Far Orchards | 315 deg, 290 m | FO01 543, LF01, CK01/02 | present |

**Tried, and held for the founder.** `Districts/forge_districts.py` builds TR01 Tower Rise (the forge's
`_quarter_towers`: capped towers round a dominant one, a clock tower, court planting, a walled court open to the
city) and MG01 Mushroom Grove (four-part giant mushrooms on stone rings, a landmark, medium and small ones round
their feet), placing nothing through anything standing. Both seeds lie inside the accepted core, and the core is
fully planted: TR01 found room for 3 of 7 towers and no clock tower, MG01 for none of its giants. Adding either
means replacing core planting, and the founder's standing rule is to grow outward from the accepted city, never
rebuild it (IC01's brief). **Founder decision:** (a) build them in the core, replacing some planting; or (b) give
those identities to the outer world instead -- a tower quarter in the ICARUS march (Icarus's vertical silhouette)
and a mushroom wood on a frontier (the forge's "mushroom woods" are one of the 24 quarter kinds).

## POST-COMPLETION GAMEPLAY REGRESSION (founder, 2026-09-29 evening + 2026-09-30) -- G1-G7 FIXED, INDEPENDENTLY FALSIFIED, PACKAGE REBUILT AND QA'D 27/27

Scope: gameplay and system repair only. The completed world is the baseline and is not modified: landscaping, C7,
radial and ring roads, hedge gates, Golden Arrival geometry, quarter layouts, TW / MG architecture, the world
boundary, emptiness treatment, lighting and the World Partition layout all stay as they are.

| # | regression | status |
|---|---|---|
| G1 | Mission Contract animation sequences wrong on the non-OG skins (founder correction: the MISSION CONTRACT sequences, not ordinary locomotion) | **FIXED, proven in play** (2026-09-30, zg_12 / zg_13 / zg_16) |
| G2 | Jack Flame secondary colour must drive both the flames and the tie, and survive a reload | **FIXED, proven in play** (zg_21 change + zg_24 restore in a fresh session) |
| G3 | Teleport to the new world locations (TW01 / TW02 / MG01 and other named places) | **FIXED, proven in play** (zg_22: 16/16 new, 17/17 existing) |
| G1b | Mission Contract: repeat deployments AND mid-act resets on every skin (founder, 2026-09-30) | **PROVEN** (zh_14: 5 skins x 3 deployments; zh_19c: contract reset + fixture stop, 8/8 clean) |
| G2b | Jack Flame SECONDARY must also drive the SUIT (founder, 2026-09-30) | **FIXED, proven in play and in the package** (zh_22 10/10, zh_26 reload 3/3, package Q01) |
| G3b | Teleport from the rim into the dense centre (the founder's own failure, 2026-09-30 16:04 UTC) | **FIXED, proven** (squeezed repro fails the old build; zh_23 10/10 incl. real 26-34 s streams; zh_24 33/33; package Q02-Q09) |
| G4 | Jack Flame head: keep the accepted crown plume (whole-head fire CANCELLED) | **KEPT** (figure byte-identical to the accepted geometry; Second verified offline; zh_18 frames) |
| G5 | World map tangled at the centre (founder, 2026-09-30) | **FIXED, proven** (zh_21 11/11 incl. 1920x1200; package Q04 0 overlaps at x1 / x4 / x8) |
| G1c | Scenario path: skins' paws off the brush / scraper in IMPLEMENTATION and REPAIR (Second Wonderland, zs_04) | **FIXED, proven** (old build 10.2 / 11.1 uu; fixed 0.00-0.04 uu on all 4 skins, zh_37 / zh_42) |
| G1d | Scenario path: the circle round the Contract jammed on the plaza (Second Wonderland, zs_04; any skin) | **FIXED, proven** (old build 0 uu walked in IMPLEMENTATION / REVIEW from 2 starts; fixed 0 stalls, zh_36) |
| G7 | HARD RULE (founder, 2026-09-30): every skin's body is Relay OG's height; capsule, camera, collision, switching unchanged | **FIXED, proven** (all 4 skins were 155 vs OG 174-176; now 174.15 = OG; zh_45 S1-S7 7/7) |

**G1 -- one canonical Mission Contract animation system, skins as a visual layer.** Relay OG *is* the canon body, so
every act (meditate, read, paint, fly-and-verify, inspect, repair) is solved on its own skeleton and its hands land on
its own props. A skin is a separate costume body with other proportions (shoulders 24.5 uu lower, forearm 30.8 uu), fed
a handed-down pose -- and that handoff was losing the act: joints were keyed by parent-relative offsets (all shins and
forearms driven by the right knee, sides crossed), copied arm ANGLES held every costume hand ~25 uu under the book,
brush and lens, the VERIFICATION fly lean (9 deg) never reached the costume, Celestial Light's aura took the mission
lift twice, and the leg solve was switched off for whole acts while the canon walked its circle round the Contract.
Fix (C++, no per-skin code): the Dog hands down its FINAL joints after ApplyMissionPose, by physical side, plus its
hand, elbow and shoulder positions and its body as written; the costume solves each arm in 3D so its hand is where the
canon hand is (the canon's elbow side and twist kept), blended by the act weight exactly as the canon blends; legs
solve to the canon soles, blended by the canon's own leg-performance share; floating parts under the spine are not
lifted twice. Proof (zg_12, all five skins x 2 consecutive deployments, measured against the canon body in the same
frame): identical act sequence to Relay OG in every stage; costume hands within 0.06 uu (p95) of the canon hands in
every act; props as close to the costume hands as to Relay OG's; body lift / lean / head within 0.05 uu / 0.05 deg;
feet 0.7 uu while walking; aura steady (3.8 uu); COMPLETED settles to weight 0 and the next deployment starts clean.
Locomotion regression (zg_16): 5/5. Frames: `Tools/captures/zg/mission_frames/`.

**G2.** The fire (`flame`, `flamepale`) and the tie (`heart`) carry a `secondary` channel in the figure, recoloured by
the chosen SECONDARY at the authored brightness (the pale core a 40% lighter shade); primary alone leaves them as
designed. **And the save never reached disk:** UE5 only writes Game.ini sections listed in `[SectionsToSave]`, which
listed none of Wonderland's, so every mascot colour choice lasted one session -- now listed in DefaultGame.ini. zg_21
12/12, zg_24: a fresh editor session comes up with the saved azure on tie and fire, then resets to the designed red.
A whole-head fire for Jack Flame was built and **reverted the same night on the founder's instruction**; the head is
the accepted one (figure identical to the committed file except the three `secondary` channel tags).

**G3.** The registry now carries each place's arrival point (38 rows, 33 offered; QA points are not offered), the travel
waits only for the ground round the arrival (150 m streaming shape; the Dog's own 512 m range is untouched) with a 25 s
limit, and two landmarks were moved 2.5 m off the planters they stood on (Grand Clock, Colossal Key -- registry only,
no geometry). zg_22: every offered place arrives, lands within 40 cm of the registry height on paving/road/ground,
streaming settles (max 22.5 s) and the Dog walks away. No map file changed in this phase (newest map file 09-29 15:13).

**2026-09-30 additions (G1b / G2b / G3b / G4 / G5).**

**G5 -- the map, not the world.** The offered places span 2.5 km and fifteen of them stand within 150 m of the gate, so
at the map's one scale the Golden Arrival was a knot of thirty pixels with fifteen names printed into it (before:
`Tools/captures/zh/map_before/`). Nothing in the world moved. `SWonderlandMapCanvas` now zooms and pans (wheel about the
cursor, drag, + / - / FIT, keyboard + - Home); markers are drawn exactly where their arrival points project and never
move; markers closer than 28 px fold into the most important of them (a group ring, "+N" on its label, the folded places
as small dots where they really are; a click on a group opens it); labels are placed most-important first (selected /
hovered, arrival, quarters, landmarks, districts) at the first of 24 candidates clear of every label, halo, leader line
and the compass / controls / scale bar, and a leader line may cross no other line; the YOU tag is placed by the same
rule. zh_21 on DLL 11:05:45: M01 no label overlap, M02 no label over a halo (YOU included), M03 markers within 0.001 px of
the projected arrival points, M04 nothing lost, M05 the named share rises with zoom, M06 the Arrival and the three nation
quarters named at FIT, M05b every place named at x8, M07 TW01 / TW02 / MG01 selected on the map and reached, M08 the same
at 1920x1200 at the game's DPI scale (the founder's screen), M09 no halo clash, M10 no crossing leader lines -- 11/11.
Second Wonderland's offline audit of the first cut found the halo, crossing and YOU defects this version fixes.

**G2b -- the suit.** The `suit` material carries `secondary_deep`: a third of the chosen colour
(`WonderlandMascotStyle::DeepAccentColour`), so the suit is plainly the chosen colour while the pinstripes stay >= 2.6x
its luminance for every palette swatch; the NIGHTMARE COLLAR and the knot the tie sits on moved to their own black
(`nightmare`), so the tie still reads. Figure change: one channel tag, one material, 189 collar boxes renamed; geometry
identical, head untouched. zh_22 10/10 (5 colours: suit, tie and fire one hue; collar and stripes as designed; a primary
alone leaves the suit; walks with feet on the canon), zh_26 3/3 (a fresh session restores azure on suit, tie and fire),
package Q01. The eyes also follow SECONDARY -- founder canon since 2026-09-24, unchanged.

**G3b -- the founder's own failure.** 16:04:57 UTC: a Mission Contract deployed at Tartarus Heartland East travelled to
castle_approach and gave up at 25.8 s ("Could not land safely"): World Partition was still bringing the castle's cells
in, and zg_22 had never made a rim-to-centre trip. A fresh editor did it in 4 s; squeezing MaxBlackSeconds reproduced the
founder's sentence on the old build. Fix (`WonderlandTravel`): MaxBlackSeconds is now the limit for a travel that has
STOPPED progressing (cells pending or loading keep it waiting, StallSeconds 5, hard cap MaxTravelSeconds 60); a late
stream gets LandingGraceSeconds (3) to land -- the squeeze found the old code placing the pawn and abandoning it the
next tick; a caption shows over the black ("TRAVELLING TO ..."); every travel logs why it ended
(GetLastTravelDiagnostics). zh_23 (limit squeezed to 2 s): 10/10 arrived, including real streams of 26.8, 28.4 and 34.4 s
that the old 25 s limit would have abandoned; zh_13 8/8 rim-to-centre + 2/2 Mission Contract deploys from the rim; zh_24
all 33 destinations.

**G1b.** zh_14 (5 skins x 3 deployments) all identical to Relay OG, every deployment settling to weight 0. Mid-act
resets (contract reset and fixture stop): zh_19c 8/8 clean -- no costume part outside its own idle range from 3 s, hands
and soles on the canon as at idle. (zh_19b's 7/15 was the instrument: one snapshot against 12-25 deg of idle sway.)

**PACKAGE.** `C:/dev/iwonder/_wonderland_package_regression_0930`, BuildCookRun SUCCESSFUL (293 s, 1,783 packages, 0
errors). `wl.Qa.PackageCheck` (WonderlandQaCommands.cpp, not in Shipping) walks the checks inside the packaged game;
`Tools/boot_test_package_qa.ps1`: 11/11 PASS -- Jack Flame azure; rim -> castle_approach; the map at x1 / x4 / x8 with 0
label overlaps; TW01 / TW02 / MG01 from the map; a Mission Contract from the Tartarus rim reaching its site. The window
ran at 1280x800 (the engine shrank the requested 1920x1200 to the work area) -- the same 16:10 layout in slate units.
Frames: `Tools/captures/zh/package_0930/`.

**G1c / G1d / G7 (later on 2026-09-30).** Second Wonderland's falsification of G1 on the founder's own mission path
(`wl.Mission.Scenario`) found two faults the scheduler-path proof could not see:
- **G1c:** the act goals sit at 82-94% of the CANON arm toward a Contract staged 3.4 m out, so a skin's arm ran out of
  reach and the canon-held brush / scraper floated 8-22 uu off its paw. Fix: while a costume is worn, each act's hand
  goal is kept inside both reaches (`AWonderlandCompanionEmbodiment::GetArmReach`, projection in RelayDogCharacter).
- **G1d:** the circle round the Contract is a forced walk that can jam on the plaza (an urn near (505, 6925)); the Dog
  then spent whole acts pinned out of shot. Fix: a stalled circle detours -- tighter, wider, then the other way --
  and returns to the circle after free walking (`GetOrbitDetourCount`, log `WLDOG orbit stalled`).

Both were reproduced on the old build by our own instruments (zh_31 / zh_34) before the fix was proven (zh_36 / zh_37).

**G7 (the founder's hard height rule).** Measured (zh_39): pawn, capsule (87.07), camera (135 above the Dog), scale,
soles and switching were already identical; the costume BODIES were not -- 155 uu (the generator's 1.55 m) against the
in-world Relay OG's 174-176. One sizing system now: every figure carries its base Dog's extent (`body` record); the Dog
measures Relay OG at rest in BeginPlay (`GetCanonBodyHeightUu`, 174.15 uu) and every worn costume and every Wardrobe
figure is scaled so that body stands exactly that tall (scale 1.1235); the Wardrobe frames every skin on that one body
height. zh_45 on DLL 15:24:15: S1 soles on OG's plane, S2 body 174.15 on all 4 skins (drawn tops within 0.3 uu of OG's
head top), S3 capsule / camera / scale identical, S4 0 uu on every switch, S5 no costume collision, S6 Mission Contract
start / end Z and lift identical, S7 Wardrobe framing identical (distance 285, body 174.2) -- 7/7. The Mission Contract
hands hold at the new size (zh_42 0.00-0.04 uu) and locomotion passes (zh_44). The package QA gains Q10 (each skin's body
against Relay OG, and the switch).

**FINAL STATE, 2026-09-30 19:27 -- each gate three ways.** Columns:
- editor: CORE's proofs in PIE;
- independent: Second Wonderland, on DLL 15:56:38 / fdaa8ffe, with its own jobs and its own reading of the frames;
- package: the REBUILT package's in-game QA (`wl.Qa.PackageCheck` + `wl.Qa.PackagePersist`).

| gate | editor | independent | package |
|---|---|---|---|
| G1 Mission Contract on every skin (incl. G1b / G1c / G1d) | zh_14, zh_19c, zh_36, zh_37, zh_42 | **PASS**: zs_09 15/15 deployments, 5/5 old jam starts, 15/15 mid-act resets; zs_08 hand gap <= 0.05 uu | **PASS**: Q09 + Q11.1-4; all 6 acts on all 5 skins; hand p95 <= 0.04 uu; 0 stall windows |
| G2 Jack Flame secondary on fire, tie and suit, with save / reload | zh_22 10/10, zh_26 3/3 | **PASS** on DLL 11:05:45 (the colour path is unchanged in fdaa8ffe) | **PASS**: Q01 read off his materials; Q12 after a restart |
| G3 Teleport, incl. TW01 / TW02 / MG01 and rim -> centre | zh_23 10/10, zh_24 33/33 | **PASS**: zs_10 104 map trips, 0 fails; squeeze 10/10; the founder's sequence 2/2; deploy 3/3 | **PASS**: Q02, Q03, Q05-Q08, Q09 (arrivals in 1.1-6.4 s) |
| G4 Jack Flame head: the accepted crown plume | zh_18 | **PASS**: zs_11 at the new scale | **PASS**: the staged JackFlame.wlvox is byte-identical to the tree (15/15 skin files) |
| G5 World map declutter | zh_21 11/11 | **PASS** on DLL 11:05:45 (map code unchanged) | **PASS**: Q04.1-3; 0 overlaps and 0 labels over markers at x1 / x4 / x8 |
| G7 Every skin's body at Relay OG's height | zh_45 7/7 | **PASS**: zs_07 / zs_07b; feet and ear tops within 1 px; switch dZ 0; capsule / camera identical | **PASS**: Q10.1-5; 174.15 uu on all 5; switch 0.00 uu |

**PACKAGE v2.** `C:/dev/iwonder/_wonderland_package_regression_0930`, rebuilt 19:13 from fdaa8ffe + the QA v2 below.
BuildCookRun SUCCESSFUL in 215 s: 1,783 packages, 0 errors.

The package QA used to assume what it should measure. It now reads:
- Jack Flame's suit, tie and fire hues off his own materials (`DescribeMaterialColours`), with the suit kept a deep
  cloth and the collar black;
- a Mission Contract on every skin, judged per act on the worn hands against the canon's (p95 <= 1.5 uu), on every act
  Relay OG performs, and on the Dog's headway round the circle (no 10 s window under 60 uu);
- each skin's body against Relay OG and the switch's vertical jump;
- across a SECOND boot, the skin and the colour the first boot chose.

`Tools/boot_test_package_qa.ps1` also hashes the loose-staged RelaySkins against the tree.

Results:
- run 1: 26/26, 706 s;
- run 2: Q12 1/1;
- **27/27 PASS, 0 FAIL, 0 fatal or assert lines** in either log.

The window ran at 1280x800: the engine shrank 1920x1200 to the work area. Frames and verdict lines:
`Tools/captures/zh/package_0930b/`.

**Second Wonderland's falsification** found, and itself recomputed, three instrument faults:
- a swap run counting canon motion from before the swap;
- enum strings parsed as "MOVE_WALKING: 1>" and "DEVELOPED: 2>";
- a 70%-width head rule.

None of the three was a fault in the game; each was re-judged from the recorded data. CORE checked the swap and the enum
cases independently.

**FOUNDER DECISION OPEN -- costume head proportions.** At Relay OG's body height:
- Every costume's feet and ear tops match OG's within 1 px (0.35 uu).
- The costume FACE BLOCK starts 5.5 uu lower than OG's and is about 19% wider: 153-169 px against 129 px in Second's
  fire-off side frames.

The cause is the skin generator's base Dog, which has longer ears and a bigger head than the canon. It predates the
height rule, and no single uniform scale can match both the ear tops and the face top. Matching the face blocks means
reshaping every costume head, Jack Flame's locked head included, so it waits for the founder.
Evidence: `Tools/captures/zh/skin_heights_verify/head_blocks_vs_relay_og.png` (green: the shared ear top; yellow:
OG's face-block top; magenta: the costumes'), `head_profile.json`.
