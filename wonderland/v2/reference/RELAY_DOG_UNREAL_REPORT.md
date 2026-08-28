# The canonical Relay Dog in Unreal — build report (for founder approval)

**Rule honoured:** the landing-page Dog (`src/relay/ui/landing/three/relay-dog.ts`) is the canon and was
not modified. Unreal was built TO its numbers: `wonderland/v2/dog_canon.py` transcribes the 31 boxes,
7 pivots and 3 materials; `dog_v2.py` builds them; `verify_dog_canon.py --log` proves the built meshes'
measured extents equal the canon (9/9 parts PASS, tolerance 0.6 uu, measured 2026-08-28 00:25 UTC).

## Scale
One HEAD_WIDTH = **60 uu (cm)** (`WLV2_DOG_HEAD_WIDTH_UU`) → total height 174.1 cm — a
third-person character at human scale on Wonderland's 4.4 m paths. Every other dimension follows.

## Normalised dimensions (web canon ×W) and the Unreal values they produce

| measure | ×HEAD_WIDTH | Unreal (uu) |
|---|---|---|
| headWidth | 1.0000 | 60.0 |
| headHeight | 0.8000 | 48.0 |
| headDepth | 0.7250 | 43.5 |
| torsoWidth | 0.6200 | 37.2 |
| torsoHeight | 0.8750 | 52.5 |
| torsoDepth | 0.4500 | 27.0 |
| visorWidth | 0.6500 | 39.0 |
| visorHeight | 0.3000 | 18.0 |
| visorRecess | 0.2200 | 13.2 |
| earWidth | 0.1900 | 11.4 |
| earHeight | 0.2400 | 14.4 |
| earGap | 0.4500 | 27.0 |
| eyeWidth | 0.1350 | 8.1 |
| armWidth | 0.2000 | 12.0 |
| armLength | 0.9750 | 58.5 |
| legWidth | 0.1900 | 11.4 |
| legGap | 0.1400 | 8.4 |
| footWidth | 0.2750 | 16.5 |
| footDepth | 0.3750 | 22.5 |
| footHeight | 0.2250 | 13.5 |
| tailSegment1 | 0.1625 | 9.8 |
| tailTip | 0.1000 | 6.0 |
| totalHeight | 2.9025 | 174.1 |

Ratio comparison: **identical by construction and by measurement** — the Unreal extents per part
are the canon's extents at 60 uu/W (see `verify_dog_canon.py --log` output in `RELAY_DOG_UNREAL_REPORT.md`
provenance section). Unavoidable renderer/rig differences: none in geometry; materials use UE's
physically-based masters (`M_V2_Surface` / `M_V2_Portal`) instead of three.js `MeshStandardMaterial`, so
specular response differs slightly under different lights; the emissive eye intensity is an absolute
radiance in UE (600 × 0.9) rather than three.js's relative `emissiveIntensity`.

## Materials (web canon → Unreal instances, `/Game/WonderlandV2/Characters/RelayDog/`)

| instance | parent | colour (sRGB) | roughness | metalness | emissive |
|---|---|---|---|---|---|
| `MI_RelayDog_Ivory` | `M_V2_Surface` | #EBE5D6 | 0.72 | 0.0 | — |
| `MI_RelayDog_Visor` | `M_V2_Surface` | #050505 | 0.55 | 0.0 | — (specular 0.2: a void, not a screen) |
| `MI_RelayDog_Eye` | `M_V2_Portal` | #F2C94C | 0.40 | 0.1 | #C9A23A × 540 (restrained; `WLV2_DOG_EYE_EMISSIVE`) |

Albedo/roughness textures are the engine's white square and normal is flat, so the tint IS the colour.

## Mesh hierarchy (`BP_RelayDog`, parent `Character`)

