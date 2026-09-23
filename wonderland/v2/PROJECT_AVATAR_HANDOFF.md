# PROJECT AVATAR — handoff to Internal Development

**Written 2026-09-22 at the founder's lane correction.** Project Avatar assets now belong to Internal
Development. The world lane built what follows, stopped on instruction, and deleted nothing. This is everything
needed to pick it up without re-deriving it.

**Read §6 first if you only read one section.** It lists what is *not* verified, which is the part that will cost
you time if you assume otherwise.

---

## 1. There are TWO avatar asset families. Know which one you are staging.

| | built by | form | lives as |
|---|---|---|---|
| **A — voxel figures** | `wonderland/Tools/project_avatar_figures.py` → `WonderlandCompanionFigure` | engine cubes, assembled at spawn | `.wlvox` definitions, **no `.uasset`** |
| **B — mesh assets** *(this handoff)* | `wonderland/v2/avatars_v2.py` on the forge branch | static meshes with materials, LODs, capsules | 343 `.uasset` under `/Game/WonderlandV2/Characters/Avatars` |

Everything below is **B**. Every render judged, every triangle count and every defect named here is B.
A and B differ in a way that has already nearly caused a mistake: **B is levelled so its lowest geometry sits at
exactly y=0**, so you place it at ground z and it is correct. A carries a per-family overhang (Cherubim −271 uu).
Do not carry A's lift onto B; it will float them.

## 2. Asset paths

```
/Game/WonderlandV2/Characters/Avatars/<Family>/MI_Avatar_<Family>_<Surface>          shared by all 3 stages
/Game/WonderlandV2/Characters/Avatars/<Family>/<Stage>/SM_Avatar_<Family>_<Stage>_<joint>_<surface>
/Game/WonderlandV2/Characters/Avatars/<Family>/<Stage>/BP_Avatar_<Family>_<Stage>
```

`<Family>` ∈ `TenTails | Cherubim | Seraph`, `<Stage>` ∈ `Small | Medium | Large`.

`BP_Avatar_*` is an **AActor**, not an ACharacter — deliberately, so it carries no movement component and no
collision capsule into an asset that is collision-free by contract. Hierarchy:

```
Body (SceneComponent, root)
└── Pivot_<joint>              nested exactly as the canon's parents() declares
    ├── Mesh_<joint>_<surface> StaticMeshComponent, material already assigned
    └── VFX_<name>             SceneComponent, an effect anchor
```

Rotate `Pivot_<joint>` and the geometry turns about the right point: every mesh is merged in **its own joint's
frame** with the pivot subtracted. That is the only reason the meshes are split this way, and it is what makes
the set riggable.

## 3. Source

Forge branch `local/wonderland-blender-forge`, `wonderland/v2/`:

| file | what |
|---|---|
| `avatar_common.py` | shared part system; `aim_x`/`aim_z` (verified numerically), `eye()`, `deck_offset`/`lift`, `fit_scale`, `to_unreal` |
| `ten_tails_canon.py` | Ten Tails, three stages, pure numbers |
| `cherubim_canon.py` | Cherubim, three stages |
| `seraph_canon.py` | Seraph, three stages |
| `avatars_v2.py` | the Unreal builder: materials, meshes, Blueprints |
| `verify_avatar_placement.py` | **offline** proof of height and placement; needs no editor |
| `PROJECT_AVATAR_CONTRACT.md` | the full contract: silhouettes, growth, LOD policy, collision, sockets |

task3 side: `wonderland/Tools/editor_jobs/build_avatars.py` (the door into the editor) and
`verify_avatars.py` (in-engine check).

## 4. Commits

| SHA | repo | what |
|---|---|---|
| `994bfd5d` | forge | the three families, nine bodies, first full build |
| `059f30aa` | forge | offline placement proof; the `get_actor_bounds` cube finding |
| `a5809ac2` | forge | Ten Tails round 4 — legs, hock, chest plate, shoulders |
| `32957657` | forge | Ten Tails round 5 — hock resized, skull narrowed **(UNRENDERED)** |
| `e14f24be` | task3 | verifier reads mesh-asset bounds, not the component property |
| `7ac6e62e` | task3 | the `get_actor_bounds` finding, written into the editor-jobs README |

## 5. Status and measurements — read off the built assets

Heights are **exact**: each body is authored in its own units and fitted once to
`project_avatar_figures.py`'s `TARGET_METRES` (1.15 / 2.70 / 5.60 m). A LARGE avatar **is** 5.60 m and needs no
shrinking.

| family | stage | height | W × D | draw calls | triangles | joints | sockets | eyes | capsule r / half-h / centre z |
|---|---|---|---|---|---|---|---|---|---|
| Ten Tails | SMALL | 1.15 m | 0.66 × 1.98 m | 28 | 3,424 | 22 | 10 | 1 | 31 / 49 / 47 cm |
| Ten Tails | MEDIUM | 2.70 m | 2.17 × 5.05 m | 60 | 12,836 | 25 | 13 | 9 | 49 / 90 / 102 cm |
| Ten Tails | LARGE | 5.60 m | 5.56 × 9.96 m | 76 | 21,676 | 29 | 17 | 17 | 87 / 175 / 197 cm |
| Cherubim | SMALL | 1.15 m | 1.36 × 1.15 m | 11 | 2,728 | 7 | 4 | 1 | 28 / 51 / 58 cm |
| Cherubim | MEDIUM | 2.70 m | 2.59 × 2.25 m | 22 | 7,840 | 13 | 8 | 4 | 57 / 103 / 117 cm |
| Cherubim | LARGE | 5.60 m | 6.39 × 5.57 m | 40 | 16,912 | 24 | 17 | 12 | 116 / 211 / 236 cm |
| Seraph | SMALL | 1.15 m | 0.82 × 0.51 m | 16 | 2,370 | 14 | 9 | 1 | 19 / 50 / 58 cm |
| Seraph | MEDIUM | 2.70 m | 2.10 × 2.18 m | 36 | 4,800 | 24 | 14 | 3 | 44 / 122 / 139 cm |
| Seraph | LARGE | 5.60 m | 4.38 × 4.69 m | 47 | 8,804 | 32 | 20 | 7 | 84 / 252 / 283 cm |

