# Wonderland — Blender asset forge, current

**This file is the handoff to the Unreal world session.** It says what exists,
what it is for, exactly how to bring it in, and what has *not* been proven.
`docs/handoffs/WONDERLAND_WORLD_CURRENT.md` is the world's recovery point; this
is the art library's.

| | |
|---|---|
| SESSION | 2026-09-07 — Blender asset forge, first pass |
| BRANCH | `claude/wonderland-blender-forge-pjinco`, cut from `origin/relay/wonderland-v2` at `0b07f0f` |
| SCOPE | `wonderland/art/blender/**` and this file. Nothing else in the repository was touched. |
| LOCK | `wonderland/.gauntlet-lock` = `writer=claude`, read before writing, unchanged. `wonderland/art/` is unowned by `gauntlet-check.py` (shared). |
| BLENDER | `bpy` 4.5.13 LTS, installed via pip. Real Blender, headless — the same bmesh, the same exporters, Cycles on CPU. |
| RENDERED | **Yes.** Six Cycles contact sheets in `wonderland/art/blender/validation/renders/`. No Unreal frame — see "What is unproven". |

---

## What exists

**44 assets, 119 meshes, 226,204 triangles.** All built, all exported to GLB and
FBX, all validated, 0 failures.

| group | assets | what it answers |
|---|---|---|
| `towers` | 24 | the skyline. 4 feet, 8 bodies, 7 crowns, 5 spires |
| `thresholds` | 6 | 4 arches, 2 gatehouses — the things you walk through |
| `civic` | 6 | 3 colonnades, 3 bridges — the horizontals |
| `details` | 6 | balustrade, newel+urn, gold screen, balcony, pinnacle, oriel |
| `hero` | 2 | `WL_Hero_GreatSpire` (118.2 m), `WL_Hero_Gate_Royal` (48.9 m) |

**692 legal tower spellings** from 24 tower modules, counted by walking the
socket graph rather than multiplying category sizes — most products are
illegal, so a multiplied figure would be a sales number.
`validation/renders/KIT_spelled_towers.png` shows nine of them, and the `.txt`
beside it lists exactly which modules each is made of.

The manifest is `wonderland/art/blender/manifests/wonderland-blender-kit.json`.

---

## The reference gaps this closes

Long form in `wonderland/art/blender/references/GAPS.md`. In short, from the one
honest reference pair (`marble-royal-garden-cam0-founder-reference.png` against
`V2_MILESTONE26_HeroCam0_1080p.png`):

1. **The skyline is needles and there were no needles.** The reference's
   dominant unit is a slender shaft under a very tall thin roof; ours is a
   squat drum under a wide one. This is not placement or material — `assets_v2`
   contains no needle, so there was nothing to place. The kit adds 5 spires and
   7 crowns, every crown taller than it is wide.
2. **The reference's towers are pierced; ours are solid.** Light comes through
   its galleries. `elements.arcade_ring` builds real openings (piers with arches
   between them, not holes cut from a drum) and 6 assets use it.
3. **A huge gold lattice, with no equivalent at any scale.** Three assets now
   carry `elements.filigree_panel` at three sizes.
4. **The foreground is a balustrade** and it does more work in that picture than
   any tower. `WL_Detail_Balustrade_Run` + `WL_Detail_Newel_Urn`.
5. **The city is connected.** `WL_Bridge_Sky` publishes `bridge_end` sockets so
   a generator can find two towers to join.
6. **The threshold is an event.** 22 m of clear opening on `WL_Hero_Gate_Royal`.
7. **The ogee** is the reference's actual line — 14 assets use it.
8. **Mushroom architecture belongs in the skyline**, not only on the ground:
   `WL_Tower_Crown_Cap`.

---

## How to bring it in

### 1. Get the meshes

They are **not committed**. The root `.gitattributes` says of `.fbx`/`.glb`:
*"add them here BEFORE the first commit, not after"* — that needs Git LFS, and
git-lfs was not installed in the container that produced them. Introducing this
repository's first LFS objects is the founder's decision, not an asset session's
side effect.

```bash
python3 -m pip install bpy==4.5.13
cd wonderland/art/blender
python3 scripts/build_assets.py      # ~3 min -> exports/glb, exports/fbx, manifest, renders
python3 scripts/validate_assets.py   # must exit 0
```

The build is **deterministic** — `validate_assets.py` rebuilds every module in a
clean scene and compares mesh hashes, and the hashes are in
`validation/VALIDATION_REPORT.json`. You will get byte-identical files.

If you would rather have them in git, `wonderland/art/blender/README.md` has the
exact order (install git-lfs → extend the root `.gitattributes` → drop the
`exports/` ignore → add). Not the other way round.

### 2. Import

