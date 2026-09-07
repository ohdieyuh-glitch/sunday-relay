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

### PASS 26 CORRECTED — the lighting fix, on the map that actually plays

The first attempt at the two-fill rig changed the render by nothing at all:
foreground p50 9.5 before, 9.5 after, for a 4x increase in fill. That is what
exposed the map defect above. Rebuilt with `WLV2_MAP_NAME` pinned to the cook
map, the same change measures:

| camera            | fg p50 before | after | under luma 20 | green in shadow |
|-------------------|---------------|-------|---------------|-----------------|
| GardenLeft04      |  9.5          | 41.7  | 89% -> 19%    | +6.5 -> +15     |
| GardenRight05     | 11.7          | 38.8  | 71% -> 20%    | +6.5 -> +14.5   |
| TeaTerraceCam16   |  8.1          | 29.4  | 84% -> 23%    | +3.5 ->  +8.5   |
| HeroCam0          | 176.9         | 185.0 | 2.8% -> 1.8%  | midground +8.5 -> +20 |
| ScaleCam07        | 186.3         | 195.5 | 1.2% -> 0.4%  | -               |

The three dark cameras lift 3.6-4.4x. The two approved compositions move +8
and +9 -- against the +28 the sky-light x8 experiment produced -- and neither
clips (p95 209 and 210). Golden Arrival's midground is the clearest evidence
the fix did what it was designed to do rather than simply brightening: its
shadowed hedges went from 46.5 to 85.2 with the green cast rising +8.5 -> +20,
which is "deep but readable shade with visible green hue" stated as numbers.

Deep shade survives: 19-23% of each garden frame is still under luma 20.
Nothing was flattened.

NOTE ON THE BEFORE COLUMN: the "before" frames come from the frozen WP2, so
part of each delta is the world differences that map never received. The
direction and the magnitude are as designed, and the after column is the
current world measured on the current package.

### PASS 26 — CRITICAL: the Dog could not traverse the world

The traversal capture found it, and nothing else could have. The Dog gave up
on leg 19 of 95 and never moved again: 22 legs abandoned, the shortfall
growing 1,154 uu -> 19,175 uu as the targets marched away while it stood
still. The take is 266 seconds of a near-static frame, which the walk audit
reported as a luma spread of HALF A UNIT across 941 frames.

`FOOT` contained `castle_tower` and not `castle_tower_octagon`,
`castle_tower_square` or `castle_tower_slender`. THIRTY-EIGHT TOWERS WERE AIR
to every route solve and every walkable audit, and the route was solved
straight through the one at (2500, 10300) -- nine uu off the leg-19 line.
The richest defect class in this project, again: a rule applied to one
collection and not its siblings.

It hid because A MISSING FOOT ENTRY FAILS OPEN. The solver skips what it does
not know and reports a clean route. `route.py` now lists every ground-level
asset it cannot see, and the deliberate exclusions are DECLARED in
NOT_OBSTACLES rather than left missing, where they looked like a considered
decision. That list immediately produced a second finding: the tea district's
crockery is solid and building-sized (pot 138 uu, cups 134 and 130, clock 78;
the saucer excluded on purpose as a flat disc you step onto).

THE CAPSULE CAME DOWN 80 -> 60. With the towers and crockery modelled, 80 uu
no longer fits the hamlet's parterre cross walk, and the honest answer was not
to widen the world to suit the solver. The world affords a 1.2 m walker
everywhere; the Dog is 0.68 m wide, so 60 uu is 1.76x its radius.

Route: 96 legs, 1,702 m -- up from 1,359 m, and the extra 343 m is the detour
around the castle the Dog now actually walks.

CORRECTION TO A PUBLISHED NUMBER: every "walkable: 0 of 60 quarters
unreachable" reported before this commit was computed blind to castle
architecture. It still reports 0 of 60 with the towers modelled, so the
conclusion survives -- but it did not mean what it appeared to.

---

## PASS 27 — THE TRAVERSAL CONTRACT (2026-08-31)

**ROOT CAUSE.** Flat walking slabs presented a surface 31 uu above the
surrounding ground while the canonical Relay Dog's `MaxStepHeight` is 30 uu.
`terrace_platform`'s top sits at local z = 140; at z = -18 with a 0.35 z-scale
that is 31. Every road, lane, path and walk in Wonderland was unclimbable by
ONE UNIT.

**SYMPTOM.** Grass traversal succeeded perfectly. The Dog stalled and ground at
road boundaries, moved at a sixth of its nominal speed along them, and could
terminate short of completely unobstructed targets -- once SEVENTY-FOUR UU
short, with nothing collidable within three metres. Every one of those reads as
"something is in the way".

**FAILED DIAGNOSTIC PATH.** Six route and collision fixes were made before the
surface contract was questioned, and each addressed a real secondary defect:

1. 38 castle towers absent from `FOOT` -- the route was solved through one.
2. Missing footprints failing OPEN -- the tea district's crockery was invisible
   to the solver too.
3. A corner-hugging breadth-first path -- the Dog wedged in a gateway the
   solver called clear.
4. Pinned pinch points -- backwards; a pin aims the route THROUGH a gap.
5. A flat 25 s leg budget -- punished the long legs the new solve produced.
6. The North Gate at 336 uu -- genuinely too narrow for a body that can be
   pushed into geometry and cannot depenetrate; widened to 736 uu.

None of them was wrong. None of them was this. A one-unit lip does not look
like a step, and the tell was there early: a Dog that cannot close 74 uu in
open ground is not blocked, it is failing to climb.

**FIX.** `ROAD_Z = -30`, putting the walking surface at 19 uu with 11 uu of
margin, applied to every flat traversal slab -- processional roads, district
lanes, grove paths, water-garden walks, garden and court walks. Intentionally
elevated geometry is preserved: rills stay raised, stairs stay a flight,
monument plinths stay plinths. The DOG WAS NOT CHANGED; `MaxStepHeight` is
still 30 and the world moved to meet it.

