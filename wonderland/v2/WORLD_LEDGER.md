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

## PASS 08 — the result, against the predictions recorded above

Rendered on package `b3ec99a` (generate 851 s, 116/116 assets, 47 materials,
689 actors, cook rc=0, no material compile failures). Four cameras, chosen by
hypothesis: HeroCam0, PlayerCam01, ReverseCam03, SkylineCam06.

| metric | PASS 07 | target | **PASS 08** | reference | |
|---|---|---|---|---|---|
| deep pixels (`palette.dark`) | 7.6% | ≥18% | **30.4%** | 23.0% | met, overshot |
| warm arc (`palette.gold`) | 1.6% | ≥10% | **36.2%** | 26.7% | met, overshot |
| neutral-pale (`palette.cream`) | 27.5% | ≤16% | **1.8%** | 2.7% | met |
| green arc | 25.3% | ≤17% | **15.0%** | 4.8% | met |
| `fg_p50` | 205 | 170±15 | **178** | 151 | met |
| `clip` | 0.01% | <1% | **0.01%** | 0.00% | met |
| `fg_span` | 79 | ≥100 | **87** | 128 | **missed** |
| `ground_variation` | 37.1 | ≥55 | **39.4** | 73.5 | **missed** |
| `cloud_fraction` (HeroCam0) | 1.3% | ≥8% | **1.0%** | 12.4% | **missed** |

Performance on the new world: median **193–213 fps** across all four cameras,
p95 70–79 fps. Triplanar tripled the texture samples on every stone surface
and 46 cloud actors were added; neither shows.

### The three misses, each with its cause

**`cloud_fraction` did not move, and the metric is the wrong instrument.**
The clouds are demonstrably there -- ReverseCam03 went from an empty blue sky
in PASS 07 to eight cumulus in PASS 08, and they parallax and take the sun.
HeroCam0 simply has very little open sky: trees and castle fill its upper
band. The metric also has a measured false-positive on pale horizon haze
(recorded in the tool). What is genuinely wrong is cloud QUALITY, not
quantity: they read as grey clip-art, because the height fog blends them
toward its inscattering over 2.6-13.5 km and a constant emissive was lifting
their shaded sides toward their lit ones.

**`fg_span` and `ground_variation` barely moved, and it is one cause.** The
four plaza tints never reached the frame. Not the binding -- the packaged
runtime's own report says "asked MI_V2_PlazaShade, renders MI_V2_PlazaShade"
for all four, and 28 batch actors exist. Counting its pieces gives the real
distribution against the intended one:

| tint | intended | actual |
|---|---|---|
| Cream | 49% | 59.3% |
| Warm | 22% | 30.2% |
| Grey | 18% | **3.7%** |
| Shade | 11% | **6.8%** |

The tint was drawn from `blotch = 0.7*U1 + 0.3*U2` against thresholds chosen
as if `blotch` were uniform. A sum of uniforms concentrates around its mean,
so the tail categories starved: the grey stone meant to be a fifth of the
pavement was one slab in twenty-seven. **The lesson is general** -- a
threshold on a derived random variable does not mean the share it looks like
it means, and nothing in the pipeline checks that a distribution came out the
way it was written.

### What PASS 08 revealed rather than caused

The dark patches across the plaza are cast shadows, and they are not new. They
occupy the same pixels in PASS 07, where a probe grid across the whole
foreground returned 203-217 -- fourteen levels end to end -- and they were
invisible. In PASS 08 the same grid splits cleanly: lit paving 184-195,
shadowed 140-154.

The discriminator is the ratio, not the position: **patch/slab was 0.97 in
PASS 07 and is 0.77 in PASS 08.** A material tint holds its ratio under any
light. A shadow's ratio moves exactly when the shadowless fill is cut, which
is what this pass did. So the shadows are correct and newly legible; their
EDGES -- hard, blocky, polygonal -- are a shadow-resolution defect that the
overexposure had also been hiding.

### Overshoots, which are mine

- warm arc 36.2% against the reference's 26.7% (1.36x), foreground chroma
  1.67x: the sun and the grade were both moved warm and compounded.
- deep pixels 30.4% against 23.0% (1.32x); on ReverseCam03 the foreground
  hedge mass fell from median 82 to 46. That is the brief's "dark masses
  swallowing architecture".
- SkylineCam06: green 45.5% -> 19.3% (the intended direction) but the warm arc
  rose 2.1% -> 27.0% and the ground now reads as barren dirt. A green void
  became a brown void. Desaturating was right; doing it under a warm sun and a
  warm grade at the same time was not.

All three are corrected in PASS 08b, sized from these numbers.

## Standing gap list after PASS 08

CRITICAL: none.

HIGH:
- the ground plane is empty and reads as a void from any elevated camera
  (45.5% -> 19.3% of SkylineCam06 and still the largest single element). This
  is CONTENT, not tint, and it is the next pass.
- clouds read as clip-art rather than cumulus (reworked in 08b, unproven).
- shadow edges are hard and blocky at canopy scale.
- foliage masses too dark and too uniform (08b lifts the light; their internal
  variation is untouched).

MEDIUM:
- plaza-side walls in ReverseCam03 still plain.
- stone reads speckly at gameplay distance (plaster texture scale).
- the 1.2 km ground slab's edge is visible at frame right on SkylineCam06.
- `_billow`'s silhouettes are simpler than real cumulus.

LOW:
- rose/flower share 0.45x the reference.
- heart topiary readability (unexamined this pass).
- the fps harness opens the default map and reports BATCHES=0 -- the numbers
  above came from the capture runs, which report 117; worth fixing before the
  fps figures are trusted for a world-density decision.

---

# PASS 09 — the ground becomes a place (scoped, not started)

The HIGH gap after PASS 08 is that the ground reads as a void from any
elevated camera. That is content, not tint, and PASS 08b's colour correction
does not touch it. Measured off the layout, the way the castle approach was
measured before W1:

| region | actors | area | density |
|---|---|---|---|
| plaza / arrival (\|x\|<25 m, y −15…17) | 257 | 1,600 m² | 1 per **6 m²** |
| castle approach (\|x\|<25 m, y 17…90) | 199 | 3,650 m² | 1 per **18 m²** |
| left flank (x 25…80, y −20…90) | 34 | 6,050 m² | 1 per **178 m²** |
| right flank (x −80…−25, y −20…90) | 38 | 6,050 m² | 1 per **159 m²** |
| behind spawn (\|x\|<80, y −90…−20) | 30 | 11,200 m² | 1 per **373 m²** |

**W1 worked.** The castle approach was 0 actors over 3,650 m² when it was
audited; it is now 199, one per 18 m², and the founder's "empty lawn between
garden gates and castle" is closed. The emptiness did not go away, it moved
outward: the flanks and the ground behind the spawn are 10–60× sparser than
the plaza and cover **23,300 m²** against the plaza's 1,600. That is the green
(now brown) expanse SkylineCam06 shows, and it is 45% of that camera's frame.

Targets, in the same units, chosen so each region reads as what it is rather
than as a copy of the plaza:

- flanks: 1 per **50 m²** — a garden, airier than a plaza, denser than a lawn.
  About +87 actors each.
- behind spawn: 1 per **90 m²** — scenic, off the primary route. About +94.

Roughly 270 new placements from the existing kit, no new asset language:
hedge rooms, flowering beds, tree groups, topiary, mushroom clusters,
secondary gates, low walls, and paths that connect them so the space is
walkable rather than looked at. Density is not the goal and the number is not
a quota — the founder's rule is that dense does not mean cluttered, and the
flanks must keep breathing room and clear movement lanes for a social space.

Two things must be settled in the same pass, because they are the same
question of where Wonderland ends:

1. **The 1.2 km ground slab's edge is visible** at frame right on
   SkylineCam06. Filling the flanks moves the eye but does not remove an edge.
