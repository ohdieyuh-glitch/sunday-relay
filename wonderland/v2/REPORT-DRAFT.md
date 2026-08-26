# V2 hybrid-world report — DRAFT (facts fixed so far; render sections filled in as passes land)

V2 BRANCH: relay/wonderland-v2
V2 HEAD: (filled at report time)
V2 MAP: /Game/WonderlandV2/Maps/WL_V2_GoldenArrival (empty World Partition level, `LevelEditorSubsystem.new_level(path, True)`; 2 engine actors at creation)

V1 ENVIRONMENT MODIFIED: NO — `tools/v1_guard.py --since 667fbf9`: 0 legacy paths changed; the pre-commit hook gates every commit on this branch.

CANONICAL MARBLE WORLD:
WORLD ID: ae83acaa-df79-4e92-b31f-53af690d5deb (operation 0de3c95d…, marble-1.1, 2026-08-21; 1,580 credits + 3,500 for the HQ mesh)
REFERENCE FILES: v2/reference/marble-royal-garden-backdrop-panorama.png (4608×2304, byte-identical export; was named .jpg, is PNG), -thumbnail.jpg, PROVENANCE.md, ANALYSIS.md, VISUAL_SPEC.md; HQ mesh on the Studio (141,473,320 bytes) at marble-assets/royal-garden-backdrop/mesh_hq.glb; no splat/depth/camera export exists for this world (the API can serve the splat free of charge — needs WORLDLABS_API_KEY, absent on both machines).
ADDITIONAL VIEWS RECOVERED/GENERATED: (renders of the Marble mesh in Unreal from MarbleView_Forward/LeftGarden/RightGarden/Elevated/CastleApproach/Reverse — filled in as captured). Marble itself has no re-render operation (verified: MarbleCanonical/MULTIVIEW-RESEARCH.md); 0 credits spent this session.

MARBLE WORLD-BIBLE: v2/reference/MarbleCanonical/ (README = index + view plan + ownership tags; LANDMARK-MAP.md; MULTIVIEW-RESEARCH.md) + ANALYSIS.md / VISUAL_SPEC.md / PROVENANCE.md
SPATIAL DATA EXTRACTED: eye height 2.62 m; horizon level; sun az +79° el +58°; gate 4.2 m opening 9.1 m behind the viewpoint, piers 6.5 m; plaza 16 m wall to wall (13 m slab field); path 4.4 → 3 m, steps at 30 m, floral arch 36 m, gateway 45 m; giant mushroom cap ~20 m at 22 m; clock tree 16 m at 28 m; heart 5 m at 28 m; towers 14–20 m at 45–75 m; city 95–400 m in three depth layers (Marble p90 118 m, max 169 m); walls 0.85 m. Measured on the cam0 reprojection, not the flat panorama.

BAND A — UNREAL HERO FOREGROUND (authored, UNREAL_PRODUCTION/BAND_A):
plaza (455 slabs, 4 slab variants, 2 tones, instanced batches), central path (spline-laid flags with kerbs, 3 steps, balustrades, urns), arrival gate (piers, open gold leaves, finials, urns), retaining walls + raised beds + hedges + roses + rose cones on planters, pedestals with gold finials, side steps, garden lawn meshes, giant mushroom (cap/stem/stone ring base/clock/ivy/vines), garden gate, nearby topiary, ground flowers/petals.
BAND B — MODULAR MIDGROUND (BAND_B): clock tree (trunk + limbs + canopies + vines + clock), heart topiary on a terrace, floral arch + stone gateway, big tree, tree_slender, hedge masses, towers (4 bodies × 5 roofs, balconies, finials), city groups at 95–130 m, dressing (5 families, PCG-style exclusion), HLOD_V2_Near.
BAND C — MARBLE/DISTANT (BAND_C): city groups at 155–400 m (modular kit, HLOD_V2_Far, never unloaded) + the EXPERIMENT: the Marble world beyond 200 m as MARBLE_DISTANT_SCENIC (visible, no collision, Nanite, two-sided unlit-gain material) — judged per render (quality / triangles / lighting / camera robustness); `marbleDistant=0` removes it.

MARBLE CONTENT REMOVED FROM HERO AREA: the six cut-outs from the Marble mesh that were designed as visible landmarks — GiantMushroom, RoseCone_L, RoseCone_R, ClockTree, HeartTopiary, GardenGate — are OFF (`marbleCutouts=0`); the full Marble world is a hidden MARBLE_REFERENCE_ONLY scaffold with NO collision; no Marble material is used by any kit asset.

PLAZA / PATH / GATES / TREES / TOPIARY / MUSHROOMS / GARDENS / CLOCKS / ARCHITECTURE / CITY: (state after the latest render)

MATERIALS: 4 masters (surface/foliage/portal/sky), 35 instances, V2 neutral texture set (14 families, plaza slabs + path flags authored; tint/mean correction; gate PASS at full size on the Studio).
PCG: secondary dressing only (dressing_v2: flowers, small mushrooms, shrubs) with plaza/corridor exclusion; landmarks, gates, path, skyline are authored.
PYTHON: build_v2.py assembles (map → data layers → HLOD → materials/textures → Geometry Script assets → ground → Marble quarantine → composition → dressing → light → 8 cameras → save → manifest); verify_v2_layout / _textures / _dryrun gates.
NANITE: on every kit asset via the asset creator options; on the Marble scaffold.
WORLD PARTITION: enabled (empty partitioned level; is_spatially_loaded by band; runtime grid = engine default, not scriptable).
DATA LAYERS: 7 real Data Layer instances (V2_Arrival … V2_VFX).
LUMEN / ATMOSPHERE: SM6 + Lumen + VSM config; SkyAtmosphere + height fog + volumetric fog + the panorama dome above +8°; sun 60,000 lux 5600 K at −58/−11.

REAL UNREAL RENDERS CREATED: (list of V2_PASS_nnn with camera and what changed)
GAUNTLETS COMPLETED: 1. 2. 3. 4. 5. 6. 7. (filled as run)
MARBLE PERFORMANCE COST / UNREAL PERFORMANCE / FPS / GPU / VRAM: build 479eccf at HeroCam0, 1080p, L4: median 9.05 ms = 110.6 fps, mean 9.64 ms, p95 15.4 ms (CSV profiler, no HLOD proxies built); Marble scaffold hidden (no cost), distant ring not yet placed (fix a4caabc).
FIVE LARGEST REMAINING DIFFERENCES: (from diff_v2 on the latest pass)