**PERMANENT PREVENTION.** `verify_v2_layout` now measures every flat walking
surface against the Dog's step height and FAILS THE BUILD if one exceeds it,
reporting the contract as numbers rather than a pass: MaxStepHeight 30 uu,
highest flat lip 19 uu, margin 11 uu, 610 surfaces checked, 0 violations, with
19 stairs, 20 rills and 5 plinths exempt and counted.

**PROOF.** 262 of 262 legs, 3,232 m, 100% completion, in 920 s. ZERO stalls,
zero route repairs, zero collision or step failures. All twelve stops reached
in order -- arrival gate, plaza, fountain court, castle front, garden quarter,
grove, water garden, mushroom wood, clock quarter, hamlet, home -- and the Dog
then began a second lap. Speed median 283 uu/s against a nominal 330, with only
3.1% of samples below 60 uu/s.

The route is 3,232 m rather than the 1,359 m of the corner-hugging solve
because it takes safe wide paths and now visits a grove and a water garden:
`tools/surface_families.py` proved the old tour crossed only three of the seven
surface families the contract governs, so it could not have proved the fix.

**REGRESSION.** The 12 uu drop broke nothing and corrected something: kerbs now
stand 9 uu PROUD of the road, where their tops previously sat at 28 against a
31 uu road surface -- they had been buried in it. Roads remain 19 uu proud of
the ground, stairs are 42-52 m from any road so no joins moved, and everything
still at the old height is soft scatter on beds.

---

## PASS 28 — ENCHANTMENT + VERTICALITY (2026-08-31)

The founder reopened the goal: Wonderland must stop reading as "a beautiful
royal botanical city" and start reading as "an enchanted royal Wonderland
civilization with impossible verticality, magical landmarks, strong
silhouettes and discovery everywhere." Their diagnosis, in their words: the
problem is not world size, it is WONDER PER METER.

### Three instruments, because nothing here could measure any of it

Every audit in this project measured the world in PLAN. None could answer
"how tall is it", "what does a camera see", or "how much sky has a leaf in
front of it" without a GPU and a capture round.

| tool | question | what it caught |
|---|---|---|
| `tools/skyline.py` | how tall, and is anything dominant? | the second-tallest thing in Wonderland was a HOT-AIR BALLOON |
| `tools/skyline.py --site` | what would this landmark do to all 21 cameras? | set the great spire's height from HeroCam0's frozen half-field |
| `tools/occlusion.py` | what does each camera actually see? | seven of the eighteen largest presences in the world were TREE CANOPIES |
| `tools/occlusion.py --cover` | how much ground has a crown over it? | 57-67% in the bands where the city is |

Heights are MEASURED off the shipped geometry -- every recipe is built on the
offline meshkit backend and its bounding box and a twelve-slab radius profile
read -- never declared in a table beside the code. A table is a derived number
in a comment, which is this project's richest defect vein.

### The measured before, walkable world (r <= 400 m of the spawn)

    height p50 6.5 m   p90 32.1 m   max 127.7 m
    80-120 m ....  4 pieces (0.06%)      120 m+ .... 2 (0.03%)
    tallest : second distinct site .... 1.46x
    canopy cover  0-40 m 43.9%   40-80 45.5%   80-130 57.1%   130-200 67.2%
    canopy palette  ~86% plain green / 0% varied leaf / ~14% flowering

### What was built

**A — the skyline.** `spire_great` (180 m authored), `spire_signature`
(117 m), `tower_district` (67 m). One great spire ON the arrival axis at
330 m, two signature spires deliberately OUTSIDE HeroCam0's 50 deg
half-field, seven district towers filling a rung that did not exist.

**B — revealing the city.** A clearing field and sightline corridors, both
filters over the assembled bands. 326 of 738 generated trees removed.

**C + E — the enchanted landmarks.** Ten recipes at 12-54 m and one authored
thing per district, no type in more than two, verified in-district by
`_district_of` itself.

**D — colour.** Four new foliage tones, `_BLOSSOM_SHARE` 0.08 -> 0.20, and
the green picked by hash instead of `i % 3` (which gave every tree one of
each green, averaging to a single colour at any distance).

### The measured after, same window

    80-120 m .... 12 pieces      120 m+ .... 6
    tallest : second distinct site .... 1.47x
    tallest : p90 ......... 4.12x -> 6.25x
    ladder 194.4 / 131.9 / 127.7 / 122.5 / 90.9 / 90.2 / 86.1 / 83.5 / 80.8 / 75.4
    canopy cover  0-40 m 41.6%   40-80 37.1%   80-130 25.8%   130-200 31.0%
    canopy palette  55.9% plain green / 15.1% varied leaf / 29.0% flowering

### PREDICTIONS, stated before the render

Scored after the capture, in the units the tools report.

1. **The great spire's tip is inside HeroCam0**, with sky above it. Computed
   +32.0 deg top elevation against a 33.8 deg vertical half-field.
2. **HeroCam0's skyline reads as a hierarchy**: one spire clearly taller than
   everything, castle below and in front of it, negative sky preserved.
3. **SkylineCam06 shows city where it showed forest.** The whole-frame veg
   share will move little -- that camera's 45 deg half-field still contains
   the trees that moved outward -- but the CENTRAL THIRD should fall from
   veg:arch 1.23 toward or below 1.0.
4. **`gap_v2.palette` green share falls and rose/pink rises**, from a canopy
   that went 86% one hue to 56% green / 29% flowering / 15% varied leaf.
5. **The 40-130 m band reads as parkland**, not woodland: architecture
   visible between crowns rather than above them.
6. **No traversal or step-height regression.** Both already gated offline:
   652 walking surfaces, highest lip 19 uu against MaxStepHeight 30, 0
   violations; 0 of 60 quarters unreachable with the new landmarks modelled
   in FOOT.

RISKS I EXPECT THE RENDER TO ARBITRATE, recorded now so the scoring is
honest: the thinning may read as bare rather than open; 29% flowering canopy
may read as an orchard again (it was cut from 20% to 8% for exactly that once);
the sightline corridors radiate from the arrival plaza and may read as a
starburst; and the coloured glass emissive is unmeasured on this runtime.

### PASS 28 — SCORED AGAINST ITS PREDICTIONS (2026-08-31)

Package `4fbba00` on the L4, 14 cameras at 1080p, frames V2_PASS_187..200.

