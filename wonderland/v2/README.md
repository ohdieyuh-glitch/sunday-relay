# Wonderland V2 — a new world from an empty level

**Branch:** `relay/wonderland-v2` (from `667fbf9`, the technical base).
**V1 (legacy):** `relay/wonderland-hd-rebuild` @ `667fbf9` and `relay/wonderland-marble` @ `7188ed7`
— preserved, not edited. V1's map (`/Game/Wonderland/Maps/WonderlandHub`) and
content (`/Game/Wonderland/…`) are never loaded, copied or referenced by V2.

**V2 map:** `/Game/WonderlandV2/Maps/WL_V2_GoldenArrival` — created NEW by
`build_v2.py` from Unreal's Open World (World Partition) template, or from an
empty level if the template is unavailable (the build log says which).
**V2 content root:** `/Game/WonderlandV2/` — nothing V2 falls back into
`/Game/Wonderland/`.

## The rule this directory exists for

V1's environment was five engine primitives arranged by a generator, and the
founder's verdict on every attempt to improve it in place was the same. V2
starts from **zero visual world state**: a new map, a new content namespace,
new assets, new materials, a new composition, a new camera. Engineering is
migrated selectively; environment art is not.

## What is migrated from V1 (engineering only, audited)

| system | why it is safe |
|---|---|
| Lightning build/cook/capture scripts (`infra/lightning/`) | know nothing about the scene; take the generator and the map as knobs |
| `WonderlandGameMode` / `WonderlandPlayerController` (`-CinematicView -HeroCam=N`) | camera selection by tag; V2 tags its own camera |
| `WonderlandInstancedBatch` (C++ ISM batching) | pure instancing; carries MeshPath/MaterialPath, no scene assumptions |
| `WonderlandHoverComponent` / `WonderlandHoverProp` (C++) | bounded, asynchronous hover for keys/teapot |
| `infra/build/gen-textures.py` | synthesises PBR texture sets on CPU; V2 imports them under its own root |
| `infra/build/hd/meshkit.py` | geometry kernel, used only as the FALLBACK authoring path when Geometry Script is unavailable, and logged as such |
| Marble `royal-garden-backdrop` panorama | strategic scenic use: the distant skyline dome behind a 3D midground |

Not migrated: `generate-hub-level.py` (the V1 scene), `hub-layout.json`,
`hd/assets.py` (V1-era library), every V1 material, every V1 actor.

## Files

| file | role |
|---|---|
| `v2_config.py` | names, paths, knobs, the locked hero camera |
| `layout_v2.py` | the authored composition, band by band from the reference (pure data) |
| `gs.py` | Geometry Script wrappers with capability probing and the meshkit fallback |
| `assets_v2.py` | the V2 asset recipes (gate, trees, heart, mushrooms, flowers, arch, tea, clocks, keys, cobbles, stairs, castle kit, portal, sky dome) |
| `materials_v2.py` | the V2 master materials and instances (`/Game/WonderlandV2/Materials`) |
| `build_v2.py` | the editor entry point: map → data layers → materials → assets → composition → light → atmosphere → portal → camera → save → manifest |
| `verify_v2_dryrun.py` | offline: the build script executes against a stub engine (syntax/logic only — never visual proof) |
| `../infra/lightning/v2-build.sh` | CPU: run `build_v2.py` in the editor commandlet, cook and package the V2 map |
| `../infra/lightning/v2-shot.sh` | GPU: capture `HeroCam_V2_Arrival` from the packaged V2 build |

## The Marble world — "make it just like this photo"

The founder pointed at the Marble panorama and said make it just like this.
That panorama is one view of a 3D world Marble generated from the founder's
own reference prompt, and the 3,500-credit **textured HQ mesh of that world
was downloaded on the Studio on 2026-08-22** (`marble/worlds/royal-garden-backdrop`,
manifest `exports[0]`). V1 imported it live and MEASURED everything V2 needs:
the actor scale (2.1145 — UE's glTF import already converts metres), the axis
correction (roll 180; without it the world is upside down), the artistic yaw
(180 — decided from two rendered frames), and that the export is
`KHR_materials_unlit` with its lighting baked in.

So V2 places that world as its scenery: the Marble mesh, at true metric scale,
its reconstruction viewpoint ON HeroCam_V2_Arrival (so every ray from the hero
camera is exactly the panorama's), its floor at z = 0, collision OFF, under
`/Game/WonderlandV2/Marble`. In front of it stand the V2 hero assets the photo
has nothing for at close range: the portal, the flagstone plaza, the corner
flower banks, the clock tree at the right edge, the framing tree at the left,
the hovering keys and teapot. `WONDERLAND_V2_LOOK=marbleWorld=0` builds the
castle kit + garden instead (every recipe exists and is exercised); the two are
not mixed by default because the Marble world already contains the gate, the
heart, the arch, the tea and the city, and doubling them is clutter.

Marble is a backdrop for a fixed camera: a single-viewpoint shell tolerates
about 1.7 m of movement at metric scale before parallax smears it. Walkable V2
means replacing it band by band with the kit — which is what the kit is for.

## Rendering target

SM6 + Nanite + Lumen + Virtual Shadow Maps (`Config/DefaultEngine.ini` on this
branch). V1 measured SM6 at half the L4's frame rate; V2 takes that cost
deliberately — quality first, then optimisation — and `measure-fps.sh` reports
what it costs.

## What no offline tool proves

Whether it looks right. The only acceptance imagery is a capture from the
packaged V2 build on the L4.
