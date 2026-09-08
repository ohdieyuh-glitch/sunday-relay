# Wonderland — Blender asset forge, current

**This file is the handoff to the Unreal world session.** It says what exists,
what it is for, exactly how to bring it in, and what has *not* been proven.
`docs/handoffs/WONDERLAND_WORLD_CURRENT.md` is the world's recovery point; this
is the art library's.

| | |
|---|---|
| SESSION | 2026-09-08 — Blender asset forge, second pass |
| BRANCH | `claude/wonderland-blender-forge-pjinco`, cut from `origin/relay/wonderland-v2` at `0b07f0f` |
| SCOPE | `wonderland/art/**` and this file. Nothing else in the repository was touched. |
| LOCK | `wonderland/.gauntlet-lock` = `writer=claude`, read before writing, unchanged. `wonderland/art/` is unowned by `gauntlet-check.py` (shared). |
| BLENDER | `bpy` 4.5.13 LTS, installed via pip. Real Blender, headless — the same bmesh, the same exporters, Cycles on CPU. |
| RENDERED | **Yes.** Twenty-one Cycles contact sheets and seven ASSEMBLY renders in `wonderland/art/blender/validation/renders/`. No Unreal frame — see "What is unproven". |

---

## SESSION 2 — DO THIS FIRST

Read this section before anything else in this file. It is the shortest path
from a fresh checkout to something you can look at, and it is ordered.

**1. Build and validate. Nothing is committed but the source.**

```bash
python3 -m pip install bpy==4.5.13
cd wonderland/art/blender
python3 scripts/build_assets.py --no-blend    # ~2 min without renders, ~25 with
python3 scripts/validate_assets.py            # must print 0 failures
python3 scripts/validate_assets.py --self-test  # proves the checks bite
```

The build is **deterministic**: `validate_assets.py` rebuilds every module in a
clean scene and compares mesh hashes, and the hashes are in
`validation/VALIDATION_REPORT.json`. You will get byte-identical files.

**2. The first import is chosen for you, and it is eighteen assets.**

`manifests/wonderland-first-unreal-proof.json` is not a taste list. Every entry
is there because it satisfies a REQUIREMENT — every material slot has a carrier,
the tallest and the shortest module are both in so a unit error shows at both
ends, one module sits either side of the Nanite threshold, a complete
foot/body/crown stack is included so the socket grammar can be BUILT rather than
read, and the awkward cases in the export contract each have a representative
(the deepest excavation, a module that mounts on a facade and foots on nothing,
a damaged variant whose socket list is shorter than its base's, the most-parted
module). `scripts/make_proof_pack.py` re-derives it, so it cannot go stale
quietly.

**3. The import itself is a script, and it plans before it runs.**

```bash
python3 wonderland/art/unreal/import_kit.py --plan            # no engine needed
python3 wonderland/art/unreal/import_kit_offline_test.py      # 18 checks, no engine
# then, inside the editor:
<UnrealEditor> Wonderland.uproject -run=pythonscript \
    -script="wonderland/art/unreal/import_kit.py --execute"
```

`--plan` writes `wonderland/art/unreal/import-plan.json`: every destination,
material, data layer, Nanite and collision decision, each DERIVED from the
manifest by a rule written beside it. `--execute` writes `import-result.json`
recording what the ENGINE did, including options it refused. The plan carries a
`proven` block that currently reads `imported_into_an_editor: false`, and it
will keep reading that until an editor says otherwise.

**4. Then look at the six assemblies before you place anything.**

`manifests/wonderland-placement-recipes.json` holds six compositions — a needle
skyline cluster, a royal threshold, a closed wall circuit, a terrace flight, a
water garden and a market street — every position computed from measured
numbers, every recipe checked, and every one rendered to
`validation/renders/ASSEMBLY_*.png`. **These are proposals.** World placement is
yours; nothing here has touched a map.

**5. What is most likely to bite you, in order.**

- `dist-relay`-style staleness has an art equivalent: **`exports/` is
  gitignored**, so the FBX and GLB on your disk are whatever your last build
  made. Re-run `build_assets.py` in your own checkout before importing.
- **A module's origin is not its centre.** A stair starts at its bottom tread,
  a corner storefront at a corner, an awning at its back plane. Use
  `bbox_min_uu`/`bbox_max_uu`, not `size_uu`, whenever you need a footprint.
