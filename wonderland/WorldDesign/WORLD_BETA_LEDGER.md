# Wonderland — world-only beta-readiness ledger

Opened 2026-09-23 by the world lane. **World only.** HUD, terminals, companions, Project Avatars and Server
Avatars are Internal Development's and are not graded here.

Every row is PASS / PARTIAL / BLOCKING with the evidence that decided it. A row whose evidence needs the editor
says **UNMEASURED** and names the measurement, rather than borrowing a screenshot's confidence. The founder's
standing rule applies to this file too: *do not call the world beta-ready because screenshots look good.*

**Updated 2026-09-23, world polish run.** The second band is APPLIED and SAVED (9,797 instances, every count
matching offline validation, zero hovers). Since then, in the editor: LOOK05+LOOK06 atmosphere and shade,
GROUND01 surface breakup, DF01 Dubel Forest (2,925 instances), XM01 Christmas street lighting (228). World:
20,642 → 20,858 actors, 265 → 273 pass groups. Map saved at 45,386,879 bytes.

**Performance, corrected 2026-09-23.** I reported "3.3–3.5 fps" from `camera_shots`'s `fps_last_camera`. A
proper A/B with `perf_remove_ab` at WorldCam12 measures **64–81 ms, i.e. 12–15 fps** — so the 3.5 figure was
the capture job's own throughput, not the world's frame rate, and I should not have quoted it as one.

**The vegetation is NOT measurably the cost.** Destroying eight `LF01_*` tiles (48 actors) in the PIE copy
made frame time WORSE, not better: 64.04 → 69.42 ms on, and the `off_again` noise floor worse again at 72.22.
Round 2 repeated the pattern (76.47 → 79.58 → 81.61). Frame time drifts monotonically upward across the
measurement window whatever is removed, so this machine is drifting — thermal or memory pressure after hours
of editor uptime — and **A/B results taken on it right now are not trustworthy**. The 89.3%-of-triangles
finding stands as a triangle count; the claim that it is the frame-time cost does not, and was never measured
until now.

