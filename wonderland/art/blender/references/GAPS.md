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

## GAP 8 — mushroom architecture is in the SKYLINE, not only on the ground

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

1. **Curtain wall and towers-on-a-wall.** The reference has a walled edge to its
   city and the kit has colonnades but no defensible wall. A wall run with a
   wall-walk, plus a half-round mural tower that butts into it, would let a
   generator draw the city's EDGE — which is what makes a city read as a place
   rather than a cluster.
2. **Roofscape: gables, dormers, chimneys, a hipped-roof house body.** Every
   module here is a tower or a monument. The reference's middle distance is
   mostly small buildings, and the current world's hamlet has no roof
   vocabulary beyond a cone.
3. **Stairs and terracing as modules.** `walkable.py` audits step height over
   every surface; a stair FAMILY (straight flight, quarter-landing, curved
   flight, ramped terrace) sized to pass it would let the generator build the
   reference's layered ground instead of flat quarters.
4. **A second hero at district scale — the water garden.** Both heroes here are
   dry and vertical. The reference's `water_garden` quarter has nothing
   singular in it, and a tiered basin/cascade landmark would use the existing
   `MI_V2_Water` material the kit never touches.
5. **Damaged and overgrown variants of the existing modules.** One extra
   parameter on three or four bodies (a broken parapet, a missing bay, ivy
   anchors over more of the face) would double the apparent vocabulary at
   almost no authoring cost, and would break the regularity that a purely
   modular city always drifts toward.