| prediction | result |
|---|---|
| 1. Great spire's tip inside HeroCam0 with sky above | **MET** — computed +32.0 deg against a 33.8 deg half-field, and that is where it landed |
| 2. HeroCam0 reads as a hierarchy | **MET on the second attempt.** It landed as a HAIRLINE: 30.4 deg of height on 2.9 deg of shaft, 1:10.4 against the castle hall's 1:2.3. Repaired to 1:3.2 by widening 1.75x, height being already at the camera's ceiling |
| 3. SkylineCam06 central third falls toward veg:arch 1.0 | **PARTIAL** — whole towers, walls and the gatehouse now visible where only tower tops showed; the frame-share number is the wrong instrument and the render is the evidence |
| 4. palette.green falls, rose rises | **MET, measured on the founder's own frame**: green 0.342 -> 0.245 (-28%), rose 0.029 -> 0.061 (+110%), cream +25%, sky +26%, gold flat |
| 5. The 40-130 m band reads as parkland | **MET** — cover 57.1% -> 22.1% at 80-130 m |
| 6. No traversal or step-height regression | **MET** — 879 surfaces, highest lip 19 uu, 0 violations; 0 of 60 quarters unreachable |

**And the guardrail I could not predict: performance IMPROVED.** Median fps at
1080p on the L4 — HeroCam0 46.8 -> 49.6, PlayerCam01 46.7 -> 52.5, PathCam02
54.6 -> 57.4 — on a world about 6,400 placements larger. Thinning removed 326
generated trees (~900 large overlapping crowns, the expensive kind) and
everything added is instanced.

**RISKS I RECORDED BEFORE THE RENDER, scored honestly.** "The thinning may
read as bare": it does not. "29% flowering may read as an orchard": it does
not — it reads as a royal garden in blossom. "The corridors may read as a
starburst": no sign of it in any frame. "The coloured glass emissive is
unmeasured": it works, glowing without becoming a light source, which is what
the ABSOLUTE emissive decision was for.

### The rule this pass is actually about

**Angular height is not enough to size a landmark by.** Everything else here
followed from that: the spire needed mass, mass is width, and width was the
one axis left once height hit the frozen camera's ceiling.

### Three siting rules, each written because the last one passed something a render refused

standpoint clear -> sightline clear -> **approach clear**. The third is the
only one that is also a composition decision: a camera on the landmark's own
cleared approach spur looks along ground already known to be open, at the face
the approach arrives at. 100% of height clear at the teapot, stair and blooms,
89% at the pavilion, 67% at the clock; the key's camera did not improve and
kept its earlier point at 90%.

### OPEN, and not caused by this pass

**ScaleCam07 contains no Dog and has not since PASS 26.** Both a possessed and
an UNPOSSESSED Dog are in the saved map at (-330,-650) and (-560,-1000); the
capture, cropped and magnified at both, contains neither. My first explanation
— hidden because possessed — is disproved by the second Dog. The cause is in
how BP_RelayDog's runtime-built joint meshes behave in a packaged HeroCam
capture: the character module, not the world.

Founder checkpoint published:
https://claude.ai/code/artifact/384b9438-f10d-42a1-b372-95e0a7225d3e

## PASS 29 — ENCHANTMENT EXPANSION + LANDMARK CLOSURE (2026-08-31)

The founder reopened the goal with two named gaps from PASS 28 — the great
spire read as a hairline, and ScaleCam07 had no Dog — and a direction:
"larger, more enchanted, more architectural, more vertical and more
memorable", with the rule stated outright: **landmark scale = height + width
+ silhouette + negative-space readability.**

### The instrument this pass needed and did not have

Every tool here measured the world in PLAN, then PASS 28 added height. Nothing
could measure WIDTH, which is why a 194 m spire could be sized correctly by
every number available and still land as a thread.

| tool | question | what it caught |
|---|---|---|
| `skyline.py --mass` | how much of the picture does this take? | the great spire was 18th from the spawn, behind fifteen trees |
| `skyline.py --cam=X` | what is THIS camera's picture made of? | the spire was 7th in HeroCam0 at 4.0%; the biggest object in Wonderland's hero shot was a tree at 28 m |
| `skyline.py --cam=X --near=40` | ranked among LANDMARKS, not framing | separates "what is the foreground" from "what is the picture of" |
| `skyline.py --profile=<recipe>` | the silhouette, slab by slab | the shaft's upper half was 6.8 m of half-width on 194 m of height |

`--cam` is the one that mattered. It clips every site to the frame before
measuring, so a landmark half out of shot scores half, and it is the only
number that can test "unmistakably #1 from HeroCam0".

### 1. THE GREAT SPIRE — re-authored, not re-scaled

PASS 28's repair widened the PLACEMENT 1.75x. Measured, that spire was still
**4.0% of HeroCam0 and seventh in it**. A placement scale was never going to
buy the width and it cost detail on the way: 1.75 across against 1.08 up
stretched every window in the tower.

Re-authored: a cathedral body 104 m across the transepts where there was a
31 m plinth, **four 122 m flanking spires** on the shoulder, buttress fins the
full height of both shaft stages, eight corner turrets with flying buttresses.
The flanking spires are what fix the upper half — a shaft alone is 5.6 deg
wide at 330 m whatever its base does, and the sky BETWEEN the flanks and the
central needle is what stops the same width reading as a slab. The impossible
flying stage, the crown and the needle are untouched.

    HeroCam0 share    4.0%  ->  7.9%        rank 7th -> 1st among landmarks
    shaft aspect      6.0:1 ->  2.7:1       (>4.5:1 is flagged a hairline)
    vs next landmark  0.6x  ->  1.7x        (2.7x against the next tower)
    GreatSpireCam22   36.4% of frame, 5x the next thing

The 1.75x is gone, folded into authored radii. Precinct, pier ring, court and
halo radii were all re-derived from the built mesh — the halos were riding the
scale letter and would have sat inside the new fins.

### 2. SCALECAM07 — the log had said why since the first empty frame

    CINEMATIC_PAWN_HIDDEN=1 pawn=BP_RelayDog_C_0 at=X=-330 Y=-650