- **`z = 0` is the ground datum, not the lowest vertex.** Seven modules cut
  below it and declare `excavation_uu`; two hang off a facade and declare
  `mounts_on` with no footing at all.
- **A `crown` socket with radius 0 is terminal.** Nothing stands on it.

---

## What exists

**101 assets, 313 meshes, 350,518 triangles.** All built, all exported to GLB and
FBX, all validated, **0 failures**.

| group | assets | what it answers |
|---|---|---|
| `towers` | 24 | the skyline. 4 feet, 8 bodies, 7 crowns, 5 spires |
| `thresholds` | 6 | 4 arches, 2 gatehouses — the things you walk through |
| `civic` | 6 | 3 colonnades, 3 bridges — the horizontals |
| `walls` | 5 | the city's EDGE: curtain run, mural tower, postern, corner bastion, stair |
| `roofscape` | 6 | the middle distance: 3 house bodies, dormer, chimney, shopfront |
| `stairs` | 8 | the vertical vocabulary: straight, quarter, half-turn, curved, ceremonial, garden, ramp |
| `gardens` | 8 | retaining runs, corners, a curved arc, planter, overlook, gate, pavilion base |
| `ground` | 8 | the made surface: kerbs, a corner, single and broad steps, a medallion, verge, runnel, tree grate |
| `water` | 7 | a 34 m reflecting basin and the canal, crossing, cascade, pavilion and pool around it |
| `market` | 6 | the inhabited layer: awning, canopy, arcade, sign, passage, corner shop |
| `details` | 6 | balustrade, newel+urn, gold screen, balcony, pinnacle, oriel |
| `hero` | 2 | `WL_Hero_GreatSpire` (118.2 m), `WL_Hero_Gate_Royal` (48.9 m) |
| `variants` | 9 | the same modules aged, ruined and overgrown — parametrically, not by hand |

**865 legal tower spellings** from 24 tower modules, counted by walking the
socket graph rather than multiplying category sizes — most products are illegal,
so a multiplied figure would be a sales number.
`validation/renders/KIT_spelled_towers.png` shows nine of them and the `.txt`
beside it lists exactly which modules each is made of.

The manifest is `wonderland/art/blender/manifests/wonderland-blender-kit.json`.

---

## What session 2 added, and why each

The first session's own "next five families" list is now complete, and the
reasons it gave still stand. Beyond those:

1. **`stairs` and `gardens` (16 modules).** The reference's ground is layered
   and ours is flat inside every quarter. Every flight is on one riser
   (0.310 m) and arrives on a rung of the route ladder (T1 1.55, T2 3.10,
   T3 6.20 = the wall-walk, T4 9.30), so a generator can connect two levels
   without measuring anything. The one flight that breaks the riser
   (`WL_Stair_Ceremonial`, 0.155 on 0.900) says so in its own params.
2. **`water` (7 modules).** `MI_V2_Water` existed and this library had never
   touched it. `WL_Hero_Water_Court` is a 34 m reflecting basin whose entire
   argument is arithmetic: put the Great Spire at its head and the composition
   is 236 m tall through the camera, and the second 118 m cost one flat quad.
3. **`market` (6 modules).** Not clutter — the brief for it was explicit and
   right. Every module changes a street's OUTLINE at the distance a camera
   stands: an awning breaks a facade with a horizontal, a canopy roofs ground
   that had none, a sign projects into the street, a passage darkens a gap.
4. **`variants` (9 modules), and this is a MECHANISM rather than nine models.**
   `forge/weathering.py` applies age, damage and overgrowth as parameters to a
   module built the ordinary way, so a ruin cannot drift from the thing it is a
   ruin of. See "Variants" below for the socket rule that makes them
   substitutable.
5. **`ground` (8 modules), and it contains no flat paving.** For a flat
   surface a material IS the right answer, and modelling 128 slabs per 8 m
   tile would cost hundreds of triangles to say what `MI_V2_PlazaCream`
   already says. What a material cannot do is RELIEF: a kerb is 15 cm of
   shadow, a runnel is the line that says a surface sheds water, a single
   riser is where two levels meet, a medallion is why a plaza has a centre.
   The whole family is 2,900 triangles.
6. **Style axes in the manifest.** Seven of them, each labelled `measured`,
   `declared` or `derived` — so a generator can ask for slender, monumental,
   open, gold-light, aged, garden, ceremonial and get an answer rather than a
   family name. See "Style" below.