**Prefer FBX.** `exports/fbx/<MeshName>.fbx` stores vertex values in
centimetres with `UnitScaleFactor 1`, Z-up, X-forward. Both ways of reading an
FBX therefore give the same answer, so **Import Uniform Scale stays 1.0** and a
10 m module lands as 1000 uu. `forge/units.py` records the four-configuration
measurement that settled this.

**GLB also works** and is the path this repository already has:
`wonderland/marble/import-marble-world.py: import_glb()` drives an
`AssetImportTask` with `InterchangeGenericAssetsPipeline` and Nanite. glTF is
metres and Y-up by specification, so it needs no scale argument.

Per asset the manifest gives `nanite_recommended` (true for all — dense, static,
opaque, no world-position offset) and `collision_recommended` (true for anything
you can walk through or on).

### 3. Assign materials

Every mesh has **exactly one material slot**, because `WonderlandInstancedBatch`
carries one MaterialPath per batch and a second slot would silently render slot
0 everywhere. A module with several materials is several meshes sharing an
origin — the same convention `assets_v2.py` already uses for
`gatehouse_district`/`gatehouse_glass`.

`parts.<key>.material` in the manifest names an `MI_V2_*` instance that
**already exists** in `wonderland/v2/materials_v2.py`; the validator parses that
file and fails if a name is not in it. Nothing new needs authoring.

| part key | material | notes |
|---|---|---|
| `stone` / `stone_dark` | `MI_V2_IvoryStone` / `MI_V2_Stone` | the pale ashlar, and shadowed masonry |
| `roof` / `roof_alt` | `MI_V2_RoofRose` / `MI_V2_RoofLilac` | the skyline's two roof colours |
| `gold` / `gold_aged` | `MI_V2_Gold` / `MI_V2_GoldAged` | finials and filigree; large ornament |
| `metal` | `MI_V2_Bronze` | railings, ties |
| `glass` / `glass_cool` | `MI_V2_GlassAmber` / `MI_V2_GlassTeal` | emissive in V2, so a lantern lights itself |
| `veg_anchor` | `MI_V2_LeafMid` | **not a plant.** See below. |

**`*_veg_anchor` meshes are optional and you may simply not import them.** They
are flat strips on the faces the reference plants with ivy, set just inside the
wall so they are invisible if nothing is scattered on them. The kit models no
foliage on purpose — `assets_v2._leaf_shell` is better than anything this
session would have written, and duplicating it is the exact mistake this
repository's `CLAUDE.md` opens with.

### 4. Stack them

Every module's **footing is at z = 0** and **+X is its front**. Modules publish
sockets; `sockets[].z_uu` and `radius_uu` are measured, not declared.

The stacking rule is one line: **put the next module's origin at the previous
module's `top` socket z.** A tower is `foot → body* → terminator`, and two
modules join when their socket radii are on the same rung of the ladder:

```
XL 680 uu    L 460 uu    M 300 uu    S 180 uu     (tolerance 1 uu)
```

`compatible_*` is not stored per asset because it is computable: `rung` on each
socket is what you match. `manifests/…json → counts.rung_coverage` shows how
many bodies leave you on each rung and how many terminators fit it.

Two rules that are not obvious:

- **A `crown` socket with radius 0 is TERMINAL.** Nothing stands on it. Spires
  are an *alternative* terminator on the M rung, not something you add to a
  crown. That is what the founder reference draws (a shaft with ONE tall roof)
  and it is also what the geometry allows — on `WL_Tower_Crown_Cone` the height
  at which the cone is 1.8 m wide is a quarter of the way up it, so a needle
  placed there sprouts from the side of the roof.
- **`WL_Bridge_Sky` is authored on its own soffit**, like everything else. Its
  deck is 4.02 m above its origin, so to land it on towers whose decks are at
  z, place the module at z − 4.02 m (402 uu). It was first authored at its
  intended 26 m and that was wrong: 26 m is a fact about the towers, not the
  bridge.

### 5. Classify them

`WORLD_LEDGER.md` PASS 38 records what it cost when a whole authored vocabulary
landed in `hierarchy.py`'s `prop` tuple beside the garden benches — 383
landmarks became 401 once it was repaired, and every arch/ha figure written
before that under-reports.

So the manifest states the intended classification per asset (`category`:
`module` / `structure` / `landmark` / `prop`) and you should add the kinds to
`hierarchy.py`'s tuples deliberately:

- `landmark` — `WL_Hero_GreatSpire`, `WL_Hero_Gate_Royal`
- `ARCH` — every `WL_Tower_*`, `WL_Arch_*`, `WL_Gatehouse_*`, `WL_Colonnade_*`,
  `WL_Bridge_*`, `WL_Spire_*`, `WL_Detail_Screen_Filigree`,
  `WL_Detail_Pinnacle_Grand`
- `prop` — `WL_Detail_Balustrade_Run`, `WL_Detail_Newel_Urn`,
  `WL_Detail_Balcony_Bracket`, `WL_Detail_Oriel_Bay`

