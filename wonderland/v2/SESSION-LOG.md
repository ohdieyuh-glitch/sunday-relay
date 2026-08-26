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

## Real Unreal renders this session

**None.** The Studio `aquala-wonderland` was stopped for the whole session
(checked repeatedly). The first render is `V2_PASS_001` and it is the next
thing that happens once the Studio is started on CPU and then switched to the
L4 for the capture.

## V1

Untouched: `tools/v1_guard.py --since 667fbf9` reports 0 legacy paths changed.