`AWonderlandPlayerController` hides the possessed pawn in every
`-CinematicView` capture. That rule was written when the pawn was an
accidental default one standing in front of the arrival camera; the locomotion
phase then made the canonical Dog the player pawn, and from that commit the
rule hid the one object ScaleCam07 exists to photograph. A pawn tagged
`ScaleReference` is the subject now, not a stray, and the log says which
branch it took.

PASS 28's second, unpossessed Dog is retired. It stood 0.9 m behind the gate's
flanking wall — the position this file's own notes had already condemned —
**and** on the same bearing from ScaleCam07 as the playable Dog, so it was
behind the wall and behind the other Dog. A fallback placed without checking
the sightline is not a fallback.

Projected from where the Dog actually stands, it is in FOUR locked frames:
ScaleCam07 (6.0 m, off -33.4), PlayerCam01 (8.7 m, +22.2), ReverseCam03
(32.7 m, -5.8), GardenLeft04 (49.4 m, +2.6) — and out of HeroCam0, which is
what the frozen arrival composition requires. v2_config had said the Dog was
outside PlayerCam01 at bearing 50.6 deg; that bearing was measured for the
RETIRED position and left standing when the Dog moved.

### 3-4. DISTRICT DEPTH AND WONDER PER METRE

Each district had one landmark, a 20 m court and an approach spur — a monument
in a field. Seven new recipes, each one of four things: a THRESHOLD you pass
through (`gatehouse_district`, `bridge_arc`), an OUTDOOR ROOM you stand in
(`cloister_square`), a MECHANISM or light that does something (`orrery_gold`,
`lantern_swag`, `fountain_grand`), or COLOUR at architectural size
(`glass_screen`). No more trees and no more towers, which is what this world
has always reached for and has enough of.

95 pieces across eight districts, every one placed in its LANDMARK'S OWN
APPROACH FRAME so the gate is always on the way in and the swags always span
the walk, whatever bearing `_sig_site` finally chose.

And the roads: `_ROUTE_LANG`'s own comment says "two districts share a kind at
most" and `key` was in three. The new architecture supplied the vocabulary to
keep the rule. The cadence was also wrong — `i % 16` over a loop that skips
odd indices is every 32nd segment, so 404 segments carried 14 wonders and four
of ten kinds never appeared in the world at all. Now 34 wonders, and the
waymarker is no longer REPLACED by the wonder standing where it was.

### 5. REVEAL — the filter could not see five of the founder's seven things

`_reveal_city` runs before the district landmarks are sited, because the
woodland must be thinned before they are placed into it. So its cones could
only ever be drawn to the skyline and the castle: gates, cloisters, bridges,
screens and courts were invisible to the only filter that opens a view. It
runs a second time now, over the same bands, with the new marks and
SIGHTLINES ONLY — the clearing field is a property of the woodland and
applying it twice would quietly halve the forest. 120 more trees, all for a
sightline.

    canopy cover   0-40 m 41.0%   40-80 38.0%   80-130 28.9%   130-200 24.0%

### 6. SKYLINE — one silhouette and four colours

The ladder was twenty consecutive rows of `roof_cone_steep` between 90 and
135 m. At a kilometre through fog, tint is the first thing to go and shape is
the last, so the entire backdrop read as one repeated tower — the "endless
towers" the brief asks not to add, already added. No tower was added, moved or
removed; the cap is chosen by hash from the four the kit already has. The
ladder now reads cone / ogee / bell / crenellated down its length.

### The five defects this pass introduced and caught before the render

Recorded because four of them are the same shape as something already in this
ledger.

1. **The depth search walked a bridge into the arrival plaza.** `_sig_site`
   has carried a district guard since PASS 23; this search, written one
   function away from it, had none. Tower Rise's bridge slid 63 m looking for
   clear ground and came to rest 11 m from HeroCam0 at **81% of the founder's
   hero frame**, with two lantern swags beside SkylineCam06. Caught by
   `--cam`, the tool built this pass. *A rule applied to one collection and
   not its sibling — the sixth.*
2. **The guard's first version was the wrong test.** `_district_of` is the
   obvious containment rule and it dropped eight pieces for being where they
   should be: districts are wedges at a radius, an approach runs INWARD, and a
   gate 150 m up the approach from a landmark at 250 m is correctly in another
   district. The test is belonging to a LANDMARK, not membership of a wedge.
3. **The bridge stood 1.55 m proud at both ends** — five times the Dog's step
   — and the step-height gate passed it, because it knew exactly one asset.
   *A gate that cannot see something reports success.*
4. **A paired fountain skipped its clearance test when its cloister had just
   been dropped for failing it**, because the pairing was tested against the
   TABLE rather than against what was placed.
5. **Four recipes were authored to sizes their docstrings did not have** —
   radii read as diameters, a 20.4 m fountain described as 8 m, a torus-arc
   window head that was neither pointed nor 13 m. All measured off the built
   mesh and rewritten, the arch head rebuilt from voussoirs because
   `torus(arc=)` gives no control over where an arc starts.

### And two defects that were already there

**Every parterre in Wonderland was a sealed box.** The route solve reported
castle -> garden and garden -> grove broken; they are one defect reported
twice, because the tour starts each leg from a stop it never reached. The
garden quarter's centre is 44 m2 of open ground with nothing solid within 17 m
of it, entirely enclosed by its own bed edges and rim. The rim's door could
never open: four pieces a side put t at 0, 0.333, 0.667 and 1.0 and the skip
window was `0.34 <= t <= 0.66`, excluding both middle values by three
thousandths — while the comment above the loop said "broken at the four walk
entrances". **Stale prose is load-bearing here and this is the clearest case
yet: the sentence describing the opening was the only thing that had one.**
The opening is a measured width now and `PARTERRE_NOTES` asserts it.