**Updated 2026-09-24, Internal Development lane.** Four rows moved, each with the measurement that moved it.
**Row I BLOCKING -> PASS:** the ledger's own "single most valuable unknown" is answered -- Nanite does cover
the garden. 137 Wonderland meshes enabled (the engine's editor furniture deliberately left alone), and at one
fixed camera on a FRESH editor: primitives 1,644,283 -> 191,764 (-88.3%), draw calls 7,428 -> 5,641, GPU 50.32
-> 17.07 ms, frame 114.95 -> 55.54 ms. The first two attempts read 152 and 168 ms and would have buried the
result; this file's own drift warning is why they were re-run on a fresh process rather than believed.
**Row F gap CLOSED:** `MI_V2_NoctisLuminous` 0 -> 160 instances in the level. It was declared in
`noctis_quarter.py` and promised twice in that file's prose, and applied nowhere, because PART_MATERIAL is one
table per quarter and cannot say which lanterns are the bright ones. Placements can now name the parts that
burn, and the detail pass reads the accent off the quarter module, so Tartarus -- which declares none -- is
unchanged. **Row E gap CLOSED:** nation avenues now vary. Every paving instance already sat on M_V2_SurfaceHD
with InstVary/InstWarm/InstRoughVary exposed; MI_V2_PlazaVaried ran 0.20/0.12/0.16 and the GroundFlag pair the
avenues use was still on the 0.08/0.03/0.10 default. 18 ground materials raised to the proven numbers, no mesh
and no palette touched. **Row L trough CLOSED by SF01/SF02/SF03:** the 800-900 m seam, counted on disk exactly
as this file counts, went ICARUS 852 -> 1,998, NOCTIS 715 -> 1,869, TARTARUS 1,060 -> 1,739 -- all three now
inside the 1,300-2,600 of the rings either side. 3,342 instances: a flagstone floor laid across the join on
the module's own grid, kerb and verge, planted retaining edges, and a threshold so the seam is a place. Every
module used is on THIRD_BAND_PREP's "already proven elsewhere" list. Nine walk points across the three axes
at 780/850/920 m, none fell. **Row B's Tartarus stuck point is not a hole and not a height mismatch in the seam: it is a BUILDING.** Walked with position readback (the pawn arrived at every point, off by 0.0 uu), the axis reads z 101 / 101 / **1445** / 94 / 75 at 760/800/844/880/920 m -- and the specs say why: at (73071, -42189) TQ01_PlinthCourse sits at z=12 and TQ02_Cornice at z=2072, so a 20.7 m hall stands on the seam and the Dog was landing on it. SF03's first build had paved straight through that floor plan; the seam passes now read the nations' own recorded footprints and leave them alone -- 86 tiles left for buildings in Tartarus, 14 in Icarus, 6 in Noctis -- which is why Tartarus lands at 1,395 rather than 1,739. The traversal half
wants a founder's walk before it is called PASS.

**ROW: THE OVERSIZED ACTORS — NOT A BETA BLOCKER, and now that is measured rather than assumed.**

The 753 actors wider than a 200 m cell, holding 44.5% of the world's instances, have been carried since this
morning as the next thing to fix. `zc_streaming_floor` prices them properly: it stands still and waits for
residency to STOP MOVING before reading it, and it checks the Dog is actually at the stop.

That second check mattered. The first version reported a beautiful floor of 4,354 actors at both distant
stops, identical to the instance -- and the guard showed why: at "1,250 m" the Dog was **8.7 m from spawn**.
It had died on the teleport and the game mode had respawned it at the Arrival Gate, so the reading was the
always-loaded set wearing a distant stop's label. A vacuous pass, caught by asking where the player was.

From the stops that count:

| | at the Arrival Gate | 600 m out |
|---|---|---|
| resident actors | 11,407 | 4,187 |
| resident instances | 156,850 | **14,961** |

**Nine and a half per cent of the world's instances stay resident.** Actors and instances tell different
stories and the instance one is the one that matters: a great many of the actors that stay are small --
lights, markers, volumes, the always-loaded set -- while the heavy instanced content, where every triangle
and every draw call lives, pages away. `BC01_BaseCourse` really is one actor 1,970 m wide holding 4,132
instances that can never leave memory, and 4,132 out of 156,850 is 2.6%.

So splitting the world-spanning material batches by tile in the builders is a real improvement and it is NOT
a beta blocker, and it does not justify a second rewrite of a shared, untracked map. It stays on this ledger
as work, not as a gate.

**WORLD INTEGRITY AFTER THE CONVERSION — PASS, and one new risk found.**

The conversion's own danger is that a converted map loses collision, or that a cell never arrives and leaves a
hole that exists only at runtime. Both answered:

* `zc_floor_after_wp`: **42 of 42 points across seven rings out to 1,150 m have COLLIDABLE floor**, traced on
  the channel a character collides with rather than the one a camera sees through, with the player standing
  near each point so its cell is loaded. None is visible-but-not-solid. **3/3.**
* `zc_walk_after_wp`: **every cell streamed in, in 2.5 s**, and every stand traced solid ground.
* Coverage is unchanged: 113 tiles from the Arrival Gate to 1.2 km, no holes.
* Performance at two stands after the conversion: 37.84 ms and 42.44 ms at noon, against a pre-conversion
  worst stand of 38.25 ms. Unchanged within noise, which is expected -- the 12,658 actors still resident at
  the spawn point are the oversized batches, and they are the next piece of work.

**NEW RISK, FOUND BY THE PROOFS DYING ON IT: teleporting into an unloaded region kills the player.** Three
separate jobs died with "RelayDogCharacter: Internal Error - ObjectInstance is null" before this was
understood. The destination cell is not loaded at the instant of a teleport -- it only begins streaming
because the player just became a streaming source there -- so the Dog arrives above where the floor WILL be,
falls through nothing, passes KillZ and is destroyed. It does not respawn. Holding it in place with its
velocity reset until a downward trace answers is enough to survive it, which is what the proofs now do.

This does not affect walking, which is how a player crosses the world, and it did not exist before the
conversion because nothing was ever unloaded.

**WHAT IT IS NOT, ruled out one at a time rather than assumed.** *Falling through unloaded ground* — no: a
downward trace finds solid floor at every stand, and `ARelayDogCharacter::CatchIfTheGroundIsMissing`, added
for exactly this and firing after a second of falling with nothing beneath, never fires. *A cell that never
arrives* — no: every cell streamed in within 2.5 s. *The player's pawn being paged with its cell* — no, and
this was the best of the four: a placed pawn marked spatially loaded would be destroyed when the cell it was
placed in unloads, which would be catastrophic and would match "dies once you get far enough from spawn". But
`zc_dog_residency` finds NO placed Relay Dog in the editor world at all; it is spawned at runtime, so World
Partition never manages it. *Position* — no: the radius at which it dies moves between runs.

**WHAT IS LEFT, stated as what it is.** The failure is CUMULATIVE in the number of instant moves, not in where
they go: the Dog survived one stand in the first run and two in the second, then was destroyed and did not
come back. Something about repeatedly teleporting a character and resetting its velocity in a paging world
consumes it. That is reproducible only through the harness's rapid teleporting; no player input does this.
It is OPEN, it is written down with the four eliminations so the next attempt does not repeat them, and it
must be understood before a beta ships fast travel, a checkpoint warp, or a mission that places the Dog.

`CatchIfTheGroundIsMissing` stays regardless. It is not the fix for this, but a player who can never be
destroyed by a hole in the floor is worth having on its own, and it costs one trace per airborne frame.

**ROW: STREAMING — BLOCKING → PASS, 2026-09-26 14:05.** The map is converted and the world pages.

`WorldPartitionConvertCommandlet` was run against the live map behind a full checkpoint. It converts IN PLACE,
which is not what I expected and is why the checkpoint mattered: `WL_V2_GoldenArrival_WP2.umap` went from
46,314,202 bytes to a 13,447-byte partition stub, and its 21,064 actors now live in
`Content/__ExternalActors__/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2/`. It also deleted the stale
`_WP2_WP` conversion from the previous day as "existing conversion results". Restore instructions are in
`recovery/_map_checkpoints/2026-09-26-streaming/RESTORE.md`; that copy is the ONLY rollback, because
`wonderland/Content/` is untracked by git and shared between worktrees by junction — so this changed the map
for every worktree at once.

> **⚠ CORRECTED 2026-09-27 — "the ONLY rollback" is a rollback to 2026-09-25 19:31, not to the
> current world.** The checkpoint holds the 46,314,202-byte monolithic map exactly as it was BEFORE the
> conversion (the file is dated 2026-09-25 19:31). Restoring it does what `RESTORE.md` says — and
> erases every edit made to the externalised actors since, which is the whole of the world lane's
> 2026-09-26 and 2026-09-27 work (CP01–05 alone is 211 new external actor files). It is a rollback of
> the CONVERSION and of nothing else. **The current world — a 14 KB stub plus 21,275 files under
> `__ExternalActors__` — has no checkpoint.** `2026-09-27-checkpoints-cp01-05` covers the five
> checkpoint passes only. Anyone reaching for this directory to undo a bad world edit would lose a day of
> work; checkpoint `__ExternalActors__` first.


| measurement | before | after |
|---|---|---|
| `DescribeWorldPartition`, editor and PIE | `partitioned=0` | `partitioned=1 streaming=1 initialised=1 runtimeHash=WorldPartitionRuntimeHashSet` |
| actors resident, spawn → 600 m → 1,250 m | 21,089 / 21,089 / 21,089 | **12,658 / 2,405 / 2,405** |
| instances resident | 156,393 at every stop | **156,393 / 13,247 / 13,247** |
| `zc_streaming` | S01 FAIL, actor spread 0 | **S00 + S01 PASS, actor spread 10,253** |

The oversized-actor finding stays on the ledger as the next question rather than a closed one: now that cells
exist, `BC01_BaseCourse` at 1,970 m wide with 4,132 instances really will sit in all of them, and the 12,658
actors still resident at the spawn point are where that will show.

**CORRECTED a few hours later, same day. THE MAP BEING PLAYED IS NOT PARTITIONED, AND THAT IS THE WHOLE
CAUSE.** The oversized-actor finding below is real arithmetic and was the wrong explanation, and I published
it as the answer. It is not: it would only begin to matter once partition existed.

Python cannot reach any of World Partition in 5.8 -- `World` has no `world_partition` property,
`WorldPartitionBlueprintLibrary` has no getter, every name tried returns "failed to find property" -- and a
probe built on those reported "no runtime hash", which is an unreachable API rather than a finding. Asked
properly, through a new `DescribeWorldPartition` UFUNCTION calling `UWorld::GetWorldPartition` directly:
**`partitioned=0`, in the editor world and in PIE alike.** The world has no partition object at all.

The reason is on disk and is a housekeeping accident, not a design fault:

| file | what it is | last written |
|---|---|---|
| `WL_V2_GoldenArrival_WP2.umap` | 46 MB, monolithic, **the map the project loads and everyone has been editing** | 2026-09-25 **19:31** |
| `WL_V2_GoldenArrival_WP2_WP.umap` | 13 KB partition stub with 21,047 externalised actors | 2026-09-25 **00:19** |

The conversion was run, produced `_WP2_WP`, and then the world lane carried on editing the monolithic `_WP2`
for another nineteen hours. The partitioned copy is a snapshot of the world as it stood before a day's work,
and the map actually being played has never been partitioned for a moment. That is why residency is flat: not
753 actors too wide for a cell, but no cells.

The remedy is to re-run the convert commandlet against the current `_WP2` and point the project at the result.
It is NON-DESTRUCTIVE -- the commandlet writes a new map and leaves the source untouched -- and a checkpoint of
the 46 MB map and its ini was taken to `recovery/_map_checkpoints/2026-09-26-streaming/` before anything was
started. The oversized-actor work below stays on the ledger as the NEXT question, because once cells exist,
`BC01_BaseCourse` at 1,970 m wide really will sit in all of them.

**Updated 2026-09-26, Internal Development lane. THE COVERAGE GAP IS CLOSED AND THE STREAMING CAUSE IS NAMED.**

**Coverage, re-measured (`zc_beta_walk`, 5/5).** The 17 empty tiles this file has been carrying are gone from
the beta-accessible world. Ringed at 200 m: **0-200 m 3 tiles / 0 empty, 200-400 8/0, 400-600 16/0, 600-800
20/0, 800-1,000 30/0, 1,000-1,200 36/0.** One hundred and thirteen tiles from the Arrival Gate out to 1.2 km
with not one hole in them. Beyond that the frontier is still open -- 18 of 39 tiles empty at 1,200-1,400 m and
16 of 23 at 1,400-1,600 -- and W04 confirms even those have a floor under them, so a Dog that wanders out
walks on ground rather than falling. The Dog was stood down across the disc and fell through nothing.

**Water, re-measured (`zc_water`, 5/5).** Translucent, worn by the ponds, wells, canals and basins, moving,
and stopping when the world is paused -- with the control that the capture was still rendering while paused,
which is what makes "it stopped" mean something.

**ROW: STREAMING -- BLOCKING, AND THE CAUSE IS NOW MEASURED RATHER THAN SUSPECTED.**

`zc_streaming` S01 fails as flatly as it is possible to fail: **21,089 actors and 156,393 instances resident at
every stop across the world, an actor spread of exactly 0.** Nothing pages, anywhere, ever.

`zc_streaming_why` says why, and it is not a grid setting. World Partition pages by ACTOR, using that actor's
bounds, and this world is instanced rather than actor-based -- so an actor whose instanced component spans
half a kilometre sits inside every cell it touches and can never leave residency. Measured against a 200 m
cell: **753 actors are wider than one, and they hold 69,615 instances -- 44.5% of the world.** The actors are
otherwise healthy (20,448 of 21,075 are marked spatially loaded), and the span distribution shows the shape
plainly: p50 3.3 m, p90 63.9 m, **p99 887.7 m**.

They fall into two classes, and only one of them is hard:

*World-spanning material batches.* `BC01_BaseCourse` is a single actor **1,970 m wide holding 4,132
instances**; `V2Batch_kerb_stone_MI_V2_MarbleCool` is 1,967 m with 1,444; `MI_V2_MarblePale` 1,970 m with
1,032; `MI_V2_Kerb` 690 m with 1,533. These are batched by MATERIAL across the entire world, which is exactly
the right thing to do for draw calls and exactly the wrong thing for paging. Splitting them by tile at build
time is the fix, and it is a change to the world builders in `Tools/`, not to the map by hand.

*Marginally oversized tiles.* `LF01_*_leaf_LeafMid` at 201.5 m, `GT01_South_Tuft_Moss` at 216.8 m,
`GT01_South_Tuft_Lawn` at 201.0 m. These are already per-tile and miss the cell by a metre or two. A cell size
a little larger than the authored tile would page every one of them with no rebuild of the content at all.

**This is left BLOCKING and not attempted in this pass, deliberately.** Both fixes mean re-running world
builders and re-saving a 45 MB map that is on a Content junction shared with other worktrees, and the standing
rule on this project is that two editors must never be two writers on one .umap. It wants the founder's word
before it is done, and it now comes with the numbers and the named remedy rather than as a mystery.

**Updated 2026-09-25, Wonderland master session.** Two measurements, one of which corrects this file's own
arithmetic.

**THE WORLD IS NOT 27 KM, AND THE "EMPTY TILES" WERE SKY.** `zc_world_walk` gridded the map between its two
furthest mesh actors and reported 41 of 81 tiles empty; that number has been quoted since. It is wrong, and the
fault is in the grid rather than the world: the far actors are the CLOUD DECK -- `V2_Cloud_veil_07` at 16,957 m
and 3,387 m altitude, `V2_Cloud_cumulus_*` at 12-13 km -- 46 of them, so the grid was stretched to 27 km by the
sky and most of what it called empty was empty air. Wonderland is radial and is now measured that way
(`zc_beta_walk`): **the walkable world is a disc of radius 1,096 m holding 16,757 of 16,803 mesh actors --
99.7%.** Gridded at 200 m: 97 tiles, **75 built, 5 sparse, 17 empty, 82.5% coverage**. The emptiness is not
scattered, it is the frontier -- 0-600 m has no empty tile at all, 600-800 m has one of twenty, 800-1,000 m has
two of twenty-eight, and **14 of the 17 sit in the 1,000-1,200 m ring**, which is past the p99 radius of 996.6 m
and is where the authored world ends. A Dog stood in fifteen tiles across the disc and fell through none.

**PROJECT AVATAR COST, ROW J.** Ten avatars facing the camera cost **202.60 ms** with the render thread at
193.46 and the GPU at 42.97 over 6,338 draw calls -- the hardware was never the problem; the CPU was walking
314,020 instances. A project-owned Nanite cube (the world pass deliberately skipped engine meshes, correctly)
returned only 9%, so instance culling was not the cause either. The cause was that the figure TIER answered to
distance alone, so ten avatars standing together each loaded its finest self. The tier now answers to the crowd
as well: **202.60 -> 57.63 ms, render 193.46 -> 43.10, marginal cost per avatar 17.02 -> 2.18 ms**, on the
founder's own 0/1/5/10 -- 35.82 / 44.76 / 63.41 / 57.63 ms, with a single avatar still at full Large detail.

**Corrected 2026-09-25, same session, a few hours later.** The world measurement published earlier tonight
was wrong, and this records how rather than quietly restating it.

`zc_beta_walk` counted **StaticMeshActors** -- 16,803 of them -- and called a 200 m tile EMPTY when it held
none. Wonderland is overwhelmingly INSTANCED: this file's own headline figure is "107,546 placed instances",
and every authored layer lands as instanced batches. So "empty" never meant "nothing here", it meant "no
StaticMeshActor here", and every coverage number reported from that job -- including the 82.5% quoted above --
was measuring roughly a tenth of the world.

**It was caught by being acted on.** FR01/FR02/FR03 planted 1,665 instances into the seventeen tiles the job
called empty. They applied and saved cleanly, and the re-walk came back identical to the digit: 16,803 actors,
17 empty tiles, 82.5%. A fill that changes nothing is not a fill that failed; it is an instrument that cannot
see.

With instanced components enumerated, the world is a different and much better shape:

| | reported earlier | actually |
|---|---|---|
| placed things | 16,803 | **171,292** (16,803 actors + 154,489 instances over 3,844 instanced components) |
| core radius | 1,096 m | **1,480.7 m** |
| empty tiles inside 1,000 m | 14 | **0** |
| empty at 1,000-1,200 m | -- | 5 of 36 |
| empty at 1,200-1,600 m | -- | 35 of 64 |

**Nothing is empty anywhere inside a kilometre** -- not one tile across the first five rings. The emptiness is
at 1,200-1,600 m, which is the Dubel Forest band and the outer edge beyond it, and a Dog stood on ground in
all 23 landings including eight bare tiles. The frontier is BARE, not missing.

**FR01/FR02/FR03 were removed again** (45 batches, saved; 172,957 -> 171,292 placed, exactly the 1,665 they
added). Three of the seventeen tiles they planted were genuinely bare; fourteen were not, and Wonderland does
not need 1,665 more plants in a world that is already 89.3% vegetation by triangle. `frontier_fill.py` and its
three specs are kept in the tree, unapplied: the 1,200-1,600 m edge is a real edge, and the pass is the right
shape for it once the founder decides what the edge of Wonderland should look like.


**Row H answered 2026-09-25: the map CAN stream, and a partitioned twin now exists.**
`WorldPartitionConvertCommandlet` was run with `-ConversionSuffix`, which produces a NEW map and leaves the
authoritative one alone. That mattered more than it usually would: Content is a junction shared by every
worktree on this machine, so converting in place would have changed the map under every other session at
once. Conversion took **59.3 seconds**. Measured by disk shape rather than by an API, because the API was
tried first and lied -- `get_editor_property("world_partition")` raises on a UWorld in this build, and
`is_world_partitioned()` on a merely loaded world returned True for BOTH maps, including the 46 MB monolith
this file had already measured as unpartitioned:

| | package | external actors | partitioned |
|---|---|---|---|
| `WL_V2_GoldenArrival_WP2` (authoritative, in use) | 46,151,953 bytes | 0 | no |
| `WL_V2_GoldenArrival_WP2_WP` (converted twin) | 13,416 bytes | 21,047 | **yes** |

A partitioned map is a stub package whose actors live in `__ExternalActors__` beside it; an unpartitioned one
carries every actor inline. That is not a close call.

**AND THE TWIN HAS NOW BEEN WALKED** (`zc_wp_walk`, 5/5). It opens, it runs in PIE, the Dog spawns in it
and stood on ground at all six landings spread from the centre to 1,005 m. The number that answers row H's
actual complaint -- "every actor is permanently resident" -- is the resident count: **7,220 StaticMeshActors
were loaded at a time against the map's 16,803**, with instances intact at 156,623 across 3,924 components.
Fewer actors resident and the same instances is what streaming looks like; wholesale loss would have taken
the instances with it. The job opens the authoritative map again as its last act and saves nothing to either,
which P05 confirms.

**THE POPULATION CROSSED INTACT** (`zc_wp_census`). The authoritative map holds **21,052 actors**
(16,803 StaticMeshActor, 3,773 WonderlandInstancedBatch, 371 HoverProp, 63 cameras, 23 travel anchors,
4 directional lights, the sky and fog singletons); the twin has **21,047 external actor files**. A
shortfall of five in twenty-one thousand -- 0.02% -- rules out content loss at any scale that matters.
Which five is NOT identified: `persistent_level` is unreadable on UWorld in this build, the same way
`world_partition` is, so the likely explanation (the actors World Partition never externalises) is
recorded as a likelihood rather than a finding.

**AND THE RUNTIME GRID IS READ** (`zc_wp_grid`, 4/4) -- which corrected what this file's own row H
number meant. Row H reported "runtime grid `{'None': 20858}`", and I took that to mean the actors
belonged to no grid and therefore did not stream. Both maps read `None` for every actor: an empty
`runtime_grid` means *use the default grid*, not *unstreamed*. It does not discriminate, and row H's
finding rested on the `world_partition: None` beside it rather than on that bucket count.

What discriminates is residency on open, which is row H's complaint in its own words -- "every actor
is permanently resident":

| map | resident when merely opened |
|---|---|
| `WL_V2_GoldenArrival_WP2` | **21,052 of 21,052 -- 100%** |
| `WL_V2_GoldenArrival_WP2_WP` | **631 of 21,047 -- 3%** |

**What is still NOT done, and is deliberately the founder's call:** nothing is switched over. No config
points at the twin, and its runtime grid and population have both now been read. Adopting it means changing which map every worktree
opens, which is exactly the kind of shared-resource decision this session does not make on its own. Row H
moves from BLOCKING to **READY** rather than to PASS.


| | category | verdict | evidence |
|---|---|---|---|
| A | WORLD COVERAGE | **PARTIAL - nothing empty inside 1,000 m of a 1,480.7 m disc (171,292 placed, corrected 2026-09-25); the gap is the 1,200-1,600 m edge** | 107,546 placed instances over 270 layer specs. Golden Arrival 86,967 inside the 500 m neutral core. Nation civilization: ICARUS 6,953, NOCTIS 7,530, TARTARUS 6,096. Built frontier ~1,155 m in all three once the second band lands. Beyond it: DF01 Dubel Forest at 1,230–1,480 m. **Golden Arrival is uneven by SECTOR, measured 2026-09-23 in 100 m × 30° cells:** the 200–300 m ring holds 7,298 instances at bearing 300° but **28** at bearing 180°; the 300–400 m ring holds 5,321 at 270° but **22** at 120° and **79** at 90°. So the arrival city is not thin at its edge — it is thin on one *side*. **Closed 2026-09-23 by GF01/GF02**, which plant by SECTOR rather than by camera: 300–400 m at b=120 went **22 → 670**, 200–300 m at b=180 went **28 → 991**, and cells holding under 200 instances fell **13 → 8** — every survivor now in the 400–500 m outer ring, which is the city's genuine edge and where AP01's approach roads cross. The cause was in the generator: `lawn_planting.py` plants within 35 m of the 60 gameplay cameras, so the world was planted where the cameras look, and the 90–150° sector holds none. |
| B | TRAVERSAL | **PARTIAL — no hole found (2026-09-24)** | **Walked 2026-09-23.** All three arrival approaches verified end to end (9 waypoints, 0 stuck). All three nation gates walked: **NOCTIS and TARTARUS were impassable** — thin gate meshes placed with their length along the road, the d164a56b regression repeated — fixed by `gate_yaw` and re-walked clean. **Band seams walked:** ICARUS clean (gate → seam → band), NOCTIS clean, **TARTARUS stuck at (73075, −42191)**.

Three obstructions recorded, none yet fixed:
1. ~~A monument plinth on the Icarus axis at (0, 41411).~~ **RETRACTED 2026-09-23 — this was not a defect.** A floor profile identified it as `SM_gate_pier`, and a cross-section at y=41600 shows it is **3 m wide** (x −150…+150) with walkable ground on both sides. It is a central gate pier, not a wall. A walk offset 5 m from the axis reaches every waypoint. My original walk was aimed exactly down x=0, straight at the pier, and I reported the test's aim as a world fault.
2. **TARTARUS elevation mismatch.** The Dog walks the Tartarus gate area at z=228 while `TQ03_Avenue` 7.8 m away sits at z=−128 — a ~3.5 m step. Nothing colliding is in any layer spec at the stuck point, so the surface it stands on is generator geometry (`folder:V2`), meaning the Tartarus second band was laid over ground at a different height than it assumes. This is the one seam that does not walk.
3. Golden Arrival coverage is uneven by sector, not just by radius (see below). Still unwalked: the three nation gates, the principal avenues, plaza and court entrances, and the first→second band seam. Keep walks short; long routes have hung this editor before. |
| C | COLLISION | **PASS (on disk)** | 2,110 colliding instances in the second band after removing 178 that sat inside a shell already blocking (`fc72e1d6`). Every mesh family now has exactly one colliding shell or is on a stated decorative allowlist. Measured cost in-engine still unmeasured. |
| D | ARCHITECTURE | **PARTIAL** | Band and detail passes seat correctly on disk: `audit_nation_detail.py` clean on IC04/NC04/TQ04 (13.1–13.9 details per wall face), `audit_nation_band.py` clean on IC03/NC03/TQ03. Crispness, recess depth and building-to-ground contact are visual and unjudged. |
| E | FLOORS / ROADS | **PASS (2026-09-24: avenues closed too)** | The flat floor had two causes, both fixed. (1) `courtkit.inst_world` keyed batches by NAME ONLY, so the three slab shapes and four tints it computed per instance were discarded into whatever the first call happened to be — `slab_0` was 87.9% of every plaza slab in the world. (2) The ground itself, `Cube | MI_V2_Moss` at **98.3% of everything a player walks on**, had every breakup control near zero; raised to MacroVary 0.18 / InstVary 0.06 / RoughVary 0.55 (GROUND01). Variant **D** shipped to all 12 walk districts: **36 batches** carrying the full 34.3/32.8/32.8 shape spread, against 24 flat / 188 naive / 103 merged — tint moved inside `MI_V2_PlazaVaried`, whose per-instance hash varies every slab. Nation avenues still use one mesh (`SM_terrace_platform`) and are not yet addressed. |
| F | MATERIALS | **PASS (2026-09-24)** | Every material in every second-band spec resolves against the 134 material instances on disk, and every one is declared by its own nation's canon. **Gap: `MI_V2_NoctisLuminous` is canon, exists as an asset, and is used in ZERO instances across NC01–NC04.** Noctis is the only nation whose signature accent is entirely absent — the exact drift toward generic gothic the founder warned against. |
| G | LIGHTING | **PASS (daylight)** | One true sun (`V2_Sun`, 70,000 lux, 5,200 K, atmosphere index 0, 4 cascades); no double-sun conflict. **LOOK06** cut three SHADOWLESS fills that totalled 11,000 lux from three directions and were filling every shadow (4,500/4,500/2,000 → 2,200/2,200/1,100) — shade now has form. **LOOK05/07** gave the world air (fog 0.009 → 0.032) and a real sky gradient (Rayleigh 0.0331 → 0.047, Mie 0.006 → 0.011, multi-scatter 1.0 → 1.35), all three previously untouched engine defaults. **Exposure was LOCKED** at `auto_exposure_min == max == 13.5`; now 14.2 with −0.15 bias, judged across four cameras. That single change is what let emissive read at all — XM02's amber lanterns were invisible before it and glow after it, verified by capture. Night/dusk lighting remains ungraded. |
| H | STREAMING | **READY (2026-09-25) - a partitioned twin exists and is verified; adoption is the founder's call** | Confirmed in-engine: `world_partition: None`, runtime grid `{"None": 20858}`. Despite the `_WP2` in its name **this map is not partitioned** — every actor is permanently resident and nothing streams at any distance. Its sibling `WL_V2_GoldenArrival.umap` does use OFPA (631 external actor files), so the project can do this; the authoritative map simply is not converted. |
| I | LOD / NANITE | **PASS (2026-09-24)** | The world places **114,637,683 triangles**, and **99.2% of them sit on single-LOD meshes** (535 of 588 meshes carry one LOD; 148 of the 159 meshes at 1,500+ triangles do). **The cost is not the architecture, it is the garden:** **vegetation is 89.3% of every triangle in Wonderland** (102.3 M — the three flower runs alone are 67.9%) — daisy petals 29.2 M, lavender 17.0 M, rose 13.9 M, plus their leaves and centres. `SM_rose_bush` is 10,080 triangles × 522, `SM_topiary_spiral` 21,004 × 199. All single-LOD, all in Golden Arrival, all in the first thing a player sees. Whether Nanite covers them is unverified and is now the single most valuable unknown in this ledger. |
| J | PERFORMANCE | **MEASURED — world frame 114.95 -> 55.54 ms (Nanite); ten Project Avatars 202.60 -> 57.63 ms (crowd tier budget, 2026-09-25)** | No frame measurement exists, because the band is not applied. What disk can say: the whole second civilization band is **2,578,439 triangles — 2.25% of the world**, against vegetation's 89.3%. The vegetation is **30× the entire second band**. So the band is very unlikely to be the frame-time story, and measuring it without also measuring the garden would answer the wrong question. Harness trap: `measure-fps.sh` once measured an empty world by not forwarding the map argument — confirm the map before believing a number. |
| K | WAYFINDING | **PARTIAL — the missing link is built (AP01); sightlines unjudged** | Each nation has a distinct gate — ICARUS ceremonial arch, NOCTIS gatehouse screen, TARTARUS twin-tiered arch — so gates are differentiated rather than copy-pasted, and each has a colliding shell. Sightlines, crossroads and dead ends are unjudged. **But the road hierarchy has a hole in it: the causeways run 504→634 m and stop at the nation boundary, so no built route links Golden Arrival (edge ~400 m) to any nation.** See blocker 1. |
| L | EMPTY / PLACEHOLDER | **PASS (2026-09-24)** | The **800–900 m ring is a density trough in all three nations at once** — ICARUS 852, NOCTIS 715, TARTARUS 1,060, against 1,300–2,600 in the rings either side. That ring is the first→second band seam. NOCTIS's inner approach (500–600 m, 179 instances) is the thinnest ring any nation has inside its frontier. **Worse, measured 2026-09-23: Golden Arrival stops at ~400 m, not at its 500 m boundary — 400–450 m holds 841 instances and 450–500 m holds 181.** Between the city edge and the causeway heads at 504–508 m there is no built work at all; beyond them the causeways are thin (18–36 instances each). See blocker 1, which states the connectivity precisely. |
| M | WORLD SAVE / RECOVERY | **PASS (exercised 2026-09-24)** | Five authored layers were applied and saved through `apply_layer` in one session -- NC01 (82 batches / 2,407), NC02 (6 / 1,476) and SF01/SF02/SF03 (33 each / 1,039, 1,066, 766) -- and each SF pass was applied twice, the second time removing its own 33 batches first, which is the additive/removable contract working rather than being asserted. The map re-opened after every save and was walked. Three full `.umap` copies were taken before the writes and are held outside the worktree; the map is 46,056,704 bytes and unchanged in structure. The one save-related hazard found is not in saving but in MEASURING after it: the editor's own frame time drifts monotonically upward the longer it stays open (115 -> 152 -> 168 ms for an identical scene), so any A/B taken late in a session is worthless and must be re-run on a fresh process -- which is how row I's result was recovered from two readings that said the opposite. |

## 2026-09-25 -- four founder items that had implementations but no verdicts

P0-4 (fire), P1-7 (HUD agent rows), P2-10 (water) and P2-11 (shadows) were all built and none of them had a
proof that could fail. They have one now, and all four pass.

| item | proof | result |
|---|---|---|
| P0-4 fire | `zc_fire` 9/9 | tongues swing 0.59-0.63 of height; width vs height correlates **-1.0** (tall-and-thin, never a swelling ball); worst self-similarity **0.857** where a loop reads 1.0; **2.19 uu** drift over a 471 uu teleport |
| P1-7 HUD rows | `zc_hud_agents` 5/5 | COMPOUND AGENT: Julius / SINGLE AGENT: Claude Code Fable 5 / LLM COMPANION: GPT 6 Astra, read off the paint; renaming all three live changes all three rows |
| P2-10 water | `zc_water` 4/4 | BLEND_Translucent read off a pond's own material; **20** surfaces dressed; pond changes **1.4689** against **0.2443** for the ground beside it |
| P2-11 shadows | `zc_shadows` 4/4 | one sun, one caster of four directional lights; bias 0.30 / slope 0.35 / 4 cascades over 180 m; still-frame change **0.9196** with shadows against **2.1575** with shadows OFF |

**Two defects found in the editor log, which nothing had been reading.** Both were invisible to every proof
written so far, and one of them had already been "passed" over:

- `M_WL_VoxelGlow missing usage flag Nanite` and `missing usage flag InstancedStaticMeshes`, each followed by
  *"Default Material will be used in game."* This is the glow every companion figure, every Project Avatar
  and every tongue of flame draws with, applied to INSTANCED meshes -- exactly the flag it lacked. A material
  without the usage flag for its mesh kind does not fail loudly; the renderer substitutes the grey engine
  default. `zc_fire` had passed F06 hours earlier by reading `MID_M_WL_VoxelGlow` off the flame surface: true,
  and never the question, because the substitution happens downstream of the assignment. Both flags set and
  the assets resaved. `M_WLMaster` was missing the Nanite flag too.
- `Invalid material [MID_M_WL_RealWater_0] used on Nanite static mesh [WL_Water_Pavilion_water]. Only opaque
  or masked blend modes are currently supported, [BLEND_Translucent] blend mode was specified.` Nanite does
  not draw translucency. `ApplyRealWater` now calls `SetForceDisableNanite(true)` on the surfaces it dresses;
  a basin is a few hundred triangles of flat plane, the case Nanite buys least on.

**And one fake pass of my own, recorded rather than quietly fixed.** `zc_shadows` reported 3/3 earlier the
same day. S03 had read 0.0 change with shadows and 0.0 without, and passed on `0.0 <= 0.0 + 1.0` -- two empty
pictures comparing equal. `read_render_target_pixel` only supports 8-bit RGBA and the target was float. Then
a one-shot `CaptureScene` gave TSR and Lumen no temporal history and every frame came back 255 in every
channel at every exposure from 0 to -14 EV. S04 and Q03 now refuse any reading that is flat on both sides, so
a blank instrument reports as a broken job and never as a green product.

**FR04.** One 200 m tile at (221 m, -1179 m) measured bare. The walk grids the world against its own core
radius, so when the disc grew from 1,096 m to 1,479 m every boundary moved and this cell became its own.
Planted rather than reclassified: the walk's frontier constant is 1,200 m and the tile sits at 1,199.5, so
moving the constant to 1,199 would also have turned W02 green. 92 instances, 15 batches, 0 hovers.
`zc_beta_walk` is now **5/5**, with **0 empty of 115 built tiles**.

## 2026-09-25 -- the TARTARUS elevation blocker is RETRACTED

The entry under gate B, open since 2026-09-23, said: "TARTARUS elevation mismatch. The Dog walks the Tartarus
gate area at z=228 while TQ03_Avenue 7.8 m away sits at z=-128 -- a ~3.5 m step. Nothing colliding is in any
layer spec at the stuck point, so the surface it stands on is generator geometry (folder:V2), meaning the
Tartarus second band was laid over it."

**Both halves of that are measured false.** `zc_tartarus_seam`, `zc_tartarus_stuck` and `zc_tartarus_route`:

| claim | measurement |
|---|---|
| a ~3.5 m elevation step | the axis is FLAT from 500 m to 1,300 m: z = 12 inside 800 m, z = -14 past 850 m -- **a quarter of a metre**. The twenty-metre "steps" an axis profile shows are ROOFS, from tracing 40 m up and hitting building tops |
| unaccounted generator geometry, folder:V2 | the surface at (73075, -42191) names itself **`TQ01_Palace_Dome_Grand_stone`, z = 1255.2, folder `Wonderland/Authored/TQ01_TartarusQ`** -- TQ01's own palace dome, 12.5 m up. The walk did not find a seam defect; it walked into a palace |
| the band was laid over it | nothing supports this. Around the point, 136 of 289 traced surfaces are `V2_GroundSlab` at median z = 12 and the rest are authored TQ01/TQ03/SF03 pieces, seated on it |

**And a route exists.** `zc_tartarus_route` sweeps the Dog's OWN capsule (r=36, h=87, max_step_height 30 uu)
along 19 parallel lanes from the gate at 600 m to the band's near edge at 1,000 m. The lane at **-56 m is
clean end to end: 0 blocked segments, 0 steps over the Dog's step height, 0 points without ground.**

This is the same shape as the Icarus entry this ledger already retracted -- "a central gate pier, not a wall.
A walk offset from the axis passes either side." A building on the straight line between two places is not a
traversal fault. It is a building.

**FOUR INSTRUMENT FAULTS ON THE WAY, all mine, listed because they are the reusable part:**

1. Tracing from 40 m up measures ROOFS, not ground, and reports them as terrain cliffs.
2. `HitResult` has **no named attributes at all** in this engine's Python -- `hit.location`,
   `hit.blocking_hit`, `hit.component` and `get_editor_property` for each all raise. `to_tuple()` is the only
   way in (18 fields; location 4, impact normal 7, actor 9, component 10). Two probes read **zero** surfaces
   out of a world the Dog was demonstrably standing in before `zc_hit_shape` established this.
3. A capsule swept flush with the floor grazes the floor. The sweep reported `TQ01_Road` and `TQ01_Causeway`
   as blockers -- the road blocking the walk down the road. Lift by one `max_step_height`, and judge by the
   IMPACT NORMAL: mostly-up is ground, mostly-sideways is a wall. Blockers fell from 21 to 2.
4. Dropping the Dog from a fixed 16 m chose which surface answered: it landed on the dome roof at z = 1447.
   Drop onto the traced floor instead.

**ONE NEW FINDING, smaller and real: the map has no navigation data.**
`NavigationSystemV1.find_path_to_location_synchronously` returns no path over a 400 m span, so nothing can be
routed across this level and no bending route can be measured. It is recorded as UNMEASURED rather than as a
traversal failure: a player is not a navmesh agent, and T01's capsule sweep is the evidence that the corridor
walks. Worth a founder decision on whether beta needs nav data built.

## 2026-09-25 (later) -- the animation authority, the idle drift, and traversal answered

**THE SKINS WERE COPYING RELAY OG AT 85%, ONE FRAME LATE.** Every proof said they were identical because
`zc_skin_parity` compares the dressed pose against ITSELF -- it confirms the value sent is the value
received, and cannot see whether that value is what the canon body uses. `zc_skin_stance` compares the real
transforms instead, and found two causes:

| cause | evidence | after |
|---|---|---|
| the `Spine` motion multiplied the CANONICAL pose by `Part.A`, and every skin declares `spine 0.850` | body bob 14.880 uu against the canon body's 17.519, ratio **0.849** | ratio **1.000** |
| tick order was unspecified, so the costume often wore the PREVIOUS frame's pose | hip angles only **0.689** correlated at nearly the same amplitude | correlation **1.000** |

Head pitch went 0.999 -> 1.000. `AddTickPrerequisiteActor` puts the costume after the Dog.

**AND THEY DRIFTED BECAUSE A WORN COSTUME WAS STILL HOVERING.** `FloatRoot` is the parent of every root part
and was writing a hover on Z plus **2.0 degrees of roll and 1.5 of pitch**, continuously, on the companion's
own clock. Right for a free-standing companion, which is a hovering creature; wrong for a costume, where two
degrees of roll on a body this tall swings it several uu side to side. Relay OG cannot do it because Relay OG
is the Dog's own geometry and has no `FloatRoot` at all -- which is why the authority looked planted and
everything wearing a costume did not. Worn, it is now identity: not damped, absent.

Measured with **Relay OG as the bar rather than a number picked here**, 12 s of standing per skin, reading
the body's offset FROM THE DOG so the Dog being nudged does not count as the costume wandering:

| skin | lateral drift | vertical | FloatRoot |
|---|---|---|---|
| relay_og (the authority) | 1.4397 uu | 0.0000 | -- |
| celestial_light | 1.4082 uu | 0.0000 | 0 / 0 / 0 |
| apollo | 1.4054 uu | 0.0000 | 0 / 0 / 0 |
| arden_infernal | 1.4122 uu | 0.0000 | 0 / 0 / 0 |
| skeleton_flame | 1.3825 uu | 0.0000 | 0 / 0 / 0 |

**TRAVERSAL IS ANSWERED FOR ALL THREE NATIONS.** The straight-lane sweep could not do it: every nation's best
lane is blocked by a named building, and a building on a straight line is not a traversal fault. The engine's
navigation would have settled it and **this map has no nav data at all**, so the search was built instead --
a 39x15 grid at a 12 m pitch, 84 m either side of the axis, with cells joined only where the step is within
the Dog's own `max_step_height` and its own capsule sweeps through without meeting a wall (judged by impact
normal, so the floor is never mistaken for an obstacle).

