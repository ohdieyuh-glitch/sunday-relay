# Wonderland V2 — resume point (GPU session ended 2026-08-26 ~19:20 UTC)

## Where to pick up

| | |
|---|---|
| DATE/TIME | 2026-08-26, GPU session ended ~19:20 UTC |
| BRANCH | `relay/wonderland-v2` |
| AUTHORITATIVE MAP | `/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2` — **classic (non World Partition) container**, 445 actors, 437 production-tagged, 8 cameras, umap 877,890 bytes |
| CONTENT ROOT | `/Game/WonderlandV2` |
| CANONICAL REFERENCE | `v2/reference/marble-royal-garden-backdrop-panorama.png` (4608×2304, byte-identical Marble export; world id `ae83acaa-df79-4e92-b31f-53af690d5deb`) |
| HERO CAMERA — **LOCKED** | `HeroCam_V2_MarbleReference`, (0, −150, 262), pitch −2 / yaw 90, FOV 100 |
| VISUAL MODE | **SUPERVISED**: one major visual category → real Unreal render → founder review → next category. No autonomous multi-hour visual marathons. |

## Visual status

- **First visible V2 world: ACHIEVED and APPROVED** — `v2/reference/renders/V2_FIRST_VISIBLE_APPROVED_FOUNDATION_cam0_720p.png`, commit `9158e48`, tag `v2-first-visible-foundation`. Structure approved by the founder; composition, path, castle massing and camera are locked.
- **Vegetation pass 1: BUILT, NOT YET RENDERED.** Twelve recipes rebuilt as leaf foliage (leaf blades in clumps, twigs, petal flowers) and generated into the map; the cook that would have produced the render was interrupted when the Studio became unreachable. Founder review is **pending a render**, not pending a decision.
- **The grey world is fixed** (not yet seen in a frame): the master materials failed to compile because their texture parameters held the engine's colour `DefaultTexture` under Normal/Grayscale samplers — *"(Node TextureSampleParameter2D) Sampler type is Normal, should be Color"*. Masters now get verified default textures; the last cook logged **0** "Failed to compile Material".

## The black-screen incident — RESOLVED

Root cause: the World Partition container created by `new_level(path, is_partitioned_world=True)` never registered its actors for cooking — 448 external actor packages existed on disk, but the cooked IoStore contained none, `GenerateStreaming` took 69 ms for both the empty and the populated world, and the packaged runtime held **0** production actors. Every capture was black under both shader models, all view modes, and both capture paths.

Fix: rebuild the identical world (same generator, same layout, same meshes) into a **classic** container. Runtime then reported `WL_TAG_VISIBILITY show=[UNREAL_PRODUCTION] shown=437`.

Open structural work: re-partitioning. `WorldPartitionConvertCommandlet` refused to start in this container (demands a Vulkan driver even with `-AllowCommandletRendering -RenderOffscreen` and the ICD mounted). The classic container renders; World Partition is deferred, not abandoned.

## Proven-good render configuration (regression baseline)

Vulkan **SM5**, NVIDIA L4, `-RenderOffscreen`, Pixel-Streaming → **real Chrome** (`capture-hero-shots.sh` → `shot.cjs`), ≤1280×720, map chosen with `WL_MAP_ARG`. `HighResShot` is a **phantom here** — it writes all-zero PNGs; `frame-check.py`'s `verdict=` must be read, not its exit code.

Diagnostic regression assets, all preserved: map `WL_V2_GoldenArrival_Diag/WL_V2_RenderDiagnosticClassic` (generator `v2/diag/build_classic_diag_map.py`), material `M_DiagUnlitMagenta`, and the packaged proof frame `v2/reference/renders/DIAG_CLASSIC_PACKAGED_MAGENTA_720p.png` (99% magenta, `verdict=STRUCTURED`).

## Resume commands (CPU first; L4 only for the capture)

```bash
# 1. ship the branch to the Studio (bundle over ssh, md5 verified)
bash wonderland/v2/tools/ship_v2.sh --ship-only
# 2. regenerate the world (needs an RHI: the masters must compile)
ssh wonderland-l4 'cd .../src && WLV2_REUSE_ASSETS=1 WP_STEP=build bash wonderland/v2/diag/wp_recover.sh'
# 3. cook only that map, clean
WL_EXTRA_ENV="WL_COOK_MAP=/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2 WL_SKIP_GENERATE=1 \
  SKIP_COMPILE_PREFLIGHT=1 WL_SKIP_BUILD_EDITOR=1 WL_BUILD_HLOD=0 SKIP_V2_TEXTURES=1 \
  FORCE_REBUILD=1 WONDERLAND_MIN_PIECES=0 ALLOW_EMPTY_LEVEL=1" bash wonderland/v2/tools/ship_v2.sh
# 4. one capture at the locked camera, then compare
WL_RES_X=1280 WL_RES_Y=720 bash wonderland/v2/tools/round.sh
```

## NEXT VISUAL PASS — recorded only, not started

**Render the vegetation pass** (already built) at HeroCam0 and hand the founder: the new render, before/after against `V2_FIRST_VISIBLE_APPROVED_FOUNDATION`, and new-vs-Marble. It is the first frame that will show the world in colour rather than the engine's grey checker. Nothing else may be changed until the founder judges it.

## Permanent principles

- Wonderland **V1 is archived / read-only** — never developed again; the write-guard (`tools/v1_guard.py`, pre-commit hook) stays.
- Wonderland **V2 is the authoritative environment**; the canonical Marble panorama is its visual foundation.
- **Marble designs, guides and may accelerate distant scenery; Unreal owns the playable world.** No raw Marble geometry in the player-facing foreground.
- Never regress to V1's primitive/cartoonish asset language.
- The founder-approved hero camera and composition are not casually redesigned.
- Broad autonomy for bounded engineering; **supervised** autonomy for visuals.
- Visual progress requires a **real Unreal render**. Offline traces, contact sheets and Python rasterisations are diagnostics, never acceptance.
- One visual category at a time until the founder expands autonomy.
