# Golden Arrival as a place — world development ledger

Founder sequencing correction (2026-08-29): after the locomotion loop and its playtest, the next
phase is **world development, not combat**. The target is that walking the Dog around Golden Arrival
reads as *"this is already Wonderland"* rather than *"this is the test area where Wonderland will go"*.
No fighting system starts until this phase is approved. V1 stays legacy and read-only; PASS 07's
castle massing, garden structure, gate, skyline hierarchy and camera suite are preserved.

## The audit, measured before anything was built

Done from `layout_v2` on a laptop — path clearance and emptiness are geometry, and geometry does not
need a GPU. (The gameplay traversal itself follows on the next build, as the founder asked; this is
what could be established first.)

**Traversal works.** Every waypoint of the exploration circuit has room for the Dog: the tightest
clearance on the whole route is 330 uu (3.3 m) at the spawn, against a 36 uu capsule. No dead end, no
blocked gate, no wall across a route. 32 actors in the district actually block a walker — steps,
retaining walls, balustrades and hedge blocks — and none of them sit on a route.

**The emptiness is the problem, and it is not subtle.**

| Ground | Actors | Area | Density |
|---|---|---|---|
| Plaza and surrounds (\|x\| < 25 m, y −15…17 m) | 108 | 1,600 m² | **one per 15 m²** |
| Castle approach (\|x\| < 25 m, y 17…90 m) | **0** | 3,650 m² | — |
| Castle approach (\|x\| < 40 m) | 5, all on the flanks | 5,840 m² | one per 1,168 m² |

The approach a participant walks toward the hero building is **246× emptier** than the plaza they
just crossed, and the first 25 m either side of the axis contains nothing whatsoever. Across the
whole sampled district, 59% of ground is more than 12 m from any actor.

That is the founder's "empty lawn between garden gates and castle", quantified, and it is why the
castle currently reads as *the last object at the edge of a set* rather than a gateway into more
Wonderland.

## The plan, gap-ranked

One hypothesis per pass, in this order. Each pass renders HeroCam0 + PlayerCam01 + the cameras it
actually touches, plus the exploration video at the checkpoints.

| Pass | Hypothesis | Why first |
|---|---|---|
| **W1 — the approach becomes a place** | The 3,650 m² of nothing becomes an authored sequence: paired hedge and topiary masses defining the avenue, a fountain court at the midpoint as a pause and a landmark, flower beds and low walls stepping the width down, and the ground broken into rooms rather than filled with props. Large masses → medium structure → small detail. | It is the single measured hole in the district, it is on the primary route, and it is what makes the castle a gateway rather than an endpoint. |
| **W2 — the two garden routes become real destinations** | The left and right garden rooms get a reason to be entered and a way back out: a path that leads somewhere, a landmark at the end, and a loop rather than a cul-de-sac. | Secondary routes exist geometrically but lead to open ground; the founder asked for wandering that does not hit dead scenery. |
| **W3 — plaza material and exposure** | Authored stone variation, believable seams, less obvious grid, and the ~1.3× brightness against the reference corrected — elegant, never dirty. | Known HIGH from PASS 07, and it is the surface the player spends most time looking at. |
| **W4 — near-field architecture** | Credibility at gameplay distance on the walls, stairs, tower bases, trims, arches, railings, plinths and the stone/gold/planting transitions a walker actually passes. | Only reachable once the routes that bring a player close to them exist. |
| **W5 — landmarks and world continuation** | Signature Wonderland objects placed for navigation and identity, and a legible answer to "where does Wonderland continue from here". | Depends on W1–W2 establishing where the eye travels. |

Clouds stay where PASS 07 left them: desirable, unproven on this Vulkan runtime, and explicitly not
worth destabilising the world for. They get one bounded attempt after W3, and a documented refusal
if the runtime still will not carry them.

## Ledger

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Static traversal + emptiness audit | done | above; no dead ends, 246× density gap on the approach |
| 2 | Exploration route in the Dog (`-wlexplore`) | done, awaiting cook | `6d482bd` |
| 3 | Gameplay traversal video | done — and it found what the audit could not | 1,637 and 2,524 frame captures; three route defects and one WORLD defect below |
| 3b | W1b — the step the path forgot | authored, gated, cooking | layout verify PASS at 787 placements; dry run 0 failures |
| 4 | W1 — the approach becomes a place | authored, gated, awaiting a build | 0 → 45 actors within ±25 m (one per 81 m²); layout verify PASS at 779 placements; dry run 112/112 assets, 0 failures; the walking axis stays clear by 15.8 m |