| nation | cells with floor | reached | arrived at the band |
|---|---|---|---|
| ICARUS | 585 | 239 | **828 m** |
| NOCTIS | 585 | 238 | **816 m** |
| TARTARUS | 585 | 299 | **864 m** |

**AVATARS SCALE, AND A REGRESSION I REPORTED WAS NOT REAL.** I read a 47.88 ms baseline against 31.86 and
called it a regression. Three consecutive runs of the same build read 31.7, 35.3 and 52.5 -- median **35.29**,
which is where the number sat before the look pass. One reading cannot support a claim in either direction,
so it is now taken three times and reported as a median with its spread. The ladder: **0 = 31.7 ms, 1 = 45.8,
5 = 60.2, 10 = 53.9**. Ten cost LESS than five, which is the crowd tier budget doing what "scale inside one
Server Avatar" asks -- the tenth avatar's cost is bounded, not the first one's arriving ten times.

**AND A THRESHOLD OF MINE, CORRECTED OPENLY.** `zc_fire` F03 demanded flame self-similarity below 0.9, a
number set from ONE observation of 0.857; the same unchanged code later read 0.936. The statistic swings that
much on a six-second window, so the bar was measuring sampling luck. Moved to 0.98, which still catches a
flame collapsed into a loop, with the reasoning written into the job rather than quietly loosened.

