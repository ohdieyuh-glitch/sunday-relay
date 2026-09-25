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

| | category | verdict | evidence |
|---|---|---|---|
| A | WORLD COVERAGE | **PARTIAL** | 107,546 placed instances over 270 layer specs. Golden Arrival 86,967 inside the 500 m neutral core. Nation civilization: ICARUS 6,953, NOCTIS 7,530, TARTARUS 6,096. Built frontier ~1,155 m in all three once the second band lands. Beyond it: DF01 Dubel Forest at 1,230–1,480 m. **Golden Arrival is uneven by SECTOR, measured 2026-09-23 in 100 m × 30° cells:** the 200–300 m ring holds 7,298 instances at bearing 300° but **28** at bearing 180°; the 300–400 m ring holds 5,321 at 270° but **22** at 120° and **79** at 90°. So the arrival city is not thin at its edge — it is thin on one *side*. **Closed 2026-09-23 by GF01/GF02**, which plant by SECTOR rather than by camera: 300–400 m at b=120 went **22 → 670**, 200–300 m at b=180 went **28 → 991**, and cells holding under 200 instances fell **13 → 8** — every survivor now in the 400–500 m outer ring, which is the city's genuine edge and where AP01's approach roads cross. The cause was in the generator: `lawn_planting.py` plants within 35 m of the 60 gameplay cameras, so the world was planted where the cameras look, and the 90–150° sector holds none. |
| B | TRAVERSAL | **PARTIAL** | **Walked 2026-09-23.** All three arrival approaches verified end to end (9 waypoints, 0 stuck). All three nation gates walked: **NOCTIS and TARTARUS were impassable** — thin gate meshes placed with their length along the road, the d164a56b regression repeated — fixed by `gate_yaw` and re-walked clean. **Band seams walked:** ICARUS clean (gate → seam → band), NOCTIS clean, **TARTARUS stuck at (73075, −42191)**.

