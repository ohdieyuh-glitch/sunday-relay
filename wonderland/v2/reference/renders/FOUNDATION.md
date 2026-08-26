# V2_FIRST_VISIBLE_APPROVED_FOUNDATION

The first real Unreal Wonderland V2 render the founder approved as the visual
foundation (2026-08-26 17:07:46Z). Everything after this builds ON it.

| item | value |
|---|---|
| render | `V2_FIRST_VISIBLE_APPROVED_FOUNDATION_cam0_720p.png` (1280×720, frame-check STRUCTURED, luma 114.7, 454 colours) |
| branch / head | `relay/wonderland-v2` @ `09a774f` (the packaged sha) |
| map | `/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2` (classic container; 445 actors, 437 production-tagged, 8 cameras; umap 877,890 bytes) |
| camera | `HeroCam_V2_MarbleReference` — (0, −150, 262), pitch −2 / yaw 90, FOV 100 — **LOCKED** |
| runtime proof | `WL_TAG_VISIBILITY show=[UNREAL_PRODUCTION] shown=437`, `HERO_CAM_SERVED=CameraActor_0 FELL_BACK=0` |
| render path | Vulkan SM5, NVIDIA L4, `-RenderOffscreen`, Pixel-Streaming → real Chrome |
| map backup on the Studio | `run/WL_V2_GoldenArrival_WP2.umap.APPROVED-FOUNDATION` |
| side-by-side vs Marble | `~/wonderland-v2-renders/V2_FIRST_VISIBLE_vs_marble.png` |

**Locked for subsequent passes:** hero camera (position/rotation/FOV), central
path position and width, garden retaining wall positions, castle massing and
centreline, the primary arrival composition. `layout_v2.py` placements are the
approved composition — later passes change what the meshes LOOK like, not where
they are.