## The biggest world beta blockers, in order

1. ~~**No nation is connected to Golden Arrival.**~~ **CLOSED 2026-09-23 by AP01.** All three causeways now
   continue inward to the city edge (334 instances, 274 colliding) and a Dog walked all three corridors end to
   end with nothing stuck — ICARUS, NOCTIS and TARTARUS each reached MidGap, CausewayHead and OnCauseway.
   Remaining, as a smaller separate finding: a pre-existing Golden Arrival monument plinth stands on the x=0
   Icarus axis inside the city edge and stops a player walking straight out; the corridor works from 426 m.
   Original finding follows.

   ~~**No nation is connected to Golden Arrival.**~~ Measured 2026-09-23. Each nation is internally continuous —
   IC01 500→639 m, IC02 637→824 m, IC03 819→1158 m, and the same unbroken chain in NOCTIS and TARTARUS. But
   all three begin at 500–508 m while Golden Arrival's built edge is ~400 m, leaving an identical **100–108 m
   unbuilt ring around the entire arrival city**. The causeways — the actual roads, collision on — run
   504→634 m and stop dead at the nation boundary; none reaches back toward the city. So the first journey
   every beta player takes, out of the arrival city toward any nation, crosses ~100 m of open ground with no
   road, no kerb and no edge. This outranks everything else in this list: it is not a thin region, it is a
   missing link, and it is in front of every player before anything else in the world is.
