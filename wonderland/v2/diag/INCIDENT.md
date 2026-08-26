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
| T0g | clean cook (Saved/Cooked removed), WL_SKIP_GENERATE=1 (build bd6374e) | world | *pending* | — | if black → T1 |
| T1 | diagnostic classic map: camera (0,0,200) yaw 90, 20 m unlit magenta cube at (0,600,200), white sphere, sun | magenta pixels | *pending* | — | per tree |
