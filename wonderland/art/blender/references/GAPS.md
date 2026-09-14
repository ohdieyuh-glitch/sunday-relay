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

## GAP 11 — the ground was flat inside every quarter

The reference's garden is on LEVELS. Ours is a plane with things standing on
it, and the only vertical route in the kit was `WL_Wall_Stair_Flight`: one
straight flight, against a wall, reaching the wall-walk. A quarter you cannot
climb is a quarter with one composition in it.

`families/stairs.py` and `families/gardens.py` are the answer, and the thing
that makes them a SYSTEM rather than sixteen models is two ladders:

    riser        0.310 m, everywhere, without exception
    route ladder T1 1.55  T2 3.10  T3 6.20 (= the wall-walk)  T4 9.30

Every flight arrives on a rung. Every terrace is retained at a rung. So "get
from here to there" is a lookup, not a measurement, and a generator can
substitute a curved flight for a straight one without re-planning anything.

The one module that breaks the riser does it on purpose and says so:
`WL_Stair_Ceremonial` is 0.155 on 0.900, which is 9.8 degrees — the pitch a
processional flight has and a functional one does not. Its params carry
`off_ladder_reason`, which is what stops the validator failing it and what
stops anybody copying it by accident.

## GAP 12 — the water quarter had no water in it

`MI_V2_Water` is in `materials_v2.py` and this library had never used it. The
world's `water_garden` quarter was ground you could stand on with nothing to
walk to.

`assets_v2.fountain_grand` already exists and is good, so a second fountain
would have been the mistake `CLAUDE.md` opens with. What the world has NO
example of is water used ARCHITECTURALLY — a sheet of it held in a made edge,
at a scale you walk along rather than stand at.

`WL_Hero_Water_Court` is 34 m of still water in a colonnaded court, and its
whole argument is arithmetic: a reflection doubles whatever stands at the head
of it, so putting `WL_Hero_GreatSpire` there makes a 236 m composition and the
second 118 m costs one flat quad. Everything else in the family serves the
route: canal units that butt, a crossing that substitutes for one, a cascade
that drops T2 in the same ten risers the dry stairs use, a pavilion that stands
IN the sheet, and a pool you go DOWN to.

## GAP 13 — the street was architecture with nobody in it

The roofscape family gave Wonderland small buildings and one of them a ground
floor worth looking at. What no module provided is the stuff IN FRONT of a
building, and that layer is the whole difference between an architectural model
and a place people live.

`families/market.py` is deliberately NOT clutter. Crates and baskets at 40 cm
do nothing for a silhouette, cost draw calls and are invisible past 30 m. Every
module here changes the street's OUTLINE at the distance a camera actually
stands: an awning breaks a vertical facade with a horizontal, a canopy roofs
ground that had none, a hanging sign projects INTO the street so a row of
facades stops being a plane, and a covered passage darkens a gap so the street
looks like it has depth behind it.

Two of the six hang off a facade and foot on nothing. That is what
`ModuleSpec.mounts` is for, and it is the mirror of `excavates`: a module may
float only when it names what carries it.

## GAP 14 — a modular city drifts towards regularity

This is the gap that is not in the reference photograph, it is in the METHOD.
Ninety modules assembled by a generator produce a city where every wall is the
same age, and the eye reads that as a product line before it reads it as a
place.

`forge/weathering.py` answers it with parameters rather than models. Age is
surface erosion scaled by exposure; overgrowth stands `veg_anchor` volumes on
ledges; damage cuts the module through with a tilted ragged plane. Nine
variants exist because each adds a FORM the kit lacked — a broken mural tower, a
ruined colonnade, a balustrade with its rail gone — and not one exists to make
the asset count larger.

The rule that makes them usable is that a variant's sockets are a subset of its
base's at the same places: age and overgrowth may not move a join at all, and
damage may only drop a join it destroyed and has to say which. A weathered
module is therefore a drop-in substitution anywhere its base fits.

## GAP 15 — the ground was a material, and a plaza is not a texture

Everything this kit had built STANDS on the ground. Nothing was the ground.
The world's answer is `MI_V2_PlazaCream` and its four siblings, and for a flat
surface that is the right answer: modelling an 8 m tile as 128 slabs would cost
hundreds of triangles to say what the material already says, hundreds of times
over.

What a material cannot do is RELIEF, and relief is most of what makes a made
surface read:

  * a KERB is 15 cm of shadow, and 15 cm of shadow is the whole difference
    between a street and a field with buildings in it
  * a RUNNEL says the surface sheds water, which means somebody built it
  * a SINGLE RISER is how two paved areas become two rooms -- you cross it
    without deciding to, and the plan reads as a composition afterwards
  * a MEDALLION is why a plaza has a centre. Without one it is a gap between
    buildings
  * a TREE GRATE is the hole a street tree stands in, and the world already
    has better trees than this kit would write

`families/ground.py` is eight modules and 2,900 triangles for the whole family.
It contains no flat paving on purpose, and the four new material slots
(`paving`, `paving_warm`, `paving_shade`, `kerb`) all name instances
`materials_v2.py` already defines -- reaching for `stone` would have made a
plaza slab the same surface as a tower shaft, which is the one thing the V2
palette went out of its way to separate.

It also found a bug in the kernel that had been there since the first pass, and
the bug was in three other modules as well. `mesh.lathe` closes a PARTIAL
revolve by adding pie slices back to the axis, so an open profile does not
leave an open shell. It was adding them to closed profiles too, where the swept
tube is already sealed by its own two radial faces -- so a closed section swept
90 degrees came back as a solid quadrant of stone filling the corner. The
magenta pass said BLACK rather than magenta, which is what named it as two
surfaces rather than a hole.