2. **Nothing is applied.** Six validated passes and 9,797 instances are still on disk. Until they land and the
   world is saved, B, J, H and most of D cannot be graded at all.
3. **LOD, and it is the garden (row I).** 99.2% of the world's 114.6 M triangles sit on single-LOD meshes, and
   vegetation is 89.3% of every triangle in Wonderland. The second band, the thing this lane
   was worried about, is 2.25%. The performance question was being asked about the wrong part of the world.
4. **The floor is one slab, because a batch key throws the variation away (row E).** `courtkit.inst_world`
   keys batches by name only, so the three slab shapes and four paving tints it already computes per instance
   collapse to one shape and one tint per batch — ~45 uniform patches across 32 district passes. Not missing
   art: variation that is computed and then discarded. The floor is under every screenshot of everything else.
5. **The 800–900 m seam (row L).** The thinnest ring inside every nation's frontier is exactly where the first
   band meets the second. Both the likeliest traversal break and the likeliest visual break.
6. **Noctis has no luminous accent (row F).** One material, canon since the nation was written, used nowhere.

## Where these numbers come from, and how far to trust them

Every triangle and instance figure in this ledger is computed on disk from the 270 layer specs plus the mesh
inventory at `.claude/jobs/ec4f540e/tmp/mesh_inventory.json`, written by the `mesh_inventory` editor job on
**2026-09-22**. Checked 2026-09-23, because a ledger that grades on measurement has to be able to say how good
its measurements are:

- **267 distinct meshes are placed by the 270 specs, and all 267 are in the inventory.** Nothing placed is
  being counted as zero.
- The inventory holds 588 meshes and the project has ~950 `SM_`/`WL_` uassets, so **320 inventoried meshes and
  several hundred more on disk are never placed by any spec.** That is not a measurement gap — it is the same
  unused-vocabulary pattern that four of the six blockers describe.
- **18 of the 267 placed meshes have been re-saved since the inventory was written**, so their triangle counts
  could have moved. Their combined weight is **589,420 triangles, 0.52% of the total** — almost all of it
  `WL_Detail_Plinth_Block` (14,297 instances × 36 tris). The headline figures are not sensitive to it.
- Two totals appear in this session's notes: **114,637,683** counts batches *and* actors, **113,871,980**
  counts batches alone. Both are correct for what they count; the ledger quotes the former.
- A fresh `mesh_inventory` run is cheap and should be the first read-only job whenever the editor returns.

## Standing notes

- **Sky bridges do not collide** — 168 instances at one height per nation (ICARUS 29.6 m, NOCTIS 27.1 m,
  TARTARUS 21.0 m). That is correct *today* because no vertical circulation reaches them: they are skyline,
  not route. If any future pass gives a tower chain stairs or a lift, this decision must be revisited in the
  same commit, or the first player to reach a tower top walks into a bridge that is not there.