`CapsuleComponent` (r 35.9, half-height 87.1 — the hands' outer edge and half the height)
→ `Body` (SceneComponent at the capsule's foot: ground = 0)
→ the seven canonical joints, each a SceneComponent at the web pivot (Unreal axes, uu), holding
   per-surface StaticMeshComponents merged INSIDE that joint's local frame (as `dog-mesh.ts` does):

| pivot | location (uu) | meshes |
|---|---|---|
| `Pivot_root` | (0.0, -0.0, 0.0) | `Mesh_root_ivory` → `SM_RelayDog_root_ivory` |
| `Pivot_head` | (0.0, -0.0, 111.8) | `Mesh_head_ivory` → `SM_RelayDog_head_ivory`, `Mesh_head_visor` → `SM_RelayDog_head_visor`, `Mesh_head_eye` → `SM_RelayDog_head_eye` |
| `Pivot_armLeft` | (0.0, 18.6, 108.2) | `Mesh_armLeft_ivory` → `SM_RelayDog_armLeft_ivory` |
| `Pivot_armRight` | (0.0, -18.6, 108.2) | `Mesh_armRight_ivory` → `SM_RelayDog_armRight_ivory` |
| `Pivot_legLeft` | (0.0, 9.9, 48.0) | `Mesh_legLeft_ivory` → `SM_RelayDog_legLeft_ivory` |
| `Pivot_legRight` | (0.0, -9.9, 48.0) | `Mesh_legRight_ivory` → `SM_RelayDog_legRight_ivory` |
| `Pivot_tail` | (-12.0, -12.0, 60.0) | `Mesh_tail_ivory` → `SM_RelayDog_tail_ivory` |

Root-joint meshes (`neck`, torso slabs, pelvis step) sit directly under `Body`. Collision: the capsule
only; part meshes are `NoCollision` — rigid block geometry, no deformation possible by construction.
`Mesh` (skeletal) is empty. Rig = seven transforms: head (pitch/yaw), arms (pitch), legs (pitch),
tail (pitch/yaw), root (position/yaw/roll) — the web `DogPose` contract, one-to-one.

## Assets
- `/Game/WonderlandV2/Characters/RelayDog/SM_RelayDog_<joint>_<surface>` × 9 (96 + 12 + 24 + 60 + 36 + 36 + 24 + 24 + 60 tris)
- `/Game/WonderlandV2/Characters/RelayDog/MI_RelayDog_{Ivory,Visor,Eye,StudioGrey}`
- `/Game/WonderlandV2/Characters/RelayDog/BP_RelayDog`
- `/Game/WonderlandV2/Maps/WL_V2_RelayDogStudio` — classic map: grey floor + backdrop, SkyAtmosphere,
  one 5000-lux sun (5800 K, pitch −42 / yaw 35), real-time-capture sky light, ONE Dog at the origin
  facing +X, cameras `HeroCam0` FRONT, `HeroCam1` THREE-QUARTER, `HeroCam2` SIDE, `HeroCam3` REAR
  (3.8 m, height 92 cm, FOV 55). Nothing was placed in the Golden Arrival environment.

## Skins
Skins attach to this skeleton by replacing/decorating the per-joint StaticMeshComponents' meshes and
material instances (armor, halo/rings, clothing, accessories as extra components under the same
pivots); the canonical anatomy stays the base form underneath.

## Captures (cycle 2, package `5665056`, 2026-08-28 01:16–01:29 UTC, 1280×720, `DisableAllScreenMessages`)

| view | file | pass |
|---|---|---|
| FRONT | `renders/dog/RELAYDOG_FRONT_720p.png` | V2_PASS_012 (luma 149.9, STRUCTURED) |
| THREE-QUARTER | `renders/dog/RELAYDOG_THREEQUARTER_720p.png` | V2_PASS_013 (147.0) |
| SIDE | `renders/dog/RELAYDOG_SIDE_720p.png` | V2_PASS_014 (151.3) |
| REAR | `renders/dog/RELAYDOG_REAR_720p.png` | V2_PASS_015 (153.3) |

Cycle 1 (`renders/dog/cycle1_*`, V2_PASS_008–011) is kept as evidence of what was fixed: the V2
master's world-XY plaster normal streaked every face (→ `TexScale 0` + read-back), the cameras clipped
the ears at 3.8 m / pitch −3 (→ 4.5 m / pitch 0), and three views opened onto the horizon (→ four walls).
Cycle 2's sun is still 5000 lux (the runner's default overrode the generator's 2500; aligned at
`fcc6637` for the next build) — the ivory reads brighter than #EBE5D6 under it; anatomy is unaffected.

Reference for the side-by-side: `reference/relay-dog-canonical-founder-reference.jpg` (the founder's
web capture) and `src/relay/ui/landing/three/relay-dog.ts` itself.
