# The reference gaps this kit was built to close

**Read this before adding an asset.** Every family in `scripts/forge/families/`
exists to answer a specific, named difference between the founder reference and
what Wonderland currently renders. An asset that does not answer one of these
is an asset that makes the world bigger without making it closer.

## The two images

| | |
|---|---|
| REFERENCE | `wonderland/v2/reference/marble-royal-garden-cam0-founder-reference.png` |
| OURS | `wonderland/v2/reference/renders/V2_MILESTONE26_HeroCam0_1080p.png` |

These are the only pair in the project with real pixels on both sides, which
`WONDERLAND_WORLD_CURRENT.md` states plainly: "Only HeroCam0 has real pixels on
both sides ... Every other camera has a render but no reference." So every
observation below is made on that pair and nowhere else. Where a claim is
about the whole world rather than that frame it says so and names the tool.

**These are OBSERVATIONS OF TWO IMAGES, not measurements.** No renderer ran on
the reference; nobody can. The world session's `gap_v2.py` needs a GPU that
does not exist on this host. What follows is the honest kind of statement a
person makes looking at two pictures side by side, and it is labelled as that
rather than dressed as data.

---

## GAP 1 — the skyline is needles, and there were no needles

**The single largest difference, and the world session had already named it**
(`9655bad`, "the reference's gold is in the garden, and its skyline is
needles").

| | reference | ours |
|---|---|---|
| dominant unit | a slender shaft under a very tall thin roof | a squat drum under a wide roof |
| roughly | past 8:1 overall; the roof alone often as tall as the shaft it sits on | about 2:1 |
| count | dozens, packed, receding through four or five depth planes | about a dozen, well separated |
| shafts | broken by galleries and balconies you can see sky through | smooth, with a painted band |

**Why it was never fixed by placement.** It is not a density problem or a
material problem. `assets_v2.py` contains no needle, so there was nothing to
place. A generator asked for a taller tower could only scale an existing one,
which gives a stretched tower — string courses a storey tall, windows the size
of doors.

**Answered by** `families/towers.py`: five spires from 18.4 m to 24.6 m on a
3.0 m socket, seven crowns every one of which is taller than it is wide, and
eight bodies authored slender rather than scaled.

## GAP 2 — the reference's towers are PIERCED; ours are solid

Look at what happens at the top of the reference's frame: light comes *through*
the buildings. Arcaded galleries, open belvederes, colonnaded storeys. Solid
mass at 400 m reads as one blob whatever its surface does.

**Answered by** `elements.arcade_ring` — a ring of piers with arches built
between them rather than holes cut out of a drum — used in
`WL_Tower_Base_Arcaded`, `WL_Tower_Mid_Arcade`, `WL_Tower_Crown_Belvedere`,
`WL_Colonnade_Arcade` and both heroes.

## GAP 3 — a huge gold lattice, and nothing like it at any scale

The reference's left third is dominated by an ornate gold screen, ivy-grown,
standing between the garden and the city. `9655bad` moved Wonderland's gold
into the garden, which was right, and it left the garden with gold OBJECTS
rather than a gold WALL.

**Answered by** `elements.filigree_panel`, and three assets that use it at
three sizes: `WL_Detail_Screen_Filigree` (a 5.2 m run), `WL_Gatehouse_Screen`
(two 4.3 x 8.6 m leaves) and `WL_Hero_Gate_Royal` (hung in a 22 m opening).

## GAP 4 — the foreground is a balustrade, and it does more work than any tower

The part of the reference nearest the camera is a balustrade with newel posts
carrying gold urns, running out of both edges of frame. It is what the eye
reads the scene's scale against.

**Answered by** `WL_Detail_Balustrade_Run` (butts end to end into any length)
and `WL_Detail_Newel_Urn`.

## GAP 5 — the city is CONNECTED; ours is a set of separate objects

The reference's towers are joined — walkways, arcaded walls, bridges crossing
at height. `WORLD_LEDGER.md`'s PASS 38 entry names the same gap from the other
end: `bridge_arc` existed and was classified as a `prop` beside the garden
benches until the classifier was repaired.

**Answered by** `families/civic.py`: `WL_Bridge_Sky` (a 32 m tower-to-tower
span with `bridge_end` sockets so a generator can find two towers to join),
`WL_Bridge_Arc`, `WL_Bridge_Flying`, and three colonnades.

## GAP 6 — the threshold is an EVENT

The reference is organised around being entered: a wide ceremonial arch at its
centre with a broad arcaded structure behind it. The current world has
thresholds and places them well — PASS 30's South Reach is built around a
`gatehouse_district` and eight arches, and it worked — but `arch_stone` and
`gatehouse_district` read as competent masonry rather than as an arrival.

**Answered by** `families/thresholds.py` (four arches, two gatehouses) and
`WL_Hero_Gate_Royal` at 22 m of clear opening.

## GAP 7 — the ogee, which is the reference's actual line

Almost every arch head, window head and gate in the reference is an OGEE — a
keel that bulges past the springing low down and draws into a point at the
crown. It is the most Wonderland-specific line in the picture and the current
world's arches are round or plain pointed.

**Answered by** `elements.arch_curve(kind="ogee")`, used on 14 assets.

## GAP 8 — the city has no EDGE

A city reads as a place rather than as a cluster because it stops on purpose.
The reference has a walled, terraced boundary between the garden you stand in
and the city behind it, with towers standing ON that line.

`layout_v2` could not draw it. PASS 30's South Reach ends on nineteen columns
"so the world's southern edge is a made line rather than a fade" — the right
instinct reached with the wrong tool, because a colonnade is transparent and an
edge has to be opaque somewhere. `gatehouse_district` is a point, not a line.

**Answered by** `families/walls.py`: a curtain run that butts to itself, a
D-plan mural tower, a postern that drops into a run without re-planning it, a
90-degree corner bastion, and a stair. All five share one wall-walk height
(6.20 m) and the stair reaches it in 20 risers of 0.310 m, so the circuit is a
ROUTE `walkable.py` can use rather than scenery.

## GAP 9 — the middle distance is small BUILDINGS, and there were none

Between the reference's foreground garden and its skyline of needles is a band
of two- and three-storey buildings with pitched roofs, dormers, chimneys and
overhanging upper floors. It occupies more of the picture than the spires do.

Wonderland has a `hamlet` district whose roof vocabulary is a cone, and every
other module in this kit is a tower or a monument — so a generator building the
middle distance had a choice between a 40 m tower and a garden bench.

**Answered by** `families/roofscape.py`: three house bodies on one shared
6.4 x 5.2 m plan (so they terrace), plus a dormer, a chimney and a shopfront as
clip-ons. The key element is `elements.roof_ridged`, whose `ridge_frac`
parameter is a gable at 1.0 and a hip below it — a ridge has two completely
different silhouettes where a cone has one, which is why a street of them reads
as many buildings.

## GAP 10 — mushroom architecture is in the SKYLINE, not only on the ground

`WONDERLAND_ART_DIRECTION.md` lists "giant red-and-white spotted mushrooms ...
at several scales" from the founder reference, and the reference image has
mushroom-roofed *buildings* in the mid-distance on both sides. Wonderland's
mushrooms are all props at ground level.

**Answered by** `WL_Tower_Crown_Cap` — the motif as a tower crown, so the
generator can put it on the skyline.

---

## What this kit does NOT answer, and should not be assumed to

- **Vegetation.** Not one leaf is modelled here. The existing foliage is good —
  `assets_v2._leaf_shell` and the vegetation pass that replaced sphere-clusters
  with leaf blades — and duplicating it would be the exact mistake this
  repository's CLAUDE.md opens with. What the kit adds instead is
  `veg_anchor` geometry: flat strips on the faces the reference plants, set
  just inside the wall so they are invisible if nothing is scattered on them.
- **Colour, light, atmosphere.** The kit names V2 materials that already exist.
  It authors no material, no shader, no light.
- **Placement.** No module decides where it stands. That is Session 2's.
- **The far-city backdrop.** PASS 31 built that (289 pieces at 360–580 m under
  a solved ceiling) and it is a different problem — silhouette at a distance
  where these modules' detail is invisible.

## Next five, in the order I would do them

The first two on this list at the end of the first pass — the curtain wall and
the roofscape — were built, and are GAP 8 and GAP 9 above. What follows is what
is left.

1. **The rest of the stair vocabulary.** `WL_Wall_Stair_Flight` proved the
   riser (0.310 m, 20 of them, reaching 6.20 m exactly) but it is one straight
   flight against a wall. A quarter-landing, a curved flight and a ramped
   terrace on the same riser would let the generator build the reference's
   layered GROUND, which is currently flat inside every quarter.
2. **A water-garden hero.** Both heroes are dry and vertical. The
   `water_garden` quarter has nothing singular in it, and a tiered
   basin/cascade landmark would use `MI_V2_Water`, which this kit never
   touches.
3. **Damaged and overgrown variants** of four or five existing bodies. One
   extra parameter each (a broken parapet, a missing bay, ivy anchors over more
   of the face) would roughly double the apparent vocabulary at almost no
   authoring cost, and break the regularity a purely modular city drifts
   toward.
4. **A market/awning layer for the roofscape.** The houses have a shopfront;
   what a street actually reads as inhabited by is the stuff in front of it —
   awnings, stalls, hanging signs, crates. Small, cheap, and the reference's
   middle ground is full of it.
5. **Terrace and retaining-wall modules.** The reference's garden is on
   several levels held by low walls with balustrades on top. The kit has the
   balustrade and the curtain wall but nothing between them at garden scale.
