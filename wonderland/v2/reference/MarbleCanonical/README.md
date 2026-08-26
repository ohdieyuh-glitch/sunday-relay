# Marble Canonical — the Wonderland V2 world-bible package

**Role (founder, 2026-08-26):** Marble is the CONCEPT ARCHITECT, SPATIAL
REFERENCE and DISTANT-WORLD ACCELERATOR. Unreal is the authoritative playable
world. This package is the permanent reconstruction blueprint: what the world
looks like, measured, so the Unreal kit can be built to it.

## Canonical world

| item | value |
|---|---|
| Marble world id | `ae83acaa-df79-4e92-b31f-53af690d5deb` |
| operation | `0de3c95d…` (marble-1.1, 2026-08-21) |
| generation cost | 1,580 credits (world) + 3,500 credits (HQ textured mesh export) |
| canonical panorama | [`../marble-royal-garden-backdrop-panorama.png`](../marble-royal-garden-backdrop-panorama.png) — 4608×2304 equirectangular, byte-identical to the export (sha256 `13bc580b0059551b…`; the export named it `.jpg`, its bytes are PNG) |
| thumbnail | [`../marble-royal-garden-backdrop-thumbnail.jpg`](../marble-royal-garden-backdrop-thumbnail.jpg) |
| HQ textured mesh | `marble/worlds/royal-garden-backdrop/assets/mesh_hq.glb` on the Studio (141,473,320 bytes; gitignored export dir, persistent at `wonderland/marble-assets/royal-garden-backdrop/`) |
| provenance + prompt + metadata | [`../PROVENANCE.md`](../PROVENANCE.md) |
| measured reference analysis | [`../ANALYSIS.md`](../ANALYSIS.md) (azimuth / elevation / distance per feature; the equirect seam finding; the two cameras) |
| world bible (palette, composition, material and lighting rules) | [`../VISUAL_SPEC.md`](../VISUAL_SPEC.md) |
| landmark map (spatial relationships) | [`LANDMARK-MAP.md`](LANDMARK-MAP.md) |

Splat / Gaussian data, depth and camera JSON: not exported for this world
(the export list holds panorama, thumbnail, mesh_hq). Whether Marble can
render further views of THIS world without a new generation is being
researched; the credit-free path below is used first.

## Views of the SAME world (no credits)

The additional views are rendered **in Unreal from the mesh we already own**:
the Marble world is placed at its measured registration (scale 2.1145, roll
180, yaw 180, viewpoint at the origin) as a hidden `MARBLE_REFERENCE_ONLY`
actor; a capture with `WL_EXTRA_ARGS="-WLShowTags=MARBLE_REFERENCE_ONLY
-WLHideTags=UNREAL_PRODUCTION"` shows it alone, from any of the cameras
below (`WL_V2_CAM=N`). The same cameras with the kit visible give the
reconstruction from the same viewpoints — a like-for-like comparison.

| view | camera (tag) | position (cm) | rotation (pitch, yaw) | fov | shows |
|---|---|---|---|---|---|
| 1. arrival (canonical) | `HeroCam_V2_MarbleReference` (HeroCam0) | (0, −150, 262) | (−2, 90) | 100 | the panorama's own framing |
| gate view | `HeroCam_V2_GateView` (HeroCam1) | (0, −1460, 262) | (−3, 90) | 95 | through the open arrival gate |
| 2. forward / central path | `MarbleView_Forward` (HeroCam2) | (0, 1500, 262) | (−2, 90) | 90 | path continuation, steps, deeper architecture |
| 3. left garden | `MarbleView_LeftGarden` (HeroCam3) | (0, −150, 262) | (−3, 145) | 90 | left gate, giant mushroom, beds, trees |
| 4. right garden | `MarbleView_RightGarden` (HeroCam4) | (0, −150, 262) | (−3, 35) | 90 | topiary, clock tree, beds |
| 5. elevated | `MarbleView_Elevated` (HeroCam5) | (0, −900, 1600) | (−28, 90) | 90 | plaza shape, garden footprint, path, landmarks |
| 6. castle approach | `MarbleView_CastleApproach` (HeroCam6) | (0, 4200, 300) | (−1, 90) | 90 | arrival garden → deeper city |
| 7. reverse | `MarbleView_Reverse` (HeroCam7) | (0, 900, 262) | (−2, 270) | 90 | back toward the arrival gate |

Rendered files land in `~/wonderland-v2-renders/` as `V2_PASS_nnn_camN_*.png`
and are copied here as `view-<name>.png` once captured. Until then this table
is the plan, not evidence.

## Ownership tags in the level

| tag | meaning |
|---|---|
| `MARBLE_REFERENCE_ONLY` | the registered Marble world, hidden in game; a measuring aid |
| `MARBLE_DISTANT_SCENIC` | the Band C experiment: the Marble world beyond 200 m, visible, no collision, HLOD far |
| `UNREAL_PRODUCTION` | authored kit content (every placed actor that is not Marble) |
| `BAND_A` / `BAND_B` / `BAND_C` | < 50 m / < 200 m / beyond, from the viewpoint |