**And the founder's lag was not the game.** Reported live, profiled before
anything was changed: 3,540 frames of the exploration route, offscreen,
FrameTime median 19.40 ms (51.5 fps), p99 25.82, worst frame 31.78, **zero
frames over 33 ms**. GPUTime 19.26 of a 19.40 ms frame; GameThread 2.40. No
hitch, stall, streaming or shader-compile line in the packaged log. The
stutter was `MAINTAIN_RESOLUTION` — a setting VERIFIED.md records as a
deliberate override *for judging stills*, which under load holds picture and
drops FRAMES — over a renderer feeding 51.5 fps into a 60 Hz cadence with an
encoder quality floor leaving nothing else to give. Fixed with a LIVE profile
(MAINTAIN_FRAMERATE, MinQuality 25, ScreenPercentage 78) that the interactive
stream now defaults to; BALANCED and CINEMATIC are untouched so captures keep
the picture-first trade. **No art was changed for it.**

The movement profiler itself passed no `-ExecCmds`, so it measured the engine
defaults whatever profile it was asked for — the "after" would have been the
"before" with a new label. Fixed before any number was taken.

### Traversal, unchanged and re-proved at every step

    step height   MaxStepHeight 30 uu | highest lip 19 | 888 surfaces | 0 violations
    quarters      0 of 60 unreachable
    tour          253 legs over 12 stops, 3,132 m, 0 broken connections
    waymarkers    164 markers + 34 wayside wonders (was 171 + 13)

### PREDICTIONS, stated before the render

Package `356fe89` — the spire, the Dog fix, the seven recipes, the 95-piece
district depth, the second reveal pass and the parterre. The four commits
after it (wayside vocabulary, backdrop silhouettes, district accents, the
camera-list correction) are NOT in this package and are not being scored here.

1. **The great spire is the largest landmark in HeroCam0.** Computed 7.9% of
   frame against 4.7% for the next thing beyond 40 m, and 2.7x the next
   district tower. It will still be behind two near-field framing pieces — a
   tree at 28 m and the giant mushroom at 22.7 m — and that is the approved
   arrival composition, not a defect.
2. **Its shaft no longer reads as a thread.** Aspect 2.7:1 against 6.0:1, and
   the four flanking spires give the group a silhouette with sky through it
   rather than one line.
3. **ScaleCam07 contains the canonical Relay Dog**, and the packaged log says
   `CINEMATIC_PAWN_HIDDEN=0 pawn=BP_RelayDog_C_0`. PlayerCam01 contains it too,
   at 8.7 m — the second camera the founder asked for proof in.
4. **SkylineCam06 will NOT hold the spire's tip, and no world change can make
   it.** That camera is 24 m up at pitch −22, so its frame top is +7.4 deg
   above the horizon while the spire's tip is +26.1 deg. The spire will rise
   out of the top of that frame. SkylineRiseCam21 and GreatSpireCam22 are
   where it is seen whole; on the latter it is 36.4% of the frame, 5x the next
   thing. Stated now because the founder's brief names SkylineCam06 and the
   honest answer is arithmetic, not a fix.
5. **Three district frames change character**: ClockGrandCam23 gains a
   gatehouse at 21.5% (its new largest object), GlassPavilionCam28 gains a
   bridge at 22.2% dead centre plus a gatehouse at 13.2%, FloatingStairCam26
   gains a gatehouse and now holds the great spire at 15.7%.
6. **No traversal regression**: 888 surfaces, highest lip 19 uu, 0 violations;
   0 of 60 quarters unreachable; the twelve-stop tour walks 3,132 m with 0
   broken connections, which is 2 fewer than PASS 28 had.
7. **Performance no worse.** Everything added is a placed actor in an
   HLOD-far band and the second reveal pass removed 120 more crowns, which are
   the expensive kind. PASS 28's own measurement is the baseline: HeroCam0
   49.6 fps at 1080p.

RISKS RECORDED NOW, so the scoring is honest: 104 m of transept may read as a
BLOCK rather than a cathedral from HeroCam0's 330 m, which is the one thing
the founder explicitly warned against; the four flanking spires may read as a
cluster of separate towers rather than one grouped landmark; the gatehouses at
25-28 m are the tallest thing in several district frames and may outrank the
landmark they announce; and the district glass tints are unmeasured on the
depth pieces at these sizes.

---

# PASS 30 — 2026-09-06/07: the region nobody could see, and the audit that could not see it

**Offline only. Nothing rendered.** Every number here comes from
`layout_v2.ALL` and the built meshkit geometry.

## The problem with passing

All four standing audits passed on this world:

    emptiness --scaled        304 m2 empty in the whole world
    walkable --window=world   0 of 60 quarters unreachable, 0 of 30 stops
    hierarchy                 GROUND core:far 10.05x, 0 nested, 0 stray roads
    camera_framing            every camera's near band accounted for

And `D02_grove`, `D11_meadow` and `D18_meadow` — three neighbouring quarters —
held 65 placements between them of which 65 were vegetation. Not one built
piece, one giant mushroom each.

Every audit was right. **A place can be full of actors, reachable, correctly
sparse for its own tier, and still be nothing to arrive at.** Presence is not
a destination, and none of the four could tell the difference.

## `tools/region.py`

Three distances over the whole accessible world — to a built silhouette
>= 25 m, to any architecture at all, to a road — and ground is FORSAKEN where
all three are past the world's OWN 90th percentile. Flood-filled into
contiguous regions, ranked by AREA, because "where are the most square metres
of it" is the question three passes inside one twenty-metre patch failed to
ask.

Two things it had to be built around, both already in this ledger:

1. **BUILT, not tall.** Its first version's worst region had 81 m of
   silhouette in it and the 81 m was a HOT-AIR BALLOON, with four tree
   canopies behind it. `skyline.py` found the balloon in PASS 28 and
   `occlusion.py` found the canopies in the same pass, and this tool
   reproduced both on its first run. A tree is scenery.
2. **A self-calibrating bar cannot compare two worlds.** Repairing a region
   pulls the whole distribution in, the bar tightens with it, and an
   untouched region reads as having GROWN — measured on this very pass, the
   Far Orchards hole went "900 m2 -> 1,600" while nothing there moved.
   `--bar` pins it. Quote the pinned number for a change.

## The classifier was fail-open, and its own comment said so

`hierarchy.py`'s `ARCH` tuple carries a note added when the signature skyline
would otherwise have "registered as zero architecture, which is the same
fail-open shape as a missing FOOT entry and would have been just as quiet."