---

## How to bring it in

### 1. Get the meshes

They are **not committed**. The root `.gitattributes` says of `.fbx`/`.glb`:
*"add them here BEFORE the first commit, not after"* — that needs Git LFS, and
introducing this repository's first LFS objects is the founder's decision, not
an asset session's side effect. **Session 2 did not add any**, per its brief.
Build them instead; the build is deterministic and takes two minutes.

### 2. Import

Use `wonderland/art/unreal/import_kit.py` (see "SESSION 2 — DO THIS FIRST"). If
you would rather drive it by hand:

**Prefer FBX.** `exports/fbx/<MeshName>.fbx` stores vertex values in centimetres
with `UnitScaleFactor 1`, Z-up, X-forward. Both ways of reading an FBX therefore
give the same answer, so **Import Uniform Scale stays 1.0** and a 10 m module
lands as 1000 uu. `forge/units.py` records the four-configuration measurement
that settled this. **GLB also works** and is the path this repository already
has (`wonderland/marble/import-marble-world.py: import_glb()`); glTF is metres
and Y-up by specification, so it needs no scale argument.

**Nanite is a MEASUREMENT now, not a default.** `nanite_recommended` is true for
a module at or above 5,000 triangles, false below it, and the manifest carries
the rule in `nanite_rule`. The first import plan asked for Nanite on all 93
assets including a 336-triangle hanging sign, which is exactly the case
`marble/import-marble-world.py`'s own note says Nanite is wrong for. 19 of 93
qualify.

**The destination is `/Game/WonderlandV2/Kit/<family group>`**, and variants sit
in `<group>/Weathered`. That root is new; the existing `Architecture/*` folders
hold assets `build_v2.py` GENERATES and rebuilds, and mixing imported meshes in
would make a rebuild ambiguous about what it owns.

### 3. Assign materials

Every mesh has **exactly one material slot**, because `WonderlandInstancedBatch`
carries one MaterialPath per batch and a second slot would silently render slot
0 everywhere. A module with several materials is several meshes sharing an
origin — the same convention `assets_v2.py` already uses for
`gatehouse_district`/`gatehouse_glass`.

`parts.<key>.material` names an `MI_V2_*` instance that **already exists** in
`wonderland/v2/materials_v2.py`; the validator parses that file and fails if a
name is not in it. Nothing new needs authoring.

| part key | material | notes |
|---|---|---|
| `stone` / `stone_dark` | `MI_V2_IvoryStone` / `MI_V2_Stone` | the pale ashlar, and shadowed masonry |
| `roof` / `roof_alt` | `MI_V2_RoofRose` / `MI_V2_RoofLilac` | the skyline's two roof colours |
| `gold` / `gold_aged` | `MI_V2_Gold` / `MI_V2_GoldAged` | finials and filigree; large ornament |
| `metal` | `MI_V2_Bronze` | railings, ties, awning frames |
| `glass` / `glass_cool` | `MI_V2_GlassAmber` / `MI_V2_GlassTeal` | emissive in V2, so a lantern lights itself |
| `water` / `water_lit` | `MI_V2_Water` / `MI_V2_GlassTeal` | still sheets; falling water, which glows |
| `paving` / `paving_warm` / `paving_shade` | `MI_V2_PlazaCream` / `MI_V2_PlazaWarm` / `MI_V2_PlazaShade` | the walked surface, its second tint, and the dark inlay |
| `kerb` | `MI_V2_Kerb` | kerbs, gutters, tree surrounds -- the edge of the made surface |
| `veg_anchor` | `MI_V2_LeafMid` | **not a plant.** See below. |

**`*_veg_anchor` meshes are optional and you may simply not import them.** They
are the faces the reference plants with ivy, and on a weathered variant they are
the clumps that ageing puts on a ledge. The kit models no foliage on purpose —
`assets_v2._leaf_shell` is better than anything this session would have written.

### 4. Stack them

Every module's **footing is at z = 0** and **+X is its front** — except where
the module says otherwise, which is now a declaration rather than a violation:

- **`excavation_uu` > 0** — the module is cut INTO the datum by that much. Seven
  are: basins have depth, and a reflecting pool whose lowest geometry sat at
  z = 0 would be a tray on the lawn. The validator checks the declared depth
  against the measured one, which is stricter than the old rule, not looser.