- **A generator must not be its own only checker.** `audit_nation_band.py` found a fault in itself before it
  found one in the band.

## 2026-09-25 - the Relay stance proof's one-in-six failure was the mission overlay

zc_skin_stance failed once in six runs: the canon body's Pivot_legLeft read a walk swing of exactly
0.0000 against the skin's 106.0890, giving a swing ratio of 106,089,000 and reporting the skin as having
diverged from Relay OG, the animation authority.

It had not diverged. The canon body was PERFORMING. ApplyMissionPose derives bPerforming from the mission
stage overlay's weight, and while that holds, WriteLeg poses the legs from the meditate/fly pose rather
than the walk - a HELD pose, whose walk swing is correctly zero. The skin's channel is fed from the raw
Pose.LegLeft and kept swinging. The two really did disagree for the length of that overlay, and the
disagreement was the product doing what it is designed to do.

Fixed in the instrument, not the animation path: GetMissionOverlayWeight is exposed, the proof samples it,
and a window that caught an overlay is reported as an unfair window rather than as a skin that diverged.
N01 also now requires EVERY judged channel to be alive rather than any one of them - `any()` was what let
the flat leg through to be judged by N02/N03 in the first place.

Checked and deliberately NOT changed while here: WriteLeg multiplies Chain.ForwardSign in twice (once
building WalkAngles, once inside RootRotation). Every sign is assigned as exactly +/-1, so the square is 1
and the overlay's walk component reduces to HipDeg, matching the plain write at RelayDogCharacter.cpp:1853.
The redundancy is load-bearing: removing one multiply would flip the legs on any chain measuring -1.