PASS 29 then authored a whole architectural vocabulary and none of it was
added. `floating_stair` 124.6 m, `key_colossal` 84.0, `clock_grand` 54.4,
`glass_pavilion` 54.0, `teapot_pavilion` 48.2, `gear_monument` 31.0,
`gatehouse_district` 28.4, `orrery_gold` 26.4, `glass_screen` 23.9,
`lantern_strange` 21.8, `cloister_square` 20.2, `tower_clock` 11.9,
`arch_stone`, `column_ornate`, `bridge_arc`, `stairs_broad` — **all sixteen
classed `prop`**, beside the garden benches and the finial balls. So eleven
meadows and three groves reported `arch=0` with a 54 m rotunda standing in
one of them.

`flower_colossal` was worse than a prop. `VEG` matches `"flower_"`, so the
Royal Gardens' district landmark — three 20 m blooms in metal and glass —
was VEGETATION. `ARCH` is tested before `VEG` in `klass`, so naming it was
the whole fix.

And `is_landmark` matches by prefix, so `mushroom_giant` has always also
matched its own gills, spots and rim: **every giant mushroom in Wonderland
was counted four times.** `LANDMARK_RIDERS` ends that.

    on the SAME world, unchanged:
      landmarks                          383  ->  401
      road to nearest landmark, median    20  ->   18 m
                                 p90      43  ->   32 m
                                 worst    83  ->   58 m
      arch per hectare at 175-200 m     21.1  -> 36.7

**Every arch/ha figure written in this file before PASS 30 under-reports.**

## The worst region

    6,800 m2, centre (120, -312) m, r 334 m, bearing 291 deg, South Meadows
    83% of ALL the forsaken ground in Wonderland
    at its worst  105 m from ANY architecture
                  128 m from anything 25 m tall
                  109 m from a road
    world medians  10 / 33 / 20 m

Not bad luck. `_DISTRICT_SEEDS` gives South Meadows the palette
`("meadow", "wood", "meadow")`, which contains **no built kind**, so the
district was always going to be landscape. Its one authored landmark stands
at 260 m, its ground runs to 358, and the last road on that bearing stopped
at 259. Everything past the rotunda was a hundred metres of grass.

## What was built, and what was deliberately not

THE FIX IS NOT DENSITY. Filling 6,800 m2 with props would have moved the
number and made the world worse: the brief for this tier is a hierarchy and a
meadow that reads as a meadow is correct. What the region never had was a
REASON.

    THE SOUTH WAY       84 m of road out of the ring circuit, two legs
    THE SOUTH GATE      a gatehouse astride it
    THE SOUTH RING      a 45 m arch on the approach axis inside a circle of
                        eight 20.8 m arches, amber and rose glass between
                        alternate pairs -- the only thing in Wonderland made
                        of nothing but arches, and you walk through all of it
    THE LAST COLONNADE  19 columns on an arc at 346 m, 12 m apart, so the
                        world's southern edge is a made line and not a fade
    TWO THRESHOLDS      one each for D11_meadow and D18_meadow

Sited at the audit's own reported centre, which is what `_QUARTER_SITES`
already says it does: "the audit's own reported centres ... the difference
between filling a world and filling the part of it somebody happened to look
at". Same move, one instrument later.

## Three defects this pass introduced and caught before any render

1. **The gate outranked the terminus it announces.** Dressed with a
   `roof_ogee` on top it stood at 38.4 m against a 45.0 m ring — 1.17x. PASS
   29 recorded exactly this risk in this file. Redressed the way
   `_depth_build` dresses a gate (colour on the banner balls above the ivory
   finial, because a coloured cone inside a white roof is invisible), it is
   29.8 m and the ring is 1.5x it.
2. **The meadow thresholds were labelled out of their own quarters.**
   `hierarchy.collect` reads a quarter tag as the label's first two fields
   with a numeric first one; `D11MeadowGate_Arch` parses to nothing, so the
   audit went on reporting `D11_meadow` at arch=0 with a gate standing at its
   centre. *A gate that cannot see something reports success* — the seventh
   of this shape in this file.
3. **`portal_ring` was going to be the monument.** Never placed in this world,
   12.2 m across, and standing it up with `pitch=90` looked like the
   enchanted, unfamiliar thing the brief asks for. It is a torus of minor
   radius 7 uu — a wire hoop 7 cm thick. At the scale needed it would have
   read as a hairline, which is precisely how the great spire failed in PASS
   28. `region.py` still handles pitch in its height read, because the next
   piece stood up that way will be solid.

## Before -> after, both worlds on the BEFORE world's own bar

    built > 70 m, arch > 37 m, road > 63 m

    forsaken ground            8,200 m2 in 4 regions  ->  1,300 m2 in 3
    the South Meadows region         6,800 m2         ->  gone
    worst region           South Meadows 6,800 m2     ->  Far Orchards 900

On each world's own recomputed bar the whole distribution moved:

    to any architecture      p90  37 -> 30 m     max  105 -> 85 m
    to a built silhouette    p90  70 -> 65 m
    to a road                p90  63 -> 59 m

    D11_meadow   28 pieces arch 0 prop 0  ->  32, arch 1 prop 4, 39.1/ha
    D18_meadow   23 pieces arch 0 prop 0  ->  28, arch 1 prop 4, 23.4/ha
    D02_grove    14 pieces arch 0         ->  unchanged, still all vegetation

## Regressions, re-proved

    route         196 legs over 12 stops, 2,323 m -- IDENTICAL before and after
    walkable      0 of 30 stops, 0 of 60 quarters closed; flood 76% both sides
    step height   0 violations over 914 surfaces (was 888)
    cameras       33 standpoints clear; no camera's band changed
    hierarchy     0 nested, 0 roads crossing a quarter they do not serve,
                  the 2 embedded landmarks are the pre-existing pair
    emptiness     --scaled 304 m2 unchanged; --radius=900 world total
                  59,712 -> 51,376 m2, and the 17,712 m2 south region is gone

## Next

