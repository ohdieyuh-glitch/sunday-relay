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

## Verified by reading, not by photograph (2026-09-25)

Two of the founder's P0/P1 requirements are satisfied by construction, and the construction was read
rather than photographed. Recorded here because "I looked at the source" is evidence only if the
reading is written down.

**P0-4, the fire's FLICKER.** `zc_skin_parity_all` proves each skin wears the Dog's pose and performs
its act; it says nothing about the fire. `AWonderlandCompanionEmbodiment::RebuildFlames(TimeSeconds)` is
called every tick from `Animate(TimeSeconds)`, and the ribbon shape is driven by three NON-HARMONIC sine
terms -- periods 0.37 s, 0.19 s and 0.83 s, each offset by a per-source seed -- summed into `Flick` and
clamped into `Lick`. Non-harmonic periods never come back into phase, so the flame never repeats itself.
That is the same principle the water normals and the python's route use.

**P1-7, the HUD row NAMES.** The founder asked for "COMPOUND AGENT: <user-created name>" and two more.
`WonderlandUsageHudWidget` reads all three from `UWonderlandCompanionPreviewSettings` and draws the name
after the label at 0.72 alpha, `if (!Row.Named.IsEmpty())`. Two names are in `DefaultGame.ini`
(`AgentName=Claude Code Fable 5`, `LlmCompanionName=GPT 6 Astra`) and the third is a class default
(`CompoundAgentName = TEXT("Julius")`), so all three rows carry a name with no config at all.

Neither is a substitute for a measurement where one is possible -- see `zc_mascot_persist`, which exists
because "the Wardrobe photograph looked right" hid a colour that never reached the world Dog.

## Waiting for a thing to arrive

Five jobs in one day published or voided on this, and the fix did not transfer on its own even while
two lanes were holding it. Read this before writing any wait.

**A settle watches the PICTURE. It cannot see whether the thing you are measuring has arrived.**
Four things that hold perfectly still while still wrong, each of which cost a run:

| looks settled | actually | what sees it |
|---|---|---|
| frame cost identical every read | `stat unit` overlay off, `FStatUnitData` frozen while the frame counter advances | re-issue `stat unit`; reject N byte-identical raw reads across advancing frames |
| light count steady at 127 | pool assignment paused mid-climb, reached 192 later | read the count either side of an **independent wait** |
| district steady and dark | World Partition still streaming after a teleport | `FlushLevelStreaming`, then settle |
| world steady after BeginPlay | still arriving; first rung read 0.4932 where the next three agreed at 0.2350 | warm up before the first rung, and let the settle fall through rather than trim |

**No number of CONSECUTIVE reads separates a plateau from an arrival, because consecutive reads share
the same moment.** A wait between reads is the only thing that does. Three equal samples of something
pausing on its way up is exactly what a plateau looks like.

For the picture itself, use the **window spread** — `max - min` over the last three reads — not steps:

```python
window = []
for _ in range(24):
    yield 1.0
    now = patch(0.5, 0.5, 0.46, 0.44)
    if now is None:
        continue
    window.append(now["luma"])
    if len(window) > 3:
        window.pop(0)
    if len(window) == 3 and (max(window) - min(window)) < 0.004:
        return
# Fell through: trim NOTHING. The rung's own two-read spread then carries the damage into the noise
# gate and voids the run, instead of a tidy number taken from the tail of an arrival that never happened.
```

Steps compound — three of 0.0039 walk the window 0.0117 while every adjacent pair passes — and both the
pair test and the three-step test return early on `[200, 60, 66, 61, 50, 49, 48.5]`. A window spread
assumes nothing about direction, rate or shape.

**Take two reads of every rung and gate on their spread before reading any value.** A gate should report
its own noise first: the traversal harness measured one route at 230, 0, 35.2 and 86.0 in a single
session and every conclusion drawn from it came from a single draw of a distribution nobody had checked.

## Two more that are not about waiting

**Read the value, do not infer it.** A cvar's value is something to read back from the engine. Inferring
`PracticalRadius ≈ 4200` from a downstream lit count fitted the data beautifully and was false — the
readback said 12000.0, the declared default. Same family: a docstring read for behaviour (the
`PracticalCount` help string described a sort two commits after it changed), a p95 taken off
`GetFrameCostMs` (the filtered half of `FStatUnitData`, peaks already removed), and a mean standing in
for a distribution (C_GROUND passed dusk at mean 0.0673 while 78.9% of the same ground was crushed).

**When an accessor will not answer, measure what the value DRIVES.** Two subsystem routes for `Nightfall`
returned nothing on two builds, so the gate failed twice for want of an instrument rather than for want
of a fix. `MoonLux` is linear in `Nightfall` and `Nightfall` is exactly 1.0 at 23:00 — so the moon's
intensity divided by its 23:00 value *is* `Nightfall`, read off the light the curve actually drives.

**A look-at point is not a standing position.** `(0, -1460)` is the Golden Arrival monument, which four
jobs aimed a camera at from 500 uu away. Standing the pawn on it put the camera against lit stone and
read luma 0.6917 at night, brighter than noon. Stand at `(-320, -1900)`.