Three obstructions recorded, none yet fixed:
1. ~~A monument plinth on the Icarus axis at (0, 41411).~~ **RETRACTED 2026-09-23 — this was not a defect.** A floor profile identified it as `SM_gate_pier`, and a cross-section at y=41600 shows it is **3 m wide** (x −150…+150) with walkable ground on both sides. It is a central gate pier, not a wall. A walk offset 5 m from the axis reaches every waypoint. My original walk was aimed exactly down x=0, straight at the pier, and I reported the test's aim as a world fault.
2. **TARTARUS elevation mismatch.** The Dog walks the Tartarus gate area at z=228 while `TQ03_Avenue` 7.8 m away sits at z=−128 — a ~3.5 m step. Nothing colliding is in any layer spec at the stuck point, so the surface it stands on is generator geometry (`folder:V2`), meaning the Tartarus second band was laid over ground at a different height than it assumes. This is the one seam that does not walk.
3. Golden Arrival coverage is uneven by sector, not just by radius (see below). Still unwalked: the three nation gates, the principal avenues, plaza and court entrances, and the first→second band seam. Keep walks short; long routes have hung this editor before. |
| C | COLLISION | **PASS (on disk)** | 2,110 colliding instances in the second band after removing 178 that sat inside a shell already blocking (`fc72e1d6`). Every mesh family now has exactly one colliding shell or is on a stated decorative allowlist. Measured cost in-engine still unmeasured. |
| D | ARCHITECTURE | **PARTIAL** | Band and detail passes seat correctly on disk: `audit_nation_detail.py` clean on IC04/NC04/TQ04 (13.1–13.9 details per wall face), `audit_nation_band.py` clean on IC03/NC03/TQ03. Crispness, recess depth and building-to-ground contact are visual and unjudged. |
| E | FLOORS / ROADS | **PASS (districts)** | The flat floor had two causes, both fixed. (1) `courtkit.inst_world` keyed batches by NAME ONLY, so the three slab shapes and four tints it computed per instance were discarded into whatever the first call happened to be — `slab_0` was 87.9% of every plaza slab in the world. (2) The ground itself, `Cube | MI_V2_Moss` at **98.3% of everything a player walks on**, had every breakup control near zero; raised to MacroVary 0.18 / InstVary 0.06 / RoughVary 0.55 (GROUND01). Variant **D** shipped to all 12 walk districts: **36 batches** carrying the full 34.3/32.8/32.8 shape spread, against 24 flat / 188 naive / 103 merged — tint moved inside `MI_V2_PlazaVaried`, whose per-instance hash varies every slab. Nation avenues still use one mesh (`SM_terrace_platform`) and are not yet addressed. |
| F | MATERIALS | **PARTIAL** | Every material in every second-band spec resolves against the 134 material instances on disk, and every one is declared by its own nation's canon. **Gap: `MI_V2_NoctisLuminous` is canon, exists as an asset, and is used in ZERO instances across NC01–NC04.** Noctis is the only nation whose signature accent is entirely absent — the exact drift toward generic gothic the founder warned against. |
| G | LIGHTING | **PASS (daylight)** | One true sun (`V2_Sun`, 70,000 lux, 5,200 K, atmosphere index 0, 4 cascades); no double-sun conflict. **LOOK06** cut three SHADOWLESS fills that totalled 11,000 lux from three directions and were filling every shadow (4,500/4,500/2,000 → 2,200/2,200/1,100) — shade now has form. **LOOK05/07** gave the world air (fog 0.009 → 0.032) and a real sky gradient (Rayleigh 0.0331 → 0.047, Mie 0.006 → 0.011, multi-scatter 1.0 → 1.35), all three previously untouched engine defaults. **Exposure was LOCKED** at `auto_exposure_min == max == 13.5`; now 14.2 with −0.15 bias, judged across four cameras. That single change is what let emissive read at all — XM02's amber lanterns were invisible before it and glow after it, verified by capture. Night/dusk lighting remains ungraded. |
| H | STREAMING | **BLOCKING** | Confirmed in-engine: `world_partition: None`, runtime grid `{"None": 20858}`. Despite the `_WP2` in its name **this map is not partitioned** — every actor is permanently resident and nothing streams at any distance. Its sibling `WL_V2_GoldenArrival.umap` does use OFPA (631 external actor files), so the project can do this; the authoritative map simply is not converted. |
| I | LOD / NANITE | **BLOCKING** | The world places **114,637,683 triangles**, and **99.2% of them sit on single-LOD meshes** (535 of 588 meshes carry one LOD; 148 of the 159 meshes at 1,500+ triangles do). **The cost is not the architecture, it is the garden:** **vegetation is 89.3% of every triangle in Wonderland** (102.3 M — the three flower runs alone are 67.9%) — daisy petals 29.2 M, lavender 17.0 M, rose 13.9 M, plus their leaves and centres. `SM_rose_bush` is 10,080 triangles × 522, `SM_topiary_spiral` 21,004 × 199. All single-LOD, all in Golden Arrival, all in the first thing a player sees. Whether Nanite covers them is unverified and is now the single most valuable unknown in this ledger. |
| J | PERFORMANCE | **UNMEASURED (but reframed)** | No frame measurement exists, because the band is not applied. What disk can say: the whole second civilization band is **2,578,439 triangles — 2.25% of the world**, against vegetation's 89.3%. The vegetation is **30× the entire second band**. So the band is very unlikely to be the frame-time story, and measuring it without also measuring the garden would answer the wrong question. Harness trap: `measure-fps.sh` once measured an empty world by not forwarding the map argument — confirm the map before believing a number. |
| K | WAYFINDING | **BLOCKING** | Each nation has a distinct gate — ICARUS ceremonial arch, NOCTIS gatehouse screen, TARTARUS twin-tiered arch — so gates are differentiated rather than copy-pasted, and each has a colliding shell. Sightlines, crossroads and dead ends are unjudged. **But the road hierarchy has a hole in it: the causeways run 504→634 m and stop at the nation boundary, so no built route links Golden Arrival (edge ~400 m) to any nation.** See blocker 1. |
| L | EMPTY / PLACEHOLDER | **BLOCKING** | The **800–900 m ring is a density trough in all three nations at once** — ICARUS 852, NOCTIS 715, TARTARUS 1,060, against 1,300–2,600 in the rings either side. That ring is the first→second band seam. NOCTIS's inner approach (500–600 m, 179 instances) is the thinnest ring any nation has inside its frontier. **Worse, measured 2026-09-23: Golden Arrival stops at ~400 m, not at its 500 m boundary — 400–450 m holds 841 instances and 450–500 m holds 181.** Between the city edge and the causeway heads at 504–508 m there is no built work at all; beyond them the causeways are thin (18–36 instances each). See blocker 1, which states the connectivity precisely. |
| M | WORLD SAVE / RECOVERY | **UNMEASURED** | No save has been exercised by this lane in this session. |

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
