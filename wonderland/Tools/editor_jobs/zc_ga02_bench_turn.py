# TURN GOLDEN ARRIVAL'S FOUNTAIN BENCHES TO FACE THE FOUNTAIN -- four StaticMeshActors, yaw + 180, nothing else.
#
# ga02_clock_plaza_heart_garden.py placed Bench0-3 at yaw = the angle FROM the fountain under the comment "Benches
# facing the fountain"; SM_garden_bench's seat faces its local +X, so each sat with its back to the water (end-on
# frame: captures/zc/ga02_bench_check, 2026-09-29). The generator is fixed and its spec differs from the committed
# one in exactly these four yaws (every batch and the other 28 actors identical). This applies that delta in place:
#   GUARD   each bench is found by its label GA02_Bench<k>, must carry WL_PASS_GA02, must stand within 5 cm of its
#           spec position and at its OLD yaw within 1 degree -- else nothing is changed at all.
#   RECORD  old and new yaw per bench go into RESULT (and WorldDesign/GoldenArrival/ga02_bench_turn_record.json
#           holds the same, written from the spec diff), so turning them back is the same job with the pair swapped.
#   SAVE    only if the map had no unsaved changes before, and only as this editor session's one save.
# Refuses a play session.
CONCURRENT = False

import unreal

SAVE = globals().get("SAVE", True)
MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"
# label: (x, y, old yaw, new yaw) -- from ga02_clock_plaza_heart_garden.json before / after the generator fix
BENCHES = {
    "GA02_Bench0": (565.69, 5965.69, 45.0, 225.0),
    "GA02_Bench1": (-565.69, 5965.69, 135.0, 315.0),
    "GA02_Bench2": (-565.69, 4834.31, 225.0, 45.0),
    "GA02_Bench3": (565.69, 4834.31, 315.0, 135.0),
}


def _yawdiff(a, b):
    return abs(((a - b) + 180.0) % 360.0 - 180.0)


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        RESULT["status"] = "refused: PIE is running"
        return
    dirty = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["map_dirty_before"] = dirty
    if dirty:
        RESULT["status"] = "refused: the map has unsaved changes"
        return
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    found = {}
    for a in eas.get_all_level_actors():
        label = a.get_actor_label()
        if label in BENCHES:
            found.setdefault(label, []).append(a)
    problems = []
    for label, (x, y, old, new) in BENCHES.items():
        hits = found.get(label, [])
        if len(hits) != 1:
            problems.append("%s: %d actors with that label" % (label, len(hits)))
            continue
        a = hits[0]
        if unreal.Name("WL_PASS_GA02") not in a.tags:
            problems.append("%s: not tagged WL_PASS_GA02" % label)
        loc, rot = a.get_actor_location(), a.get_actor_rotation()
        if abs(loc.x - x) > 5.0 or abs(loc.y - y) > 5.0:
            problems.append("%s: at (%.1f, %.1f), spec (%.1f, %.1f)" % (label, loc.x, loc.y, x, y))
        if _yawdiff(rot.yaw, old) > 1.0:
            problems.append("%s: yaw %.2f, expected %.1f" % (label, rot.yaw, old))
    RESULT["guard_problems"] = problems
    if problems:
        RESULT["status"] = "refused: " + "; ".join(problems)
        return
    record = []
    for label, (x, y, old, new) in BENCHES.items():
        a = found[label][0]
        before = a.get_actor_rotation()
        a.modify(True)
        a.set_actor_rotation(unreal.Rotator(roll=before.roll, pitch=before.pitch, yaw=new), False)
        after = a.get_actor_rotation()
        record.append({"label": label, "old_yaw": round(before.yaw, 2), "new_yaw": round(after.yaw, 2),
                       "read_back_ok": _yawdiff(after.yaw, new) <= 0.5})
    RESULT["record"] = record
    if not all(r["read_back_ok"] for r in record):
        RESULT["status"] = "FAIL: a bench did not read back at its new yaw (unsaved)"
        return
    yield 0.5
    RESULT["dirty_after_turn"] = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    if SAVE:
        RESULT["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(ues.get_editor_world(), MAP))
    RESULT["dirty_end"] = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["status"] = "turned 4 benches" + (" (saved)" if SAVE else " (not saved)")