Ten Tails rows are the **round-4 build**, which is what is in the editor. Round 5 is committed but not built
(see §6).

**Collision:** every mesh saved `collision=False`, every component `NO_COLLISION`. Each family declares its own
capsule around its **core mass** via `collision_capsule(stage)` — deliberately *not* from mesh bounds, because a
bounds-derived capsule on a LARGE Ten Tails would be 1.5 m in radius on a body one metre wide. None of these
will block a spawn.

**Cost shape:** triangles are cheap (2.4k–21.7k). **Draw calls are the cost** — one mesh per joint per surface,
which is the price of a body a rig can drive. LARGE is a showcase form (40–76 draw calls, one near spawn);
SMALL is the crowd form (11–28). No LOD setting changes a draw call. Nothing is translucent: the glow is
emissive on opaque, in scene units.

## 6. NOT VERIFIED — the part that will cost you time

1. **Ten Tails round 5 is committed but never built or rendered.** `32957657` shrinks the hock from 1.02× to
   0.74× the leg radius and rebuilds the skull as three tapering masses. It is *offline-measured only*:
   115/270/560 exact, draw calls unchanged at 28/60/76, 13,600 est. triangles at LARGE. **Nobody has looked at
   it.** Rebuild that family before judging it.
2. **The in-engine verifier has never completed a clean run.** `verify_avatars.py` crashed on
   `StaticMeshComponent.bounds` (no such property in 5.8 Python), was fixed to read each StaticMesh's own
   `get_bounding_box()` through the component world transform, and **has not been run since**.
3. **Cherubim and Seraph were last judged at round 3.** Their vane/pinion roll fix and the eye fix were both
   confirmed in frames. Neither has been looked at since.
4. **LODs are on (`lods=True`) but no LOD has been visually checked** at distance.
5. **No frame-time measurement exists** for any avatar in a populated scene.

## 7. Visual findings — four rounds of looking, so you need not repeat them

* **The cameras were behind the creatures (round 1).** Poses generated at azimuth 232–268 for figures facing +Y
  photographed three families from directly behind; the shot named `LargeFace` had no face in it. Nothing was
  wrong with the assets.
* **`roll=0` makes a blade edge-on (round 2).** A blade's width axis comes out horizontal, so a viewer on the
  ground sees a splinter however wide it is. Every Cherubim vane and Seraph pinion. `roll=90` fixed it.
* **A head can be built correctly and still not read (round 2).** The Ten Tails' skull sat level with the roots
  of ten tails with half of it inside the shoulders. SMALL read correctly in the same frame — the fault was in
  how the head is *carried* as the body grows, not in the head.
* **An opaque rim placed concentric with a glowing iris hides it completely (round 3).** `eye()` put the rim at
  1.18× the iris radius, concentric; the Cherubim's twelve eyes came back as twelve black beads. The Ten Tails'
  tail bulb did it to its tail eyes, the Seraph's hood to its head. *In this project a bigger opaque thing
  around a smaller bright thing always wins, and it always looks like the bright thing was never built.*
* **A joint swells; it does not become a ball (round 4 → 5).** A hock at 1.02× the leg radius made the legs read
  as ball-jointed doll legs at player-approach distance. Round 5 takes it to 0.74×. **Unverified.**

## 8. Two traps in the tooling

1. **Frame.** Canon positions and sizes are in the web frame (X right, Y up, Z forward); a `rot` is **already an
   Unreal Rotator**. `aim_x`/`aim_z` were verified numerically against the Rotator's own roll→pitch→yaw order on
   nine directions. The first verification *matrix* had the pitch sign backwards — the helpers were right.
2. **`get_actor_bounds` returns a cube for Blueprint actors here and cannot be used for size.** It reported the
   canonical Relay Dog at 2020 cm for a 174 cm animal. Use each StaticMesh's `get_bounding_box()` through the
   component world transform, or `verify_avatar_placement.py` offline. Recorded in
   `wonderland/Tools/editor_jobs/README.md`.

## 9. Build cost, if you rebuild

343 meshes across nine bodies: **477 s** with the builder yielding and collecting every 12 meshes. Yielding on
*every* mesh costs 2.3 s of tick-wait each (1,177 s); yielding on none takes the editor's private footprint to
19.5 GB against a 55 GB commit limit with the channel silent for minutes. Twelve is where both are cheap.
A single family is roughly 18 minutes.

---

**The world lane has stopped here.** Nothing above will be modified by this lane again unless Internal
Development asks a specific technical question. All of it is committed and none of it is deleted.