The guard is now in `lathe`: a section whose first point equals its last gets
no pies. But it only helps a section that says it is closed, and three others
were rectangles written as four points without the fifth --
`WL_Colonnade_Curved`'s plinth and cornices and `WL_Garden_Retaining_Curved`'s
planting strip. Those modules' origins are their own ARC CENTRES, 24 m and 11 m
away, so each pie was a disc that size: the retaining run had a green wedge the
size of its own quadrant, which is what made it visible at all. The colonnade's
were stone on stone at ground level and had been invisible in every render
since the module was written.

## Next, in the order I would do them

Session 1's list is done: the stair vocabulary is GAP 11, the water hero GAP 12,
the market layer GAP 13, the variants GAP 14, and the terrace walls are part of
GAP 11. What is left:

1. **Interiors of the thresholds.** Every gate here is a solid you walk past.
   None has a passage you walk THROUGH with a ceiling over you, and a gate is
   the one module a player is guaranteed to be inside.
2. **A LOD story.** Everything is authored at one density and that density
   suits a camera at 30 m. `report_performance.py` names the modules spending
   triangles a distant camera cannot resolve; a coarser spelling of the crowns
   would matter most, because a skyline is mostly crowns.
3. **Ground at the 1 m scale** — paving, kerbs, single steps. Stairs and
   gardens connect LEVELS; what joins two modules on the SAME level is still a
   terrain material, and the reference's plaza is not a texture.
4. **A second roof language.** Everything is rose or lilac tile. The reference
   has lead, copper and thatch in its middle distance and the palette has room.
5. **Night.** `glass` and `water_lit` are emissive in V2 and no module has been
   composed for the dark.

## GAP 16 — the sky has islands in it, and ours had none

**The reference changed.** Since 2026-09-13 the visual authority is the founder-approved Wonderland
Bible boards (`wonderland/v2/reference/boards/BOARD_1`-`BOARD_6`), not the Marble image this document
was first written against. Every one of the six boards puts FLOATING ISLANDS over the skyline: a disc
of lawn in a stone lip, a rock underside hanging to points, and a small castle on top.

The world had balloons, clouds, gold keys and teacups in the air, and not one island. Nothing in
`assets_v2` or this kit becomes one by scaling: a tower foot with a cone under it reads as exactly that.

**Answered by** `families/sky.py`: three islands (9, 16 and 26 m across) whose datum is their own lawn,
so any kit tower foot stands on one exactly as it stands on the world's ground, and whose underside is
a main rock mass with a ring of smaller hanging masses, declared through `excavates` so the validator
holds the depth to the centimetre.

## GAP 17 — the city had towers and houses, and the Bible's city is palaces

**What the Bible shows** (BOARD_1 "Architecture Detail References" and "Depth & Scale References"): between
the garden and the needles stand long ivory palace fronts -- an arcaded, rusticated ground storey, a piano
nobile of tall round-headed windows between gilded pilasters, a cornice and a balustrade -- under steep
lilac and rose mansards with dormers and gold cresting, broken by taller pavilions, and over them a great
ribbed dome on a columned drum. The founder's private-beta list (2026-09-13) asks for exactly this: "more
domes", "layered palace/city architecture".

**What the kit had.** 6 m houses, towers, walls and one small ribbed dome crown on the L rung. A palace
front spelled from houses is a terrace; a tower scaled into a drum has windows the size of doors.

**Answered by** `families/palace.py`: `WL_Palace_Wing` (24 x 12 m, five bays, joins end to end),
`WL_Palace_Pavilion` (14 m square, one storey taller, tall roof and lantern) and `WL_Palace_Dome_Grand`
(34 m podium with portico and corner turrets, a 16-window columned drum, a ribbed pointed dome whose
shell is its own part so a layer lays it in lilac, rose, blue or gold). The three share one order --
ground 0-5.2 m, nobile 5.4-11.4 m, parapet 12.4 m -- so wings, pavilions and the dome's podium line up.

## GAP 18 — the walked ground was a tinted sheet

**What the quality reference shows** (founder, 2026-09-13, `WorldDesign/Reference/environment_quality_reference_2026-09-13.png`
in the world repo): a plaza of chunky individual stones in a loose light/dark checker, each bevelled and a little
proud or sunk against its neighbours, with deep joints and moss in them -- relief the low sun finds.

**What the world had.** The V2 plaza slab: one smooth tile shape on a grid, hairline joints, every top in one plane.
However good its material, a plaza of it reads as one tinted sheet.

**Answered by** `families/paving.py`: three 4 m flagstone fields (A/B/C, different seeds) laid over existing
paving -- courses of stones in running bond (course depths 36-56 cm, stones 34-72 cm), every stone a chamfered block
of its own height (5.0-5.9 cm) and chamfer, three tints in a loose checker (~40% dark), 1.6 cm joints over a moss
bed. No collision: the paving under it carries the walk.

## GAP 19 — the flower beds were colour, not flowers

**What the Bible and the quality reference show:** beds made of flowers -- daisies round a gold eye, lavender spikes,
roses among dark leaves, spilling over the stone. The founder (2026-09-13): "Flowers should not read as flat color
clusters."

**What the world had.** SM_flower_cluster: a rounded blob in a petal material, laid every 58 cm along the path kerbs
-- a row of pink and violet cushions.

**Answered by** `families/flowers.py`: 1.2 m bed runs of daisies (38, ten petal blades round a gold eye), lavender
(30 spikes of seven florets) and roses (22 blooms of three nested, turned cups), each flower on its own stem, height
and lean over low fine leaf clumps; `petal` is a batch material so one mesh plants any colour. First planted at
3-4.5 cm blooms and the beds read mostly green; now 5.5-8 cm (Wonderland scale, not botanical).
