# Wonderland V2 — session log (2026-08-25)

Evidence of the work, in the founder's terms: commits, passes, what each
pass changed, and what remains unverifiable until the Studio runs.

## Commits on `relay/wonderland-v2` (base `667fbf9`)

- f104805 18:48 Wonderland V2: diagnostic recipe contact sheet (meshkit backend; form only, never evidence)
- cdccd96 18:47 Wonderland V2: Box validity for cut-out selection (verified ctor is Box(min, max); is_valid is a property)
- ebee4cc 18:45 Wonderland V2: the engine API verified against Epic's 5.5 Python docs -- six mismatches fixed before they cost a Studio cycle
- be2b381 18:37 Wonderland V2: Marble cut-outs, V2 gates in prepare.sh, pull-and-compare, template candidates
- 5ed00d0 18:32 Wonderland V2: composition pass from the guide view -- corners, steps at 30 m, floral arch + gateway, heart nearer, towers and tree in frame, path kerbs
- aa7c4a8 18:28 Wonderland V2: guide-view pass -- pale path, sunken plaza steps, pedestals, garden gate, clock tree in frame, unique city permutations, layout gate, batching, dressing, diagnostic projector
- 8d660cb 17:28 Wonderland V2: rebuilt to the Marble reference -- V1 write-guard, world bible, cameras, kit and vegetation families
- fbbb87b 15:42 Wonderland V2: a new world from an empty level -- the foundation, built offline, unrendered

## Passes

1. **Foundation** — branch, namespace, empty-map builder, cameras, 44 recipes, 4 masters, physical light regime, Marble world registration.
2. **Marble reference** — original preserved with provenance; every feature measured; the seam finding (one gate behind the viewpoint); two locked cameras; layout rebuilt to the panorama; palette re-measured; V1 write-guard; world bible; reprojection + comparison tools; city language (4 bodies × 5 roofs, facade, arcade); 8 vegetation families.
3. **Guide view** — path colour, sunken plaza steps, corner pedestals, garden gate, giant mushroom on its base, clock tree brought into frame (measured on the reprojection), unique city permutations, layout gate, batching, dressing, diagnostic projector.
4. **Composition** — steps at 30 m, floral arch + gateway, heart nearer, towers/tree in frame, path kerbs and near hedges, the big pink palace behind the arch.
5. **Marble cut-outs** — the reference's own landmarks cut from the imported mesh; V2 gates in `prepare.sh`; pull-and-compare.
6. **API verification** — Epic's 5.5 Python docs read; six signature/name mismatches fixed; the empty World Partition level created directly.
7. **Recipe sheet** — every recipe rendered on the fallback backend; tree limbs and vines corrected from it.
8. **Ship path** — `ship_v2.sh` (whole-branch bundle over ssh, md5-verified, build pinned to the shipped head) + its fake-ssh test; compile preflight first in `v2-build.sh`.
9. **Neutral textures** — measured that the shared albedos carry colour (ashlar 0.39/0.34/0.24, roof 0.51/0.11/0.16 linear) and the master multiplies them by the tint, so cream would render brown: `textures_v2.py` (T_V2_*, linear-neutralised, sidecar means, plaza slab + path flag families), `verify_v2_textures.py`, tint/mean correction in `materials_v2.py`, generated and gated in `v2-build.sh`.
10. **Measured comparison** — `diff_v2.py` ranks the five largest regional differences (luma/chroma/hue/edges/bright/blue on a 6×4 grid) between a render and the reference view at the same camera; `pull_render.sh` runs it and records the fps median `v2-shot.sh` now measures per pass.
11. **Performance (gauntlet G)** — two INSTANCING HLOD layers (far: always loaded, castle/skyline; near: garden bands) as the World Partition default, `is_spatially_loaded`/`hlod_layer` by band on every actor, an opt-in `build-hlod` commandlet step in the shared build, a `V2 PERFORMANCE` manifest line. API names verified against Epic's 5.5 docs; the runtime hash grids are not scriptable and the log says so.
12. **Audit + lawn** — derived-number audit of every unit-bearing comment (sun pitch −55 vs measured +58 → −58; camera bearings recomputed, the rose cones are outside the frame as in the panorama; clock tree 21.6 m → 16 m measured; plaza width prose); the layout gate now checks the gate-view camera and every recipe's folder key; `compare_v2` labels diagnostics NOT A RENDER; the garden floor is a noise-displaced lawn mesh per side (`garden_lawn`, `MI_V2_Lawn`) instead of the flat moss plane.

## Real Unreal renders this session

**None.** The Studio `aquala-wonderland` was stopped for the whole session
(checked repeatedly). The first render is `V2_PASS_001` and it is the next
thing that happens once the Studio is started on CPU and then switched to the
L4 for the capture.

## V1

Untouched: `tools/v1_guard.py --since 667fbf9` reports 0 legacy paths changed.