**Far Orchards, 1,600 m2, centre (326, -86) m, r 337, bearing 345** — 64% of
what is left. And the question this pass raises and does not answer: two more
districts have palettes with no built kind in them at all, `The Long Woods`
`("wood","meadow","wood")` and `West Wood` `("wood","wood","meadow")`.
Changing `_DISTRICT_SEEDS` regenerates a district and is a bigger move than
authoring a reach.

One measurement defect found and not fixed: `_lm_setting` labels a landmark's
approach paving `_Spur%d`, and every audit here counts a road by `_Seg`.
Fourteen district landmarks are approached by something no audit calls a
road. Right on the ground, wrong in the measurement.

---

# PASS 31 — the reference is a city behind a garden (`e3952ae`, `9655bad`)

The brief changed to MAXIMUM VISUAL FIDELITY TO THE FOUNDER'S REFERENCE. From
here the authority is
`reference/marble-royal-garden-cam0-founder-reference.png` and the audits are
guardrails, not goals.

Only HeroCam0 has real pixels on both sides — that reference against
`reference/renders/V2_MILESTONE26_HeroCam0_1080p.png`. That pair is the only
trustworthy instrument for tone and palette. `tools/frame.py` (new, offline
mass model) is good for same-model before/after ONLY; its docstring records
that it over-fills so badly that 411 new towers moved nothing.

## `e3952ae`

A far city at 360–580 m under a +15° ceiling; a bearing bias in `_horizon`
that had been INVERTED (`pick < 0.62` selects the ridge, and multiplying
`pick` by 0.32 to "reduce" ridges made them commoner — the site count proved
it, 10 of 10 hero-arc sites still wooded); a cloud retune; and two audit
leaks that the new scenery opened: `hierarchy` counted 495 backdrop
`tower_capped` as landmarks, and `region` had no radius filter, so a cell at
350 m could find a far-city tower 30 m away. Closing the second restated PASS
30's own pinned figure as 1,800 m², not 1,300.

Three attempts at the far city are worth keeping. v1 at 460–760 m: keep-outs
pushed everything to 576–777 m, 284 pieces, 2.41% ink, tops at +3.2° — a
hairline at the world's edge. v2 at 260–520 m would have dropped 80 m towers
into walkable ground and undone PASS 30. And every tower was first sized from
`tower_district`'s 6,730 uu when `tower_capped` is **1,100** — 6.1× too
short, and the coverage audit scored zero columns above +6°. Sized from a
number belonging to a different recipe: PASS 29 caught four of these; that
was the fifth.

## `9655bad`

**Gold at four depths.** The reference carries 86% of its gold in the left
half of the frame and ours carried it at one distance. Four filigree screens
at 44, 53, 69 and 87 m, every bay but the centre one leafed. The bay geometry
was wrong first: `gate_leaf` hinges at x=0 and runs 400 uu, `gate_arch_gold`
springs from piers 380 apart, and 800 uu bays put each leaf across half a bay
with the arch spanning 3.8 m of an 11.2 m opening.

**A gate has an opening.** Five solid screens closed `LEFT landmark`. Opening
the centre bay was not enough: the third screen at (1900, 6400) stood 9.6 m
from that landmark, whose approach is a SIX-CELL KEYHOLE between `Tower_L2`,
the giant mushroom's cap, a mature trunk and two hedge masses — a pocket
always that tight and never before closed. A probe over the left garden
(20–46° frame-left, 54–98 m, every pier on ground the spawn flood already
reaches, 1.9 m clear of any solid, 12 m from every named destination) found
56 sites of 930; **538 of the rejects hit existing geometry**, which is the
left garden saying it is not empty. It moved to (3000, 8000).

**An airborne prop is not a wall.** Tracing that blockage found a defect
older than this pass: `solid_boxes` gave a ground footprint to 27 placements
that hang in the air — 20 clock faces up trees, 3 urns on columns, the
floating teapot and its cups — so *every traversal audit this world has ever
run* had been walling off ground under things you can walk beneath. Anything
above 400 uu no longer blocks.

**A skyline of needles needs the needles apart.** `hierarchy` reported 191
embedded landmarks, nearly all a far-city tower inside a *different*
cluster's tower: cluster centres 2,600 uu apart, members scattered to 2,800,
and at s=7 a tower is 12.5 m across. The rank now rejects a member whose
measured MESH radius (178 uu for `tower_capped`, 763 for `castle_hall`, read
off `assets_v2` — not `FOOT`, which is a walker-clearance number 2.2× the
mesh) overlaps anything placed.

    from HeroCam0, 100 deg arc   pieces   >+1deg   >+6deg   median top
    before (overlapping)            566    79.8%    78.0%     +13.4 deg
    after  (spaced)                 289    80.2%    79.2%     +13.0 deg

277 pieces were pure interpenetration — draw calls producing no silhouette.
Embedded landmarks 191 → 6; the six left are the audit's `FOOT` margin.
Landmarks inside the walkable world unchanged at 302.

---

# PASS 32 — a tree was standing in front of the city (`200aeff`)

One question asked of the reference: **what owns the top of the frame?** In
the reference, a warm dense continuous city between two dark trees. Measured
per degree across HeroCam0's 100° arc, ours was vegetation 69.8% / built
30.2%.

`Garden_L_Tree_Canopy0` — one crown at 28 m — owned the ceiling from +11.8°
to +46°, thirty-four of the frame's hundred degrees, with the city standing
at +19° to +28° in those same columns, present and hidden. PASS 28 had
already found these crowns (the eight largest presences in the frame) and
made them BLOSSOM rather than move them: that fixed their colour and left
them a roof.

The reference's foliage is ASYMMETRIC — left margin only +50° to +36°, right
one huge dark tree from −16° to −50°. Ours was the MIRROR: heavy left, light
right. `ClockTree` already runs −29° to −50° and was left alone. The left
group moved out as one rigid piece by `_GLT_DX, _GLT_DY = 900, 200` uu and
now runs +27° to +49°.

The same profile found the two lowest ceilings in the whole frame at −15..−11
(+16.8°) and +11..+15 (+19.1°), every neighbour at +26 to +32. They are City1
and City2, the two smallest clusters of the founder-approved focal plane,
standing exactly where the reference's spire field is densest.

