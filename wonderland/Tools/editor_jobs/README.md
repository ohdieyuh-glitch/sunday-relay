# Editor jobs

Scripts that drive a live Unreal Editor session through `wonderland/Tools/editor_channel.py`.

**Visual authority:** captures are judged against the GPT Wonderland Bible boards, not the Marble image
(`wonderland/WorldDesign/VISUAL_AUTHORITY.md`, founder ruling 2026-09-13). The hero camera is
`HeroCam_GoldenArrivalBible` (renamed from `HeroCam_V2_MarbleReference` on 2026-09-13); the hidden Marble scaffold
is historical source only. Compare every capture with the Bible panel it aims at:
`wonderland/Tools/bible-compare.ps1 -Capture <png> -Panels hero_b1,skyline_b4 -Out <jpg>`
(panels are named in `wonderland/WorldDesign/Reference/bible_panels.json`).

Launch the editor with the channel once:

    UnrealEditor.exe Wonderland.uproject /Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2 ^
      -ForceEnablePython -ExecCmds="py <repo>/wonderland/Tools/editor_channel.py <channel dir>" -NoLiveCoding

Then write a job into `<channel dir>/inbox/` ATOMICALLY: write `<name>.py.tmp`, then rename it to `<name>.py`. The channel polls every 0.25 s and will run a half-written file. The result lands in `<channel dir>/done/<name>.json`,
and any captures go to `<channel dir>/../captures/`.

| job | world | does |
|---|---|---|
| `probe_editor.py` | editor | actors, batches, editor-preview pieces, anchors, registry rows |
| `anchors_search.py` | PIE | safe, walkable, clear-camera arrival spot per registry row, with a capture from each |
| `place_anchors.py` | editor | places/moves `AWonderlandTravelAnchor` actors from `done/anchors_search.json`, saves the map |
| `ui_tests.py` | PIE | 32 checks: usage HUD, Julius 3.3 terminal (Ctrl+T), world map (M) and teleport, PIE restart |
| `camera_census.py` | editor | every CameraActor (label, pose, FOV) and the Marble scaffold placement |
| `reference_suite.py` | PIE | each suite camera twice: the authored world, and the historical scaffold alone (provenance, never the target) |
| `camera_shots.py` | PIE | authored captures from named cameras (`CAMERAS`, `TAG`), plus a frame-rate sample |
| `topdown.py` | PIE | orthographic plans of the corridor (cm per pixel = ortho width / viewport height) |
| `corridor_census.py` | editor | actors and batch instances along the Golden Arrival corridor; how the generator used hero meshes |
| `probe_ground.py` | PIE | every floor under a list of XY points (`probe_points.json`); batch collision exists only at runtime |
| `apply_layer.py` | editor | applies an authored layer (`wonderland/WorldDesign/**.json`), tagged `WL_PASS_<id>`; re-apply is exact, `REMOVE_ONLY` removes it |
| `grade_variants.py` | PIE | look/lighting variants on the PIE copy, captured side by side; nothing saved |
| `apply_look.py` | editor | applies a look (`wonderland/WorldDesign/Look/*.json`) over recorded before-values; `REVERT = True` restores them |
| `import_kit.py` | editor | imports the Blender forge kit from its import plan: no material assets, V2 instance in slot 0, Nanite and collision enforced, resumable, read back |
| `skyline_profile.py` | editor, read-only, concurrent | horizon elevation per degree of azimuth from a camera, with the nearest dominant piece |
| `reload_channel.py` | editor | swaps the running listener for the repo's current `editor_channel.py` without restarting the editor |

Rules the jobs follow, each learned in a real run:
- The founder may be using the same editor and may start Play-In-Editor at any time. EditorAssetLibrary and
  EditorActorSubsystem refuse every call during PIE (`does_asset_exist` answers False for real assets), so asset
  and map jobs wait for `get_game_world() is None`; read-only jobs read the editor world through
  `unreal.find_object(None, <map object path>)` and `GameplayStatics`, and declare `CONCURRENT = True` so they can
  start beside a running job. A job that saves the map must not save someone else's unsaved edits.