- **`mounts_on`** — the module hangs off a facade and foots on nothing. Two are
  (`WL_Market_Awning`, `WL_Market_Hanging_Sign`). Each publishes a `bridge_end`
  socket naming the face that carries it, and the validator requires it.

The stacking rule is one line: **put the next module's origin at the previous
module's `top` socket z.** A tower is `foot → body* → terminator`, and two
modules join when their socket radii are on the same rung of the ladder:

```
XL 680 uu    L 460 uu    M 300 uu    S 180 uu     (tolerance 1 uu)
```

Routes work the same way vertically. `route_ladder_uu` in the manifest gives
T1–T4 and `riser_uu` gives the 31 uu riser; **every `route` socket in the kit is
a whole number of risers above the ground datum or above another route in the
same module**, and the validator enforces it. That is what makes "put a stair
here" a solvable problem rather than a measuring exercise.

Two rules that are not obvious:

- **A `crown` socket with radius 0 is TERMINAL.** Nothing stands on it. Spires
  are an *alternative* terminator on the M rung. On `WL_Tower_Crown_Cone` the
  height at which the cone is 1.8 m wide is a quarter of the way up it, so a
  needle placed there sprouts from the side of the roof.
- **`WL_Bridge_Sky` is authored on its own soffit.** Its deck is 4.02 m above
  its origin, so to land it on towers whose decks are at z, place it at
  z − 4.02 m (402 uu).

### 5. Classify them

`WORLD_LEDGER.md` PASS 38 records what it cost when a whole authored vocabulary
landed in `hierarchy.py`'s `prop` tuple beside the garden benches. So the
manifest states the intended `category` (`module` / `structure` / `landmark` /
`prop`) per asset and you should add the kinds deliberately.

**Watch the prefix matching.** `hierarchy.py` matches on name prefixes and
`LANDMARK_RIDERS` exists because glazing was being counted as separate
landmarks. Every multi-material module exports `<AssetId>` plus
`<AssetId>_glass` / `_gold` / `_roof` / `_veg_anchor`: **count the base mesh,
ride the suffixed ones.**

`import_kit.py` also derives a **data layer** per asset from its family group,
using only names that are in `v2_config.DATA_LAYERS`.

---

## Variants: ageing as a parameter

`forge/weathering.py`. Three independent dimensions, each 0..1:

- **`age`** — surface only. Vertices move along their own normals by value
  noise scaled by EXPOSURE, so copings and parapets lose their arris and
  soffits stay crisp. Erosion is rain and frost; geometry that sees neither
  should not weather.
- **`overgrowth`** — addition only. Up-facing ledges above a minimum area get a
  `veg_anchor` volume standing on them. The kit says WHERE things grow; the
  world says what grows.
- **`damage`** — subtraction. A tilted, ragged cut through the module, capped,
  everything above removed.

**The socket rule, which the validator enforces:** a variant's sockets are a
SUBSET of its base's, and every socket it keeps is at the same z and radius.
`age` and `overgrowth` may not move a join at all — the bands around every join
are frozen before erosion runs, and nothing may be planted in one. `damage` may
only DROP a socket it destroyed, and it records which in
`params.sockets_destroyed`. That is what makes a weathered module safe to
substitute into a spelled stack.

Everything is hashed rather than randomised, so a variant rebuilt tomorrow is
byte-identical, and the deterministic-rebuild check covers variants exactly as
it covers their bases.

`registry.VARIANTS` is the one list. Each line is there because the variant adds
a FORM the kit lacks — a broken mural tower, a ruined colonnade, a balustrade
with its rail gone — not to make the asset count larger.

---

## Style: seven axes, and where each number comes from

`forge/style.py` writes a `style` block per asset and one `style_axes` table at
the top of the manifest saying what each axis means and how it was obtained.
Each runs 0..1 from its first pole to its second.

| axis | 0 → 1 | provenance |
|---|---|---|
| `slender_broad` | slender → broad | measured: height against horizontal diameter, log scale |
| `low_monumental` | low-rise → monumental | measured: absolute height, log scale |
| `open_solid` | open → solid | measured: silhouette fill from three bearings |
| `gold_stone` | gold-light → stone-heavy | measured: share of surface AREA in gold/glass/emissive parts |
| `pristine_aged` | pristine → aged | declared: the weathering recipe's own numbers |
| `garden_urban` | garden → urban | derived: from the districts the module declares |
| `ceremonial_residential` | ceremonial → residential | derived: from the kit's own category and role |

