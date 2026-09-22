# Editor job: build the PROJECT AVATAR asset families into /Game/WonderlandV2/Characters/Avatars.
#
# FOUNDER DIRECTIVE (2026-09-22): build the world-asset half of Project Avatars -- TEN TAILS, CHERUBIM
# and SERAPH, each at SMALL, MEDIUM and LARGE, with real morphological development rather than one model
# scaled three times. This lane owns meshes, materials, silhouette, the joint structure a rig needs, LODs,
# collision and packaging. Runtime -- growth, hover, gait, spawning, Brain integration -- is Internal
# Development's and is not touched here.
#
# The geometry lives on the forge branch beside the Relay Dog's own generator, because it uses the same
# proven pipeline: a canon module of pure numbers (ten_tails_canon / cherubim_canon / seraph_canon), the
# shared avatar_common part system, and gs.py's Geometry Script wrapper. This job is only the door into the
# editor: it adds that folder to sys.path, reloads it so a re-run picks up edits, and builds one FAMILY at a
# time so the channel keeps breathing between them.
#
# It creates ASSETS ONLY. It does not touch the open map, spawns nothing, and saves no level.
# Globals: FORGE, OUT, FAMILIES (comma list or blank for all), STAGES (comma list or blank for all).
import importlib
import json
import sys

FORGE = globals().get("FORGE", r"C:/dev/iwonder/wonderland-blender-forge/wonderland/v2")
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/avatar_build.json")
FAMILIES = [s for s in str(globals().get("FAMILIES", "")).split(",") if s]
STAGES = [s for s in str(globals().get("STAGES", "")).split(",") if s]
WIPE = bool(globals().get("WIPE", False))


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    # Building assets while the game world is up risks cooking a half-made asset into a PIE session.
    while ues.get_game_world() is not None:
        yield 5.0
    if FORGE not in sys.path:
        sys.path.insert(0, FORGE)
    import avatar_common, gs, dog_canon                      # noqa: E401
    import ten_tails_canon, cherubim_canon, seraph_canon     # noqa: E401
    import avatars_v2                                        # noqa: E401
    for mod in (avatar_common, gs, dog_canon, ten_tails_canon, cherubim_canon, seraph_canon, avatars_v2):
        importlib.reload(mod)
    avatars_v2 = sys.modules["avatars_v2"]

    ctx = gs.Context(unreal, avatars_v2.LOG)
    RESULT["backend"] = str(ctx.backend)
    RESULT["caps"] = ctx.caps.report()
    yield 0.2

    if WIPE:
        # only ever set when every family and stage is being rebuilt in the same run
        RESULT["wiped"] = avatars_v2.wipe()
        yield 1.0

    families = FAMILIES or sorted(avatars_v2.FAMILIES)
    stages = STAGES or list(avatar_common.STAGES)
    report = {"backend": str(ctx.backend), "caps": ctx.caps.report(), "families": {}}
    summary = {}
    for family in families:
        mod = avatars_v2.FAMILIES[family]
        mats = avatars_v2.build_materials(family, mod)
        fam = {"materials": sorted(mod.MATERIALS), "stages": {}}
        yield 0.5
        for stage in stages:
            # Drive the mesh generator ONE MESH AT A TIME. The first full run built all 343 meshes in nine
            # uninterrupted steps: the channel heartbeat went three and a half minutes without a tick over Ten
            # Tails MEDIUM, and the editor's private footprint reached 19.5 GB against a 55 GB commit limit,
            # because nothing could reclaim a finished DynamicMesh until the whole stage was done. Yielding here
            # lets the engine breathe and collect between meshes.
            # ...but yield every YIELD_EVERY meshes, not every mesh. Yielding on each one made the job wait for
            # the next editor tick 343 times: the same build went from 410 s to roughly 1,200 s, about 2.3 s of
            # pure waiting per mesh. Twelve at a time keeps the heartbeat alive and the garbage collected while
            # giving almost all of that back.
            YIELD_EVERY = 12
            gen = avatars_v2.build_stage_meshes(ctx, family, stage, mod)
            built, step = None, 0
            while built is None:
                try:
                    next(gen)
                    step += 1
                except StopIteration as stop:
                    built = stop.value
                    break
                if step % YIELD_EVERY == 0:
                    yield None
            meshes, rows, piv, socks, measure = built
            yield 0.4
            bp_path, made = avatars_v2.build_stage_blueprint(
                family, stage, mod, meshes, mats, piv, socks, measure["k"])
            measure.update({"blueprint": bp_path, "components": made,
                            "draw_calls_est": made["meshes"], "meshes": rows})
            fam["stages"][stage] = measure
            summary["%s/%s" % (family, stage)] = {
                "height_m": measure["metres"]["height"],
                "width_m": measure["metres"]["width"],
                "depth_m": measure["metres"]["depth"],
                "meshes": made["meshes"],
                "tris": measure.get("tri_actual") or measure["tri_estimate"],
                "eyes": measure["eyes"],
                "joints": measure["joints"],
                "capsule": measure["capsule_recommendation_cm"]}
            yield 0.4
        report["families"][family] = fam
        yield 0.5

    with open(OUT, "w", newline="\n") as f:
        json.dump(report, f, indent=1)
    RESULT["summary"] = summary
    RESULT["out"] = OUT
    RESULT["status"] = "done"
