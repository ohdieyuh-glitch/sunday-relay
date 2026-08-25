# The Wonderland HD pipeline

**Branch:** `relay/wonderland-hd-rebuild`. **Scope:** the Golden Arrival
District as seen from HeroCam6, and the pipeline that makes it possible.
Everything under `infra/build/hd/` runs on a laptop with no engine, no GPU and
no third-party Python — deliberately, because the GPU costs the founder money
per minute and every check that can be free must be free.

## The finding that reset the approach

Until this branch, every visible thing in Wonderland resolved to one of five
engine meshes — `/Engine/BasicShapes/{Cube, Cylinder, Cone, Sphere, Plane}`
— and the repository contained **zero** `.uasset` files. The founder's list of
unacceptable characteristics ("obvious cubes", "cone roofs", "sphere/blob
trees", "crude mushrooms", "simplistic gold geometry") was therefore not a
description of a styling problem. It was an exact description of the asset
library, which is why no colour, bloom, density or scatter pass ever moved it.

The pipeline is now the one the brief prescribes:

    HIGH-QUALITY ASSETS -> COHERENT MATERIALS -> AUTHORED COMPOSITION
    -> PROCEDURAL ASSISTANCE -> LIGHTING -> ATMOSPHERE -> VFX -> OPTIMISATION

## What is in `hd/`

| file | what it is |
|---|---|
| `meshkit.py` | a stdlib-only geometry kernel: chamfered boxes, lathes with profile helpers (ogee, bell, scallop), lofts, parallel-transport tubes, tori, ear-clipped prisms, fbm displacement, vertex-cluster decimation with fold-over rejection, LOD chains, deterministic hashing so a build is byte-identical on every machine |
| `assets.py` | the 58-asset library, each registered with tier, default material, Nanite flag, fit convention; `FALLBACK` (the primitive each key falls back to) and `SILHOUETTE` (how the offline tracer draws it) |
| `ue_bridge.py` | builds each asset as a `UStaticMesh` with its full LOD chain inside the editor, then **reads the triangle count back off the finished asset** and rejects any that disagrees — because the offline `unreal` stub cannot prove a single API name |
| `validate.py` | Phase F's mechanism: per-asset tier, tris per LOD, material slot, Nanite flag (reported as INERT), bounds, fit, collision, material-exists, fallback/silhouette/folder consistency, and structural checks (missing vertices, zero-area triangles, fold-overs) |
| `render_sheet.py` | a software rasteriser that draws the authored triangles to a labelled contact sheet — the only free look at the *form* of an asset |
| `layout_tools.py` | Phase S: `Spline` (Catmull-Rom, arc-length), `lay_stones()` (running-bond setts, aligned, elevation-following, provably non-overlapping), Data Layer classification, tag/folder/spline-actor helpers |
| `border.py` | Phase T: the three-band path border (edge / mid / outer) with exclusion width, per-family scale and rotation variance, seed, and a keep-out callback |

## Content hierarchy (Phase C)

Assets build to `/Game/Wonderland/HD/<folder>/SM_<name>`, folder from
`ue_bridge.FOLDER`: `Architecture/{Castle,Gates,Bridges,Stairs,Trim}`,
`Ground/Cobblestone`, `Vegetation/{Trees,Shrubs,Flowers,Vines,Topiary}`,
`Mushrooms`, `Props/{Tea,Clocks,Keys,Garden}`. Materials stay where the
generator has always built them (`/Game/Wonderland/Materials`); `hd/` adds
names, not a second material system.

## Tiers (Phase D)

`S` singleton landmark (the arrival arch, 12,000 tris) · `A` hero ≤ 4,200 ·
`B` midground ≤ 3,000 · `C` distant ≤ 500. `validate.py` fails a build that
overruns. Tier C assets keep the silhouette that scales with the object (an
ogee, an eave) and drop the detail that does not (a 12 uu shingle at 25 km
subtends 0.0007 px).

## How the generator uses it

1. At import, every HD key is registered in `PLACEHOLDER_MESH` against its
   fallback primitive, so a key always resolves.
2. Inside `build()`, `ue_bridge.build_hd_meshes()` runs and overwrites the
   entries whose assets verified. The log line is `HD_MESHES built=… verified=…
   rejected=…`; every rejection is named with its reason.
3. Each kit asks `hd_ok(key)` before it deletes the workaround it used to need
   (the fake roof ribs, the root cubes, the voxel canopy). If the HD mesh did
   not build, the fallback world comes back — visibly the old one, explained
   by one log line, never an empty one.

`WONDERLAND_HD=0` disables the whole thing for one cook.
`WONDERLAND_HD_ASSUME=1` makes the offline harnesses register the asset paths
without building anything, so the composition tracer looks at the HD world
rather than the fallback; it never affects a real cook.

## Nanite (Phase F) — the honest line

**Inert on this target, by measurement.** `Config/DefaultEngine.ini` targets
`SF_VULKAN_SM5` only; SM6 halved the L4's frame rate for a visually identical
frame, and Nanite needs SM6. The flag is set on 48 of 58 assets because it is
correct and costs nothing, and it is **never reported as quality**. What
actually carries the geometry budget is the LOD chain every HD asset ships —
which the engine primitives could not (one LOD each, ~1,900 tris per Sphere,
50,285 Spheres ≈ 95 M tris/frame at any distance).

## RVT (Phase J) — deferred, with the masters prepared

Not enabled. The project has no Landscape (the ground is meshes), no
`VirtualTexturing` setting, and a plain level. The right foundation is a
Landscape or a mesh-ground writing to an RVT with `M_WLMaster` sampling it for
the blend; adding either without a render cycle to verify it would be exactly
the class of change that has taken builds down before. Recorded as the first
material step for the next GPU session.

## Materials (Phases H, I)

Measured against the HD reference by **pixel population**, never by region
mean (see `MATERIAL_SPEC` in the generator for the table). New: `ivory`,
`bark`, `cobble_hero`, `roof_coral`, `mush_stem`, `mush_spot`, `card_white`;
corrected hue on `spire`, `spire_far`, `cobble*`, `trunk`, `foliage*`,
`mush_red`, `gold`. `cobble_hero` is the hero path material on the shared
cobble sheet. The cracks / moss / petals / wetness / magic-mask **layers** are
not in the master graph — that graph is authored from Python and the last
unseen graph change took a build down; they are the next material step.

## World Partition, Data Layers, HLOD

- **World Partition:** the level is a plain map, generated headlessly; not
  converted (the brief says not to unless necessary). The HD content is
  modular, foldered and tagged, which is what a later conversion needs.
- **Data Layers:** every batch actor now carries a tag from
  `HD_ARRIVAL / HD_GARDEN / HD_CASTLE / HD_DISTANT / HD_VFX / HD_PROPS /
  HD_VEGETATION` (log line `DATA_LAYER_TAGS …`) and an outliner folder from
  the HD hierarchy. Real Data Layer assets need a WP world; the tags are the
  form that conversion reads back.
- **HLOD:** not generated. The skyline is already Tier-C meshes per tower;
  merged castle proxies are a straightforward next step because the towers
  are now per-instance meshes with LODs rather than primitives.

## Global pulse (Phase W)

Already removed before this branch and **gated**: `verify-static-environment.py`
proves every WPO output sits behind an `Animated` static switch defaulting
off, and that only the Dog coats are on the allow-list. The HD assets add no
motion. Motion that IS allowed: foliage wind (none authored yet), the Dogs,
and the new hover component below.

## Hover (Phase V)

`UWonderlandHoverComponent` (bounded, asynchronous by location hash, one sine
per prop) and `AWonderlandHoverProp` (the actor Python spawns for it). The
three sky keys and the teapot use it; nothing else. `WONDERLAND_LOOK=hoverActors=0`
puts them back in the batches.

## Portal (Phase U)

The ground circle is the runes material on real geometry rings with a
localised violet `HeroLight_Arcane` at the Dog; the rising cross-sparks are
instanced geometry on the Bob WPO with per-instance phase. Niagara systems
are editor-authored assets Python cannot build — the node-by-node spec is in
`../TASK5-NIAGARA.md`, and placing them once they exist is ordinary generator
work.

## Lighting and grade (Phases X, Y, Z)

Golden-hour foundation was already in the layout (`sunElevationDeg` 30,
5400 K, fog, sky atmosphere, sky light, Lumen on). Phase Y adds a per-range
grade on the **camera's** PostProcessSettings — the level volume is proven not
to reach this render — as `gradeShadows / gradeMidtones / gradeHighlights`,
all inside ±8 %. Bloom stays conservative (1.5 / 0.8).

## Running it

    cd wonderland/infra/build
    python3 hd/validate.py                          # the library, structurally
    python3 hd/render_sheet.py /tmp/sheet.png       # the library, visually
    python3 verify-generator-dryrun.py              # the generator executes
    python3 verify-hero-composition.py /tmp/hero.png   # composition, HD world

Then the Lightning path unchanged (`prepare.sh` gates → `cpu-build-all.sh` on
CPU → `native-shot.sh` with the GPU ON for the capture only).

## What a render will tell us that nothing here can

Whether the ogee roofs, the wreath, the gate scrolls and the flagstones READ
under the real light; whether the LOD chains pop; whether the materials'
hues land. The offline tools answer composition and form. The founder's eye
answers acceptance.