**`open_solid` is genuinely measured.** The geometry is rasterised by ray
casting from three bearings, the holes each silhouette ENCLOSES are found by
flooding the outside, and the axis is filled area over filled-plus-enclosed
area. `WL_Tower_Base_Arcaded` earns its openness from the sky visible through
it, not from its family name.

**An axis that cannot be established is `null`** and renders as Unknown. Never
0, which on a 0..1 axis would be a confident claim of one pole.

---

## Placement recipes, and what they are not

`manifests/wonderland-placement-recipes.json`, written by
`scripts/make_recipes.py`, rendered by `scripts/render_assemblies.py`.

Six compositions. Every position is COMPUTED from the manifest's measurements: a
stack's storeys sit at the `top` socket heights measured off the geometry, a
canal is laid at the canal module's own length so its ends butt, the upper
terrace sits at the cascade's measured `top_route`. Then every recipe is
CHECKED — stacks agree on the ladder, butts touch, footprints do not clash
unless a placement declares what it `abuts` — and the checks caught three real
errors while the recipes were being written, including two rings of towers
spaced by circumference over 2π, which is the n → ∞ approximation and put a
two-stack ring's 19 m feet 16 m apart.

**They are proposals in a file.** World placement belongs to the world session;
nothing here has touched a map, a layout or the HUD.

---

## What was validated, and how

`python3 scripts/validate_assets.py` → **93 assets checked, 0 failures.**
`--self-test` manufactures gaps and proves the checks catch them.

| check | what it caught |
|---|---|
| export agrees with the mesh (GLB and FBX re-opened, FBX read both ways) | two assets whose exports were stale after a geometry fix |
| one material slot per mesh; the `MI_V2_*` name exists in the real `materials_v2.py` | — |
| ground datum: footing at z = 0, or a declared `excavation_uu` matching the measurement, or a declared `mounts_on` with a `bridge_end` socket | 6 water modules that were excavations rather than errors; 2 market modules that hang off a facade |
| socket radii on the ladder; a foot/body has geometry AT its top socket | the belfry stage declared a socket 4.4 m above where its masonry stopped |
| every rung a body can leave you on has a terminator | the XL rung had none after a crown became a body |
| **coplanar overlapping surfaces, up-facing, across ALL parts** | **16 modules**, including both deck approaches of `WL_Bridge_Arc` rendering solid black in a committed contact sheet. See below. |
| coincident faces sharing a centre, same normal direction | `tower_base_terraced`'s terrace discs; then 8 more across the kit |
| no inverted closed shells (signed volume per shell) | `WL_Tower_Mid_Oriel`'s bay hoods; then 4 balusters of the broken balustrade after a bisect |
| socket GRAMMAR: names from `kit.SOCKET_NAMES`, both halves of a pair, a butt plane with masonry on it, a route on a whole riser, a span level at both ends | 20 findings: 4 socket notes naming a plane the geometry never reached, 4 routes out by 1–3 cm, a `route` socket that was really a clearance, 5 runs joinable from one side only |
| variant sockets are a subset of the base's, at the same places | — |
| no degenerate faces, loose verts, zero normals; triangle budget; deterministic rebuild | — |
| coverage: the set of validated assets equals the set in the manifest, both ways | — |

### The one worth reading about

`WL_Bridge_Arc` rendered with both deck approaches SOLID BLACK — 24.9 m² of
spandrel wall lying in exactly the plane of the deck slab above it, facing the
same way, on an asset that had passed every check and whose contact sheet was
committed.

**Why black rather than a flicker.** In a rasteriser coincident faces shimmer.
In Cycles they go black: a ray lands on one surface and the shadow ray it sends
towards the sun immediately hits the other one a hair away, so the surface
shadows itself completely. Every solid-black panel in this kit's history is
that.

The check that existed compared faces sharing a CENTRE, per object, and both
halves were wrong. Per object, because the renderer does not care which mesh a
face came from and the kit's house style puts a darker wearing course in its own
part on top of every walk. Sharing a centre, because a small course inset on a
big slab shares neither centre nor area with it.
`validate_assets.coplanar_overlaps` now buckets faces by quantised PLANE, unions
faces that share a vertex into one surface, tests overlap by point-in-polygon
rather than bounding box, and reports only UP-FACING surfaces — which takes the
kit from 448 raw hits to 52, every one of them real.