**And the first fix for that was wrong, which is the useful part.**

                            before     via scale     via spire
    ceiling at -15..-11      +16.8       +22.9         +24.5 deg
    ceiling at +11..+15      +19.1       +26.3         +26.6 deg
    route legs / length    190/2306    377/4878      190/2306

Lifting the two clusters by `scale` closed the notches and DOUBLED the
walking tour, because scaling a cluster grows its hall, arcade, bays, dome,
bridge and every tower offset — two palaces at 100 m had grown across ground
the world walks through. The gap measured was ELEVATION, so `_castle_group`
gained `spire`: tower bodies scale `(s, s, s * spire)`, caps and finials ride
up at their own scale, no footprint changes. It closed the notches further
and cost the walk nothing.

**Rule: if you need a silhouette taller, reach for `spire`, never `scale`.**

Nothing moved a camera; nothing moved behind the castle or onto its outline.
City3 keeps the axis at s 1.7 and stays dominant. PASS 06 rejected
thirty-two giant towers stacked on the castle's silhouette at 350 m; these
two are on its flanks at 100–115 m, in front of it, at their original ground
scale.

    topmost silhouette owner, 100 deg arc:  built 30.2% -> 43.8%
                                            vegetation 69.8% -> 56.2%

## Gates at `200aeff`

    verify_v2_layout        PASS  13,686 placements, 914 surfaces,
                                  0 step violations, 33 standpoints clear
    verify_v2_dryrun        PASS  0 failures, 0 errors
    verify_v2_marble_paths  PASS
    walkable --window=world PASS  0 of 30 destinations, 0 of 60 quarters
    route                   PASS  190 legs, 2,306 m -- unchanged
    region --bar=70,37,63         1,800 m2 in 4 regions -- unchanged
    emptiness --scaled            3 regions over 3 cells, 6 in all
    hierarchy               PASS  302 walkable-world landmarks -- unchanged
    camera_framing          PASS
    occlusion               PASS

## Next

**PASS 33 is the lighting pass, and it must have a render in the loop.** The
largest measured gap to the reference is not geometry:

                          reference    ours
    dark (<70/255)          42.9%     27.1%
    median luminance          81       120
    p10 (shadow depth)        23        43
    ground row, dark      12/20/42%   0.5/3.3/8.9%

Our ground carries essentially no cast shadow. The cause is the shadowless
fill budget in `v2_config.LOOK` — `canopyFillLux` 9,000, a second PASS 26
fill, `bounceLux` 2,400 and `skyLightIntensity` 1.6 against a 60,000-lux key.
It was NOT touched this session, deliberately: those values were tuned across
PASS 08/08b/08c/24/26 against real renders, and a founder judgement is in
that history — the right side reading "excessively dark" is what caused the
hemisphere lift. Moving them blind risks re-breaking a call the founder
already made.

Then: the `Approach_Canopy0..3` and `ApproachSideL/R` canopies at 37–84 m
(vegetation still owns 56.2% of the ceiling).

And a warning about the ground's colour. Our low row is pale/stone 42.3% +
gold 48.0% + grey 4.1% where the reference is gold 57.9% + grey 21.2% + pale
4.1%. That looks like a material gap and is not one: "pale" is
bright-and-desaturated and "grey" is dark-and-desaturated, the gold shares
are already close, and the difference between the two buckets is luminance.
It is the shadow gap above, seen on the paving. **Do not darken the paving
albedo to close it** — that bakes an exposure error into a material. Measure
it again after the lighting pass.

Full detail and the render command list: `docs/handoffs/WONDERLAND_WORLD_CURRENT.md`.


---

# PASS 33 — the reference's city is taller than its trees

PASS 32's premise, checked against the reference IMAGE rather than an
impression, by classifying the top-most non-sky pixel of every column:

    ceiling owner    reference   our PASS 26 render   offline model
    built              71.5%           33.0%             30.2%
    vegetation         28.5%           67.0%             69.8%

Two things fall out. The offline silhouette model tracks the real render
within THREE POINTS -- the first cross-check against pixels anything here has
had, and reason to trust it more than `frame.py`. And the reference's trees
are enormous and still own only 28.5% of its ceiling, because the spire field
behind them out-tops them. The target was never "less green".

At -43..-23 and +23..+29 the tallest built thing was a DISTRICT TOWER losing
to a canopy by 0.4 to 4.3 degrees. `_DT_LIFT = 1.25` stretches the whole
`tower_district` rung vertically; footprint untouched, the same lesson as
`spire`. Applied to the RUNG, uniformly, and not to the two towers standing
in HeroCam0's flanks: tuning individual pieces to win named columns of one
benchmark frame is how a world comes to look right from exactly one place.

    ceiling owner:  built 43.8% -> 55.8%,  vegetation 56.2% -> 44.2%

Every gate byte-identical: 13,686 placements, route 190 legs / 2,306 m,
walkable 0 of 30 and 0 of 60, region 1,800 m2, hierarchy 302 landmarks,
wayfinding worst 64 m, camera_framing / occlusion / marble_paths PASS.

## What this pass refused to do

The remaining losing columns were sorted against the reference, not swept up.
-45..-49 and +43..+49 are the frame's extreme margins and the reference's own
trees own those. -33..-25 loses by 5.6-8.7 deg, and the reference's right
tree covers -16 to -50, so vegetation there is faithful.

+31..+41 is the one genuine hole -- the reference has dense spires and our
city tops at +14.4 deg. A siting probe over the wedge (26-46 deg, 120-300 m)
found NO FREE GROUND: every candidate centre falls inside an existing
quarter, nearest placement 97-693 uu. What stands there is the Royal Gardens
landmark, `S17_garden`, `S16_meadow` and a ring road -- a coherent GARDEN
district. Dropping a city cluster on it would overwrite a district's identity
and its road tree to win six columns of one frame. That is a district palette
decision for a considered pass.

`SkyGold0` (+37..+39, loses by 1.5 deg) and `GiantMushroom_Vine1` (+43..+49,
1.9 deg) would both flip by nudging a floating prop upward. Left alone: that
is benchmark-gaming, not world-building.
