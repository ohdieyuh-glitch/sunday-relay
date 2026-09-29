# TERRACE FLOORS TURNED THE RIGHT WAY: re-yaw SM_terrace_platform by +90 and WL_Ground_Kerb_Run by -90, in place,
# for the passes whose generators misread the plate's axes.
#
# WHAT WAS WRONG (2026-09-28: the W270 PIE proof zzW15, straight-down captures in captures/passes/*plate_check*,
# and a census neighbour-spacing test over every pass). SM_terrace_platform is 1,440 along its LOCAL X and 740
# along Y. Two generators -- WorldDesign/Wedges/w270_rear_seam.py and WorldDesign/Nations/nation_band.py -- laid it
# at yaw = bearing + 0, which puts local X ALONG the road, while spacing the columns 1,440 apart ACROSS it: 7.4 m
# paving strips with 7 m of lawn between, and rows overlapping by 7 m along the road. Both also stood their kerb
# runs at yaw 90, across the verge. The census test: W270S/N/T/G and NC03/TQ03/IC03 have across-neighbours at
# 1,440 cm (700 cm gaps); IC01/IC02/NC01/TQ01/AP01 (other generators) abut at 740, as they should.
#
# PROVEN EQUIVALENT BEFORE ANY EDIT: each corrected generator reproduces its applied specs with every batch,
# instance, position, scale and material identical; the ONLY differences are these yaws. So turning the applied
# instances in place IS the corrected world.
#
# GUARDS: every selected batch at the origin, unrotated and unscaled; every selected instance's CURRENT yaw equal
# to its pass's applied yaw (float32); per-pass batch and instance counts exactly the applied specs' -- or the whole
# job aborts before its first write. Only float 4 (yaw) changes, and all nine floats are read back. REVERSIBLE:
# the record lists every batch with its old and new yaw (undo = the deltas negated). DRY = True changes nothing.
# SAVE as apply_layer does it: one save_map, refused if the map was dirty before this job.
CONCURRENT = False

import json

DRY = globals().get("DRY", True)
SAVE = globals().get("SAVE", False)
MAP_WAS_DIRTY_OK = globals().get("MAP_WAS_DIRTY_OK", False)
PASSES = globals().get("PASSES", ["W270S", "W270N", "W270T", "W270G"])
MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"
RECORD = globals().get("RECORD", r"C:\dev\iwonder\wonderland-task3\wonderland\WorldDesign\Wedges\floor_reyaw_record.json")
N = 9
MATCH = {"plate": "SM_terrace_platform", "kerb": "WL_Ground_Kerb_Run"}
DELTA = {"plate": 90.0, "kerb": -90.0}
#: pass -> kind -> (applied yaw, batches, instances), from the applied specs
APPLIED = {
    "W270S": {"plate": (270.0, 13, 142), "kerb": (0.0, 24, 160)},
    "W270N": {"plate": (270.0, 4, 93)},
    "W270T": {"plate": (270.0, 4, 93)},
    "W270G": {"plate": (270.0, 4, 49), "kerb": (0.0, 16, 168)},
    "NC03": {"plate": (210.0, 3, 528), "kerb": (300.0, 4, 304)},
    "TQ03": {"plate": (330.0, 3, 528), "kerb": (60.0, 4, 304)},
    "IC03": {"plate": (90.0, 3, 528), "kerb": (180.0, 4, 304)},
}