2. **Terrain.** The ground is one flat engine cube. Real land would let the
   flanks read as landscape rather than as objects on a table — but any
   undulation has to keep every route walkable, and the locomotion phase
   already proved that a 60 uu riser nobody planned makes a district
   unreachable. Terrain is therefore proposed, not assumed, and it comes with
   a traversal re-check.

Not in this pass: districts beyond Golden Arrival. The founder's sequencing is
that Golden Arrival reaches founder-quality first.

## PASS 08b predictions — recorded before its capture

Same discipline as PASS 08: stated first, scored after.

| metric | PASS 08 | 08b target | reference |
|---|---|---|---|
| warm arc | 36.2% | **26–30%** | 26.7% |
| deep pixels | 30.4% | **23–27%** | 23.0% |
| foreground chroma vs ref | 1.67× | **≤1.35×** | — |
| `ground_variation` | 39.4 | **≥55** | 73.5 |
| `fg_span` | 87 | **≥100** | 128 |
| SkylineCam06 green arc | 19.3% | **28–36%** (green again, not brown) | — |
| SkylineCam06 warm arc | 27.0% | **≤15%** | — |

One prediction against my own change: **`fg_p50` will get slightly WORSE, to
about 183 from 178** (reference 151). Raising the sky light 0.45 → 0.58 adds
~4% to a sun-dominated surface, and the widened tint set averages 2.7%
brighter than the one it replaces. Both were done for other reasons — shade
depth and stone spread — and both push this number the wrong way. If it lands
where predicted, the plaza albedo comes down ~10% in PASS 09; if it lands
higher than 190, the light change is doing more than the arithmetic says and
that is the thing to look at, not the albedo.

## PASS 09 traversal check, before the render

An offline clearance sweep over five routes into and along the new ground,
with deliberately generous footprints for every solid asset and a 36 uu
capsule:

| route | min clearance | |
|---|---|---|
| spawn → rear gate → out | **227 uu** | clear |
| left flank walk (border → grove) | −29 uu | pre-existing `BeyondL_Wall0_0` |
| right flank walk | +103 uu | clear |
| plaza → left flank room | −138 uu | pre-existing `SideBed_L_Hedge3`, `GiantMushroom_Foot0` |
| plaza → right flank room | −50 uu | the parterre's own centrepiece |

**Every flagged point is pre-existing planting or a route endpoint I chose
badly** — the plaza's own side beds, the giant mushroom's foot, and in one
case the plinth at the centre of a parterre, which a route should go round
rather than through. Nothing PASS 09 placed blocks anything, and the rear
route — the one genuinely new way through the world — is clear by 227 uu.

This check is worth exactly what it is: a straight line through a garden, with
radii chosen to over-report. The ledger already records that clearance at a
point proves nothing about the ground between points, and that only walking it
found the 60 uu riser that made the castle unreachable. **The real test is the
Dog**, and it belongs in the same pass as these renders.

## PASS 09 rendered, and what the first frame of a new area taught

`5581796` built: 847 actors, garden band 230 → 535, v1_actors 0, 799 s.
SkylineCam06 against PASS 08's: green arc 19.3% → 23.8% and the warm arc
27.0% → 16.5%, so 08b's correction landed — the ground is meadow again rather
than the brown void PASS 08 made of it. (Against the original SUITE03
baseline: green 45.5% → 23.8%, because the flanks now carry garden instead of
lawn.)

**FlankLeftCam08's first frame is the useful one.** It showed three defects.
Two of them I had already found and fixed in commits waiting for the next
build — the hedges that edged 30% of their bed, and the missing paved walks.
The third the render found and I had not:

**The flank cameras stand on bare lawn.** Cam08 sits at y = −1,250 and the
flank's first content was the parterre's near bed at y = −70: twelve metres of
empty grass across the bottom 40% of the frame. This is the *same defect* the
offline camera preview caught for RearWorldCam10 an hour earlier — which I
fixed for that camera and did not think to check for these two. Fixing the
instance instead of the class, in a session whose own ledger says that is the
failure mode here.

The other thing the frame said: **a bed of three blooms reads as three pink
dots sitting on grass.** The reference's beds are full — the planting *is* the
bed. Seven per quadrant now, mixed cluster/blossom/lavender so a bed has
texture as well as colour.

### Sequencing, learned the cheap way

