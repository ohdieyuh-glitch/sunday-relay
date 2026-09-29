# Globals: CONFIG = a json {"expect": {pass: batch count}, "replaced_passes": [...], "replaced_record": path or null,
#          "modified_record": path or null (packages an in-place edit job recorded, e.g. zc_cull_edit_in_place)}.
CONFIG = globals().get("CONFIG")
# Editor job: the ONE save of write window 1, behind a dirty-package gate.
# Saves only if every dirty package is one of these:
#   (a) the external package of an actor tagged with one of the window's 15 passes;
#   (b) a package recorded (zzW67) as belonging to a REPLACED pass before the re-apply (an expected deletion);
#   (c) an __ExternalObjects__ package (folders), listed by name;
#   (d) the map stub.
# It also requires every pass's actor count to equal its spec's batch count, and the guarded TR01 packages
# (Golden Arrival clock-plaza steps) to be untouched.
import json
import time

MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"
S = "C:/Users/Kaisi/AppData/Local/Temp/claude/C--Users-Kaisi/3fac451f-d692-4e52-82cc-49dd0ba99485/scratchpad/"
CFG = json.load(open(CONFIG))
EXPECT = CFG["expect"]
REC = json.load(open(CFG["replaced_record"])) if CFG.get("replaced_record") else {}
REPLACED = set(p for k in CFG.get("replaced_passes", []) for p in REC.get(k, []))
GUARD = set(REC.get("TR01", []))
# (e) packages MODIFIED IN PLACE by a recorded edit job (the tree cull, zzW446): every one must be dirty, nothing else
MODIFIED = set(json.load(open(CFG["modified_record"]))) if CFG.get("modified_record") else set()
DO_SAVE = globals().get("DO_SAVE", True)


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    world = ues.get_editor_world()
    dirty = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["dirty_before_count"] = len(dirty)
    counts = {k: 0 for k in EXPECT}
    pass_pkgs = set()
    guard_now = set()
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        tags = [str(t) for t in a.tags]
        if "WL_PASS_TR01" in tags:
            guard_now.add(a.get_outermost().get_name())
        for k in EXPECT:
            if "WL_PASS_" + k in tags:
                counts[k] += 1
                pass_pkgs.add(a.get_outermost().get_name())
    RESULT["pass_actor_counts"] = counts
    RESULT["count_mismatch"] = {k: (counts[k], EXPECT[k]) for k in EXPECT if counts[k] != EXPECT[k]}
    RESULT["guard_tr01_intact"] = (guard_now == GUARD) if GUARD else True
    cats = {"new_pass": 0, "replaced_deleted": 0, "modified": 0, "objects": [], "stub": [], "unexpected": []}
    for p in dirty:
        if p in GUARD:
            cats["unexpected"].append(p)
        elif p in pass_pkgs:
            cats["new_pass"] += 1
        elif p in REPLACED:
            cats["replaced_deleted"] += 1
        elif p in MODIFIED:
            cats["modified"] += 1
        elif "/__ExternalObjects__/" in p:
            cats["objects"].append(p)
        elif p == MAP:
            cats["stub"].append(p)
        else:
            cats["unexpected"].append(p)
    RESULT["dirty"] = cats
    ok = (not cats["unexpected"]) and not RESULT["count_mismatch"] and RESULT["guard_tr01_intact"] \
        and cats["new_pass"] == sum(EXPECT.values()) and cats["modified"] == len(MODIFIED)
    RESULT["gate_ok"] = ok
    if not ok:
        RESULT["status"] = "refused"
        RESULT["saved"] = False
        return
    if DO_SAVE:
        t0 = time.time()
        RESULT["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(world, MAP))
        RESULT["save_seconds"] = round(time.time() - t0, 1)
        yield 1.0
        RESULT["dirty_after"] = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["status"] = "done"
