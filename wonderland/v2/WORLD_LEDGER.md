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
