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
| Q1 | R50 wild ring 1,200-1,480 m (outside Dubel) | SECOND | APPLIED + SAVED window 1 (class A). R50b densify (wall + fuller wood) PLANNED cd9403fc for window 4 | sparse from the air; the outer edge reads as flat lawn to the horizon | window 3 (sector fill 2) first; perf check after R50b |
| Q2 | Sector fill 2: every empty region >= 1.5 ha inside 1,200 m (22 wedges fitted to the post-window-1 audit, incl. the Q11 rim) | SECOND | PLANNED f31f68d5 (sector_fill2.py; 22 specs, 1,121 batches / 10,603 inst; cul-de-sac walks dropped; TW01/MG01 keep-outs) | projected 26.3% -> 22.0% | window 3, after CORE's 2A/2B |
| Q3 | Frontiers R12 / R22 / R32, 1,000-1,200 m | SECOND | PARTLY PLANNED: the frontier strips S2T356 / S2N254 / S2I088 / S2N164 / S2I131 are in sector fill 2 (capped at 1,200 m) | 1,100-1,200 m still ~31% empty after S2 + R50b (lawn beside the outer ring road) | re-audit after window 3; a grove fringe framing the outer ring road is next |
| Q4 | Distant readability of 5 heartland fills | SECOND | RE-APPLIED + SAVED window 1 (hedges/roses/benches 260 m, trees/topiary 600 m, 11 landmark markers; 11/11 resident in play zzW105) | A/B (zzW60 vs zzW106): the rooms now carry trees at range and hedge rims show on the aerials; hedges still drop at 600 m | none |
| Q5 | S02 seam radials 30° / 150° / 270°, plus the ring breaks that belong to the seams | CORE | APPLIED in window 1 (unsaved): SR150 434 m, 0 breaks; SR030 569 m, 2 recorded breaks (SKY05 ~710 m, hedge at RR02). 270° = W270S. `Rings/seam_radials.py` 605abbec | a radial road on each seam; RR02 23-32° and 140-148° SKY05 clusters; RR01 27.7-29.5° | R41/R42 fills hang on these polylines; CORE publishes them to SECOND before its layouts |
| Q6 | TW01 Tower Rise (pass TW01: TR01 is GA clock-plaza steps), relocated outward to the ICARUS march edge (~105-125°, ~300-650 m; empty region at 111°, 3.8 ha) | CORE | APPLIED in window 1 (unsaved; 17 batches / 67 inst, removed 0) at 111° 478 m | the missing forge district: 7/7 towers, clock tower, walled court open to the city | directive P5 "prefer outward expansion": RELOCATED WITH INTENT. Needs a census clearance check, then a CORE write window |
| Q7 | MG01 Mushroom Grove, relocated on its forge bearing to 297° 984 m (TARTARUS outer heartland, 2.7 ha empty) | CORE | APPLIED in window 1 (unsaved; 13 batches / 86 inst, removed 0) | the missing forge district: giant mushrooms on stone rings plus a landmark | footprint published to SECOND before its R32 / Q2 T294 layouts |
| Q8 | DESIGNED HEDGE GATES in the V2 hedge ring (founder decision 2026-09-29: cut designed gates; continuity over an unbroken hedge) | CORE | 2A APPLIED 07:00 (GB: SR030 -> RR02 by a 55 m walk round a SKY05 base, 2 hedges relocated; GE: Dubel ~118° to its 122° chain and WI122, 1 hedge trimmed by SINK_UU); 2B APPLIED 08:17 (GA RR01 ~47°, GC RR02 ~68°, GD RR02 ~150°: 9 hedges relocated, 1 trimmed, 21 plates re-laid, GD tower bypass 6 stones; class A, +74/-0) | the ring gaps at hedges | `Rings/hedge_gates.py`, `Tools/editor_jobs/zc_hedge_gates.py` (guarded, reversible: `Rings/hedge_gate_record_2a.json`); SELF-POWERED proof by SECOND / JUJU after each window |
| Q9 | R41 / R42 seams 150° / 30°, 500-1,200 m (fills) | SECOND | UNBLOCKED (polylines sent 05:31; keep 20 m off each road's centreline) | seam identity between two nations | Q5 polylines |
| Q10 | R00 / R01 Golden Arrival + 24 quarters: verification (composition checklist, TRAV / DIST / PROOF) | CORE (composition) / integration lane (in-play) | IN PROGRESS | tower / grove KINDS (table below; the first cut's "0/7 towers, 1/7 groves" was WRONG -- it read only each site's top four categories): towers survive at 2 of 7 (Q08, S05), partly at 2, not at 3; groves at 1 of 7 (S06), partly at 3, not at 3 | **FOUNDER DECIDED 2026-09-29: PRESERVE THE CORE, carry identities outward.** Room for 3 of 21 towers and 0 of 7 giants without replacing accepted core planting (`Districts/quarter_kinds.py`, 51c2f242). Identities carried outward instead (TW01, MG01, heartland mushroom woods). In-play GA + quarter walk: integration lane (zzJ) after window 1 |
| Q11 | R02 core rim 400-600 m | SECOND (merged into sector fill 2) | PLANNED in Q2: S2N246 (246°), S2I073 (73°), S2N179 (179°), S2T300 (300°); pockets < 1.5 ha stay lawn between groups | -- | window 3 |
| Q12 | P5 Bible reconciliation (all districts/features -> BUILT / RELOCATED / SUPERSEDED / FOUNDER DECISION) | CORE | IN PROGRESS | outer-world Bible landmarks (below) | see "Bible reconciliation" under this table |
| Q13 | Final gates: emptiness, beta walk on real streaming, packaged boot + streaming | CORE | LAST | -- | everything above |

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
