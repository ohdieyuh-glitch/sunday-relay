# V2_VEGETATION_PASS_HEROCAM0_720p — the first frame in colour

The vegetation pass 1 (`dbc892e`) + master-material fix (`dd36027`, `dacf7cb`) rendered for the
first time, 2026-08-28 00:02 UTC, as `V2_PASS_007` — for founder review against the approved
foundation. Nothing in the environment was changed by the render session.

| item | value |
|---|---|
| render | `V2_VEGETATION_PASS_HEROCAM0_720p.png` (1280×720, frame-check STRUCTURED, luma 122.2) |
| branch / head | `relay/wonderland-v2` @ `675ebb5` (packaged sha `675ebb54ff…`) |
| map | `/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2` — classic container, unchanged (877,890 bytes, byte-identical size to `APPROVED-FOUNDATION`) |
| camera | `HeroCam_V2_MarbleReference` (HeroCam0) — (0, −150, 262), pitch −2 / yaw 90, FOV 100 — **unchanged, LOCKED** |
| render path | Vulkan SM5, NVIDIA L4, `-RenderOffscreen`, Pixel Streaming → real Chrome, `WL_MAP_ARG=…WP2` |
| performance | median 5.61 ms = **178 fps**, mean 7.02 ms, p95 13.16 ms (measure-fps, 300 frames) |
| assets | 82/82 static meshes; 12 vegetation recipes rebuilt as leaf geometry; scene ≈ 4.5 M tris |
| known technical warning | on-screen engine text "Cached lighting in Lumen and real-time sky capture … r.EyeAdaptation.CachedLightingPreExposure … Exposure: 12.5" — a development-build screen message, not a render defect; hidden in later captures with `DisableAllScreenMessages` |
| whole-frame metrics | render luma 0.332 / chroma 0.069 / bright 42 % vs Marble reference luma 0.160 / chroma 0.105 / bright 20 % |

Two capture traps closed in the same session (`round.sh`): the packaged game boots
`GameDefaultMap = WL_V2_GoldenArrival` (the EMPTY World-Partition map) unless `WL_MAP_ARG`
names the classic map — capture-hero-shots then rightly deletes the frame (no `HeroCam0`);
and a failed capture must never re-register the newest OLD frame (`V2_PASS_006` was such a
stale re-registration and is marked INVALID in the Studio history).