**Watch the prefix matching.** `hierarchy.py` matches on name prefixes and
`LANDMARK_RIDERS` exists because glazing was being counted as separate
landmarks. Every multi-material module here exports `<AssetId>` plus
`<AssetId>_glass` / `_gold` / `_roof` / `_veg_anchor`, which is exactly that
shape: **count the base mesh, ride the suffixed ones.** Otherwise every tower in
Wonderland gets counted three or four times, which is the bug PASS 38 fixed for
mushrooms.

---

## What was validated, and how

`python3 scripts/validate_assets.py` → **44 assets checked, 0 failures.**
Report: `wonderland/art/blender/validation/VALIDATION_REPORT.json`.

| check | what it caught while building this kit |
|---|---|
| export agrees with the mesh (GLB and FBX re-opened and compared, FBX read both ways) | two assets whose exports were stale after a geometry fix |
| one material slot per mesh | — |
| the `MI_V2_*` name exists in the real `materials_v2.py` | — |
| footing at z = 0 | 3 assets: the skybridge authored at 26 m, an oriel starting at 0.30 m, a gate screen reaching 0.15 m below ground |
| socket radii on the ladder | — |
| a foot/body has geometry AT its top socket | the belfry stage declared a socket 4.4 m above where its masonry stopped |
| every rung a body can leave you on has a terminator | the XL rung had none after a crown became a body; the first spelling test drew a tower with an open top |
| no coincident coplanar faces | `tower_base_terraced` laid a full disc on each terrace top — every terrace rendered solid black |
| no inverted closed shells (signed volume per shell) | `WL_Tower_Mid_Oriel`'s three bay hoods, from an open partial-revolve `recalc_face_normals` had no outside to point at |
| no degenerate faces, loose verts, zero normals | — |
| triangle budget per asset | — |
| deterministic rebuild (mesh hashes) | — |

Four further defects were found **by looking at renders**, not by any check:
filigree panels lying flat on their backs, an attic floating over an unfilled
spandrel, a torn spandrel web under the royal gate's arch, and the black
terraces. That is why `build_assets.py` renders by default.

---

## What is unproven

Stated plainly, in the style `WONDERLAND.md` uses:

- **No Unreal Engine binary exists on this host.** Nothing here has been
  imported, cooked, packaged or seen in an Unreal frame. The FBX unit contract
  is verified against the *file* (its `UnitScaleFactor` and raw vertex values
  were decoded, and both readings agree); the claim that Unreal reads it that
  way is standard and untested here.
- **Nanite, collision and lightmap behaviour are recommendations**, not
  measurements. `nanite_recommended` reflects the shape of the geometry, not a
  profile.
- **The UVs are a planar world projection at 2 m per tile, not a lightmap
  unwrap.** The manifest says so. The V2 materials are procedural
  (`materials_v2.py` builds them from a kind and a colour) so this is enough
  for them; a texture-mapped material would want a real unwrap.
- **The renders are Blender/Cycles with the V2 palette's base colours on a
  Principled BSDF and a two-light rig.** They show form, proportion, silhouette
  and the stone/gold/roof balance. They are **not** a preview of an Unreal
  frame: no V2 material graph, no Lumen, no sky, no fog, none of the world's
  lighting.
- **Nothing has been placed.** No `layout_v2.py` change, no district assignment,
  no audit re-run. `districts` in the manifest is a suggestion from the module's
  character, not a placement.

---

## Files

| | |
|---|---|
| the handoff | `wonderland/art/blender/manifests/wonderland-blender-kit.json` |
| the contract | `wonderland/art/blender/README.md` |
| why each family exists | `wonderland/art/blender/references/GAPS.md` |
| validation | `wonderland/art/blender/validation/VALIDATION_REPORT.json` |
| renders | `wonderland/art/blender/validation/renders/KIT_*.png` |
| the art | `wonderland/art/blender/scripts/forge/families/*.py` |
| the kernel | `wonderland/art/blender/scripts/forge/{units,kit,mesh,elements,export,preview}.py` |

## Next five asset families, highest impact first

1. **Curtain wall + mural towers.** The kit has colonnades but no defensible
   wall, so a generator cannot draw the city's *edge* — which is what makes a
   city read as a place rather than a cluster.
2. **Roofscape: gables, dormers, chimneys, a hipped-roof house body.** Every
   module here is a tower or a monument; the reference's middle distance is
   mostly small buildings and the hamlet has no roof vocabulary beyond a cone.
3. **Stairs and terracing as modules**, sized to pass `walkable.py`'s step-height
   audit, so the generator can build the reference's layered ground.
4. **A water-garden hero.** Both heroes are dry and vertical; the
   `water_garden` quarter has nothing singular in it, and `MI_V2_Water` is a
   material this kit never touches.
5. **Damaged and overgrown variants** of four or five existing bodies. One extra
   parameter each would roughly double the apparent vocabulary at almost no
   authoring cost, and break the regularity a purely modular city drifts toward.
