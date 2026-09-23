# Wonderland — world-only beta-readiness ledger

Opened 2026-09-23 by the world lane. **World only.** HUD, terminals, companions, Project Avatars and Server
Avatars are Internal Development's and are not graded here.

Every row is PASS / PARTIAL / BLOCKING with the evidence that decided it. A row whose evidence needs the editor
says **UNMEASURED** and names the measurement, rather than borrowing a screenshot's confidence. The founder's
standing rule applies to this file too: *do not call the world beta-ready because screenshots look good.*

State when this was written: the second civilization band (IC03/NC03/TQ03/IC04/NC04/TQ04, 9,797 instances) is
validated on disk and **not yet applied** — Internal Development held the editor. Everything in column J and
most of B is therefore unmeasured by construction.

| | category | verdict | evidence |
|---|---|---|---|
| A | WORLD COVERAGE | **PARTIAL** | 107,546 placed instances over 270 layer specs. Golden Arrival 86,967 inside the 500 m neutral core. Nation civilization: ICARUS 6,953, NOCTIS 7,530, TARTARUS 6,096. Built frontier ~1,155 m in all three once the second band lands. Beyond it: empty. |
| B | TRAVERSAL | **UNMEASURED** | Needs the editor. Required: three nation gates, principal avenue per nation, plaza and court entrances, district edges, and the first→second band seam. Surface profile AND a character walk — neither alone proves it. Keep walks short; long routes have hung this editor before. |
| C | COLLISION | **PASS (on disk)** | 2,110 colliding instances in the second band after removing 178 that sat inside a shell already blocking (`fc72e1d6`). Every mesh family now has exactly one colliding shell or is on a stated decorative allowlist. Measured cost in-engine still unmeasured. |
| D | ARCHITECTURE | **PARTIAL** | Band and detail passes seat correctly on disk: `audit_nation_detail.py` clean on IC04/NC04/TQ04 (13.1–13.9 details per wall face), `audit_nation_band.py` clean on IC03/NC03/TQ03. Crispness, recess depth and building-to-ground contact are visual and unjudged. |
| E | FLOORS / ROADS | **BLOCKING** | The founder's standing note is that the floor must not read as a flat procedural sheet under detailed buildings. Measured 2026-09-23, it currently does. **Nine `SM_plaza_slab` variants exist and three are placed — `slab_0` alone is 87.9% of every plaza slab in the world** (1,769 of 2,012); #1, #2, #4, #5, #7 and #8 have never been placed anywhere. The nations are worse: their entire walkable floor is `SM_terrace_platform` × 2,536, one mesh doing every avenue, court and work block. Golden Arrival's ground is 83% kerb stone (10,623 of 12,775) with 2,012 slabs. And the vocabulary that would break it up is sitting unused — 12 `WL_Ground_Flagstone_A/B/C` meshes with about 12 instances placed in total, all in Golden Arrival, none in any nation, plus `Ground_Steps_Broad`, `Ground_Step_Single`, `Ground_Kerb_Corner` and `Ground_Tree_Grate`, none of them placed by a nation pass. This is proven art, already standing up in-engine. The floor has nine tools and uses one for seven-eighths of the work. |
| F | MATERIALS | **PARTIAL** | Every material in every second-band spec resolves against the 134 material instances on disk, and every one is declared by its own nation's canon. **Gap: `MI_V2_NoctisLuminous` is canon, exists as an asset, and is used in ZERO instances across NC01–NC04.** Noctis is the only nation whose signature accent is entirely absent — the exact drift toward generic gothic the founder warned against. |
| G | LIGHTING | **UNMEASURED** | No lighting pass has been graded for the nation bands. |
| H | STREAMING | **UNMEASURED** | The authoritative map is a classic non-WP container; streaming behaviour at 1,155 m is unmeasured. |
| I | LOD / NANITE | **BLOCKING** | The world places **114,637,683 triangles**, and **99.2% of them sit on single-LOD meshes** (535 of 588 meshes carry one LOD; 148 of the 159 meshes at 1,500+ triangles do). **The cost is not the architecture, it is the garden:** **vegetation is 89.3% of every triangle in Wonderland** (102.3 M — the three flower runs alone are 67.9%) — daisy petals 29.2 M, lavender 17.0 M, rose 13.9 M, plus their leaves and centres. `SM_rose_bush` is 10,080 triangles × 522, `SM_topiary_spiral` 21,004 × 199. All single-LOD, all in Golden Arrival, all in the first thing a player sees. Whether Nanite covers them is unverified and is now the single most valuable unknown in this ledger. |
| J | PERFORMANCE | **UNMEASURED (but reframed)** | No frame measurement exists, because the band is not applied. What disk can say: the whole second civilization band is **2,578,439 triangles — 2.25% of the world**, against vegetation's 89.3%. The vegetation is **30× the entire second band**. So the band is very unlikely to be the frame-time story, and measuring it without also measuring the garden would answer the wrong question. Harness trap: `measure-fps.sh` once measured an empty world by not forwarding the map argument — confirm the map before believing a number. |
| K | WAYFINDING | **BLOCKING** | Each nation has a distinct gate — ICARUS ceremonial arch, NOCTIS gatehouse screen, TARTARUS twin-tiered arch — so gates are differentiated rather than copy-pasted, and each has a colliding shell. Sightlines, crossroads and dead ends are unjudged. **But the road hierarchy has a hole in it: the causeways run 504→634 m and stop at the nation boundary, so no built route links Golden Arrival (edge ~400 m) to any nation.** See blocker 1. |
| L | EMPTY / PLACEHOLDER | **BLOCKING** | The **800–900 m ring is a density trough in all three nations at once** — ICARUS 852, NOCTIS 715, TARTARUS 1,060, against 1,300–2,600 in the rings either side. That ring is the first→second band seam. NOCTIS's inner approach (500–600 m, 179 instances) is the thinnest ring any nation has inside its frontier. **Worse, measured 2026-09-23: Golden Arrival stops at ~400 m, not at its 500 m boundary — 400–450 m holds 841 instances and 450–500 m holds 181.** Between the city edge and the causeway heads at 504–508 m there is no built work at all; beyond them the causeways are thin (18–36 instances each). See blocker 1, which states the connectivity precisely. |
| M | WORLD SAVE / RECOVERY | **UNMEASURED** | No save has been exercised by this lane in this session. |

## The biggest world beta blockers, in order

1. **No nation is connected to Golden Arrival.** Measured 2026-09-23. Each nation is internally continuous —
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
4. **The floor is one slab (row E).** `slab_0` is 87.9% of every plaza slab in the world and the nations'
   whole floor is a single mesh, while nine slab variants and three flagstone families sit unused. The fix
   needs no new art, and the floor is under every screenshot of everything else.
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