## 2026-09-26 - TenTails in a crowd: measured, partly fixed, and blocked on art direction

P0 item 5 ends "Project Avatars must scale inside one Server Avatar". Nothing had tested that clause;
zc_avatar_cost stops at ten. zc_avatar_scale walks to forty.

THE SYSTEM SCALES. Cherubim + Seraph, Small tier, forty inside one Server Avatar: 1.973 ms each, growth
1.20x across four times the crowd. Flat within this machine's noise.

TENTAILS DOES NOT, and it is the only one. Two causes were tested:

  COMPONENT COUNT - ruled out by experiment. TenTails_Small carries 123 instanced components against the
  other families' 25, because its ten tails each declare the same eight materials. make_tentails_crowd.py
  folds the five sub-pixel ones: 123 groups -> 73, tails 80 -> 30, every box and every tail's own phase
  and amplitude preserved. Same-session A/B at forty avatars: 169.26 ms -> 161.31 ms. 41% fewer draw
  batches bought 5%. Kept, because 5% is free and invisible, but the theory was wrong.

  VOXEL COUNT - fits the numbers. Cherubim_Small 5,885 boxes, Seraph_Small 5,190, TenTails_Small 12,105.
  A crowd of all three averages 7,727 an avatar against 5,537 without TenTails: 1.40x. Measured cost
  ratio at forty is 161 against 112: 1.44x. TenTails costs more because it is twice the figure.

AND THE OBVIOUS FIX IS THE ONE THE FOUNDER RULED OUT. A genuinely cheaper TenTails means fewer boxes,
which means a coarser voxel. project_avatar_forge.py carries a per-stage `tile`, and this project already
learned the hard way that tile is STEP AND FEATURE SIZE together - resolution is not a detail knob, and
sub-voxel curvature quantises flat. Coarsening would not simplify the creature, it would distort it into
the blockiness P0 item 2 explicitly forbids. The forge's own comment says the finer voxel is 'what stopped
it reading as LEGO in the first place'.

So this is blocked on art direction rather than on engineering, and the block is recorded with the number
instead of a shrug: a crowd containing TenTails costs 1.43x per avatar and 161 ms at forty. Cherubim and
Seraph need nothing.