## W1, as built

Three new kit pieces, because the district had 82 assets and not one of them held water: an octagonal
royal **fountain** (basin + still water + gold finial) in the gate piers' own plan, and `MI_V2_Water` —
low roughness so it takes the sky and the towers rather than glowing.

The composition, large masses first:

- **A corridor that narrows.** Paired hedge masses step from 26 m apart at the garden gates to 17 m at
  the castle front. The castle grows as you walk without being moved, and the walk gains a direction
  that open lawn cannot give it.
- **A fountain court at the midpoint** — the one place on the route with a reason to stop — ringed by
  rose topiary, four urns and their flowers.
- **Two cross-axes at the court**, each ending in a stone arch and a landmark mushroom, so the approach
  is a spine with exits rather than a corridor, and so the garden routes have somewhere to rejoin.
- **Four tree pairs** between the masses for canopy overhead, and **six flower beds** at the hedges'
  feet, so the eye has something at every height instead of only at the horizon.

Nothing touches the castle, the skyline bands or the garden gates: the PASS 06/07 hierarchy is
preserved and this fills the hole inside it. The approach is still airier than the plaza (81 m² per
actor against 15) — which is correct for an approach; it is no longer a void.

## What walking it found that measuring it could not

The static audit said traversal was fine: every waypoint had clearance, no blocking actor sat on a
route. That was true and it was not enough. Three things only a walk could show:

1. **The castle approach was unreachable on foot.** `PATH_SPLINE` lifts the path 60 uu between
   y = 2940 and y = 3060 and nothing was ever built to carry a walker up it — no steps, no ramp,
   nothing within nine metres. The Dog met a 60 uu wall against a 26 uu step height and stopped;
   six route legs gave up in a row, 2,221 uu short of the fountain and 5,021 short of the castle.
   Everything W1 had just built was behind that wall. Fixed in W1b: two flights of `path_steps`
   (three 20 uu risers, the plaza's own nosing) with balustrades and finialled plinths, and the
   character's step height raised 26 → 30 because the world's treads carry perlin noise and at
   exactly 26 the tallest of them were a coin toss.
2. **The third-person camera ends up inside planting.** Vegetation has no collision, so the spring
   arm has nothing to probe against and the view fills with leaves. Left as a finding rather than
   fixed: giving every canopy collision would cost performance for a camera edge case, and the
   better answer is keeping dense planting off the walkable routes (a W2 concern).
3. **A garden waypoint sat inside a hedge**, which with no timeout hung a whole capture. The route
   now gives each leg a finite budget and logs what it gave up on — which is what made defect 1
   diagnosable instead of a silent stall.

The lesson worth keeping: clearance at a point proves nothing about the ground BETWEEN points. The
audit measured where things are; only the walk measured whether you can get there.

---

# PASS 08 — the look: light budget, warmth, stone, sky (2026-08-30)

The founder reopened the phase with the environment as the objective and a
carried gap list headed by "plaza ~1.3× brighter than reference", "empty lawn"
and "clouds not resolved". The instruction was to baseline first and to solve
the largest deficiencies rather than process the list. So the district was
measured against the founder's cam0 reference before anything was touched,
with a new permanent tool, `v2/tools/gap_v2.py`.

## What the measurement said, and where it disagreed with the list

| | ours (PASS 07) | reference | |
|---|---|---|---|
| pixels below sRGB 40 | 9.9% | **25.7%** | 0.39× |
| pixels above sRGB 240 | 0.01% | 0.00% | nothing clips |
| warm arc of the palette | 1.6% | **26.7%** | 0.06× |
| neutral-pale arc | 27.5% | 2.7% | **10.2×** |
| green arc | 25.3% | 4.8% | **5.2×** |
| rose arc | 2.6% | 6.8% | 0.38× |
| cloud, share of the sky band | 1.3% | 12.4% | 0.10× |
| walking surface, p50 luma | 212 | 162 | 1.31× |
| walking surface, p10–p90 span | 44 | **119** | 0.37× |
| edge density (detail) | — | — | **1.18×** |

Three of these changed the plan.

**Nothing clips.** The world is not over-exposed, so pulling exposure — the
lever the "1.3× brighter" note implies — would have darkened a frame that is
already correctly exposed and produced the muddiness the founder warned
against. The frame is *unshaded*, which is a different defect.

**The district already carries more detail than the reference** (1.18×). Its
richness gap is not a shortage of objects. Adding props would have made it
busier and no closer. What it is short of is tonal range, warmth and shade.

**The plaza's real defect is uniformity, not brightness.** 1.31× too bright is
true; 2.7× too *flat* is larger, and it is what makes fitted masonry read as
one poured sheet.

## Cause, in one sentence per face

- **No shade**: a 6,000-lux *shadowless* upward bounce plus a real-time sky
  capture at 1.0 over a doubled atmosphere. The bounce was sized in PASS 05b
  for leaf undersides at p50 1; PASS 05f then fixed the leaf albedo, which is
  what actually lit them, and recorded "the bounce light stays for this render
  (one change)". Nobody returned to it. Third time this class has cost
  Wonderland its shadows.
- **No warmth**: the grade was neutral to three decimal places while every
  non-sky surface in the reference is warm.
- **No stone variation**: three plaza tints inside 0.18 of each other, and the
  entire path on a single material.
- **No cloud**: VolumetricCloud spawns, takes its coverage, compiles its
  shadermap, and puts nothing in the frame — twice, on this Vulkan SM5 runtime.
- **Green dominance**: one actor, the 1.2 km moss cube standing in for terrain,
  in a saturated blue-green.
- **The vertical smear**: the surface master built UVs from WorldPosition
  masked to X and Y, so on any vertical surface the UV does not change with
  height and the texture is smeared upward. Every column, pier, wall, tower,
  riser and plinth. This was not on the gap list at all; it was found by
  zooming PlayerCam01 and then reading the master.
- **Trees ending outside their leaves**: limb reach 700–800 uu against leaf
  shells at 500–530.

## Predictions for the PASS 08 capture — recorded BEFORE the render

Each is measurable by `gap_v2.py` on HeroCam0 against the same reference. A
prediction that misses is a finding, not a thing to re-explain afterwards.

| metric | PASS 07 | PASS 08 target | reference |
|---|---|---|---|
| pixels below sRGB 40 | 9.9% | **≥ 18%** | 25.7% |
| warm arc | 1.6% | **≥ 10%** | 26.7% |
| neutral-pale arc | 27.5% | **≤ 16%** | 2.7% |
| green arc | 25.3% | **≤ 17%** | 4.8% |
| cloud share of sky | 1.3% | **≥ 8%** | 12.4% |
| foreground p50 luma (`fg_p50`) | 205 | **170 ± 15** | 151 |
| foreground tonal span (`fg_span`) | 79 | **≥ 100** | 128 |
| ground_variation | 37.1 | **≥ 55** | 73.5 |
| pixels above sRGB 240 (`clip`) | 0.01% | **< 1%** (no clipping) | 0.00% |

The last four rows are `gap_v2.py`'s whole-band figures over the bottom
quarter of the frame at 640×360. The 212/44 and 162/119 quoted earlier in this
entry came from a hand-placed rectangle on the plaza at 1280×720, which
excludes the kerbs and hedge feet the band includes. Both are true of the same
frames; the tool's are the reproducible ones and are what the pass is judged
on. Targets are stated in the tool's units.

Visual, not metric: the gate columns and plaza-side walls must stop showing
continuous vertical streaks (PlayerCam01, ReverseCam03), and the trees must
stop showing bare brown branches outside their canopies (all cameras).

Cameras to render, by hypothesis — not the whole suite:

- **HeroCam0** — tonality, warmth, stone, sky, trees. The primary comparison.
- **PlayerCam01** — the triplanar fix at gameplay height, where the streaked
  columns fill the frame.
- **ReverseCam03** — the plaza-side walls, the second place the smear shows.
- **SkylineCam06** — the ground retint and whether cloud reaches a camera whose
  sky band is only ~7° tall.

GardenLeft04, GardenRight05, PathCam02 and ScaleCam07 are not rendered this
pass: nothing in PASS 08 tests a hypothesis they answer, and the founder's
render discipline is explicit about not spending compute on unchanged cameras.

## Known risk, recorded before the fact

The cumulus sit 2.6–13.5 km out under a fog tuned in PASS 06 for separating
towers at 185–420 m. If the far clouds wash into the fog's inscattering
colour, `cloud_fraction` will move less than predicted and the fix is the
fog's distance response, not the clouds. SkylineCam06 is the camera that will
show it first, because its sky band is entirely far cloud.
