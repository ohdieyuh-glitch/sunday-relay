# V2 primary visual reference — provenance

**Selected by the founder 2026-08-25** as the PRIMARY environment target for
Wonderland V2, overriding the earlier illustrated references (which remain
secondary inspiration for small details only).

| field | value |
|---|---|
| file | `marble-royal-garden-backdrop-panorama.jpg` — **byte-identical copy** of `marble/worlds/royal-garden-backdrop/assets/panorama.jpg` (sha256 `13bc580b0059551b…`, 14,150,112 bytes) |
| dimensions / projection | 4608 × 2304, **equirectangular 360° × 180°** (u → azimuth, v → elevation; u = 0.5 is straight ahead; the left and right edges are the SAME direction, behind the viewer) |
| generator | Marble `marble-1.1`, world id `ae83acaa-df79-4e92-b31f-53af690d5deb`, operation `0de3c95d-f056-442c-9fcd-8198c9a2d059`, generated 2026-08-21T16:25:39Z |
| prompt | image prompt (the founder's reference) + text prompt, sha256 `b4fdbfb6…` — recorded in `marble/worlds/royal-garden-backdrop/intent.json` |
| cost | 1,580 credits (80 pano + 1,500 world); the textured HQ mesh export a further 3,500 |
| viewpoint | the Marble world origin; **1.24 native units above the ground plane → 2.62 m at the measured metric scale 2.1145** |
| depth (Marble, metres, native) | p1 11.2 · p10 32.7 · p25 48.8 · p50 70.5 · p90 118.1 · max 168.8 |
| associated 3D data on disk (git) | `collider.glb` (5.4 MB decimated proxy), `splat_100k/150k/500k/full_res.spz` (Gaussian splats, 1.4–30.8 MB), this panorama, thumbnail |
| associated 3D data on the Studio | `assets/mesh_hq.glb` — the **3,500-credit textured mesh**, downloaded on the L4 2026-08-22 (not in git); `KHR_materials_unlit`, one material, one texture; V1 measured import scale 2.1145, axis roll 180, artistic yaw 180 |
| founder's attachment | a phone screenshot of THIS file (downsampled); the original above is what V2 builds to — never the screenshot |

**Do not recompress the panorama.** Tools that need a smaller copy make it in a
scratch directory.