def ydiff(a, b):
    return abs(((a - b) + 180.0) % 360.0 - 180.0)


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    RESULT["status"] = "running"
    RESULT["dry"] = bool(DRY)
    RESULT["passes"] = list(PASSES)
    unknown = [p for p in PASSES if p not in APPLIED]
    if unknown:
        RESULT["status"] = "aborted: no applied record for %s" % unknown
        return
    dirty_before = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["map_dirty_before"] = dirty_before
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    picked = []
    for a in eas.get_all_level_actors():
        if not isinstance(a, unreal.WonderlandInstancedBatch):
            continue
        label = a.get_actor_label()
        pas = label.split("_")[0]
        if pas not in PASSES:
            continue
        mp = str(a.get_editor_property("mesh_path"))
        kind = next((k for k, m in MATCH.items() if m in mp), None)
        if kind is None:
            continue
        picked.append((pas, kind, label, a))
    found = {}
    for pas, kind, label, a in picked:
        nb, ni = found.get((pas, kind), (0, 0))
        found[(pas, kind)] = (nb + 1, ni + len(list(a.get_editor_property("transforms"))) // N)
    want = {(p, k): (v[1], v[2]) for p in PASSES for k, v in APPLIED[p].items()}
    RESULT["found"] = {"%s/%s" % k: v for k, v in sorted(found.items())}
    if found != want:
        RESULT["status"] = "aborted: found %s != applied %s -- nothing changed" % (
            RESULT["found"], {"%s/%s" % k: v for k, v in sorted(want.items())})
        return
    for pas, kind, label, a in picked:
        loc, rot, scl = a.get_actor_location(), a.get_actor_rotation(), a.get_actor_scale3d()
        if (abs(loc.x) + abs(loc.y) + abs(loc.z) > 1.0 or abs(rot.yaw) + abs(rot.pitch) + abs(rot.roll) > 0.01
                or abs(scl.x - 1) + abs(scl.y - 1) + abs(scl.z - 1) > 1e-4):
            RESULT["status"] = "aborted: %s is not at the origin/unrotated/unscaled -- nothing changed" % label
            return
        old = APPLIED[pas][kind][0]
        tf = list(a.get_editor_property("transforms"))
        for i in range(len(tf) // N):
            if ydiff(tf[i * N + 4], old) > 0.05:
                RESULT["status"] = "aborted: %s instance %d yaw %.3f is not the applied %.1f -- nothing changed" % (
                    label, i, tf[i * N + 4], old)
                return
    yield 0.0
    record = {"reason": "terrace plates +90 / kerb runs -90: the axis misreading in w270_rear_seam.py and "
                        "nation_band.py (see zc_floor_reyaw.py)",
              "undo": "run zc_floor_reyaw with each delta negated and APPLIED set to the new yaws",
              "applied": not DRY, "passes": list(PASSES), "batches": []}
    changed = 0
    for pas, kind, label, a in picked:
        old = APPLIED[pas][kind][0]
        new = (old + DELTA[kind]) % 360.0
        tf = [float(v) for v in a.get_editor_property("transforms")]
        new_tf = list(tf)
        for i in range(len(tf) // N):
            new_tf[i * N + 4] = (tf[i * N + 4] + DELTA[kind]) % 360.0
        try:
            package = str(a.get_outermost().get_name())       # the external actor package the save rewrites
        except Exception as exc:                               # noqa: BLE001
            package = "unknown: %r" % exc
        record["batches"].append({"label": label, "pass": pas, "kind": kind, "instances": len(tf) // N,
                                  "old_yaw": old, "new_yaw": new, "package": package})
        if not DRY:
            a.set_editor_property("transforms", new_tf)
            back = [float(v) for v in a.get_editor_property("transforms")]
            for i in range(len(tf) // N):
                for k in range(N):
                    w = new_tf[i * N + k]
                    if abs(back[i * N + k] - w) > 1e-3 * max(1.0, abs(w)):
                        RESULT["status"] = "FAILED: %s instance %d float %d read back %.4f, wanted %.4f" % (
                            label, i, k, back[i * N + k], w)
                        return
        changed += len(tf) // N
        yield 0.0
    with open(RECORD, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=1)
    RESULT["record"] = RECORD
    RESULT["instances"] = changed
    RESULT["dirty"] = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    saved = False
    if SAVE and not DRY:
        if dirty_before and not MAP_WAS_DIRTY_OK:
            RESULT["save_refused"] = "the map had unsaved changes before this job: " + ", ".join(dirty_before)
        else:
            saved = bool(unreal.EditorLoadingAndSavingUtils.save_map(ues.get_editor_world(), MAP))
            RESULT["saved"] = saved
            RESULT["dirty_after_save"] = [p.get_name() for p in
                                          unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["status"] = ("dry run: %d instances in %d batches would turn" % (changed, len(picked)) if DRY
                        else "re-yawed %d instances in %d batches (%s)" % (
                            changed, len(picked), "saved" if saved else "unsaved"))