Cam10's capture in that round failed: `WL_REQUIRE_SHA=5581796 but the checkout
is at c5d6338`. I shipped the next commit while a capture round was still
running, and the source-pin guard refused rather than quietly capturing a
frame whose provenance nobody could state. The guard is right and the mistake
was mine. **Do not ship while a round is in flight**; there is no rush that a
frame of unknown provenance would have saved.

### Queued for the build after this one

The heart topiary rebuilt with real volume (159 → 397 uu deep), and one
Wonderland landmark per flank with the hierarchy the brief asks for — a clock
monument at the end of one walk, the heart at the end of the other, a tea
vignette beside each room, an arch over each way in. 919 actors.

## PASS 10–11 — the new areas, and the error that hid two passes of work

Golden Arrival's flanks and the ground behind the spawn are districts now
rather than lawn. 787 placements at PASS 08; **1,479** at PASS 11. Density on
the flanks went 1 actor per 178 m² → 1 per 41; behind the spawn 1 per 373 →
1 per 105. Three cameras were added for the new ground (FlankLeftCam08,
FlankRightCam09, RearWorldCam10); the original eight have not moved.

Every defect below was found by a render or a measurement, and each one is
recorded with what it cost:

| found | defect | fix |
|---|---|---|
| render | the flank cameras stood on 12 m of bare lawn | near field authored |
| render | a bed of three blooms reads as three dots on grass | seven, mixed |
| render | ground-flower patches were **white domes** — one mesh carrying leaf mound *and* blooms, so the petal colour painted the mound | split into mat + blooms |
| render | limbs still outside the leaves after two fixes | reach 0.60 → 0.42 |
| render | the bole was 3.2 m across — a baobab, not a garden tree | 160/100 → 105/62 |
| measurement | a paved spine down the flank does not fit (best clearance −25 uu against 150 needed) | **not placed**, numbers recorded |
| measurement | the bed floor would have been buried under the ground slab | z −6 → +3 |
| gate | the layout gate read a different band list from the builder | one list, `BUILD_BANDS` |

### The one worth carrying forward

**Foreground planting placed nearer than the frame's lower edge is invisible.**
A camera's picture of the ground begins at `eye_z / tan(-(pitch - vfov/2))`,
and everything nearer is under the lens. RearWorldCam10 sees from 5.1 m and
its new planting was at 2.2 m; FlankLeftCam08 sees from 4.0 m and its bank was
at 3.5 m. So two consecutive passes each authored a foreground that could not
appear, and the second render looked exactly like the first — which is the
worst kind of failure, because it reads as "the fix didn't work" rather than
"the fix wasn't visible".

It is now `v2/tools/camera_framing.py`, which prints for every camera where
its ground begins, how many placements stand in the band from there to 3×,
and how many sit **under** the lens. The three new cameras read 20 / 20 / 10
in-band with 0 under. The weakest remaining are GardenLeft04 (8) and
GardenRight05 (10) — the next foreground work, named by measurement rather
than by which render happened to look wrong.

### Also this stretch

`ship_v2.sh` bundles incrementally (19.6 MB → 32 KB, after a full bundle timed
out at 600 s), and its test suite — which had been failing three of four
assertions in silence — is repaired and extended to 7/7. `measure-fps.sh` was
measuring an **empty world** because it was the only launcher never forwarding
`WL_MAP_ARG`; every frame rate it has reported for V2 is void, and it now
prints the world it measured. `WLV2_REUSE_MATERIALS=1` skips a ~5-minute
shader recompile on passes that only move actors.

## PASS 12–15 — the foreground, three ways wrong, and the colour nobody checked

FlankLeftCam08 showed the same ground wrong three times running, one failure
per build, and each fix caused the next:

1. **Bare** — the planting was under the lens (nearer than
   `eye_z / tan(-(pitch - vfov/2))`, so outside the picture entirely).
2. **Polka dots** — moved into frame but laid on an even 9 × 3 grid, which
   reads as isolated objects on a lawn. Massed into clumps.
3. **A wall** — massed at s 0.82–0.96 five metres from a 2.65 m eye, so a bank
   of foliage filled the bottom 45% and hid the garden. Dropped to knee height
   at the front, mass kept for 9–12 m.

And `camera_framing.py` caught a fourth inside fix 2 that no render would have
attributed correctly: **at 90° horizontal fov the visible half-width equals
the depth**, so clumps spread 30 m off-axis at 8 m out were not in the picture
at all. The tool reported the near-band count going *down* after adding
planting, which is not a thing an eye notices.

Then `gap_v2` on the result, against the founder reference:

| | ours | reference | |
|---|---|---|---|
| green arc | 25.6% | 4.8% | **5.3×** |
| rose arc | 1.8% | 6.8% | **0.26×** |
| foreground p50 | 61 | 151 | **0.40×** |

**Three passes went to how MUCH planting there is and none to what colour it
is.** Being right about the massing three times running does not make the mass
the right colour. Every other piece in the near clumps and mid band now
carries a petal colour; the greens include a lighter tone.

### The flank walk, and why the straight line was the wrong question

A straight paved spine does not fit either flank — best clearance −33 uu
against the 150 a 3 m walk needs. That is a fact about **straight lines**.
Asked instead for the route a walker takes, both flanks first answered in
twenty waypoints out to x = 1,500 and back down the main approach: **they were
cul-de-sacs**, and nothing had said so because every destination inside them
was individually reachable — from the middle of the world, by walking round.

The pinch was 142 uu between the rose border and a pre-existing hedge mass,
70 uu once the Dog's capsule comes off both sides. A gap in the border
opposite it — ordinary garden language, two pieces — and both flanks answer in
seven waypoints that stay inside. Those waypoints are now paved, derived
rather than designed, with the regenerating command in the comment.

### Two flat quads

The flanks were authored with no `garden_lawn` under them, so an entire
district stood on the moss terrain slab: one flat quad, one flat tone. And
that slab's edge showed at frame right on SkylineCam06 at ±600 m, inside the
distance this fog still carries. Lawn meshes added; slab to ±1,500 m.

### Standing after this stretch

~1,500 placements against 787 at PASS 08. Flank density 1 per 178 m² → 1 per
41. Eleven cameras, the original eight unmoved. **0 of 18 named destinations
unreachable.** Generate down from ~15 min to ~6 with `WLV2_REUSE_MATERIALS=1`.

Open, in order: the rose share is still the largest measured gap (the bloom
pass is unrendered); the ground between garden rooms; and whether the flanks
need their own camera-suite checkpoint once the founder has judged them.

---

# STOPPING POINT — 2026-08-30, world-development phase

Clean state. `relay/wonderland-v2` HEAD `1db48cb`; Studio packaged
`d35e58e`; working tree clean; 50 commits this session; V1 untouched (41
changed paths, 0 legacy). All gates green: layout PASS, dry run 117/117 assets
and 0 failures, walkability 0 of 18 destinations unreachable. GPU idle.

## What the world is now

| | start of phase | now |
|---|---|---|
| placements | 787 | **4,564** |
| actors (after instancing) | 689 | 2,123 |
| empty ground | 30,176 m² | **4,832 m²** |
| flank density | 1 per 178 m² | 1 per 41 m² |
| cameras | 8 | 13 |

Golden Arrival has two flank gardens, a rear world, a processional flower
border the length of its axis, a plaza with a medallion and border course,
stone-edged parterres with rim walls, and walls with pilasters and cap
courses. Outside it stand **24 quarters** — formal gardens, tower
neighbourhoods with perimeter walls and paved courts, and mushroom woods —
joined by radial roads and a ring circuit.

## The four tools this phase produced

Each was written after making the same mistake twice, and each then found
something no camera had:

| tool | what it answers | what it caught |
|---|---|---|
| `gap_v2.py` | does the frame read as the reference? | the world was unshaded and cool, not over-exposed |
| `camera_framing.py` | where does a camera's ground begin? | two passes of planting placed **under the lens** |
| `walkable.py` | can the Dog get there, by what route? | a landmark inside a tower; both flanks cul-de-sacs |
| `emptiness.py` | where is the world *not*? | **27,056 m² in one region**, wrapping the whole district |

`emptiness.py` is the one that mattered most and the one written last. Three
passes went into a twenty-metre patch a camera happened to show while two
orders of magnitude more empty ground sat outside every camera's frame. **A
camera shows what it points at; only an audit shows where the world is not.**

## Known open items, in priority order

1. **Quarter hierarchy.** The quarters are all roughly one size at roughly one
   spacing. The reference has a dense core fading through midground to
   atmospheric distance; ours tiles uniformly. This is the largest remaining
   difference from the boards.
2. **The ground quilt does not read.** 28 displaced lawn meshes are in place
   and invisible at world distance — the Lawn and Moss tints are too close.
   The mechanism works; the contrast does not.
3. **Mushrooms still out-shout the architecture** at 35 giant caps, because
   terracotta is the highest-contrast colour in the frame.
4. **The horizon still ends** at a hard line against the sea band.
5. `palette.rose` remains ~0.46× the reference on the flank cameras.
6. The plaza medallion reads as a scribed ring rather than inlay.
7. Performance is unprofiled at this density — `measure-fps.sh` is fixed and
   has not been run against the 4,564-placement world.

---

# PASS 22 — QUARTER HIERARCHY (ledger item 1)

The first item on the list above, closed against measurements rather than
against a camera. `tools/hierarchy.py` and `tools/plan_view.py` are new; three
of the four existing tools were extended, and two of those extensions found
defects on their first run.

## What the problem actually was, in numbers

`hierarchy.py` on the world as it stood:

| | |
|---|---|
| quarters | 32, all built by three functions taking a centre and nothing else |
| garden quarters | **106 or 108** placements, every one |
| towers quarters | **36 or 38** placements, every one |
| grove quarters | **34 or 36** placements, every one |
| footprint | 21.6 m for every garden AND every towers quarter, at 50 m out and at 164 m |
| quarter-intrinsic core:far density | **1.10x** |
| the outer world beyond 200 m | **nothing at all**, in 6 of 8 sectors |

A polar map named the shape of it: a complete ring of thin ground at 50-75 m
(147-334 per hectare in all eight sectors) with a DENSER ring outside it at
75-125 m. Density that rises with distance is not a hierarchy, it is a fence.

And the audits could not have seen the biggest part of it, because **their own
windows were too small**. `emptiness.py` sampled +/- 120 m of a world that
reaches 450 m and reported 4,832 m2 empty; over the ground a walker can
actually cover it reports **461,488 m2** -- ninety-five times the number this
ledger was carrying, and the identical failure the tool exists to catch, one
level up. `walkable.py` sampled +/- 90 m, so all 24 quarters, both ring roads
and every radial road had never been tested at all; "0 of 18 destinations
unreachable" was true and was a statement about Golden Arrival.

**An audit's window is part of its measurement.** Both are now parameterised
and default to the world.

## The mechanism

One function, `layout_v2.HIER(x, y)`, returns a continuous score

    score = 0.70 * falloff + 0.16 * road activation + 0.14 * a noise field

and twelve derived quantities: density, spacing, scale, landmark probability,
landmark scale, vegetation, props, courtyard frequency, skyline contribution,
empty-area tolerance, plus the tier label -- which the generator never reads,
precisely so the world cannot acquire a visible boundary at a threshold. The
three terms each do a job: the falloff makes the hierarchy, the road term
keeps ground beside a way denser than open land at the same radius (density
follows movement, not distance), and the noise breaks the tiers so they read
as country rather than as three concentric bands.

`emptiness.py --scaled` reads `empty_tol` from the same function. The audit
and the generator share one definition of how much emptiness is correct at a
place, which is the only way the audit can be right about the far world
without demanding the far world be dense.

Placement is greedy and sequential, not relaxed: inner sites first, authored
sites before generated ones, each taking its own position if it clears and
otherwise the nearest ring position that does -- then a smaller size, then a
drop with its name printed. Every kept site is conflict-free by construction.

## Before / after

| | before | after |
|---|---|---|
| quarters | 32 | **44** |
| garden quarter size | 106 or 108, always | 67-151 |
| footprint CV | 0.300 | **0.452** |
| spacing CV | 0.379 | 0.381 |
| quarter-density CV | 0.618 | **0.957** |
| quarter-intrinsic core:far | **1.10x** | **4.82x** |
| tier mean density (core/mid/far) | 787 / 596 / 717 | **502 / 215 / 104** |
| outer world reaches | 200 m | **350 m** |
| 50 m bands populated (0-350 m) | 4 of 7 | **7 of 7** |
| monotone beyond the peak | n/a (world ended) | **0 violations** |
| nested quarters | 1 (S00/S12, 10.6 m apart, 21 m footprints) | **0** |
| landmarks in unrelated geometry | 1 new + 2 pre-existing | **0 new** |
| roads through a quarter they do not serve | never measured | **0 of 263 segments** |
| world emptiness, flat 9 m, 40.7 ha disc | 329,984 m2 | **207,392 m2** |
| world emptiness, tier-scaled | not measurable | 34,656 m2 (8.5%) |
| district emptiness, flat 9 m | 4,832 m2 | 5,840 m2 |
| placements | 4,590 | 5,673 |
| **actors after instancing** | **2,123** | **1,541** |
| layout_v2 import | 0.05 s | 1.3 s |

The actor count FELL while the world grew by a quarter, because the pass also
put the trunks, canopies and repeated ornament into the instanced batches:
1,958 pieces became 40 batch actors. Trunks keep their collision inside
the batch, so `walkable.py`'s model of this world stays exactly true.

## Golden Arrival is untouched, and that is checked rather than asserted

Twelve of the thirteen bands hash **byte-identical** to the previous commit
(FOREGROUND, GARDEN, PALACE, FLANKS, FLANK_GROUND, REARWORLD, CAM_FOREGROUNDS,
COURTYARD, PLAZA_ORNAMENT, PROCESSIONAL_BORDER, SKY, HOVER). `_parterre`,
`_grove` and `_mushroom_cluster` take an optional hierarchy and are unchanged
without one, which is how the flanks kept their authored density.

The thirteenth, GROUND_QUILT, went 26 -> 102 on purpose: it is terrain, it was
a 7 x 5 grid reaching 170 m laid when that was the whole world, and everything
beyond it was the flat moss slab again.

## Defects this pass found, each by a measurement and not by looking

| found by | defect |
|---|---|
| `emptiness --window=world` | the audit's own frame held 4,832 m2 of a 461,488 m2 problem |
| `walkable --window=world` | 22 of 75 "unreachable" -- the destinations were quarter CENTRES, and a towers quarter has a tower on its centre. The instrument was asking to walk into a building |
| `hierarchy` embedded-landmark check | quarters pushed onto approved castle groups; a tower inside a parterre; a wood's tree inside a City8 tower |
| `hierarchy` nested check | S00_garden and S12_towers 9.7 m apart -- the SAME HOLE, reported by the emptiness audit in two rounds and turned into two quarters because nothing compared new centres against old |
| `plan_view` | far woods drawing as a dozen dots inside a 58 m ring: an orchard with most of it missing, not woodland |
| `hierarchy` monotonicity | four concentric far arcs pressed onto the world edge -- ten sites in one 25 m bin and a density that RISES into the horizon |

## Traps worth not re-learning

1. **A keep-out has to be as big as the thing it keeps out, and the anchors
   have bodies.** Three successive versions cleared the quarter's CENTRE and
   not its pieces, then cleared its pieces against anchor POINTS while the
   anchor was a 640 uu tower.
2. **Correcting a measurement must not quietly change the thing measured.**
   Making `_reach` linear in spacing (which it should always have been) widened
   every gap that used it and took the core from 327 placements per hectare to
   147. The fix was to split the two questions -- a quarter's BODY for spacing
   against another quarter, its full EXTENT against approved work.
3. **Relaxation does not have to succeed.** A damped Jacobi pass runs a fixed
   number of iterations and leaves whatever it could not fix embedded, so five
   tunings each fixed the pair in front of me and produced a different one --
   and cost 36 seconds of every module import. Greedy sequential placement
   cannot leave a conflict.
4. **Two descriptions of one quantity will disagree.** The far tier had its own
   spacing table (154 m) while the placer enforced `_want_gap` (178 m); the
   spiral accepted candidates the placer refused and four woods fell into a
   15,000 m2 hole in the west.
5. **Memoise before optimising anything else.** `HIER` is called ~1.3 million
   times during placement; caching it on the exact coordinate took import from
   25 s to 1.3 s with byte-identical output.
6. **A hole on purpose is not a hole.** The largest empty region in the world
   is the castle sightline, and it is meant to be. `emptiness.py` labels it, so
   a later pass does not helpfully fill in the founder's sky.

## Renders worth inspecting

`v2/reference/renders/V2_WORLD_PLAN_PASS22.png` -- the world from above, with
the score field as tone, every placement as a pixel, quarter footprints as
rings by kind, and the road network. **No camera in this project can show a
hierarchy**: every one of them stands inside the core at eye height. This is a
diagram, not a render, and it is not evidence of visual quality.

**Nothing here has been rendered on a GPU.** The Studio is stopped and
founder-started. The next GPU session should capture cams 0 / 6 / 11 / 12 --
0 and 6 to prove Golden Arrival is unchanged in frame, 11 and 12 because they
are the only two cameras that can see the outer world at all.

Their NEAR-band counts FELL -- WorldCam11 2,469 -> 2,044, WorldCam12
1,504 -> 1,315 -- and that is the hierarchy working rather than a regression:
those bands are 78-235 m and 59-178 m, which is exactly the ground the
falloff thins. What grew is behind them, where neither tool counts and only a
frame will say.

## The list, re-ordered

1. ~~Quarter hierarchy~~ **DONE, above.**
2. **The far world is 8.5% empty by its own tier's tolerance** -- 34,656 m2,
   the largest single region 14,960 m2. New, and the successor to item 1: the
   far tier's coverage, now that it exists.
3. **Ten authored sites could not be placed** and are named in the build log
   (Q07, Q10, S02, S03, S16, S18, S19 towers/groves/gardens, and three far
   woods). Their ground is mostly covered by neighbours -- district emptiness
   went 4,832 -> 5,840 m2 -- but each is a decision that was discarded to
   satisfy a spacing rule, and they should be re-sited rather than left dropped.
4. **The 50-75 m band is Golden Arrival's own thin outskirt** (282 per hectare
   against 723 inside it and 305 outside -- a dip now rather than the
   391-against-720 step it was). Measured twice, from two directions:
   the district's walkable mass ends between 66 m and 117 m depending on
   bearing, so this band is INSIDE approved ground everywhere. Closing it means
   re-planting the flanks and the rear world, which is a founder decision.
5. The ground quilt does not read -- 102 displaced lawn meshes now, still
   invisible at world distance because the Lawn and Moss tints are too close.
   The mechanism works; the contrast does not.
6. Mushrooms still out-shout the architecture, because terracotta is the
   highest-contrast colour in the frame.
7. The horizon still ends at a hard line against the sea band.
8. `palette.rose` remains ~0.46x the reference on the flank cameras.
9. The plaza medallion reads as a scribed ring rather than inlay.
10. Performance is unprofiled at this density. `measure-fps.sh` is fixed and has
    still never been run; the actor count is now LOWER than when that item was
    written (1,541 against 2,123), so the answer may already be fine.
11. Two landmarks stand inside hedges in Golden Arrival -- `ClockTree_Clock`
    inside `Garden_R_Hedge0` and `Tower_R0` inside `Approach_HedgeR2`. Both
    predate this pass (the twelve approved bands are byte-identical), both are
    approved ground, and neither is mine to move without being asked.

---

# PASS 23 — WONDERLAND BECOMES A PLACE

The founder's directive: the architecture phase has earned its keep, now turn
it into Wonderland; use the three reference boards; resolve the far-world gap;
give quarters identity; build woods as forests; expand roads and destinations;
keep the actor count disciplined. Instrumentation is a minority of the time.

## What the boards said that the world was not doing

The boards' world-layout overview is a MAP WITH NAMES ON IT -- ROYAL CASTLE,
CLOCK TOWER DISTRICT, GOLDEN GATES, ROYAL GARDENS, MUSHROOM GROVE, ARRIVAL
PLAZA, WATER FEATURES, OUTER DISTRICTS -- and their object language is clocks,
keys, teapots, fountains, columns, gold arches, topiary sculpture and hot-air
balloons. Counted against the world as it stood:

| the boards' signature | recipe exists? | placements before | after |
|---|---|---|---|
| clock tower | `tower_clock` | **0** | 7 |
| ornamental clock | `clock_ornate` | 3 | 25 |
| fountain | `fountain_basin` | 1 | 8 |
| tea service | `tea_plinth` | 2 | 7 |
| columns | `column_ornate` | **0** | 18 |
| stone arch | `arch_stone` | **0** | 19 |
| keys | `key_ornate` | 2 | 11 |
| topiary sculpture | `topiary_spiral` | 5 | 41 |
| giant mushroom | `mushroom_giant` | 4 | **30** |
| hot-air balloon | *none* | 0 | **24** |

Eight of the ten recipes already existed and the world used them eleven times
in 4,590 placements. The gap between Wonderland and the reference was not
mostly a modelling gap.

## Seven new kinds, and geography to decide them

`_district_of(x, y)` -- fourteen named seeds at a bearing and a radius, joined
by a metric blending angle and distance so districts are wedges and sectors
rather than circles, with a noise term so their borders are not arcs. A
quarter's KIND now comes from the district it stands in. Authored POSITIONS
are untouched; the `kind` column in those tables is advisory.

CLOCKYARD (a clock tower over a geometric yard, keys on plinths) · WATER
GARDEN (fountain, balustrade, radial walks, columns) · TEA TERRACE (service at
garden scale under spiral topiary, a vine arch to come in by) · walled COURT
(colonnade, gold arch, parterre inside) · HAMLET (small houses, a lane, a
well, a village tower) · MEADOW (hedgerow, drifts, single trees, one marker) ·
and the woods, which now stand under real 20 m giants.

Plus one thing every kind was missing: an EDGE. A broken ring of hedge, tree
and shrub, beds at its foot, and a short paved approach with a marker either
side on the bearing its road arrives from. Written once, applied to all ten.

## The country, the horizon, and the way past the castle

**The country.** Twenty quarters is all the far band holds at its own spacing.
The rest of the distance is landscape: a jittered grid of tree masses,
hedgerows, drifts, lone towers and lone giants, density from the same `HIER`,
kept off the quarters and off the castle sightline. 118 clusters, 1,400
placements, all instanced.

**The horizon** (ledger item 7, "the horizon still ends at a hard line"). The
approved CITY layer 5 stands at 300-420 m and occupies bearings 22-158 --
the castle's hemisphere and nothing else -- so in five of eight sectors the
world's last object was at 345 m. A scenic band now runs 430-580 m all the way
round: wooded ridges, far tower groups, the occasional giant. Nothing in it is
reachable, nothing collides, nothing has a road. It is silhouette at the range
where silhouette is all that survives.

**The way past the castle.** Written by hand it ran into the BeyondL hedge
wall and walkable reported its first turn unreachable. Asked for the route a
walker takes, the flood came back squeezing past a court urn at 1.3 m -- a
walk, not a road. So the corridor was SOLVED: Dijkstra maximising the minimum
clearance from the castle court to a milestone at 256 m, then simplified by
extending each leg only while the straight line still clears 250 uu. 2.6 m of
clear air the whole run, and it says what no eye could: the way north goes UP
THE AXIS behind the focal plane and turns east at 200 m, because the flanks
and the beyond gardens close every other side.

## Eight permanent district cameras

Golden Arrival's thirteen all stand in the arrival plaza. Eight more now stand
in the Clock Quarter, the Mushroom Grove, the Water Gardens, the Tea Terraces
and the Lantern Hamlets, on a road at the Dog's eye height, high beyond the
castle looking back over the world-to-city transition, and past the castle's
shoulder to the East Reach. Their transforms are computed from the world, and
`_district_cam_foregrounds` gives each one a near field derived from its own
frame arithmetic -- 2-19 placements in band became 20-37, and nothing it
places can be under a lens because the lens decides where it goes.

## The quilt finally has contrast (ledger item 2)

Measured: Moss and Lawn differed by **1.39x** in luma, and 28 displaced lawn
meshes on a moss slab at a 1.4x step are invisible at world distance. Moss
darkens 12% (it is also the terrain slab, and fields read against a darker
ground), a third sward `MI_V2_Meadow` joins at 0.285, and the quilt no longer
uses Moss at all -- lighter fields ON a darker ground. **2.08x** now. Lawn does
not move: it is the district's own grass and the founder has judged it.

## Numbers

| | PASS 22 | PASS 23 |
|---|---|---|
| placements | 7,115 | **7,824** |
| **actors** | 859 | **584** |
| quarters | 44 | 45, in 12 named districts |
| kinds | 4 | **10** |
| world emptiness (tier-scaled) | 2,896 m2 | 2,336 m2 of 40.7 ha |
| populated 50 m bands | 0-350 m | **0-600 m, all 12, monotone** |
| outer density per ha, 100 -> 350 m | 202/87/46/40/39 | 197/139/87/57/40 |
| GROUND core:far (outer) | 5.19x | 4.90x |
| destinations / quarters unreachable | 0 of 18 / 0 of 44 | **0 of 30 / 0 of 45** |
| nested quarters, roads through quarters | 0, 0 | 0, 0 |
| cameras | 13 | **21** |
| assets / materials | 117 / 47 | 119 / 48 |

Actors fell 32% while the world grew 10% and gained a 420-piece horizon,
because the silhouette itself is instanced now: 71 tower_capped, 34
castle_hall, 30 giant mushrooms with three companion meshes each. Everything
walkable.py treats as an obstacle keeps its collision inside the batch.

## Defects found by a measurement, not by looking

| found by | defect |
|---|---|
| dry-run warning count | LAYOUT.SKY's loop gated EVERY item on `skyDome` -- true while the band held one placement. All 48 balloon pieces were silently skipped, 49 times, under a log line saying "dome skipped" |
| `hierarchy` embedded landmarks | 15 landmarks standing in hedges the moment the edge dressing and the country layer existed; then 3 more when the filter guarded only its own band; then 2 more when the horizon overlapped the outer quarters |
| `walkable` | the north way's first turn unreachable -- the hand-drawn road ran into an approved hedge wall |
| `walkable` again | the derived route squeezed past a court urn at 1.3 m, so the corridor had to be solved rather than sampled |
| `camera_framing` | the eight new cameras opened onto bare ground, 2-19 in band against 42 for the flanks |
| the FOOT table | setting `mushroom_giant` to its CAP radius (20 m) made three Golden Arrival destinations unreachable in one edit. The cap is 13 m in the air; the stem is the obstacle |

## Traps worth not re-learning

1. **A band is not homogeneous.** A loop that gates every item in a band on
   one item's flag is correct exactly until the band holds two things.
2. **Containment is not overlap.** `_declutter` first asked "is the hedge's
   centre inside the landmark", and a 3.2 m hedge can contain a 4 m tower's
   centre while its own centre is outside. The Minkowski sum is symmetric.
3. **Clearance is not corridor width.** A widest-path search reporting 1.5 m
   means the tightest approach to ANY object is 1.5 m, which is exactly enough
   for a 3 m road. Half an hour was spent believing the world was sealed.
4. **A measured table has one home.** `FOOT` moved into layout_v2 and
   walkable.py reads it, and the north way's waypoints are exported as
   `NORTH_WAY` for the same reason -- the tool spent two runs reporting a turn
   the world no longer had.

## Renders worth inspecting

`V2_WORLD_PLAN_PASS23.png` (the districts, coloured by name and kind, with the
road network) and `V2_WORLD_PLAN_PASS23_horizon.png` (out to 600 m, showing
the scenic band). **Nothing rendered on a GPU.** The next session should
capture 0 / 6 / 11 / 12 for the world, then 13-18 for the districts.

## The list

1. ~~Quarter hierarchy~~ · 2. ~~The ground quilt does not read~~ (contrast now
   2.08x; needs a frame to confirm) · 3. ~~Far-world emptiness~~ ·
   4. ~~Destinations beyond the castle~~ · 5. ~~The horizon ends at a hard line~~
   (band placed; needs a frame)
6. **Ten authored sites still could not be placed** and are named in the build
   log. Their ground is covered by neighbours; each is a discarded decision.
7. **The 50-75 m band is Golden Arrival's own thin outskirt** -- 282 per
   hectare against 723 inside and 305 outside. Founder decision: closing it
   means re-planting approved ground.
8. Mushrooms may still out-shout the architecture. 30 giants now, but spread
   1/4/2/5/6/4/3 across the 50 m bands and evenly split across three tints --
   a distribution rather than a pile. Needs a frame.
9. `palette.rose` ~0.46x the reference on the flank cameras. Needs a frame.
10. The plaza medallion reads as a scribed ring rather than inlay.
11. Performance unprofiled: 584 actors now, against 2,123 when this item was
    written. `measure-fps.sh` has still never been run.
12. Two landmarks stand inside hedges in Golden Arrival (`ClockTree_Clock`,
    `Tower_R0`). Both predate this work and both are approved ground.

## PASS 23 e-g — routes, the approach's shoulders, and the kinds that were thin

**District lanes.** The road tree gets you across the world and the ring closes
its loops; neither makes the seven clockyards of the Clock Quarter feel like
one place. A lane is 1.8 m against a road's 3, links quarters of the same
district in a nearest-neighbour chain, skips any leg that would cross a third
quarter, and carries a waymark at each end. 21 of them.

`_crosses_quarter` is written once now and used by the ring and the lanes,
because the first two road builders each learned it separately. And the road
audit was matching two label forms, so the north way and the lanes -- 32 roads
-- had never been checked at all. It matches `_Seg` now: **403 segments in 139
roads, 0 crossings.**

**The approach's shoulders** (ledger item: "empty lawn between the garden gates
and the castle"). Measured per hectare of solid placements:

| | before | after |
|---|---|---|
| the corridor, \|x\| < 25 m, y 17-95 m | 713 | 713 (untouched) |
| LEFT of it, x 25-70 m | 362 | **444** |
| RIGHT of it | 330 | **427** |
| the flank beside the plaza, same offset | 505 | 505 |

W1 gave the approach a fountain court, hedge masses and cross-axes and every
one of them is ON the axis; its shoulders were never planted. `APPROACH_SIDES`
is an added BAND, not an edit, and stops 28 m clear of the corridor.

**The plaza-side walls** (ledger, MEDIUM). `_dress_wall` was written for this
exact complaint, made twice by the founder, and had been used on the rear wall
and the flank edges and never on SideWall or FrontWall -- both of which are in
ReverseCam03's frame. 48 pieces of pilaster, cap course and planting, again as
an added band; the plaza-clean gate confirms nothing entered PLAZA_RECT.

**The thin kinds.** Mean placements per quarter by kind said which ones had an
identity and a landmark and then stopped:

| kind | before | after | what it gained |
|---|---|---|---|
| hamlet | 44 | **65** | a front garden and a lane per house; a market cross; an arch |
| tea | 52 | **70** | a balustrade round the terrace, lanterns, the rest of the service |
| water | 59 | **75** | a rill and a lower basin -- one fountain in a lawn is an object |
| clockyard | 58 | **77** | the HOUR RING (twelve kerbs, four quarter-hour plinths) and a colonnade |
| grove | 52 | **73** | a WINDING PATH -- the founder's own word -- with understory at its edge |

## Standing at the end of PASS 23

| | phase start | now |
|---|---|---|
| placements | 4,590 | **9,734** |
| **actors** | 2,123 | **608** |
| quarters | 32, three kinds | **61, ten kinds, fourteen named districts** |
| populated 50 m bands | 4 of 7 (0-350 m) | **12 of 12 (0-600 m)** |
| world emptiness (tier-scaled) | not measurable | 3,168 m2 of 40.7 ha |
| cameras | 13 | **21** |
| roads | 70 | **139, 0 crossing a quarter they do not serve** |
| destinations / quarters unreachable | 0 of 18 / n/a | **0 of 30 / 0 of 61** |

Golden Arrival's eleven composition bands still hash byte-identical to the
commit before this phase. Four bands are added (GROUND_QUILT extended, SKY's
balloons, HORIZON, APPROACH_SIDES, PLAZA_WALL_DRESS) and each is recorded.

## PASS 23 h-i — the two props that do a job, and water at the right scale

**Signposts and benches.** "SIGNS" is a panel on the boards' object-language
page and this kit had no sign of any kind. It is also the one prop that DOES
something: the founder's test for a road network is that a player believes
they can keep going, and a fingerpost at a junction is how a garden tells
them where. 54, one at every quarter's approach turned so a finger points
back down the road it arrived by, one at each ring marker, one at the north
gate. And "social spaces" is the last line of the founder's list for what a
quarter can have -- a social space with nowhere to sit is a lawn. 50 seats.

**The lake.** Twelve fountains is a lot of water and none of it is big. There
was no room to put a lake between the quarters -- searched, and the widest
clear spot in the southern half measures under 25 m -- so a lake is a KIND.
The sheet is `garden_lawn` wearing MI_V2_Water: 48 x 48 of displaced grid,
which under a water material is ripple rather than plate. Island, fountain,
broken balustrade rim with a slipway, reeds, a walk right round, three seats
facing in, and a bridge, because `castle_bridge` had been used exactly once
in this world and a lake is what a bridge is for.

`_REACH["lake"]` was guessed at 2,600 and both candidates fell back to a
fountain -- the kind existed and the world had none of it. Measured off the
builder it is 1,900, and two lakes stand. The district's palette also drops
"garden": a district called the Water Gardens should arrive at a garden by
FALLING BACK to one, not by choosing it.

## Standing at the end of PASS 23

| | phase start | now |
|---|---|---|
| placements | 4,590 | **9,839** |
| **actors** | 2,123 | **620** |
| quarters | 32, three kinds | **60, eleven kinds, fourteen named districts** |
| recipes | 117 | **121** (balloons, signpost, bench) |
| populated 50 m bands | 4 of 7 (0-350 m) | **13 of 13 (0-650 m)** |
| cameras | 13 | **21** |
| roads | 70 | **139**, 0 crossing a quarter they do not serve |
| unreachable | 0 of 18 destinations | **0 of 30 destinations, 0 of 60 quarters** |

The object language, counted:

    tower_clock 7 · clock_ornate 25 · fountain_basin 12 · lakes 2 · tea_plinth 7
    column_ornate 22 · arch_stone 8 · key_ornate 11 · topiary_spiral 41
    mushroom_giant 31 · balloon 24 · signpost 54 · bench 50 · gate_arch_gold 8

against 11 placements between the first eight of those at the phase start.

---

# THE RENDERS — PASS 23A and 23B, 2026-08-30

The Studio was up with the L4. Two builds and two captures, and the second one
carries a fix the first one found.

## PASS 23A (`0051644`) — the world exists

`V2_PASS_116-119`, HeroCam0 / SkylineCam06 / WorldCam11 / WorldCam12, 1280x720
through Pixel Streaming, all four verdict STRUCTURED. The generate: 119/119
assets, 584 actors, **8,533 instances in 314 batch actors** — the instancing is
real in-engine, not only in the dry run.

What the frames show that no previous render did: hot-air balloons across the
sky in all four; giant mushrooms with their gold rims and cream spots reading
as landmarks from 100 to 300 m; a clock tower on the skyline; garden quarters
with their parterres and paths legible from above; tower neighbourhoods; and
the horizon band as a treeline where the world used to stop at a hard edge.
HeroCam0 is the founder's frozen composition, unchanged, with balloons over it.

`V2_COMPARE_PASS21_vs_PASS23A_WorldCam12.png` is the pair worth looking at:
PASS 21 is a sparse ring on bare ground under an empty sky; PASS 23A is wooded
to the skyline.

## What PASS 23A found — THE GROUND SLAB WAS ON TOP OF THE GARDENS

Every frame showed one flat olive plane from the district to the horizon. The
ledger has carried that since PASS 20 as "the ground quilt does not read — the
mechanism works, the contrast does not", and PASS 23c had just doubled the
quilt's colour contrast to 2.08x. **The contrast was never the problem.**

    garden_lawn = box(6000, 7200, 24, at=(0,0,-12))   top surface at local z = 0
                  perlin displaces that top by +/-9
    terrain slab = Cube at z = -30 scaled 0.6          60 uu thick, TOP AT z = 0

A lawn placed at the authored z = -2 therefore has its surface between -11 and
+7, and only its noise peaks cleared the terrain. **191 of the world's 255
lawns sat between -2 and -8** — the ground quilt, every quarter's ground, the
flank lawns, the lake's water sheet. All of them were inside the terrain.

`garden_lawn`'s own docstring says what was meant: "the moss ground slab stays
BENEATH as terrain." It was not beneath; it was exactly level with the lawn's
origin, and had been since the slab was introduced.

Raising the lawns was tried first and is wrong: it buries what stands ON the
lawn instead (`ground_flowers` is a flattened sphere reaching only +11 from its
origin). The slab drops to z = -44 — a top of -14, below the lawns' deepest
displaced point of -13 — and every placement in the world keeps its authored z.

## PASS 23B (`8568d7c`) — the fix, measured

`V2_PASS_120-123`, same four cameras. Build time 14 minutes against the first
build's 85, because the material set was unchanged and the shader cache warm.

| SkylineCam06, gap_v2 | 23A | 23B |
|---|---|---|
| foreground.luma | 0.1547 | **0.1786** (+15%) |
| midground.luma | 0.1084 | 0.1063 |
| skyline.luma | 0.0712 | 0.0705 |

The near ground brightened by an eighth and nothing else moved, which is
exactly what a lawn appearing from under the terrain should do. On WorldCam11
and 12 the quilt reads as lighter fields against the darker slab, and the new
lake is visible as a pale sheet with its rim and walk.

Filed: `V2_GOLDENARRIVAL_PASS23A_*` and `PASS23B_*` for the four cameras, with
`V2_COMPARE_SLABFIX_*` sheets and `V2_COMPARE_PASS2x_vs_PASS23A_*`.

## Performance, measured on the L4

`FPS cam1 median 52.8 ms = 18.9 fps, mean 61.6 ms, p95 99.2 ms` at 1280x720
through Pixel Streaming, with 9,830 placements in ~600 actors. The ledger's
performance item has never had a number before; it has one now. Note the
measured caveat already in this file: the encoder and the network are the
known bottlenecks on this path, not the renderer, so this is a floor.

## PASS 23C — the district cameras, re-aimed after their first frame

Their first render said three things at once and all three were mine.

**WaterGardenCam15 pointed at a tower.** The transforms were computed against
the site list as it stood, and the kinds had changed under them since -- the
fallback chain turns a water garden into a garden where there is no room, so
the camera aimed at a quarter that had become something else. They are aimed
now at the quarter of the district's SIGNATURE kind whose radius is closest to
the district's own seed radius: representative rather than innermost, which is
also why TeaTerraceCam16 no longer stands 18 m from the plaza.

**ClockQuarterCam13's clock tower was behind its own quarter's edge planting**
at 46 m. Back to 79 m and up to 5.2 m of eye, each camera nudged to the
clearest spot on a 5x5 search, with the clearance recorded beside it in
v2_config: 2.5 to 12.6 m.

**HamletCam17 was inside a bush, and GroveRoadCam18 had a trunk on the lens.**
That is the failure this project spent PASS 09 to PASS 12 on and wrote down --
"massed at s 0.82-0.96 five metres from a 2.65 m eye, so a bank of foliage
filled the bottom 45% and hid the garden" -- reproduced by a foreground rule
that placed trees at 1.15x d_near, which is 5.5 m from a 2.8 m eye. **Reading
a lesson is not the same as applying it.**

`_district_cam_foregrounds` starts at 1.6x d_near now, and a TREE needs 2.2x
AND to be past 0.58 of the visible half-width; anything nearer or more central
is knee-height planting. GroveRoadCam18 was measured onto the road instead of
placed beside it: every road segment between 90 m and 220 m scored for clear
air at the camera and 6-18 m ahead along its own bearing, and the best is the
outer ring in the Mushroom Grove at 182 m -- 10.2 m here, 6.0 m ahead.

camera_framing after: 17 to 106 placements in band, 0 to 5 under.

## The list, at the end of PASS 23

Closed this phase: quarter hierarchy · far-world emptiness · the ground quilt
(it was the SLAB, not the contrast) · destinations beyond the castle · the
horizon's hard line · the empty lawn beside the approach · the plain
plaza-side walls · performance, which now has a number.

1. **The frames are dark.** The district cameras stand in heavy shade and the
   near planting reads almost black. Neither the sun angle nor the fill has
   been looked at since the world tripled in vegetation, and 12 % of the
   canopy is now blossom that a dark frame cannot show.
2. **One authored site still cannot be placed** (`Q08_towers`) and is named in
   the build log.
3. **The 50-75 m band is Golden Arrival's own thin outskirt** -- 282 per
   hectare against 723 inside and 305 outside. Founder decision: closing it
   means re-planting approved ground.
4. Mushrooms may still out-shout the architecture: 31 giants, spread across
   the 50 m bands and evenly split across three tints, but unjudged in frame.
5. `palette.rose` ~0.46x the reference on the flank cameras.
6. The plaza medallion reads as a scribed ring rather than inlay.
7. Two landmarks stand inside hedges in Golden Arrival (`ClockTree_Clock`,
   `Tower_R0`). Both predate this work and both are approved ground.
8. The Relay Dog has not been walked through any of this. `walkable.py` is a
   plan-view flood and the locomotion phase already proved that only walking
   finds a 60 uu riser. `playtest.sh` exists and has not been run against the
   district world.

---

## PASS 25 — THE WORLD, SOLVED FOR WALKING (2026-08-30)

The founder's instruction was that the Relay Dog must walk this world, and
that where a route does not work THE WORLD is repaired, not the route. Asking
that question of the whole world at once turned out to be the fastest audit
in the toolkit, and the most productive.

**`tools/route.py`** — the fifth permanent tool. It builds the same obstacle
field `walkable.py` audits with, floods it breadth-first from the spawn
carrying parent pointers, and reads back a walkable path to every stop on the
tour in one pass. ONE FLOOD, MANY DESTINATIONS: the first attempt searched per
leg and did not finish in ten minutes; this solves the whole world in 5-16
seconds. Paths are simplified by sight rather than by angle, so a grid
staircase becomes a handful of legs.

It reported four broken connections on its first run, and they were real:

**The garden quarter and the hamlet were sealed inside their own flower
beds.** Of 434,342 cells of open ground, exactly two were unreachable — the
centres of two parterres, each with the ornament it is built around standing
in the middle where no player could reach it. `_parterre` put the bed centres
at `q/2 + w` from the axis, so `w` was the walk's half-width only if the beds'
borders had no thickness; each border run is a stretched `hedge_block` of
half-width 67.5 uu straddling the bed boundary, and two adjacent beds each
took that out of the walk between them. Delivered: 112 uu. Not narrow —
impassable. `off` now adds the border's own half-width, so `w` means what it
says: a clear 2w, 3 m at full scale. The parterre grew 135 uu overall, under
8 % of its width, and its proportions are unchanged.

**A 13 m ivory tower was standing in a hedge.** `tools/hierarchy.py`'s
embedded-landmark test was plan-only, so it had been reporting a clock
ornament 5.6 m up a tree as "inside" the 2.6 m hedge below it — a standing
false finding on approved composition, which is how a real one gets ignored.
Made 3D (with tops measured from the recipes, failing CLOSED on any asset with
no entry), the clock cleared and `Tower_R0` remained: an approach rung 1.4 m
from its centre, wrapping a 5 m hedge blob around the foot of a landmark on
the corridor every player walks. `_declutter` could not have caught it — it
runs inside `_approach_sides` and the APPROACH band is assembled separately.
`_approach_pair` now slides a colliding rung UP the climb until it clears,
which keeps working when either end moves. Ledger item 7 is closed.

**The exploration route is now generated, not typed.** 97 legs over 1,358 m,
solved at an 80 uu capsule — more than twice the Dog's own 34 uu radius, so
the tour has margin rather than merely fitting. Two hand-placed waypoints had
already been found inside planting, each costing a capture. `route.py` also
gates the trap that would have eaten this one: `StepRoute` abandons a leg after
`max(12, hold + 25)` seconds and cannot tell "stuck" from "still walking", so
a leg longer than its own budget is silently dropped and the tour quietly
loses a stop. 0 of 97 overrun; the check now runs every time.

**No leg needs a jump, and none ever will.** The Dog has none: Space is the
Live Terminal, `JumpMaxCount = 0`, the ability refused rather than unbound.

Audits after: walkable 0 of 60 quarters unreachable · emptiness 2,640 m2 with
the largest region the deliberate castle sightline · hierarchy 0 embedded, 0
roads crossing a quarter they do not serve · verify_v2_layout PASS ·
verify_v2_dryrun PASS (625 actors) · verify_dog_canon PASS.

Still open from the standing list: 1 (dark frames — PASS 24 lit them, unjudged
in a fresh capture), 2, 3, 4, 5, 6. Item 7 closed. Item 8 half-closed: the
route is solved and written, but it has not been RUN on hardware.

---

## THE LIVE TERMINAL (2026-08-30)

Founder canon: Wonderland is an AI creation platform wrapped in an open-world
interface. SPACE is the Live Terminal. The Relay Dog does not jump. RELAY
SYSTEM is JULIUS, the orchestration layer ABOVE the three workers.

Built at `wonderland/web/player/`. Two decisions are structural rather than
habits, because both fail silently:

**Who owns the keyboard** (`keys.js`). Space is a character before it is a
shortcut, so the global binding fires only when world input owns focus -- never
from an input, textarea, select, contenteditable or textbox role -- and the
terminal focuses its input the moment it opens. `preventDefault` is false for
typing (the space still types) and true when we claim the key (the page never
scrolls).

**What it may say** (`feed.js`). `normalizeEvent` reads six named fields and
ignores the rest, so chain-of-thought, hidden prompts, secrets and internal
reasoning cannot reach the panel by default -- a producer that grows a
`reasoning` field leaks nothing, because the field is never read. With no
source connected the terminal says NO AUTHORITATIVE FEED CONNECTED and shows
nothing; a command typed with nowhere to send it says so rather than being
answered. It projects execution; it does not invent it.

**The defect the standalone harness could not have found.** Standing it up
against a page shaped like Epic's Pixel Streaming frontend showed the game
receiving the opening Space and every character of "walk south". Listeners on
the same target in the same phase fire in REGISTRATION ORDER, so a client that
binds window-capture first cannot be stopped by any amount of
stopImmediatePropagation -- capture phase was necessary and nowhere near
sufficient. `claimKeyboard()` now runs at MODULE EVALUATION with no DOM, and
`install-overlay.sh` puts the tag BEFORE player.js. Reversing those two lines
reproduces the failure exactly, which is why the harness keeps both orders.

The panel's markup lives once, in `mount.js`, and `index.html` mounts the same
thing: two copies of an approved design is two designs.

97 offline assertions, 24 through real Chrome across both pages. The bridge
that carries real Julius execution into `window.wonderlandTerminal.connect()`
is the next piece of work, and until it exists the panel says so.

Also corrected: `playtest.sh` printed "space  jump" beside the URL the founder
opens -- the first thing they read, teaching the canon that had just been
overturned.

---

## PASS 26 — THE MILESTONE RUN, AND THE THREE BLACK CAMERAS (2026-08-30)

The founder asked for the full milestone validation: rebuild at the newest
HEAD, capture the eight locked Golden Arrival cameras plus 15 and 16, split
performance by region, and walk the Dog through all 1,359 m.

**The camera suite found the world's largest remaining defect, and it was a
lighting one.** Every locked camera's foreground was measured. Seven read 52
to 186 luma. THREE read 8 to 12, with 71-89% of their foreground below luma
20 -- GardenLeft04 (9.5), GardenRight05 (11.7) and TeaTerraceCam16 (8.1).
All three stand under the densest canopy in the world. This is exactly the
founder's first quality priority ("foliage collapsing to black") and it was
invisible to every audit here, because plan-view coverage cannot see a
shadow.

Two candidates were ruled out by measurement BEFORE anything changed:

* **Ambient occlusion is not the mechanism.** `r.DistanceFieldAO 0` plus
  `r.AmbientOcclusion.Enable 0` moved the garden foreground from 9.5 to 9.4.
* **The sky light cannot do it alone.** At x8 it fixed the garden (9.5 ->
  31.7, green cast +6.5 -> +15) and took Golden Arrival's approved foreground
  from 177 to 205 with its shadowed hedges nearly doubling. An omnidirectional
  ambient hits the up-facing plaza hardest, so it cannot separate the two.

What separates them is the ANGLE. At pitch -18 a shadowless fill delivers
sin(18) = 0.31 of itself to up-facing paving and nearly all of itself to a
vertical leaf facing it. And one directional lights ONE HEMISPHERE of leaf
normals -- the rest stay black however bright it is, which is why 4,500 lux
was not merely too little. The rig is now two fills of 9,000 lux at
complementary yaws with the sky light at 1.6. 18,000 lux against a 60,000 lux
key is 30%; the failure recorded three times in this project is a fill at
122% of key, which destroys the shade.

**Three builds were thrown away by exit codes, not by anything wrong with the
world.** `-run=pythonscript` exits non-zero if ANY error was logged, and the
material builder probed engine assets that are absent from this commandlet's
registry. Fixed at the source, twice (two call sites, then one that cannot be
guarded at all -- `does_asset_exist` reports DefaultNormal present and
`load_asset` still fails, so the ask was removed). And the guard written to
accept a completed world vetoed itself: `actors=0 ` matched `v1_actors=0 `.
A regex written to catch one failure that instead catches every success is
worse than no guard, because it looks like a safety net.

**The profiler was measuring a cold start.** Its wait loop broke as soon as a
>2k CSV existed, but UE writes the CSV incrementally: a 420-second profile
returned in twelve seconds with 46 rows. Every percentile from it would have
described the first second of a launch. It now waits for the run, takes the
largest CSV rather than the first, and refuses to report percentiles from a
capture too small to have them.

Engine performance, measured per camera at 1080p on the L4 (NOT through the
stream, whose 18.9 fps is an encoder and network number): HeroCam0 46.8 fps
median, PlayerCam01 46.7, PathCam02 54.6, ReverseCam03 46.4.

World as built: 631 actors, 11,290 instances in 335 batch actors, 121/121
assets, both maps written.

NOTE ON THE STAMP: the PASS 26 world on disk was generated at 43012bb and the
package stamps 668c170. The two differ only in a build-script regex and an
engine fallback that never loaded, so the generated content is identical --
but the stamp is the newer commit and this is why.