- A synthetic Ctrl+T must hold Ctrl across frames; the game's chord reads key state when it processes the press.
- Never send Escape unless a panel is open: with no panel, the editor takes Escape and ends PIE.
- Anything that saves or loads pumps Slate; the channel guards against re-entering a running job.

After `place_anchors.py`, regenerate the registry:

    python wonderland/Tools/travel_registry.py --audit <audit.json> --anchors <channel dir>/done/anchors_search.json

## get_actor_bounds is not a measurement. Do not quote a number derived from it.

**Measured 2026-09-22.** `Actor.get_actor_bounds()` returns a **cube** for Blueprint actors in this project, not
the actor's real extent, and it over-reports badly. The proof is a quantity this project already knows exactly:

| actor | what `get_actor_bounds` said | what it actually is |
|---|---|---|
| canonical Relay Dog | `bounds_extent [1010, 1010, 1010]` &rarr; **2020 cm tall** | **174 cm** (`dog_canon.EAR_TOP * 60`) |
| Relay Dog Sub-Agent Cub | `bounds_extent [128, 128, 128]` &rarr; 256 cm | a floating head, far smaller |
| Ten Tails / Cherubim / Seraph, SMALL | `256.0 x 256.0 x 256.0` for **all three** | 1.15 m tall, three different footprints |

An 11.6x over-report on the Dog, and one identical cube for three creatures that share no geometry. The giveaway
is that the three axes come back **equal** — a real creature's bounds are never a perfect cube.

This matters beyond one job: **every bounds-derived number anyone has quoted in this project is suspect**,
including the extents recorded in `cub_figures.json`. If a figure came out of `get_actor_bounds`, re-derive it
before relying on it.

**What to use instead.** Ask the mesh, then place it:

```python
sm = comp.get_editor_property("static_mesh")        # StaticMeshComponent has NO 'bounds' property in 5.8 Python
box = sm.get_bounding_box()                          # the asset's own box, in its own space
world = comp.get_world_transform().transform_location(unreal.Vector(box.min.x, box.min.y, box.min.z))
```

Union the eight transformed corners of every component's box. `verify_avatars.py` does exactly this.

For an asset built by this project's own generators there is also an offline answer that needs no editor at all:
`wonderland/v2/verify_avatar_placement.py` on the forge branch redoes the build's arithmetic in plain Python and
reports the true height to 0.05 cm. It is how the avatars were cleared without the editor.

## Lit and unlit emissive have working bands ~20x apart. Never carry a value between them.

**Measured 2026-09-22, by two lanes who each had a number and disagreed by a factor of twenty.** Internal
Development swept a small UNLIT emissive (`LevelColorationUnlitMaterial`) across six exposure floors in one PIE
session and photographed each, against this map's pinned EV100 13.5 daylight:

| scene units | what the frame shows |
|---|---|
| 1,700 | dark maroon — reads as a shadow, not a colour |
| **3,400** | a deep, unmistakable red — **chosen** |
| 13,700 | washed out to orange; it has stopped being red |
| 56,000 | far past white |

And the world lane's own measured band, for emissive on the **lit/opaque** `M_V2_Surface`, is **55,000–62,000** —
where 2.2 renders black. Both numbers are right. Each is wrong by more than an order of magnitude on the other
path: 56,000 is blown out on an unlit material, and 3,400 is invisible on a lit one.

So the transferable rule is not a number:

> A brightness measured on a lit material must never be carried to an unlit one, or the reverse. Sweep and
> photograph on the path you are actually shipping.

This is the same family as the Cub Ghost rendering black at 2.2 and the Bee's wings vanishing at 9,000 and again
at 58,000 before they were moved off the translucent master. Before spending a rebuild on a colour value, check
which path the material is on.