The remedy in the geometry is `elements.wear_course`: a course is laid PROUD of
its slab, because the one thing it may never be is flush.

**One class still needs a render.** Two surfaces coplanar, same-facing and only
partly overlapping on a VERTICAL plane are outside the up-facing restriction.
`build_assets.py --surface-check` renders each family against a bright magenta
world: **a hole shows magenta, two fighting surfaces show black with a moiré.**

### Performance

`python3 scripts/report_performance.py` → `validation/PERFORMANCE_REPORT.json`.
Counts, triangles per metre of height (the silhouette measure), and a MEASURED
hidden-area share: the fraction of each module's surface no ray from outside can
reach. That is the price of building by union rather than by boolean; it is the
same price that makes these meshes manifold; nothing removes it, and the report
says which modules would gain most if a union pass is ever wanted.

---

## What is unproven

- **No Unreal Engine binary exists on this host.** Nothing here has been
  imported, cooked, packaged or seen in an Unreal frame. `import_kit.py --plan`
  has run; `--execute` has not, and its `proven` block says so.
- **Nanite and collision are recommendations.** `nanite_recommended` is now
  derived from a measured triangle count and a stated rule, which is better than
  a default and is still not a profile.
- **The UVs are a planar world projection at 2 m per tile, not a lightmap
  unwrap.** The V2 materials are procedural so this is enough for them.
- **The renders are Blender/Cycles with the V2 palette on a Principled BSDF and
  a two-light rig.** They show form, proportion, silhouette and the
  stone/gold/roof balance. They are **not** a preview of an Unreal frame: no V2
  material graph, no Lumen, no sky, no fog.
- **Nothing has been placed.** No `layout_v2.py` change, no district assignment,
  no audit re-run. `districts` is a suggestion from the module's character.
- **The assemblies show modules meeting, not terrain.** A terrace edge is an
  edge; the ground behind it is the world session's, and the recipes say so.

---

## Files

| | |
|---|---|
| the handoff | `wonderland/art/blender/manifests/wonderland-blender-kit.json` |
| the first import | `wonderland/art/blender/manifests/wonderland-first-unreal-proof.json` |
| the compositions | `wonderland/art/blender/manifests/wonderland-placement-recipes.json` |
| the importer | `wonderland/art/unreal/import_kit.py` (+ `import_kit_offline_test.py`) |
| the contract | `wonderland/art/blender/README.md` |
| why each family exists | `wonderland/art/blender/references/GAPS.md` |
| validation | `wonderland/art/blender/validation/VALIDATION_REPORT.json` |
| performance | `wonderland/art/blender/validation/PERFORMANCE_REPORT.json` |
| renders | `wonderland/art/blender/validation/renders/KIT_*.png`, `ASSEMBLY_*.png` |
| the art | `wonderland/art/blender/scripts/forge/families/*.py` |
| the kernel | `wonderland/art/blender/scripts/forge/{units,kit,mesh,elements,export,preview,style,weathering,registry}.py` |

---

## Next families, highest impact first

Session 1's list is complete. What is left, in the order I would take it:

1. **Interiors of the thresholds.** Every gate in this kit is a solid you walk
   past; none has a passage you walk THROUGH with a ceiling over you. A gate is
   the one module a player is guaranteed to be inside.
2. **A LOD story.** Everything here is authored at one density, and the density
   suits a camera at 30 m. `report_performance.py` says which modules are
   spending triangles a distant camera cannot resolve; a second, coarser
   spelling of the crowns would matter most, since a skyline is mostly crowns.
3. **Cobbled and unmade ground.** `families/ground.py` gives a plaza its kerbs
   and its runnels; what it does not give is the OTHER surface -- the cobble
   the reference's lanes are laid in, which `MI_V2_Cobble` already exists for.
4. **A second roof language.** Everything is rose or lilac tile. The reference
   has lead, copper and thatch in its middle distance, and the palette has room.
5. **Night.** `glass` and `water_lit` are emissive in V2 and no module has been
   composed for the dark. A lantern module, a lit undercroft, and a version of
   the market street that reads at night would test the emissive palette the
   world already has.
