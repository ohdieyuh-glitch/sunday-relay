# P0 black-screen isolation — incident log (2026-08-26)

Method: binary isolation, one variable per test, a real capture per test
(Pixel-Streaming frame in real Chrome via capture-hero-shots.sh, verdict from
frame-check.py; HighResShot is known to be a phantom here).

| # | test | expected | result | conclusion | next |
|---|---|---|---|---|---|
| T0a | V2 package, SM6, cam0/1/5, post/Lumen/VSM/unlit/Nanite variants (11 captures) | world | BLACK | — | count actors at runtime |
| T0b | V2 package, SM5 | world | BLACK | shader model not the cause | count actors at runtime |
| T0c | runtime tag count `-WLShowTags=UNREAL_PRODUCTION` | N≈448 | **shown=0**; `__ExternalActors__` = 0 files on disk; map 11 KB | actors were never saved | save external packages |
| T0d | save via save_dirty_packages | files | 0 files | not dirty | save by handle |
| T0e | save_packages(448, only_dirty=False) | files | **448 on disk** (8.8 MB) | saved | cook |
| T0f | cook + capture (build eca66cd) | world | BLACK; `shown=0`; pak byte-identical to the empty one, no GenerateStreaming line | cooker reused the stale WP result | clean cook |
| T0g | clean cook (Saved/Cooked removed), WL_SKIP_GENERATE=1 (build bd6374e) | world | ABORTED — clang segfault in the preflight compile, AutomationTool idle 15 min | full pipeline unreliable + too expensive | stop full builds; cheapest pixel path |
| T1/A′ | diagnostic classic map rendered IN THE EDITOR COMMANDLET (SceneCapture2D → render target → export PNG, 640×360, no cook, no game) | magenta pixels | **MAGENTA PIXELS** (`DIAG_A_editor_rt_640x360.png`, 158 KB) — camera aimed up by the Rotator positional bug, cube still fills a third of the frame | **SUCCESS 1: renderer + scene work (Vulkan SM5 in the container)**; the black is in the packaged/capture path or the V2 map | T B: same scene through the packaged capture path |
| T1 bug | `unreal.Rotator(0, 90, 0)` | pitch 0 yaw 90 | pitch 90 yaw 0 (positional order is roll, pitch, yaw) | diag scripts fixed (by property); V2's `rot()` already sets by property — V2 cameras were correct (`HERO_CAM_ROT=-2,90,0`) | — |
| A′-2 | same scene, camera aimed correctly, materials REUSED from disk | magenta | BLACK (56 KB) | reused materials compile async → capture before shaders ready; fixed (recompile_material on reuse) | C′ |
| C′ | the ACTUAL V2 map loaded in the editor commandlet, SceneCapture at HeroCam0 | world | map loads with **275 actors, 0 cameras (HeroCam0 MISSING)**; FinalColor = pure white, BaseColor = pure black (empty view) | the editor loads only the always-loaded set (castle/skyline 274 + 1); every spatially-loaded actor (plaza, garden, cameras) depends on WP streaming; and NO cook has yet run on the 448 saved packages (the only clean cook was the wedged build) | one minimal clean cook of the saved world (no compile/gen/HLOD) → 720p capture |

