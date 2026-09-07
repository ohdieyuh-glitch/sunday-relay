# The Wonderland Blender asset forge

Bespoke geometry for Wonderland, authored in Blender Python and exported for
Unreal. **Blender is an asset forge here, not the world engine** — nothing in
this directory places anything, lights anything, or knows where a district is.
Unreal keeps world layout, traversal, streaming, lighting, materials, Julius
and runtime behaviour. This gives the Unreal generator better things to place.

```
wonderland/art/blender/
  scripts/
    forge/            the kernel: units, kit grammar, bmesh helpers, elements
    forge/families/   THE ART. one module per asset family:
                        towers, thresholds, civic, walls, roofscape,
                        details, hero
    build_assets.py   build everything, export, measure, write the manifest
    validate_assets.py  fail loudly on an invalid asset
  references/GAPS.md  which reference gap each family answers
  exports/glb|fbx     generated meshes (gitignored -- see below)
  source/             generated .blend files (gitignored)
  manifests/          wonderland-blender-kit.json  <- the handoff
  validation/         VALIDATION_REPORT.json and the render sheets
```

## Run it

```bash
python3 -m pip install bpy==4.5.13        # this IS Blender 4.5 LTS, headless
cd wonderland/art/blender
python3 scripts/build_assets.py           # ~3 min: build, export, manifest, renders
python3 scripts/validate_assets.py        # exit 0 only if every asset passes
```

There is no Blender executable and none is needed. `bpy` is the full
application as a Python module: the same bmesh, the same FBX/glTF exporters,
the same Cycles. Renders are Cycles on CPU — EEVEE and Workbench need an EGL
surface this container has no library for.

## The two rules that shape everything

**1. Search before you build.** This repository's `CLAUDE.md` opens with it and
it applied here too. `assets_v2.py` already contains 200+ excellent complete
objects and `meshkit.py` is a capable geometry kernel. This kit does not
duplicate either. What it adds is a *grammar* — parts that recombine — which is
the thing the existing library, by being made of finished objects, cannot be.

**2. Measure, do not claim.** No dimension in the manifest was typed by a
human. Every one is read off the emitted mesh, and the exported GLB and FBX are
re-opened and checked against it. A builder that says its crown is 13.4 m tall
while the geometry stops at 11.06 m is a bug, and the validator says so.

## The kit grammar in one paragraph

Modules publish `bottom` and `top` sockets whose radii sit on a four-rung
ladder (`XL` 6.80 m, `L` 4.60 m, `M` 3.00 m, `S` 1.80 m). A tower is
`foot -> body* -> terminator`, and two modules join when their socket radii are
on the same rung. Crowns are terminal (radius 0, "the stack ends here"); spires
are an *alternative* terminator on the M rung rather than something you stack on
a crown, because the geometry refused the other grammar — see the `TERMINAL`
note in `families/towers.py`. `build_assets.py` counts the legal spellings by
walking the graph, so the number in the manifest moves when a socket changes.

## Conventions, all asserted by `validate_assets.py`

| | |
|---|---|
| authoring | metres, Z up, **+X is the module front** |
| origin | every module's footing at **z = 0** |
| manifest | Unreal units (1 uu = 1 cm) |
| GLB | glTF 2.0 binary, metres, Y-up per spec. The format `wonderland/marble/import-marble-world.py: import_glb()` already imports. |
| FBX | binary, vertex values in **centimetres** with `UnitScaleFactor 1`, Z-up, X-forward. Both readings agree, so Unreal's Import Uniform Scale stays 1.0. The measurement that settled this is in `forge/units.py`. |
| materials | **one slot per mesh.** A module with several materials exports one mesh per material, sharing an origin. Names are `MI_V2_*` instances that already exist in `wonderland/v2/materials_v2.py`. |
| UVs | planar world projection at 2 m per tile. **Not a lightmap unwrap** and the manifest does not claim to be one. |

The one-slot rule is not a preference. `meshkit.py`'s docstring states it: the
world draws through `WonderlandInstancedBatch`, which carries one MaterialPath
per batch, so a second slot would silently render slot 0 everywhere.

## Why `exports/` and `source/` are gitignored

The repository's own `.gitattributes` says, of `.fbx` / `.glb`: *"If the
pipeline later imports .fbx / .glb source meshes, add them here BEFORE the
first commit, not after."* That is the right instruction and it needs Git LFS.
**git-lfs is not installed in the session container that produced this kit**,
and introducing this repository's first LFS objects — with a push that could
leave pointer files without their objects — is not a change to make without the
founder deciding it.

So the meshes are not committed, and nothing is lost by that: the validator
proves the build is **deterministic** (every module rebuilt in a clean scene
hashes identically), so `python3 scripts/build_assets.py` reproduces byte-identical
files in about three minutes. `validation/VALIDATION_REPORT.json` carries the
per-mesh hashes, so a future run can prove it got the same geometry.

**To commit the meshes instead**, in this order: install git-lfs, add
`*.glb` and `*.fbx` to the root `.gitattributes` with the same
`filter=lfs diff=lfs merge=lfs -text` form as `*.uasset`, then remove the
`exports/` line from `wonderland/art/blender/.gitignore`, then add the files.
Never the other way round.

## Adding a family

1. Write the gap first. `references/GAPS.md` is the list of observed
   differences between the founder reference and what we render; an asset that
   answers none of them makes the world bigger without making it closer.
2. Spell it from `forge/elements.py`. If you need a new element, put it there
   rather than in the family — a kit whose modules each invent their own column
   reads as a kit.
3. Return a `kit.ModuleSpec`. Do not state a dimension; the pipeline measures.
4. Add the builder to that family's `BUILDERS` tuple.
5. `build_assets.py`, then `validate_assets.py`, then **look at the render.**
   Four of the defects fixed while building this kit were invisible in the
   numbers and obvious in a picture: filigree panels lying flat, an attic
   floating over an unfilled spandrel, a torn spandrel web under an arch, and
   every terrace of `tower_base_terraced` rendering solid black.
